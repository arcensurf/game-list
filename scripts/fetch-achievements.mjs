import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets the workflow point at a separate `data` branch checkout.
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, '..', 'public', 'data');
const achievementsPath = resolve(dataDir, 'achievements.json');
const librariesPath = resolve(dataDir, 'platform-libraries.json');

// Refresh tokens must NOT live in `dataDir` — that directory is served as
// static assets and committed to a public branch. TOKEN_DIR defaults to
// ~/.game-list so local runs keep them private; CI sets TOKEN_DIR to a
// cache-backed path.
const tokenDir = process.env.TOKEN_DIR
  ? resolve(process.env.TOKEN_DIR)
  : resolve(homedir(), '.game-list');
if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });

// Load env vars from .env.local in dev
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
} catch { /* dotenv not available in CI, env vars come from secrets */ }

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_USER_ID = process.env.STEAM_USER_ID;
const PSN_NPSSO_TOKEN_FILE = resolve(tokenDir, 'psn-npsso-token');
const PSN_NPSSO_TOKEN = process.env.PSN_NPSSO_TOKEN
  || (existsSync(PSN_NPSSO_TOKEN_FILE) ? readFileSync(PSN_NPSSO_TOKEN_FILE, 'utf-8').trim() : undefined);
const PSN_REFRESH_TOKEN_FILE = resolve(tokenDir, 'psn-refresh-token');
const PSN_STATUS_FILE = resolve(tokenDir, 'psn-status');
const XBOX_REFRESH_TOKEN = process.env.XBOX_REFRESH_TOKEN;
const RA_API_KEY = process.env.RA_API_KEY;
const RA_USERNAME = process.env.RA_USERNAME;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Achievement list shards ──
//
// achievements.json holds one summary row per game. The individual
// achievement lists behind those rows are ~31k entries library-wide —
// roughly 4MB of JSON against the 83KB the app loads on every page — so
// they live one file per game instead, fetched on demand:
//
//   public/data/achievements/steam/620.json
//   public/data/achievements/psn/NPWR24281_00.json
//   public/data/achievements/xbox/1234567890.json
//
// Sharding also keeps the nightly commit proportional to what actually
// changed, but only while untouched games serialize byte-identically.
// That's why nothing in a shard is a timestamp and writeShard skips
// no-op writes — one played game should be a one-file diff, not 670.
const listsDir = resolve(dataDir, 'achievements');

// Platform IDs are alphanumeric in practice (Steam appids, PSN
// NPWR....., Xbox titleIds), but they come from upstream APIs and get
// used as a path, so don't take that on trust.
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

const shardPath = (platform, id) => resolve(listsDir, platform, `${safeId(id)}.json`);

function writeShard(platform, id, payload) {
  const file = shardPath(platform, id);
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (existsSync(file) && readFileSync(file, 'utf-8') === json) return false;
  writeFileSync(file, json);
  return true;
}

function readShard(platform, id) {
  const file = shardPath(platform, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null; // corrupt shard — treat as missing so it gets refetched
  }
}

// Drop shards for games that have left the platform library (delisted,
// refunded, region-swapped). Only ever called for a platform that
// actually returned data this run, so a failed fetch can't wipe a slice.
function pruneShards(platform, keepIds) {
  const dir = resolve(listsDir, platform);
  if (!existsSync(dir)) return 0;
  const keep = new Set([...keepIds].map((id) => `${safeId(id)}.json`));
  let removed = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || keep.has(file)) continue;
    unlinkSync(resolve(dir, file));
    removed++;
  }
  return removed;
}

// Global unlock rates are stored to one decimal place. At full float
// precision they drift a little every single night, which would rewrite
// every shard on every run and undo the whole point of sharding.
const roundRarity = (pct) => {
  const n = typeof pct === 'string' ? Number.parseFloat(pct) : pct;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

// Trophy definitions effectively never change once a game ships, so a
// game whose earned/total counts haven't moved doesn't need its list
// pulled again. Rarity *does* drift, so shards still get re-pulled
// periodically — on a day derived from the game's own ID, so the
// library spreads across the week and a given night refreshes ~1/7 of
// it rather than landing all 670 in one commit. Pure function of ID and
// date, so it needs no persisted "last checked" state.
const FORCE_REFRESH = process.env.FORCE_REFRESH === '1';
const REFRESH_CYCLE_DAYS = 7;

function idHash(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const dayIndex = Math.floor(Date.now() / 86_400_000);
const isRefreshDay = (id) =>
  idHash(id) % REFRESH_CYCLE_DAYS === dayIndex % REFRESH_CYCLE_DAYS;

// PSN and Xbox get earned/total free with the library call, so a
// skipped game costs no request at all. Steam has to call
// GetPlayerAchievements per game regardless (that IS where its counts
// come from), so there the check only gates the extra rarity call.
// Returns the existing shard when it's still good, otherwise null.
function currentShard(platform, id, earned, total) {
  if (FORCE_REFRESH) return null;
  const shard = readShard(platform, id);
  if (!shard || !Array.isArray(shard.achievements)) return null;
  if (shard.earned !== earned || shard.total !== total) return null;
  return isRefreshDay(id) ? null : shard;
}

// This script no longer does any game-list matching. It dumps each
// platform's library (keyed by the platform's own ID) into
// achievements.json, and the app resolves game → entry at render time
// via src/utils/achievementMatch.ts. That means a manual override ID
// change takes effect on the next reload without re-running CI.

// ── Steam ──

async function fetchSteamLibrary() {
  if (!STEAM_API_KEY || !STEAM_USER_ID) {
    console.log('Steam: skipping (no API key or user ID)');
    return [];
  }

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${STEAM_USER_ID}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Steam: failed to fetch library', res.status);
    return [];
  }
  const data = await res.json();
  return (data.response?.games ?? []).map((g) => ({
    platformTitle: g.name,
    platformId: g.appid,
    platform: 'steam',
    // playtime_forever comes free from GetOwnedGames and is the best
    // "which copy of this game is which" signal for the reference list
    // — achievement counts would need a per-game GetSchemaForGame call.
    playtimeMinutes: g.playtime_forever ?? 0,
  }));
}

// Returns the raw per-achievement rows. `l=english` is what turns the
// response from bare API names into display names + descriptions — the
// counts this used to reduce to are just the array length and the
// achieved filter, so the list costs nothing extra to keep.
async function fetchSteamAchievements(appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${STEAM_API_KEY}&steamid=${STEAM_USER_ID}&appid=${appId}&l=english`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.playerstats?.achievements ?? null;
}

// Global unlock percentages, so the picker can weight or filter by how
// grindy a trophy is. No API key needed. Plenty of apps publish no
// stats at all (403 or an empty body), so this is best-effort — a game
// without rarity just gets nulls.
async function fetchSteamGlobalRarity(appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const data = await res.json();
    const rows = data.achievementpercentages?.achievements ?? [];
    return new Map(rows.map((r) => [r.name, roundRarity(r.percent)]));
  } catch {
    return new Map();
  }
}

// Fallback art for the picker, resolved once per game and then cached
// forever in achievements.json (see currentIcon below) — box art doesn't
// change, so there's no reason to keep paying for this call.
//
// GetOwnedGames carries no art at all, so the picker guesses a URL from
// the appid client-side instead (utils/pickerCover.ts). That guess
// depends on Steam serving assets from the older flat
// apps/{id}/header.jpg path; newer titles are increasingly showing up
// on a per-app hashed path instead (e.g.
// apps/{id}/2d8e4389.../header.jpg) with no flat-path alias at all, so
// the guess 404s for them. The store API is the only place that hashed
// path is discoverable, and it can't be resolved client-side — Valve
// doesn't send CORS headers on it.
async function fetchSteamHeaderImage(appId) {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data?.[appId];
    if (!entry?.success) return null;
    return entry.data?.header_image ?? null;
  } catch {
    return null;
  }
}

function buildSteamShard(entry, rows, rarity) {
  return {
    platform: 'steam',
    id: String(entry.platformId),
    title: entry.platformTitle,
    earned: rows.filter((a) => a.achieved === 1).length,
    total: rows.length,
    achievements: rows.map((a) => ({
      id: a.apiname,
      name: a.name || a.apiname,
      // Steam withholds the description of a hidden achievement until
      // it's unlocked, so a blank one is the only "is this hidden"
      // signal GetPlayerAchievements gives us — GetSchemaForGame has a
      // real flag but costs another call per game. Inferred, not exact:
      // a handful of visible achievements just ship without text.
      description: a.description ?? '',
      hidden: !a.description,
      earned: a.achieved === 1,
      earnedAt: a.achieved === 1 && a.unlocktime
        ? new Date(a.unlocktime * 1000).toISOString()
        : null,
      rarity: rarity.get(a.apiname) ?? null,
    })),
  };
}

// ── PSN ──

let psnAuth = null;

async function initPsn() {
  if (!PSN_NPSSO_TOKEN) {
    console.log('PSN: skipping (no NPSSO token)');
    return false;
  }

  try {
    const psn = await import('psn-api');

    // Try refresh token first
    if (existsSync(PSN_REFRESH_TOKEN_FILE)) {
      try {
        const refreshToken = readFileSync(PSN_REFRESH_TOKEN_FILE, 'utf-8').trim();
        psnAuth = await psn.exchangeRefreshTokenForAuthTokens(refreshToken);
        // Save new refresh token
        writeFileSync(PSN_REFRESH_TOKEN_FILE, psnAuth.refreshToken);
        writeFileSync(PSN_STATUS_FILE, 'ok');
        console.log('PSN: authenticated via refresh token');
        return true;
      } catch {
        console.log('PSN: refresh token expired, using NPSSO');
      }
    }

    // Fall back to NPSSO
    const accessCode = await psn.exchangeNpssoForAccessCode(PSN_NPSSO_TOKEN);
    psnAuth = await psn.exchangeAccessCodeForAuthTokens(accessCode);
    // Save refresh token for next run
    writeFileSync(PSN_REFRESH_TOKEN_FILE, psnAuth.refreshToken);
    writeFileSync(PSN_STATUS_FILE, 'ok');
    console.log('PSN: authenticated via NPSSO');
    return true;
  } catch (err) {
    console.error('PSN: authentication failed', err.message);
    // Flag for the workflow so it can open an issue with renewal instructions.
    writeFileSync(PSN_STATUS_FILE, 'expired');
    return false;
  }
}

async function fetchPsnLibrary() {
  if (!psnAuth) return [];

  try {
    const psn = await import('psn-api');

    // psn-api's getUserTitles is paginated — defaulting to ~100 per page.
    // We walk nextOffset until exhausted so the full trophy library comes
    // back, not just the first page. Without this, PS5+ games near the
    // tail of your library (e.g. a title you beat recently that sits at
    // index 120) get silently dropped.
    //
    // The earnedTrophies / definedTrophies counts on each returned title
    // are already cross-group aggregates (verified empirically: Dirt 5
    // reports 41/41 = 20 base + 20 DLC + 1 platinum), so no per-title
    // group fetch is needed to pick up DLC trophies that live under the
    // same npCommunicationId. Standalone DLC with its own npCommId
    // (some PS5 expansions) stays as a separate entry; the user treats
    // those as distinct game-list entries, not DLC to merge.
    const all = [];
    let offset = 0;
    const pageSize = 100;
    while (true) {
      const page = await psn.getUserTitles(
        { accessToken: psnAuth.accessToken },
        'me',
        { limit: pageSize, offset },
      );
      const titles = page.trophyTitles ?? [];
      all.push(...titles);
      // `nextOffset` is null / undefined when there are no more pages.
      if (page.nextOffset == null || titles.length === 0) break;
      offset = page.nextOffset;
    }

    const sumCounts = (c) =>
      (c?.bronze ?? 0) + (c?.silver ?? 0) + (c?.gold ?? 0) + (c?.platinum ?? 0);

    return all.map((t) => ({
      platformTitle: t.trophyTitleName,
      platformId: t.npCommunicationId,
      platform: 'psn',
      earned: sumCounts(t.earnedTrophies),
      total: sumCounts(t.definedTrophies),
      // Required by the per-title trophy endpoints below ('trophy' for
      // PS3/PS4/Vita, 'trophy2' for PS5) — they 404 without the right
      // one. Carried on the in-memory entry only; it never reaches
      // achievements.json.
      npServiceName: t.npServiceName,
      // Game art, already in this response. The covers in covers.json
      // only exist for games on the curated list, which is a small
      // fraction of the owned library the picker draws from — so the
      // platform's own art is the only thing with full coverage.
      icon: t.trophyTitleIconUrl ?? null,
    }));
  } catch (err) {
    console.error('PSN: failed to fetch library', err.message);
    return [];
  }
}

// The library response carries counts but no trophy names, so a shard
// needs two more calls per title: getTitleTrophies for the definitions
// and getUserTrophiesEarnedForTitle for the unlock state and rarity,
// joined on trophyId. Group id 'all' covers DLC groups in one pass.
async function fetchPsnTrophyList(entry) {
  if (!psnAuth) return null;
  const psn = await import('psn-api');
  const auth = { accessToken: psnAuth.accessToken };
  const base = { npServiceName: entry.npServiceName };

  // Both endpoints page at 100. Trophy sets run past that (FFXIV's PSN
  // set is 224), so walk nextOffset the same way fetchPsnLibrary does.
  const pageAll = async (call) => {
    const out = [];
    let offset = 0;
    while (true) {
      const page = await call(offset);
      const items = page.trophies ?? [];
      out.push(...items);
      if (page.nextOffset == null || items.length === 0) break;
      offset = page.nextOffset;
      await delay(150);
    }
    return out;
  };

  try {
    const defs = await pageAll((offset) =>
      psn.getTitleTrophies(auth, entry.platformId, 'all', { ...base, offset }),
    );
    await delay(150);
    const earnedRows = await pageAll((offset) =>
      psn.getUserTrophiesEarnedForTitle(auth, 'me', entry.platformId, 'all', { ...base, offset }),
    );

    const earnedById = new Map(earnedRows.map((t) => [t.trophyId, t]));
    return defs.map((d) => {
      const e = earnedById.get(d.trophyId);
      return {
        id: String(d.trophyId),
        name: d.trophyName ?? '',
        description: d.trophyDetail ?? '',
        hidden: d.trophyHidden === true,
        type: d.trophyType ?? null,
        earned: e?.earned === true,
        earnedAt: e?.earnedDateTime ?? null,
        rarity: roundRarity(e?.trophyEarnedRate),
      };
    });
  } catch (err) {
    console.error(`  PSN: trophy list failed for ${entry.platformId}`, err.message);
    return null;
  }
}

// ── Xbox ──
//
// Auth flow (see scripts/xbox-get-refresh-token.mjs for how the initial
// refresh token is minted):
//   1. Exchange refresh_token → new access_token + refresh_token via
//      Microsoft's v1 Live Connect token endpoint.
//   2. Exchange that access_token for an Xbox user token (XASU) via
//      xnet.exchangeRpsTicketForUserToken(..., 't') — the 't' prefix
//      marks the token as a v1 Live Connect RPS ticket.
//   3. Exchange the user token for an XSTS token scoped to xboxlive.com.
//
// We use the v1 endpoints + Minecraft launcher public client because:
//   - The old login.live.com redirect flow is killed by Microsoft's
//     anti-phishing page.
//   - The v2.0 Microsoft Identity consumers endpoint rejects both
//     first-party Microsoft clients (Azure CLI) and legacy public
//     clients (Minecraft launcher) for Xbox Live scopes.
//   - The v1 Live Connect device-code + refresh endpoints still honor
//     the Minecraft client, which is what prismarine-auth and the
//     broader Minecraft/Xbox auth ecosystem rely on.

let xboxAuth = null;
const XBOX_REFRESH_TOKEN_FILE = resolve(tokenDir, 'xbox-refresh-token');
const XBOX_STATUS_FILE = resolve(tokenDir, 'xbox-status');
const XBOX_CLIENT_ID = '00000000402b5328'; // Minecraft launcher public client
const XBOX_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const XBOX_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';

async function refreshXboxTokens(refreshToken) {
  const res = await fetch(XBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: XBOX_CLIENT_ID,
      refresh_token: refreshToken,
      scope: XBOX_SCOPE,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function initXbox() {
  // Refresh tokens rotate on every use, so the cached file (persisted
  // between runs via actions/cache) holds the latest valid token after
  // the first run. The env-var secret is only the initial seed. If we
  // let env win, we'd send the original rotated-away token on every
  // subsequent run and fail after the first. Cache wins, env is the
  // fallback for the very first run (or after a cache wipe).
  const refreshToken =
    (existsSync(XBOX_REFRESH_TOKEN_FILE)
      ? readFileSync(XBOX_REFRESH_TOKEN_FILE, 'utf-8').trim()
      : null) || XBOX_REFRESH_TOKEN;

  if (!refreshToken) {
    console.log('Xbox: skipping (no refresh token — run `npm run xbox-get-refresh-token` to mint one)');
    return false;
  }

  try {
    const { xnet } = await import('@xboxreplay/xboxlive-auth');

    const fresh = await refreshXboxTokens(refreshToken);

    const userToken = await xnet.exchangeRpsTicketForUserToken(fresh.access_token, 't');
    // Use the singular form — it wraps the token into { userTokens: [token] }
    // internally, which is the shape the XSTS endpoint actually requires.
    // The plural form had been called with { userToken: ... } (wrong key)
    // since the original commit, sending userTokens: undefined and 400-ing
    // every run. That bug predates this rewrite; Xbox never worked before.
    const xstsToken = await xnet.exchangeTokenForXSTSToken(userToken.Token);

    xboxAuth = {
      xuid: xstsToken.DisplayClaims.xui[0].xid,
      userHash: xstsToken.DisplayClaims.xui[0].uhs,
      xstsToken: xstsToken.Token,
    };

    // Persist the rotated refresh token for the next run.
    writeFileSync(XBOX_REFRESH_TOKEN_FILE, fresh.refresh_token);
    writeFileSync(XBOX_STATUS_FILE, 'ok');
    console.log('Xbox: authenticated via refresh token');
    return true;
  } catch (err) {
    console.error('Xbox: authentication failed', err.message);
    // Flag for the workflow so it can open an issue with renewal steps.
    writeFileSync(XBOX_STATUS_FILE, 'expired');
    return false;
  }
}

async function fetchXboxLibrary() {
  if (!xboxAuth) return [];

  try {
    // titleHub is Microsoft's unified title history service — it returns
    // Xbox 360, One, and Series X|S titles in a single response, each with
    // a precomputed achievement block. The older
    // achievements.xboxlive.com/users/xuid(X)/achievements endpoint only
    // covers the 2017+ achievement format and silently drops legacy 360
    // titles, which is why a previous version of this script was only
    // seeing a handful of modern Xbox games.
    const url = `https://titlehub.xboxlive.com/users/xuid(${xboxAuth.xuid})/titles/titleHistory/decoration/achievement`;
    const res = await fetch(url, {
      headers: {
        Authorization: `XBL3.0 x=${xboxAuth.userHash};${xboxAuth.xstsToken}`,
        'x-xbl-contract-version': '2',
        'Accept-Language': 'en-US',
      },
    });

    if (!res.ok) {
      console.error('Xbox: failed to fetch title history', res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const titles = data.titles ?? [];

    return titles
      // Drop apps/system tiles and anything that doesn't have achievements.
      .filter((t) => t.achievement && (t.achievement.totalAchievements ?? 0) > 0)
      .map((t) => ({
        platformTitle: t.name,
        platformId: t.titleId,
        platform: 'xbox',
        earned: t.achievement.currentAchievements ?? 0,
        total: t.achievement.totalAchievements ?? 0,
        // Box art from the same titleHub response — see the PSN note.
        icon: t.displayImage ?? null,
      }));
  } catch (err) {
    console.error('Xbox: failed to fetch library', err.message);
    return [];
  }
}

// titleHub's decoration only carries the counts block, so per-game
// lists come from the achievements service one title at a time.
//
// This needs two calls, for the same reason PSN does — definitions and
// progress live behind different requests:
//
//   * The plain call returns the player's record. It carries unlock
//     state and rarity, but in practice lists only achievements already
//     unlocked. (unlockedOnly defaults to false, so passing it changes
//     nothing — that was a wasted run.)
//   * possibleOnly=true is documented as "return all possible results
//     but not unlocked metadata": the full definition list with the
//     unlock state deliberately stripped.
//
// So: definitions from one, progress from the other, joined on id.
// Xbox 360 titles predate the v2 format and only exist under contract
// v1, which does return locked achievements directly.
//
// KNOWN LIMITATION — do not re-attempt without new information.
// As of 2026-08-20 this still returns only unlocked achievements for
// 176 of 190 titles (7 more return nothing at all, all of them titles
// with zero earned). Verified against the live API on force_refresh
// runs, each producing byte-identical output:
//   * unlockedOnly=false  — no effect (it is already the default)
//   * possibleOnly=true   — no effect, despite being documented as
//                           "return all possible results"
//   * contract v1 fallback — works for exactly one title (GRID)
//   * /titleachievements (a distinct endpoint, contract v1, found in
//     OpenXbox/xbox-webapi-python) — tried and reverted 2026-08-22.
//     Returns more entries for some titles, but its ids are a legacy
//     scheme that never matches the modern /achievements ids used to
//     attribute earned state, so every entry it contributes comes back
//     earned:false regardless of truth — confirmed on Guitar Hero III,
//     which showed 32 achievements all unearned despite 13 actually
//     earned. Worse than the status quo (the picker could re-offer
//     something already earned), not just unhelpful — do not reuse
//     this endpoint's data for earned state without solving the id
//     mapping first.
// The 14 titles that do come back complete are almost all games that
// were 100%'d, i.e. "complete" only because everything was unlocked.
// The likely explanation is that Xbox Live keeps no definition set for
// these mostly-360 titles on an account-scoped endpoint — consistent
// with the earlier finding that 360 rarity is unavailable (commit
// bd9bb4a). Steam and PSN are unaffected and fully populated.
async function fetchXboxAchievementList(titleId, expectedTotal) {
  if (!xboxAuth) return null;
  const base = `https://achievements.xboxlive.com/users/xuid(${xboxAuth.xuid})/achievements`;
  const get = async (contractVersion, query) => {
    try {
      const res = await fetch(`${base}?titleId=${titleId}&maxItems=1000${query}`, {
        headers: {
          Authorization: `XBL3.0 x=${xboxAuth.userHash};${xboxAuth.xstsToken}`,
          'x-xbl-contract-version': contractVersion,
          'Accept-Language': 'en-US',
        },
      });
      if (!res.ok) return [];
      return (await res.json()).achievements ?? [];
    } catch {
      return [];
    }
  };

  // Unearned achievements come back with a placeholder unlock date.
  const unlockedAt = (value) =>
    value && !String(value).startsWith('0001') ? value : null;

  const mapModern = (a) => ({
    id: String(a.id),
    name: a.name ?? '',
    // `description` is the post-unlock text; `lockedDescription` is the
    // "how do I get this" hint, which is the useful one for something
    // the picker is asking you to go earn.
    description: a.lockedDescription || a.description || '',
    hidden: a.isSecret === true,
    points: Number(a.rewards?.find((r) => r.type === 'Gamerscore')?.value) || null,
    earned: a.progressState === 'Achieved',
    earnedAt: unlockedAt(a.progression?.timeUnlocked),
    rarity: roundRarity(a.rarity?.currentPercentage),
  });

  const mapLegacy = (a) => ({
    id: String(a.id),
    name: a.name ?? '',
    description: a.description || a.lockedDescription || '',
    hidden: a.isSecret === true,
    points: Number(a.gamerscore) || null,
    earned: a.unlocked === true,
    earnedAt: unlockedAt(a.timeUnlocked),
    rarity: null, // v1 predates the rarity block
  });

  const player = (await get('2', '')).map(mapModern);
  await delay(120);
  let defs = (await get('2', '&possibleOnly=true')).map(mapModern);

  if (expectedTotal > 0 && defs.length < expectedTotal) {
    await delay(120);
    const legacy = (await get('1', '')).map(mapLegacy);
    if (legacy.length > defs.length) defs = legacy;
  }

  // Whichever call knew about more of the title supplies the entries;
  // unlock state always comes from the player call, since possibleOnly
  // strips it by design.
  const source = defs.length >= player.length ? defs : player;
  const unlocked = new Map(player.filter((a) => a.earned).map((a) => [a.id, a]));
  const merged = source.map((a) => {
    const hit = unlocked.get(a.id);
    return hit ? { ...a, earned: true, earnedAt: hit.earnedAt, rarity: a.rarity ?? hit.rarity } : a;
  });
  return merged.length > 0 ? merged : null;
}

// Shared PSN/Xbox shard pass. Both platforms get earned/total free from
// their library call, so a game whose counts haven't moved costs zero
// requests here — the opposite of Steam, where the per-game call is the
// only source of counts and can't be skipped.
async function syncShards(platform, lib, fetchList, throttleMs) {
  console.log(`\nSyncing ${platform} achievement lists for ${lib.length} games...`);
  let written = 0, fetched = 0, unchanged = 0, failed = 0, done = 0;
  const short = [];
  for (const e of lib) {
    const id = String(e.platformId);
    if (e.total > 0 && !currentShard(platform, id, e.earned, e.total)) {
      const list = await fetchList(e);
      fetched++;
      if (list) {
        // A list shorter than the platform's own count means we didn't
        // get the whole set — worth surfacing, since it's silent
        // corruption otherwise: the shard looks fine, it's just missing
        // the achievements the picker most wants to offer.
        if (list.length < e.total) {
          short.push(`${e.platformTitle} (${list.length}/${e.total})`);
        }
        const payload = {
          platform,
          id,
          title: e.platformTitle,
          // Counts mirror achievements.json (i.e. the library response)
          // rather than list.length, so the currentShard check always
          // compares like with like — otherwise a one-off disagreement
          // between the two endpoints would wedge a game into being
          // refetched every single night.
          earned: e.earned,
          total: e.total,
          achievements: list,
        };
        if (writeShard(platform, id, payload)) written++;
      } else {
        failed++;
      }
      await delay(throttleMs);
    } else if (e.total > 0) {
      unchanged++;
    }
    done++;
    if (done % 50 === 0) console.log(`  ${platform}: ${done}/${lib.length}`);
  }
  const pruned = pruneShards(platform, lib.map((e) => String(e.platformId)));
  console.log(`  ${platform} shards: ${written} written, ${fetched} fetched, ${unchanged} unchanged, ${failed} failed, ${pruned} pruned`);
  if (short.length > 0) {
    console.log(`  ${platform}: ${short.length} incomplete list(s) — ${short.slice(0, 10).join(', ')}${short.length > 10 ? ', ...' : ''}`);
  }
}

// ── RetroAchievements ──
//
// No OAuth, just an API key + username as query params — simpler than
// PSN/Xbox. But unlike them, the per-game call (below) is the only
// place real box art shows up: the library call only carries a tiny
// 96x96 icon (confirmed empirically — PSN/Xbox icons run much larger,
// so treating RA's the same way would visibly pixelate the picker's
// cover). Box art doesn't change once a game's added to RA, so it's
// resolved once and cached forever, same as Steam's header image —
// which is also why this doesn't use the shared syncShards() pass PSN
// and Xbox use: that helper only ever calls fetchList when the shard
// itself is stale, and box art can still be missing on a shard that's
// otherwise current (right after this feature ships, backfilling
// everyone's existing library).
//
// "Earned" means hardcore-earned (DateEarnedHardcore) specifically —
// RA distinguishes hardcore (no save states/rewind/cheats) from
// softcore, and a softcore-only clear is treated as still open here,
// both for the per-achievement rows and the library summary counts
// (so the two stay consistent with each other).

const RA_BASE = 'https://retroachievements.org/API';
const RA_MEDIA_BASE = 'https://media.retroachievements.org';

async function raCall(endpoint, params) {
  const qs = new URLSearchParams({ y: RA_API_KEY, u: RA_USERNAME, ...params });
  const res = await fetch(`${RA_BASE}/${endpoint}.php?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRaLibrary() {
  if (!RA_API_KEY || !RA_USERNAME) {
    console.log('RetroAchievements: skipping (no API key or username)');
    return [];
  }

  const all = [];
  let offset = 0;
  const pageSize = 500;
  try {
    while (true) {
      const page = await raCall('API_GetUserCompletionProgress', { c: pageSize, o: offset });
      const results = page.Results ?? [];
      all.push(...results);
      offset += results.length;
      if (results.length < pageSize || offset >= (page.Total ?? 0)) break;
      await delay(200);
    }
  } catch (err) {
    console.error('RetroAchievements: failed to fetch library', err.message);
    return [];
  }

  // MaxPossible === 0 means the game has no achievement set on RA at
  // all — nothing for the picker to ever draw from.
  return all
    .filter((g) => (g.MaxPossible ?? 0) > 0)
    .map((g) => ({
      platformTitle: g.Title,
      platformId: g.GameID,
      platform: 'ra',
      earned: g.NumAwardedHardcore ?? 0,
      total: g.MaxPossible ?? 0,
    }));
}

// RA timestamps are "2022-08-23 22:56:38" — space-separated, always
// UTC, no offset given.
function raTimestampToIso(value) {
  if (!value) return null;
  const d = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildRaShard(entry, rows, playersCasual) {
  return {
    platform: 'ra',
    id: String(entry.platformId),
    title: entry.platformTitle,
    earned: entry.earned,
    total: entry.total,
    achievements: rows.map((a) => ({
      id: String(a.ID),
      name: a.Title ?? '',
      // RA never withholds the description before unlock — no hidden
      // concept the way Steam has.
      description: a.Description ?? '',
      hidden: false,
      type: a.Type ?? null,
      points: a.Points ?? null,
      earned: a.DateEarnedHardcore != null,
      earnedAt: raTimestampToIso(a.DateEarnedHardcore),
      // Percent of everyone who's played the game that has this
      // specific achievement — the same "Earned by X% of players"
      // semantic Steam's rarity carries, just computed from fields RA
      // already returns instead of a separate call.
      rarity: playersCasual > 0 ? roundRarity((a.NumAwarded / playersCasual) * 100) : null,
    })),
  };
}

// ── Temporary diagnostic ──
//
// Only runs when DEBUG_XBOX_CONTRACTS=1 (see the workflow's
// debug_xbox_contracts input). Reuses whatever session initXbox()
// already established this run — mints nothing new, writes nothing.
// Probes contract versions 3 and 4 (the script has only ever tried 1
// and 2) against two known-broken titles, per a lead from an OpenXBL
// GitHub issue comment claiming v3 covers old-gen titles.
async function probeXbox(path, titleId, version, query) {
  try {
    const res = await fetch(
      `https://achievements.xboxlive.com/users/xuid(${xboxAuth.xuid})/${path}?titleId=${titleId}&maxItems=1000${query}`,
      {
        headers: {
          Authorization: `XBL3.0 x=${xboxAuth.userHash};${xboxAuth.xstsToken}`,
          'x-xbl-contract-version': String(version),
          'Accept-Language': 'en-US',
        },
      },
    );
    const json = res.ok ? await res.json() : null;
    const achievements = json?.achievements ?? [];
    const earnedLooking = achievements.filter(
      (a) => a.unlocked === true || a.progressState === 'Achieved',
    ).length;
    return { status: res.status, count: achievements.length, earnedLooking, sample: achievements[0] };
  } catch (err) {
    return { error: err.message };
  }
}

async function debugXboxContractVersions() {
  const titles = [
    ['1096157146', 'Marvel Ult. Alliance', 7, 58],
    ['1096157175', 'Guitar Hero III', 13, 59],
  ];
  const variants = [
    ['bare', ''],
    ['possibleOnly=true', '&possibleOnly=true'],
    ['unlockedOnly=true', '&unlockedOnly=true'],
  ];
  for (const [titleId, name, realEarned, realTotal] of titles) {
    console.log(`\n=== ${name} (real: ${realEarned}/${realTotal}) ===`);
    console.log(' -- /achievements --');
    for (const version of [1, 2, 3, 4]) {
      for (const [label, query] of variants) {
        const r = await probeXbox('achievements', titleId, version, query);
        if (r.error) console.log(`  v${version} ${label}: ERROR ${r.error}`);
        else console.log(`  v${version} ${label}: status=${r.status} count=${r.count} earned-looking=${r.earnedLooking}`);
        await delay(300);
      }
    }
    // Never tried at anything but v1 before (see the 2026-08-22 revert
    // note above fetchXboxAchievementList) — OpenXBL's full-58/59-item
    // response for these same titles doesn't match what our own v1
    // call on this path returns (32/58), so something between v2-v4
    // might close that gap.
    console.log(' -- /titleachievements --');
    for (const version of [1, 2, 3, 4]) {
      const r = await probeXbox('titleachievements', titleId, version, '');
      if (r.error) console.log(`  v${version}: ERROR ${r.error}`);
      else {
        console.log(`  v${version}: status=${r.status} count=${r.count} earned-looking=${r.earnedLooking}`);
        if (r.sample) console.log(`       sample keys: ${Object.keys(r.sample).join(', ')}`);
      }
      await delay(300);
    }
  }
  console.log('\nDiagnostic done — nothing was written.');
}

// ── Main ──

async function main() {
  // achievements.json stores full per-platform libraries keyed by the
  // platform's own ID. Shape:
  //   { steam: { [appid]: { title, earned, total, playtimeMinutes, icon } },
  //     psn:   { [npId]:  { title, earned, total, icon } },
  //     xbox:  { [titleId]: { title, earned, total, icon } },
  //     updatedAt }
  // The app resolves game → entry at render time (see
  // src/utils/achievementMatch.ts), so a manual override change takes
  // effect on the next page load without re-running this script.
  const existing = existsSync(achievementsPath)
    ? JSON.parse(readFileSync(achievementsPath, 'utf-8'))
    : { steam: {}, psn: {}, xbox: {}, ra: {} };

  await initPsn();
  await initXbox();

  if (process.env.DEBUG_XBOX_CONTRACTS === '1') {
    if (!xboxAuth) {
      console.log('DEBUG_XBOX_CONTRACTS set but Xbox auth failed — nothing to probe.');
    } else {
      await debugXboxContractVersions();
    }
    return;
  }

  console.log('\nFetching platform libraries...');
  const [steamLib, psnLib, xboxLib, raLib] = await Promise.all([
    fetchSteamLibrary(),
    fetchPsnLibrary(),
    fetchXboxLibrary(),
    fetchRaLibrary(),
  ]);
  console.log(`Steam: ${steamLib.length} games, PSN: ${psnLib.length} games, Xbox: ${xboxLib.length} games, RetroAchievements: ${raLib.length} games`);

  // Only replace a platform's slice if we actually fetched it this run.
  // A transient API failure (empty list) preserves the previous data
  // rather than wiping every override for that platform.
  const fetchedPlatforms = new Set();
  if (steamLib.length > 0) fetchedPlatforms.add('steam');
  if (psnLib.length > 0) fetchedPlatforms.add('psn');
  if (xboxLib.length > 0) fetchedPlatforms.add('xbox');
  if (raLib.length > 0) fetchedPlatforms.add('ra');

  // platform-libraries.json is a simplified human-readable reference
  // for manually finding override IDs. Not consumed by the app.
  const existingLibs = existsSync(librariesPath)
    ? JSON.parse(readFileSync(librariesPath, 'utf-8'))
    : { steam: [], psn: [], xbox: [], ra: [] };
  const libraries = {
    steam: fetchedPlatforms.has('steam')
      ? steamLib.map((e) => ({
          id: e.platformId,
          title: e.platformTitle,
          playtimeMinutes: e.playtimeMinutes ?? 0,
        }))
      : (existingLibs.steam ?? []),
    psn: fetchedPlatforms.has('psn')
      ? psnLib.map((e) => ({
          id: e.platformId,
          title: e.platformTitle,
          earned: e.earned,
          total: e.total,
        }))
      : (existingLibs.psn ?? []),
    xbox: fetchedPlatforms.has('xbox')
      ? xboxLib.map((e) => ({
          id: e.platformId,
          title: e.platformTitle,
          earned: e.earned,
          total: e.total,
        }))
      : (existingLibs.xbox ?? []),
    ra: fetchedPlatforms.has('ra')
      ? raLib.map((e) => ({
          id: e.platformId,
          title: e.platformTitle,
          earned: e.earned,
          total: e.total,
        }))
      : (existingLibs.ra ?? []),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(librariesPath, JSON.stringify(libraries, null, 2) + '\n');

  // Steam needs a per-appid call for achievement counts (GetOwnedGames
  // only returns playtime). PSN and Xbox already include earned/total
  // in their library responses, so those are in-memory transforms.
  const steamMap = {};
  const steamShards = { written: 0, rarityCalls: 0 };
  if (fetchedPlatforms.has('steam')) {
    console.log(`\nFetching Steam achievements for ${steamLib.length} games...`);
    let done = 0;
    let iconCalls = 0;
    for (const e of steamLib) {
      const id = String(e.platformId);
      const rows = (await fetchSteamAchievements(e.platformId)) ?? [];
      const earned = rows.filter((a) => a.achieved === 1).length;

      // Resolved once and kept forever — box art doesn't change, so a
      // game that already has one costs nothing here. Only new library
      // additions (or a first backfill run) pay for the extra request.
      let icon = existing.steam?.[id]?.icon ?? null;
      if (!icon) {
        icon = await fetchSteamHeaderImage(id);
        iconCalls++;
        await delay(400);
      }

      steamMap[id] = {
        title: e.platformTitle,
        earned,
        total: rows.length,
        playtimeMinutes: e.playtimeMinutes ?? 0,
        icon,
      };
      await delay(300);

      // The list itself came free with the call above, so the only
      // thing worth skipping here is the extra rarity request — reuse
      // the percentages already in the shard when nothing has moved.
      if (rows.length > 0) {
        const reusable = currentShard('steam', id, earned, rows.length);
        let rarity;
        if (reusable) {
          rarity = new Map(reusable.achievements.map((a) => [a.id, a.rarity ?? null]));
        } else {
          rarity = await fetchSteamGlobalRarity(e.platformId);
          steamShards.rarityCalls++;
          await delay(300);
        }
        if (writeShard('steam', id, buildSteamShard(e, rows, rarity))) steamShards.written++;
      }

      done++;
      if (done % 50 === 0) console.log(`  Steam: ${done}/${steamLib.length}`);
    }
    const pruned = pruneShards('steam', Object.keys(steamMap));
    console.log(`  Steam shards: ${steamShards.written} written, ${steamShards.rarityCalls} rarity calls, ${iconCalls} icon calls, ${pruned} pruned`);
  }

  const psnMap = {};
  if (fetchedPlatforms.has('psn')) {
    for (const e of psnLib) {
      psnMap[e.platformId] = {
        title: e.platformTitle,
        earned: e.earned,
        total: e.total,
        icon: e.icon ?? null,
      };
    }
  }

  const xboxMap = {};
  if (fetchedPlatforms.has('xbox')) {
    for (const e of xboxLib) {
      xboxMap[e.platformId] = {
        title: e.platformTitle,
        earned: e.earned,
        total: e.total,
        icon: e.icon ?? null,
      };
    }
  }

  // Like Steam, RA's shards are written inline here rather than through
  // syncShards — see the comment above buildRaShard for why (box art
  // resolution needs to piggyback on the same per-game call).
  const raMap = {};
  if (fetchedPlatforms.has('ra')) {
    console.log(`\nSyncing RetroAchievements lists for ${raLib.length} games...`);
    let written = 0, fetched = 0, unchanged = 0, failed = 0, iconCalls = 0, done = 0;
    for (const e of raLib) {
      const id = String(e.platformId);
      let icon = existing.ra?.[id]?.icon ?? null;
      const needsIcon = !icon;
      const needsRefresh = !currentShard('ra', id, e.earned, e.total);

      if (needsIcon || needsRefresh) {
        try {
          const game = await raCall('API_GetGameInfoAndUserProgress', { g: e.platformId });
          if (game.ImageBoxArt) icon = `${RA_MEDIA_BASE}${game.ImageBoxArt}`;
          if (needsIcon) iconCalls++;

          if (needsRefresh) {
            fetched++;
            const rows = Object.values(game.Achievements ?? {});
            if (rows.length > 0) {
              const playersCasual = game.NumDistinctPlayersCasual ?? 0;
              if (writeShard('ra', id, buildRaShard(e, rows, playersCasual))) written++;
            } else {
              failed++;
            }
          }
        } catch (err) {
          console.error(`  RetroAchievements: fetch failed for ${e.platformTitle} (${id})`, err.message);
          if (needsRefresh) failed++;
        }
        await delay(350);
      } else {
        unchanged++;
      }

      raMap[id] = { title: e.platformTitle, earned: e.earned, total: e.total, icon };
      done++;
      if (done % 50 === 0) console.log(`  RetroAchievements: ${done}/${raLib.length}`);
    }
    const pruned = pruneShards('ra', raLib.map((e) => String(e.platformId)));
    console.log(`  RetroAchievements shards: ${written} written, ${fetched} fetched, ${unchanged} unchanged, ${failed} failed, ${iconCalls} icon calls, ${pruned} pruned`);
  }

  const achievements = {
    steam: fetchedPlatforms.has('steam') ? steamMap : (existing.steam ?? {}),
    psn: fetchedPlatforms.has('psn') ? psnMap : (existing.psn ?? {}),
    xbox: fetchedPlatforms.has('xbox') ? xboxMap : (existing.xbox ?? {}),
    ra: fetchedPlatforms.has('ra') ? raMap : (existing.ra ?? {}),
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(achievementsPath, JSON.stringify(achievements, null, 2) + '\n');
  console.log(`\nWrote achievements.json — steam: ${Object.keys(achievements.steam).length}, psn: ${Object.keys(achievements.psn).length}, xbox: ${Object.keys(achievements.xbox).length}, ra: ${Object.keys(achievements.ra).length}`);

  // Shards come last so a failure here can't cost us the summary data
  // that's already on disk. Steam's and RA's shards were written
  // inline above, since their counts and lists arrive in the same
  // response.
  if (fetchedPlatforms.has('psn')) await syncShards('psn', psnLib, fetchPsnTrophyList, 300);
  if (fetchedPlatforms.has('xbox')) await syncShards('xbox', xboxLib, (e) => fetchXboxAchievementList(e.platformId, e.total), 250);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
