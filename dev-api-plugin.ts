import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, extname } from 'path';
import { execSync } from 'child_process';
import { statSync } from 'fs';
import { config } from 'dotenv';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

type GameEntry = { title: string; order: number; [key: string]: unknown };

function renumberOrders(games: GameEntry[]) {
  games
    .sort((a, b) => a.order - b.order)
    .forEach((g, i) => { g.order = i; });
}

function parseBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default function devApiPlugin(): Plugin {
  const root = process.cwd();
  const gamesPath = resolve(root, 'public/data/games.json');
  const coversPath = resolve(root, 'public/data/covers.json');
  const coversDir = resolve(root, 'public/covers');

  // Load .env.local for SGDB API key
  config({ path: resolve(root, '.env.local') });

  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next();

        try {
          if (req.url === '/api/upload-cover') {
            const body = JSON.parse(await parseBody(req));
            const { title, imageData, filename } = body as {
              title: string;
              imageData: string; // base64
              filename: string;
            };

            if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true });

            // Decode base64 and write file
            const ext = extname(filename) || '.png';
            const slug = slugify(title);
            const outName = `${slug}${ext}`;
            const outPath = resolve(coversDir, outName);
            const buffer = Buffer.from(imageData, 'base64');
            writeFileSync(outPath, buffer);

            // Update covers.json
            const covers = existsSync(coversPath) ? readJson(coversPath) : {};
            covers[title] = {
              sgdbId: covers[title]?.sgdbId ?? null,
              file: outName,
              fetchedAt: new Date().toISOString(),
            };
            writeJson(coversPath, covers);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ coverUrl: `/covers/${outName}?t=${Date.now()}` }));
            return;
          }

          if (req.url === '/api/add-game') {
            const body = JSON.parse(await parseBody(req));
            const { title, subtitle, platforms } = body as {
              title: string;
              subtitle?: string | null;
              platforms: string[];
            };

            const games = readJson(gamesPath);

            // Check for duplicate
            if (games.some((g: { title: string }) => g.title === title)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `"${title}" already exists` }));
              return;
            }

            // Find alphabetical insert position among same-letter games
            const norm = (t: string) => t.replace(/^the\s+/i, '').toLowerCase();
            const newNorm = norm(title);
            const newLetter = newNorm.charAt(0).toUpperCase();

            const sameLetterGames = games
              .filter((g: GameEntry) => {
                const gl = norm(g.title).charAt(0).toUpperCase();
                return gl === newLetter;
              })
              .sort((a: GameEntry, b: GameEntry) => a.order - b.order);

            // Find the game it should go before
            let insertOrder: number;
            const insertBefore = sameLetterGames.find(
              (g: GameEntry) => norm(g.title) > newNorm
            );
            if (insertBefore) {
              insertOrder = insertBefore.order;
              // Bump everything at or after this order
              for (const g of games) {
                if ((g as GameEntry).order >= insertOrder) (g as GameEntry).order++;
              }
            } else if (sameLetterGames.length > 0) {
              insertOrder = sameLetterGames[sameLetterGames.length - 1].order + 1;
              // Bump everything after
              for (const g of games) {
                if ((g as GameEntry).order >= insertOrder) (g as GameEntry).order++;
              }
            } else {
              insertOrder = games.length;
            }

            games.push({
              title,
              subtitle: subtitle || null,
              platforms,
              extras: [],
              sgdbId: null,
              coverOverride: null,
              gameOfGames: null,
              order: insertOrder,
            });

            renumberOrders(games);
            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ title, added: true }));
            return;
          }
          if (req.url === '/api/browse-covers') {
            const apiKey = process.env.SGDB_API_KEY;
            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'SGDB_API_KEY not set' }));
              return;
            }

            const body = JSON.parse(await parseBody(req));
            const { title, sgdbId } = body as { title: string; sgdbId?: number };

            const SGDB = (await import('steamgriddb')).default;
            const client = new SGDB(apiKey);

            let gameId = sgdbId;
            let gameName = title;
            if (!gameId) {
              const results = await client.searchGame(title);
              if (!results || results.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ images: [], gameName: title }));
                return;
              }
              gameId = results[0].id;
              gameName = results[0].name;
            }

            // Try 600x900 first, then fallback to all grids
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let grids: any[] = [];
            try {
              grids = await client.getGridsById(gameId, undefined, ['600x900']);
            } catch { grids = []; }
            if (!grids || grids.length === 0) {
              try {
                grids = await client.getGridsById(gameId);
              } catch { grids = []; }
            }

            const images = (grids || [])
              .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
              .slice(0, 20)
              .map((g: { id: number; url: { toString(): string }; thumb: { toString(): string }; score: number }) => ({
                id: g.id,
                url: g.url.toString(),
                thumb: g.thumb.toString(),
                score: g.score,
              }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ images, gameId, gameName }));
            return;
          }

          if (req.url === '/api/select-cover') {
            const body = JSON.parse(await parseBody(req));
            const { title, imageUrl, sgdbId } = body as {
              title: string;
              imageUrl: string;
              sgdbId: number;
            };

            if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true });

            // Download the selected image
            const response = await fetch(imageUrl, { redirect: 'follow' });
            if (!response.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Failed to download: HTTP ${response.status}` }));
              return;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const ext = extname(new URL(imageUrl).pathname) || '.png';
            const outName = `${slugify(title)}${ext}`;
            writeFileSync(resolve(coversDir, outName), buffer);

            // Update covers.json
            const covers = existsSync(coversPath) ? readJson(coversPath) : {};
            covers[title] = {
              sgdbId,
              file: outName,
              fetchedAt: new Date().toISOString(),
            };
            writeJson(coversPath, covers);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ coverUrl: `/covers/${outName}?t=${Date.now()}` }));
            return;
          }

          if (req.url === '/api/edit-game') {
            const body = JSON.parse(await parseBody(req));
            const { originalTitle, title, subtitle, platforms, extras, gameOfGames } = body as {
              originalTitle: string;
              title: string;
              subtitle: string | null;
              platforms: string[];
              extras: { label: string; items: string[] }[];
              gameOfGames: string | null;
            };

            const games = readJson(gamesPath);
            const game = games.find((g: { title: string }) => g.title === originalTitle);
            if (!game) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Game "${originalTitle}" not found` }));
              return;
            }

            // If title changed, update covers.json key too
            if (title !== originalTitle) {
              if (games.some((g: { title: string }) => g.title === title && g !== game)) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `"${title}" already exists` }));
                return;
              }

              const covers = existsSync(coversPath) ? readJson(coversPath) : {};
              if (covers[originalTitle] !== undefined) {
                covers[title] = covers[originalTitle];
                delete covers[originalTitle];
                writeJson(coversPath, covers);
              }
            }

            game.title = title;
            game.subtitle = subtitle;
            game.platforms = platforms;
            game.extras = extras;
            game.gameOfGames = gameOfGames;

            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ title, platforms, extras }));
            return;
          }

          if (req.url === '/api/reorder-games') {
            const body = JSON.parse(await parseBody(req));
            const { titles } = body as { titles: string[] };

            const games = readJson(gamesPath) as GameEntry[];
            // Get the current order values for this group, sorted
            const groupGames = titles.map(t => games.find(g => g.title === t)!).filter(Boolean);
            const orders = groupGames.map(g => g.order).sort((a, b) => a - b);

            // Assign the sorted order slots to the new title sequence
            titles.forEach((t, i) => {
              const game = games.find(g => g.title === t);
              if (game && i < orders.length) game.order = orders[i];
            });

            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.url === '/api/add-extra') {
            const body = JSON.parse(await parseBody(req));
            const { title, label, item } = body as {
              title: string;
              label: string;
              item: string;
            };

            const games = readJson(gamesPath);
            const game = games.find((g: { title: string }) => g.title === title);
            if (!game) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Game "${title}" not found` }));
              return;
            }

            const group = game.extras.find((e: { label: string }) => e.label === label);
            if (group) {
              if (!group.items.includes(item)) {
                group.items.push(item);
              }
            } else {
              game.extras.push({ label, items: [item] });
            }
            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ title, extras: game.extras }));
            return;
          }
          if (req.url === '/api/publish') {
            const token = process.env.GITHUB_TOKEN;
            if (!token) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'GITHUB_TOKEN not set in .env.local' }));
              return;
            }

            const repo = 'arcensurf/game-list';

            // 1. Build
            try {
              execSync('npx vite build', { cwd: root, stdio: 'pipe' });
            } catch (e: unknown) {
              const err = e as { stderr?: Buffer; stdout?: Buffer };
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Build failed:\n' + (err.stderr?.toString() || '') + (err.stdout?.toString() || '') }));
              return;
            }

            // 2. Create tar.gz of dist/
            const distDir = resolve(root, 'dist');
            const artifactPath = resolve(root, '.dist-artifact.tar.gz');
            try {
              execSync(`tar -czf "${artifactPath}" -C "${distDir}" .`, { stdio: 'pipe' });
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Tar failed: ' + String(e) }));
              return;
            }

            const artifactSize = statSync(artifactPath).size;
            const artifactBuffer = readFileSync(artifactPath);
            try { execSync(`rm "${artifactPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }

            // 3. Create Pages deployment
            const createResp = await fetch(`https://api.github.com/repos/${repo}/pages/deployments`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ artifact_size: artifactSize }),
            });

            if (!createResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Pages deployment failed: ' + await createResp.text() }));
              return;
            }

            const deployment = await createResp.json() as {
              status_url: string;
              page_url: string;
              artifact_url: string;
            };

            // 4. Upload the artifact
            const uploadResp = await fetch(deployment.artifact_url, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/zip',
                'Content-Length': String(artifactSize),
              },
              body: artifactBuffer,
            });

            if (!uploadResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Artifact upload failed: ' + await uploadResp.text() }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, pageUrl: deployment.page_url }));
            return;
          }

        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
          return;
        }

        next();
      });
    },
  };
}
