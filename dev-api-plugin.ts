import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
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
  const overridesDir = resolve(root, 'public/data/overrides');

  // Whatever the control window last rolled. OBS runs its own browser
  // process, so a browser source shares nothing with the window you're
  // driving from — no localStorage, no BroadcastChannel. The dev server
  // is the only thing both can see, so it relays the current roll.
  // In-memory on purpose: this is throwaway display state, and it has
  // no business being written into public/data.
  let pickerState: unknown = null;

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
        // The stage view polls this; everything else here is a POST.
        if (req.method === 'GET' && req.url?.split('?')[0] === '/api/picker-state') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ roll: pickerState }));
          return;
        }

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
            const { title, subtitle, platforms, status } = body as {
              title: string;
              subtitle?: string | null;
              platforms: string[];
              status?: 'beaten' | 'backlog';
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
              ...(status === 'backlog' ? { status: 'backlog' } : {}),
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
                    steamAppId, psnNpCommId, xboxTitleId, ffxivLodestoneId } = body as {
              originalTitle: string;
              title: string;
              subtitle: string | null;
              platforms: string[];
              extras: { label: string; items: string[] }[];
              gameOfGames: string | null;
              steamAppId: number | null;
              psnNpCommId: string | null;
              xboxTitleId: string | null;
              ffxivLodestoneId: string | null;
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
            game.ffxivLodestoneId = ffxivLodestoneId ?? null;

            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ title, platforms, extras }));
            return;
          }

          if (req.url === '/api/mark-beaten') {
            const body = JSON.parse(await parseBody(req));
            const { title } = body as { title: string };

            const games = readJson(gamesPath) as GameEntry[];
            const game = games.find((g) => g.title === title);
            if (!game) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Game "${title}" not found` }));
              return;
            }

            delete game.status;
            writeJson(gamesPath, games);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, title }));
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
          // Trophy-picker marks. One file per game under
          // public/data/overrides/<platform>/<id>.json, written only
          // for games that actually have a mark, so the set stays
          // sparse — the achievement shards next door are dense by
          // construction, these are hand-entered.
          if (req.url === '/api/achievement-override') {
            const body = JSON.parse(await parseBody(req));
            const { platform, gameId, title, achievementId, status, days } =
              body as {
                platform: string;
                gameId: string;
                title: string;
                achievementId: string;
                status: 'earned' | 'skipped' | 'unachievable' | null;
                days?: number;
              };

            if (!/^(steam|psn|xbox)$/.test(platform) || !gameId || !achievementId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'platform, gameId and achievementId are required' }));
              return;
            }

            // gameId reaches the filesystem, and it originates from
            // platform APIs — same sanitising the fetch script applies.
            const safeGameId = String(gameId).replace(/[^A-Za-z0-9_-]/g, '_');
            const dir = resolve(overridesDir, platform);
            const file = resolve(dir, `${safeGameId}.json`);

            const existing = existsSync(file)
              ? readJson(file) as { overrides?: Record<string, { status: string; at: string; until?: string }> }
              : {};
            const now = Date.now();

            // Drop expired skips on every write. This is what keeps the
            // files from accumulating dead entries as you roll — an
            // expired skip is not a block, just leftovers.
            const overrides: Record<string, { status: string; at: string; until?: string }> = {};
            for (const [id, mark] of Object.entries(existing.overrides ?? {})) {
              const expired =
                mark.status === 'skipped' && mark.until != null && Date.parse(mark.until) <= now;
              if (!expired) overrides[id] = mark;
            }

            if (status == null) {
              delete overrides[achievementId];
            } else {
              const mark: { status: string; at: string; until?: string } = {
                status,
                at: new Date(now).toISOString(),
              };
              if (status === 'skipped') {
                const span = Number(days) > 0 ? Number(days) : 14;
                mark.until = new Date(now + span * 86400000).toISOString();
              }
              overrides[achievementId] = mark;
            }

            // An empty file is just noise in the tree — drop it so the
            // directory only ever lists games you've actually marked.
            if (Object.keys(overrides).length === 0) {
              if (existsSync(file)) unlinkSync(file);
            } else {
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
              writeJson(file, { platform, id: String(gameId), title, overrides });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, platform, id: String(gameId), title, overrides }));
            return;
          }

          // The control window publishes each roll here so the stage
          // view (and therefore OBS) can pick it up.
          if (req.url === '/api/picker-state') {
            const body = JSON.parse(await parseBody(req));
            pickerState = (body as { roll?: unknown }).roll ?? null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
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

            // Trophy-picker marks, one file per marked game. Unlike the
            // achievement shards next door — which CI writes straight to
            // the data branch — these only exist locally until a publish.
            const OVERRIDES_PREFIX = 'public/data/overrides/';
            const localOverridePaths = new Set<string>();
            if (existsSync(overridesDir)) {
              for (const platform of readdirSync(overridesDir)) {
                const platformDir = resolve(overridesDir, platform);
                if (!statSync(platformDir).isDirectory()) continue;
                for (const file of readdirSync(platformDir)) {
                  if (!file.endsWith('.json')) continue;
                  const repoPath = `${OVERRIDES_PREFIX}${platform}/${file}`;
                  localOverridePaths.add(repoPath);
                  filesToPush.push({
                    repoPath,
                    localPath: resolve(platformDir, file),
                  });
                }
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
            const treeItems: { path: string; mode: string; type: string; sha: string | null }[] = [];

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

            // Clearing a game's last mark deletes its override file, so
            // publish has to remove it on the branch too — otherwise the
            // mark would come back on the next fresh clone. Scoped to the
            // overrides prefix; nothing else here deletes.
            for (const repoPath of remoteShas.keys()) {
              if (!repoPath.startsWith(OVERRIDES_PREFIX)) continue;
              if (localOverridePaths.has(repoPath)) continue;
              treeItems.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
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
