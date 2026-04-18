import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, extname } from 'path';
import { readdirSync } from 'fs';
import { createHash } from 'crypto';

function gitBlobHash(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  return createHash('sha1').update(header).update(content).digest('hex');
}
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

type ExtraGroup = { label: string; items: string[] };
type GameEntry = { title: string; order: number; extras: ExtraGroup[]; [key: string]: unknown };

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

  function ensureCoversDir() {
    if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true });
  }

  function updateCoverEntry(title: string, sgdbId: number | null, fileName: string) {
    const covers = existsSync(coversPath) ? readJson(coversPath) : {};
    covers[title] = {
      sgdbId,
      file: fileName,
      fetchedAt: new Date().toISOString(),
    };
    writeJson(coversPath, covers);
  }

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

            ensureCoversDir();

            // Decode base64 and write file
            const ext = extname(filename) || '.png';
            const slug = slugify(title);
            const outName = `${slug}${ext}`;
            const outPath = resolve(coversDir, outName);
            const buffer = Buffer.from(imageData, 'base64');
            writeFileSync(outPath, buffer);

            const existingCovers = existsSync(coversPath) ? readJson(coversPath) : {};
            updateCoverEntry(title, existingCovers[title]?.sgdbId ?? null, outName);

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

            const games = readJson(gamesPath) as GameEntry[];

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

            ensureCoversDir();

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

            updateCoverEntry(title, sgdbId, outName);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ coverUrl: `/covers/${outName}?t=${Date.now()}` }));
            return;
          }

          if (req.url === '/api/edit-game') {
            const body = JSON.parse(await parseBody(req));
            const { originalTitle, title, subtitle, platforms, extras, gameOfGames,
                    steamAppId, psnNpCommId, xboxTitleId } = body as {
              originalTitle: string;
              title: string;
              subtitle: string | null;
              platforms: string[];
              extras: { label: string; items: string[] }[];
              gameOfGames: string | null;
              steamAppId: number | null;
              psnNpCommId: string | null;
              xboxTitleId: string | null;
            };

            const games = readJson(gamesPath) as GameEntry[];
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
            game.steamAppId = steamAppId ?? null;
            game.psnNpCommId = psnNpCommId ?? null;
            game.xboxTitleId = xboxTitleId ?? null;

            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ title, platforms, extras }));
            return;
          }

          if (req.url === '/api/delete-game') {
            const body = JSON.parse(await parseBody(req));
            const { title } = body as { title: string };

            const games = readJson(gamesPath) as GameEntry[];
            const index = games.findIndex((g) => g.title === title);
            if (index === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Game "${title}" not found` }));
              return;
            }

            games.splice(index, 1);
            renumberOrders(games);
            writeJson(gamesPath, games);

            // Remove cover entry if present
            if (existsSync(coversPath)) {
              const covers = readJson(coversPath);
              if (covers[title] !== undefined) {
                delete covers[title];
                writeJson(coversPath, covers);
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, deleted: title }));
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

            const games = readJson(gamesPath) as GameEntry[];
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
            const branch = 'data';
            const gh = (path: string, opts: RequestInit = {}) =>
              fetch(`https://api.github.com${path}`, {
                ...opts,
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                  ...opts.headers as Record<string, string>,
                },
              });

            // Collect files to push
            const filesToPush: { repoPath: string; localPath: string }[] = [
              { repoPath: 'public/data/games.json', localPath: gamesPath },
              { repoPath: 'public/data/covers.json', localPath: coversPath },
            ];
            if (existsSync(coversDir)) {
              for (const file of readdirSync(coversDir)) {
                filesToPush.push({
                  repoPath: `public/covers/${file}`,
                  localPath: resolve(coversDir, file),
                });
              }
            }

            // Get current commit SHA of the data branch
            const refResp = await gh(`/repos/${repo}/git/ref/heads/${branch}`);
            if (!refResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to get data branch: ' + await refResp.text() }));
              return;
            }
            const refData = await refResp.json() as { object: { sha: string } };
            const baseSha = refData.object.sha;

            // Get base tree
            const commitResp = await gh(`/repos/${repo}/git/commits/${baseSha}`);
            const commitData = await commitResp.json() as { tree: { sha: string } };

            // Fetch the existing tree recursively to diff against
            const existingTreeResp = await gh(`/repos/${repo}/git/trees/${commitData.tree.sha}?recursive=1`);
            const existingTree = await existingTreeResp.json() as {
              tree: { path: string; sha: string; type: string }[];
            };
            const remoteShas = new Map<string, string>();
            for (const item of existingTree.tree) {
              if (item.type === 'blob') remoteShas.set(item.path, item.sha);
            }

            // Only upload files that have changed
            const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];

            for (const file of filesToPush) {
              if (!existsSync(file.localPath)) continue;
              const content = readFileSync(file.localPath);
              const localSha = gitBlobHash(content);

              // Skip if unchanged
              if (remoteShas.get(file.repoPath) === localSha) continue;

              const blobResp = await gh(`/repos/${repo}/git/blobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content: content.toString('base64'),
                  encoding: 'base64',
                }),
              });
              if (!blobResp.ok) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Blob failed for ${file.repoPath}: ` + await blobResp.text() }));
                return;
              }
              const blobData = await blobResp.json() as { sha: string };
              treeItems.push({ path: file.repoPath, mode: '100644', type: 'blob', sha: blobData.sha });
            }

            // Nothing changed
            if (treeItems.length === 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, message: 'No changes to publish' }));
              return;
            }

            // Create tree
            const treeResp = await gh(`/repos/${repo}/git/trees`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base_tree: commitData.tree.sha, tree: treeItems }),
            });
            if (!treeResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Tree failed: ' + await treeResp.text() }));
              return;
            }
            const treeData = await treeResp.json() as { sha: string };

            // Create commit on data branch
            const newCommitResp = await gh(`/repos/${repo}/git/commits`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'Update game data',
                tree: treeData.sha,
                parents: [baseSha],
              }),
            });
            if (!newCommitResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Commit failed: ' + await newCommitResp.text() }));
              return;
            }
            const newCommit = await newCommitResp.json() as { sha: string };

            // Update data branch ref
            const updateResp = await gh(`/repos/${repo}/git/refs/heads/${branch}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sha: newCommit.sha }),
            });
            if (!updateResp.ok) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Ref update failed: ' + await updateResp.text() }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, sha: newCommit.sha }));
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
