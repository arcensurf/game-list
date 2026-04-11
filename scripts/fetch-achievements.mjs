import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
const PSN_NPSSO_TOKEN = process.env.PSN_NPSSO_TOKEN;
const PSN_REFRESH_TOKEN_FILE = resolve(tokenDir, 'psn-refresh-token');
const PSN_STATUS_FILE = resolve(tokenDir, 'psn-status');
const XBOX_REFRESH_TOKEN = process.env.XBOX_REFRESH_TOKEN;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // achievements.json stores full per-platform libraries keyed by the
  // platform's own ID. Shape:
  //   { steam: { [appid]: { title, earned, total, playtimeMinutes } },
  //     psn:   { [npId]:  { title, earned, total } },
  //     xbox:  { [titleId]: { title, earned, total } },
  //     updatedAt }
  // The app resolves game → entry at render time (see
  // src/utils/achievementMatch.ts), so a manual override change takes
  // effect on the next page load without re-running this script.
  const existing = existsSync(achievementsPath)
    ? JSON.parse(readFileSync(achievementsPath, 'utf-8'))
    : { steam: {}, psn: {}, xbox: {} };

  await initPsn();
  await initXbox();

  console.log('\nFetching platform libraries...');
  const [steamLib, psnLib, xboxLib] = await Promise.all([
    fetchSteamLibrary(),
    fetchPsnLibrary(),
    fetchXboxLibrary(),
  ]);
  console.log(`Steam: ${steamLib.length} games, PSN: ${psnLib.length} games, Xbox: ${xboxLib.length} games`);

  // Only replace a platform's slice if we actually fetched it this run.
  // A transient API failure (empty list) preserves the previous data
  // rather than wiping every override for that platform.
  const fetchedPlatforms = new Set();
  if (steamLib.length > 0) fetchedPlatforms.add('steam');
  if (psnLib.length > 0) fetchedPlatforms.add('psn');
  if (xboxLib.length > 0) fetchedPlatforms.add('xbox');

  // platform-libraries.json is a simplified human-readable reference
  // for manually finding override IDs. Not consumed by the app.
  const existingLibs = existsSync(librariesPath)
    ? JSON.parse(readFileSync(librariesPath, 'utf-8'))
    : { steam: [], psn: [], xbox: [] };
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
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(librariesPath, JSON.stringify(libraries, null, 2) + '\n');

  // Steam needs a per-appid call for achievement counts (GetOwnedGames
  // only returns playtime). PSN and Xbox already include earned/total
  // in their library responses, so those are in-memory transforms.
  const steamMap = {};
  if (fetchedPlatforms.has('steam')) {
    console.log(`\nFetching Steam achievements for ${steamLib.length} games...`);
    let done = 0;
    for (const e of steamLib) {
      const ach = await fetchSteamAchievements(e.platformId);
      steamMap[String(e.platformId)] = {
        title: e.platformTitle,
        earned: ach?.earned ?? 0,
        total: ach?.total ?? 0,
        playtimeMinutes: e.playtimeMinutes ?? 0,
      };
      await delay(300);
      done++;
      if (done % 50 === 0) console.log(`  Steam: ${done}/${steamLib.length}`);
    }
  }

  const psnMap = {};
  if (fetchedPlatforms.has('psn')) {
    for (const e of psnLib) {
      psnMap[e.platformId] = {
        title: e.platformTitle,
        earned: e.earned,
        total: e.total,
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
      };
    }
  }

  const achievements = {
    steam: fetchedPlatforms.has('steam') ? steamMap : (existing.steam ?? {}),
    psn: fetchedPlatforms.has('psn') ? psnMap : (existing.psn ?? {}),
    xbox: fetchedPlatforms.has('xbox') ? xboxMap : (existing.xbox ?? {}),
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(achievementsPath, JSON.stringify(achievements, null, 2) + '\n');
  console.log(`\nWrote achievements.json — steam: ${Object.keys(achievements.steam).length}, psn: ${Object.keys(achievements.psn).length}, xbox: ${Object.keys(achievements.xbox).length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
