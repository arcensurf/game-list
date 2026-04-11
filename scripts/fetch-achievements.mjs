import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets the workflow point at a separate `data` branch checkout.
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, '..', 'public', 'data');
const gamesPath = resolve(dataDir, 'games.json');
const achievementsPath = resolve(dataDir, 'achievements.json');

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
const PSN_NPSSO_TOKEN = process.env.PSN_NPSSO_TOKEN;
const PSN_REFRESH_TOKEN_FILE = resolve(tokenDir, 'psn-refresh-token');
const PSN_STATUS_FILE = resolve(tokenDir, 'psn-status');
const XBOX_REFRESH_TOKEN = process.env.XBOX_REFRESH_TOKEN;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Title normalization for fuzzy matching ──
//
// Strict exact-match only after normalization. Substring matching was
// previously used as a fallback but caused a bunch of false positives:
//   - "Borderlands" matching "Borderlands 2", "Borderlands 3", GOTY, etc.
//   - "Dirt 2" matching "Dirt 2 Demo"
//   - "Halo 3" matching "Halo 3: ODST"
//   - "Persona 5" matching "Persona 5 Royal" (different games — a user
//     who beat both would want them as separate game-list entries anyway)
// Any legitimate edge case that doesn't survive exact-match (e.g. a
// regional title difference) is handled via explicit
// steamAppId / psnNpCommId / xboxTitleId overrides on the game entry.

function normalize(title) {
  return title
    .toLowerCase()
    // Drop leading "the " so "The Elder Scrolls V" matches "Elder Scrolls V".
    .replace(/^the\s+/, '')
    // Strip trademarks first so the symbol between "DiRT" and "5" doesn't
    // leave a ghost character that splits the word weirdly.
    .replace(/[®™©]/g, '')
    // Drop everything except letters and digits — no whitespace, no
    // punctuation, no brackets, no slashes, no ampersands. Stripping
    // spaces too is the key move that lets "DiRT®5" (no space, stylized
    // PSN title) match "Dirt 5" from games.json: both collapse to "dirt5".
    // "Dirt 5" vs "Dirt" still differ (dirt5 ≠ dirt), so no false positive.
    .replace(/[^a-z0-9]/g, '');
}

// ── Platform-family eligibility ──
//
// Each achievement-bearing platform only matches games marked as beaten
// on a platform in its family. Stops Bastion-on-Steam from attaching
// Steam achievements to a game that was only beaten on PS4, etc.

const PLATFORM_FAMILIES = {
  steam: new Set(['PC']),
  psn: new Set(['PS3', 'PS4', 'PS5', 'PS Vita']),
  xbox: new Set(['Xbox 360', 'Xbox One', 'Xbox Series X|S', 'Xbox Series X', 'Xbox Series S']),
};

function gameIsOnPlatformFamily(game, platform) {
  const family = PLATFORM_FAMILIES[platform];
  if (!family) return true; // unknown family: don't filter
  return game.platforms.some((p) => family.has(p));
}

function findMatch(platformTitle, platform, games) {
  const normPlatform = normalize(platformTitle);
  for (const g of games) {
    if (normalize(g.title) !== normPlatform) continue;
    if (!gameIsOnPlatformFamily(g, platform)) continue;
    return g;
  }
  return null;
}

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
  }));
}

async function fetchSteamAchievements(appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${STEAM_API_KEY}&steamid=${STEAM_USER_ID}&appid=${appId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const achievements = data.playerstats?.achievements;
  if (!achievements) return null;
  const total = achievements.length;
  const earned = achievements.filter((a) => a.achieved === 1).length;
  return { earned, total, platform: 'steam' };
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

    return all.map((t) => ({
      platformTitle: t.trophyTitleName,
      platformId: t.npCommunicationId,
      platform: 'psn',
      // Trophy data is already in the list response
      earned:
        (t.earnedTrophies?.bronze ?? 0) +
        (t.earnedTrophies?.silver ?? 0) +
        (t.earnedTrophies?.gold ?? 0) +
        (t.earnedTrophies?.platinum ?? 0),
      total:
        (t.definedTrophies?.bronze ?? 0) +
        (t.definedTrophies?.silver ?? 0) +
        (t.definedTrophies?.gold ?? 0) +
        (t.definedTrophies?.platinum ?? 0),
    }));
  } catch (err) {
    console.error('PSN: failed to fetch library', err.message);
    return [];
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
      }));
  } catch (err) {
    console.error('Xbox: failed to fetch library', err.message);
    return [];
  }
}

// ── Main ──

async function main() {
  const games = JSON.parse(readFileSync(gamesPath, 'utf-8'));
  const existing = existsSync(achievementsPath)
    ? JSON.parse(readFileSync(achievementsPath, 'utf-8'))
    : {};

  const achievements = { ...existing };

  // Initialize platform auth
  await initPsn();
  await initXbox();

  // Fetch platform libraries
  console.log('\nFetching platform libraries...');
  const [steamLib, psnLib, xboxLib] = await Promise.all([
    fetchSteamLibrary(),
    fetchPsnLibrary(),
    fetchXboxLibrary(),
  ]);
  console.log(`Steam: ${steamLib.length} games, PSN: ${psnLib.length} games, Xbox: ${xboxLib.length} games`);

  // Build a map of game title -> matched platform entries
  const matchResults = new Map();
  const unmatched = { steam: [], psn: [], xbox: [] };

  for (const lib of [steamLib, psnLib, xboxLib]) {
    for (const entry of lib) {
      // Check for manual override first
      const override = games.find((g) => {
        if (entry.platform === 'steam' && g.steamAppId === entry.platformId) return true;
        if (entry.platform === 'psn' && g.psnNpCommId === entry.platformId) return true;
        if (entry.platform === 'xbox' && g.xboxTitleId === entry.platformId) return true;
        return false;
      });

      const match = override || findMatch(entry.platformTitle, entry.platform, games);
      if (match) {
        if (!matchResults.has(match.title)) matchResults.set(match.title, []);
        matchResults.get(match.title).push(entry);
      } else {
        unmatched[entry.platform].push(entry.platformTitle);
      }
    }
  }

  // Fetch detailed achievement data for matched games
  let fetched = 0;
  for (const [title, entries] of matchResults) {
    const platforms = [];

    for (const entry of entries) {
      if (entry.platform === 'steam') {
        // Steam needs a separate API call for achievements
        const result = await fetchSteamAchievements(entry.platformId);
        if (result) platforms.push(result);
        await delay(300);
      } else if (entry.platform === 'psn') {
        // PSN already has trophy counts from the library call
        platforms.push({ earned: entry.earned, total: entry.total, platform: 'psn' });
      } else if (entry.platform === 'xbox') {
        // TODO: fetch Xbox achievements
        if (entry.earned !== undefined) {
          platforms.push({ earned: entry.earned, total: entry.total, platform: 'xbox' });
        }
      }
    }

    if (platforms.length > 0) {
      // Pick best platform (highest completion %)
      const best = platforms.reduce((a, b) => {
        const pctA = a.total > 0 ? a.earned / a.total : 0;
        const pctB = b.total > 0 ? b.earned / b.total : 0;
        return pctB > pctA ? b : a;
      });

      achievements[title] = {
        platforms,
        best,
        updatedAt: new Date().toISOString(),
      };
      fetched++;
    }
  }

  // Write results
  writeFileSync(achievementsPath, JSON.stringify(achievements, null, 2) + '\n');
  console.log(`\nUpdated ${fetched} games with achievement data`);
  console.log(`Total games with achievements: ${Object.keys(achievements).length}`);

  // Log unmatched
  for (const [platform, titles] of Object.entries(unmatched)) {
    if (titles.length > 0) {
      console.log(`\nUnmatched ${platform} games (${titles.length}):`);
      titles.slice(0, 20).forEach((t) => console.log(`  - ${t}`));
      if (titles.length > 20) console.log(`  ... and ${titles.length - 20} more`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
