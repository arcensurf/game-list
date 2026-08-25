import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync, renameSync } from 'fs';
import { resolve, extname, basename } from 'path';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
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

// Written to a sibling temp file and renamed into place. writeFileSync
// truncates first, so a crash or a full disk mid-write leaves games.json
// half-written and unparseable — and it's the file the whole app loads
// from. rename is atomic on the same filesystem, so a reader sees either
// the old file or the new one, never a partial.
function writeJson(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}


// The publish path writes straight to the R2 bucket the deployed site
// reads from, so a cover pick is live as soon as the button returns —
// no deploy, no branch. Only the slice of scripts/lib/r2.mjs used here.
// Loaded through a variable specifier for the same reason sharp is: the
// module is plain JS with no declarations, and a static import would
// make `tsc -b` fail looking for types that were never written.
type R2Client = {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix?: string): Promise<Map<string, { size: number; etag: string }>>;
  etagOf(body: Buffer): string;
};

async function loadR2(): Promise<R2Client> {
  const specifier = pathToFileURL(resolve(process.cwd(), 'scripts/lib/r2.mjs')).href;
  return (await import(specifier)) as unknown as R2Client;
}

// Set on upload and served back verbatim by the Worker, so getting this
// wrong means a browser refusing to render a perfectly good cover.
const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.json': 'application/json',
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// Cover encoding, kept in step with scripts/fetch-covers.mjs so a cover
// picked in the dev UI and one fetched by the script are encoded
// identically.
const COVER_WIDTH = 600;
const COVER_HEIGHT = 900;
const WEBP_QUALITY = 82;

// Only the slice of sharp's API used here. Declared locally because the
// specifier below is a variable, which stops TypeScript resolving the
// module at compile time — sharp is deliberately absent from
// package.json (its per-platform native packages break `npm ci` on the
// Linux CI runner), and a static import would make `tsc -b` fail there.
type SharpFactory = (input: Buffer) => {
  resize(
    width: number,
    height: number,
    opts: { fit: string; withoutEnlargement: boolean },
  ): { webp(opts: { quality: number }): { toBuffer(): Promise<Buffer> } };
};

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const specifier = 'sharp';
    return ((await import(specifier)) as { default: SharpFactory }).default;
  } catch {
    return null;
  }
}

/**
 * Re-encode a picked cover to WebP.
 *
 * A 600x900 grid runs ~700KB as PNG against ~85KB as WebP, and a page
 * view asks for every cover at once — which is what pushes the batch
 * past what the host will serve without throttling.
 *
 * Fails rather than degrading. This used to fall back to saving the
 * original bytes under their own extension, which was wrong twice over:
 * the caller reported success, so a batch of unconverted covers reached
 * the bucket before anyone noticed; and the sharp-threw branch saved
 * bytes sharp had just refused to read, which is how a 10-byte file
 * ended up in covers.json described as cover art. Refusing keeps the
 * manifest honest — a cover is either a real WebP or it isn't there.
 *
 * build-site-data.yml sweeps the bucket for anything that slipped
 * through by another route, so this is the near guard, not the only one.
 */
async function encodeCover(
  buffer: Buffer,
  slug: string,
): Promise<{ name: string; buffer: Buffer }> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error(
      'sharp is unavailable, so this cover cannot be converted to WebP. ' +
        'Install it for this checkout with:  npm install --no-save sharp',
    );
  }

  let webp: Buffer;
  try {
    webp = await sharp(buffer)
      // `inside` + withoutEnlargement: shrink anything oversized to fit
      // the box while keeping aspect ratio, and leave correctly-sized or
      // smaller grids alone rather than upscaling them.
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (err) {
    throw new Error(
      `This image could not be re-encoded — ${err instanceof Error ? err.message : String(err)}. ` +
        'It may be corrupt or in a format sharp cannot read.',
    );
  }
  return { name: `${slug}.webp`, buffer: webp };
}


/**
 * Remove an earlier cover for this slug when the extension changed.
 *
 * Matching on the slug alone is not enough to prove a file belongs to
 * this game: slugify() is not injective ("Foo: Bar" and "Foo Bar" both
 * give "foo-bar"), so on a collision this would delete the other game's
 * cover as a supposedly stale copy of this one. Anything the manifest
 * still lists under a different title is therefore left alone — no
 * titles collide today, and this keeps it that way if two ever do.
 */
function dropStaleCovers(
  coversDir: string,
  slug: string,
  keep: string,
  coversPath: string,
  title: string,
) {
  if (!existsSync(coversDir)) return;
  const covers = existsSync(coversPath)
    ? (readJson(coversPath) as Record<string, { file?: string }>)
    : {};
  const claimedByOthers = new Set(
    Object.entries(covers)
      .filter(([t, entry]) => t !== title && entry?.file)
      .map(([, entry]) => entry.file as string),
  );
  for (const file of readdirSync(coversDir)) {
    if (file === keep || claimedByOthers.has(file)) continue;
    if (basename(file, extname(file)) === slug) unlinkSync(resolve(coversDir, file));
  }
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
  // Banned games are a game-level concern, so they live in one small
  // file rather than as a flag inside the per-achievement override
  // files — the picker needs to know every ban up front to filter its
  // pool, and it can't fetch 657 per-game files to find out.
  const bannedPath = resolve(overridesDir, 'banned.json');
  // Manual corrections to the leaderboard's cross-platform duplicate
  // grouping (see assignDupeKeys in scripts/build-leaderboard.mjs) —
  // one flat file, same shape/lifecycle as bannedPath above.
  const gameLinksPath = resolve(overridesDir, 'game-links.json');

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
        // Every throw below has to become a 500, not an unhandled
        // rejection. This middleware is async, so a rejection that
        // escapes it takes the whole dev server down rather than
        // failing one request — and the GET handlers used to sit
        // outside the POST try/catch entirely. The commonest trigger is
        // a fresh clone, where the gitignored public/data/ doesn't
        // exist yet and the first /api/dupe-groups read throws ENOENT.
        try {
          // ── Cross-origin guard ──
          //
          // This server writes to the real repo — games.json, covers,
          // overrides, and /api/publish pushes to the data branch. It
          // listens on localhost with no auth, so *any* page open in the
          // same browser can address it. Nothing here checked where a
          // request came from, and an attacker never needs to read the
          // response for a delete to have happened.
          //
          // Two complementary checks. An Origin that isn't ours is
          // refused outright, which covers every cross-site fetch and
          // form post, since browsers always attach Origin to those.
          // Requiring a JSON content-type on writes closes the rest:
          // a cross-site form can only send urlencoded, multipart or
          // text/plain, so anything else forces a preflight the browser
          // won't pass. Requests with no Origin at all (curl, the
          // scripts) still work.
          const apiPath = req.url?.split('?')[0] ?? '';
          if (apiPath.startsWith('/api/')) {
            const origin = req.headers.origin;
            if (origin) {
              let sameOrigin = false;
              try {
                sameOrigin = new URL(origin).host === req.headers.host;
              } catch {
                sameOrigin = false;
              }
              if (!sameOrigin) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Cross-origin request refused' }));
                return;
              }
            }
            if (req.method === 'POST' && !(req.headers['content-type'] ?? '').includes('application/json')) {
              res.writeHead(415, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Expected Content-Type: application/json' }));
              return;
            }
          }

          // The stage view polls this; everything else here is a POST.
          if (req.method === 'GET' && req.url?.split('?')[0] === '/api/picker-state') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({ roll: pickerState }));
            return;
          }

          // Every marked achievement, across every game with an override
          // file. Unlike bans there's no single index to read — the marks
          // are sparse per-game files by design — so this walks the
          // directory. Only the "manage marks" overlay calls it, and it's
          // dev-only like everything else in this plugin, so a directory
          // scan on demand is cheap enough not to need a cache.
          if (req.method === 'GET' && req.url?.split('?')[0] === '/api/all-overrides') {
            const games: unknown[] = [];
            if (existsSync(overridesDir)) {
              for (const platform of readdirSync(overridesDir)) {
                const platformDir = resolve(overridesDir, platform);
                if (!statSync(platformDir).isDirectory()) continue;
                for (const file of readdirSync(platformDir)) {
                  if (!file.endsWith('.json')) continue;
                  try {
                    games.push(readJson(resolve(platformDir, file)));
                  } catch {
                    // A half-written or corrupt file shouldn't blank the
                    // whole list — skip it and show the rest.
                  }
                }
              }
            }
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({ games }));
            return;
          }

          // Full (unsliced) scored-games list with dupeKey grouping, for
          // the "Review duplicates" overlay. leaderboard.json only ships
          // each platform's top N (see GAMES_LIMIT_PER_PLATFORM in
          // build-leaderboard.mjs), which is fine for the public
          // leaderboard but would make a real duplicate whose weaker copy
          // scores too low to make that cut invisible to this review
          // tool — so this recomputes the same thing straight from
          // achievements.json + the shards instead of reading the capped
          // file. Reuses build-leaderboard.mjs's own logic rather than a
          // third copy of the matching/scoring code.
          if (req.method === 'GET' && req.url?.split('?')[0] === '/api/dupe-groups') {
            // An absolute file:// URL, not a relative specifier: Vite
            // bundles this plugin (as a vite.config.ts dependency) into
            // node_modules/.vite-temp/ before running it, so a relative
            // './scripts/...' path resolves against that temp file's
            // location instead of the real project root.
            const specifier = pathToFileURL(resolve(root, 'scripts/build-leaderboard.mjs')).href;
            const { computeLeaderboardData } = (await import(specifier)) as {
              computeLeaderboardData: () => { games: unknown[] };
            };
            const { games } = computeLeaderboardData();
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({ games }));
            return;
          }

          // Last-resort art for the picker: Steam's own capsule/header art
          // is occasionally gone entirely (delisted-adjacent apps, CDN
          // path changes the nightly fetch hasn't caught up with yet), and
          // PSN/Xbox icons can 404 too. SGDB is already wired up for the
          // curated list's cover picker below, so this reuses the same
          // client and key rather than adding a second art source — it
          // just resolves live instead of being curated by hand.
          if (req.method === 'GET' && req.url?.split('?')[0] === '/api/art-fallback') {
            const apiKey = process.env.SGDB_API_KEY;
            const params = new URLSearchParams(req.url.split('?')[1] ?? '');
            const platform = params.get('platform');
            const id = params.get('id');
            const title = params.get('title') ?? '';

            const respond = (url: string | null) => {
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              });
              res.end(JSON.stringify({ url }));
            };

            if (!apiKey || !id) {
              respond(null);
              return;
            }

            try {
              const SGDB = (await import('steamgriddb')).default;
              const client = new SGDB(apiKey);

              // Steam appids resolve directly; PSN/Xbox have no such
              // lookup in SGDB, so those fall through to a title search —
              // same as the curated cover picker does further down.
              let grids: Awaited<ReturnType<typeof client.getGrids>> = [];
              if (platform === 'steam') {
                try {
                  grids = await client.getGridsBySteamAppId(Number(id), undefined, ['600x900']);
                } catch { grids = []; }
                if (!grids || grids.length === 0) {
                  try {
                    grids = await client.getGridsBySteamAppId(Number(id));
                  } catch { grids = []; }
                }
              }

              if ((!grids || grids.length === 0) && title) {
                const results = await client.searchGame(title).catch(() => []);
                const match = results?.[0];
                if (match) {
                  try {
                    grids = await client.getGridsById(match.id, undefined, ['600x900']);
                  } catch { grids = []; }
                  if (!grids || grids.length === 0) {
                    try {
                      grids = await client.getGridsById(match.id);
                    } catch { grids = []; }
                  }
                }
              }

              const best = (grids ?? []).sort((a, b) => b.score - a.score)[0];
              respond(best ? best.url.toString() : null);
            } catch {
              respond(null);
            }
            return;
          }

          if (req.method !== 'POST') return next();

          if (req.url === '/api/upload-cover') {
            const body = JSON.parse(await parseBody(req));
            // The uploaded filename is deliberately ignored. Output is always
            // <slug>.webp now, so the source extension decides nothing.
            const { title, imageData } = body as {
              title: string;
              imageData: string; // base64
            };

            ensureCoversDir();

            const slug = slugify(title);
            const { name: outName, buffer } = await encodeCover(
              Buffer.from(imageData, 'base64'),
              slug,
            );
            writeFileSync(resolve(coversDir, outName), buffer);
            dropStaleCovers(coversDir, slug, outName, coversPath, title);

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
            const slug = slugify(title);
            const { name: outName, buffer } = await encodeCover(
              Buffer.from(await response.arrayBuffer()),
              slug,
            );
            writeFileSync(resolve(coversDir, outName), buffer);
            dropStaleCovers(coversDir, slug, outName, coversPath, title);

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

            // The assignments below copy these straight onto the entry,
            // and JSON.stringify drops whatever is undefined — so a body
            // missing `platforms` doesn't write an empty list, it writes
            // the key out of games.json entirely. The app then throws on
            // g.platforms.some(...) at its next load and renders nothing,
            // having reported the save as successful. Cheap to check, and
            // the failure it prevents costs a hand-edit of the data file.
            const invalid =
              typeof title !== 'string' || title.trim() === ''
                ? 'title must be a non-empty string'
                : !Array.isArray(platforms) || platforms.some((p) => typeof p !== 'string')
                  ? 'platforms must be an array of strings'
                  : !Array.isArray(extras)
                    ? 'extras must be an array'
                    : null;
            if (invalid) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: invalid }));
              return;
            }

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

            if (!/^(steam|psn|xbox|ra)$/.test(platform) || !gameId || !achievementId) {
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

          // Toggle a whole game out of the picker pool.
          if (req.url === '/api/ban-game') {
            const body = JSON.parse(await parseBody(req));
            const { platform, gameId, title, banned } = body as {
              platform: string;
              gameId: string;
              title: string;
              banned: boolean;
            };

            if (!/^(steam|psn|xbox|ra)$/.test(platform) || !gameId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'platform and gameId are required' }));
              return;
            }

            const store = existsSync(bannedPath)
              ? readJson(bannedPath) as { games?: Record<string, { title: string; at: string }> }
              : {};
            const games = store.games ?? {};
            const key = `${platform}/${gameId}`;

            if (banned) {
              games[key] = { title, at: new Date().toISOString() };
            } else {
              delete games[key];
            }

            if (Object.keys(games).length === 0) {
              if (existsSync(bannedPath)) unlinkSync(bannedPath);
            } else {
              if (!existsSync(overridesDir)) mkdirSync(overridesDir, { recursive: true });
              // Sorted so the committed file has a stable order and a
              // single ban is a one-line diff.
              const sorted: Record<string, { title: string; at: string }> = {};
              for (const k of Object.keys(games).sort()) sorted[k] = games[k];
              writeJson(bannedPath, { games: sorted });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, games }));
            return;
          }

          // Manual correction to the leaderboard's duplicate-game
          // grouping — see assignDupeKeys in scripts/build-leaderboard.mjs,
          // which is the only thing that actually reads this file (on
          // its next run, local or nightly). `action: null` removes the
          // pair from whichever list it's currently in.
          if (req.url === '/api/game-links') {
            const body = JSON.parse(await parseBody(req));
            const { a, b, action } = body as {
              a: { platform: string; id: string };
              b: { platform: string; id: string };
              action: 'merge' | 'split' | null;
            };

            const validMember = (m: { platform?: string; id?: string }) =>
              m && /^(steam|psn|xbox|ra)$/.test(m.platform ?? '') && m.id;
            if (!validMember(a) || !validMember(b)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'a and b must each have a valid platform and id' }));
              return;
            }

            const keyA = `${a.platform}/${a.id}`;
            const keyB = `${b.platform}/${b.id}`;
            const pairKey: [string, string] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];

            const store = existsSync(gameLinksPath)
              ? readJson(gameLinksPath) as { merges?: [string, string][]; splits?: [string, string][] }
              : {};
            const samePair = (p: [string, string]) => p[0] === pairKey[0] && p[1] === pairKey[1];
            let merges = (store.merges ?? []).filter((p) => !samePair(p));
            let splits = (store.splits ?? []).filter((p) => !samePair(p));

            if (action === 'merge') merges.push(pairKey);
            else if (action === 'split') splits.push(pairKey);

            if (merges.length === 0 && splits.length === 0) {
              if (existsSync(gameLinksPath)) unlinkSync(gameLinksPath);
            } else {
              if (!existsSync(overridesDir)) mkdirSync(overridesDir, { recursive: true });
              // Sorted so the committed file has a stable order and a
              // single link is a one-line diff.
              merges = merges.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
              splits = splits.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
              writeJson(gameLinksPath, { merges, splits });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, merges, splits }));
            return;
          }

          if (req.url === '/api/publish') {
            const r2 = await loadR2();

            // Local path -> bucket key. The bucket's layout mirrors
            // public/ exactly, which is what lets DATA_BASE be a plain
            // prefix swap between dev and production.
            const toPublish: { key: string; localPath: string }[] = [
              { key: 'data/games.json', localPath: gamesPath },
              { key: 'data/covers.json', localPath: coversPath },
            ];
            if (existsSync(coversDir)) {
              for (const file of readdirSync(coversDir)) {
                toPublish.push({ key: `covers/${file}`, localPath: resolve(coversDir, file) });
              }
            }

            // Trophy-picker marks, one file per marked game, plus the two
            // flat override files. Unlike the achievement shards next
            // door — which the nightly writes straight to the bucket —
            // these only exist locally until a publish.
            const OVERRIDES_PREFIX = 'data/overrides/';
            const localOverrideKeys = new Set<string>();
            const addOverride = (key: string, localPath: string) => {
              localOverrideKeys.add(key);
              toPublish.push({ key, localPath });
            };
            if (existsSync(bannedPath)) addOverride(`${OVERRIDES_PREFIX}banned.json`, bannedPath);
            if (existsSync(gameLinksPath)) {
              addOverride(`${OVERRIDES_PREFIX}game-links.json`, gameLinksPath);
            }
            if (existsSync(overridesDir)) {
              for (const platform of readdirSync(overridesDir)) {
                const platformDir = resolve(overridesDir, platform);
                if (!statSync(platformDir).isDirectory()) continue;
                for (const file of readdirSync(platformDir)) {
                  if (!file.endsWith('.json')) continue;
                  addOverride(
                    `${OVERRIDES_PREFIX}${platform}/${file}`,
                    resolve(platformDir, file),
                  );
                }
              }
            }

            // One listing serves both jobs: skipping unchanged uploads,
            // and finding the override files that were cleared locally.
            // R2 sets a single-part upload's ETag to the body's MD5, so
            // comparing against a local digest needs no extra request.
            const remote = await r2.listObjects('');

            const uploaded: string[] = [];
            const failures: string[] = [];
            for (const { key, localPath } of toPublish) {
              if (!existsSync(localPath)) continue;
              const body = readFileSync(localPath);
              if (remote.get(key)?.etag === r2.etagOf(body)) continue;
              try {
                await r2.putObject(key, body, contentTypeFor(localPath));
                uploaded.push(key);
              } catch (err) {
                failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // Clearing a game's last mark deletes its override file, so
            // publish has to remove it from the bucket too — otherwise
            // the mark comes back on the next fresh pull. Scoped to the
            // overrides prefix; nothing else here deletes.
            //
            // Guarded on the directory existing, because a fresh clone
            // has no local overrides at all: without this check the first
            // publish from one would read that emptiness as "everything
            // was cleared" and wipe every ban and mark from the bucket.
            // An absent directory means "no local state to compare",
            // which is not the same as "the user cleared their marks".
            const removed: string[] = [];
            if (existsSync(overridesDir)) {
              for (const key of remote.keys()) {
                if (!key.startsWith(OVERRIDES_PREFIX)) continue;
                if (localOverrideKeys.has(key)) continue;
                try {
                  await r2.deleteObject(key);
                  removed.push(key);
                } catch (err) {
                  failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            }

            if (failures.length > 0) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: `${failures.length} file(s) failed to publish`,
                failures,
                uploaded: uploaded.length,
              }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              uploaded: uploaded.length,
              removed: removed.length,
              message:
                uploaded.length + removed.length === 0
                  ? 'No changes to publish'
                  : `Published ${uploaded.length} file(s)` +
                    (removed.length ? `, removed ${removed.length}` : ''),
            }));
            return;
          }

        } catch (err) {
          // A handler that already started responding can't be given a
          // 500 — writeHead would throw again, straight back out of the
          // catch and into the rejection this exists to prevent.
          if (res.headersSent) {
            res.end();
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        next();
      });
    },
  };
}
