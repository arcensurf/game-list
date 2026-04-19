// One-off probe: does PS3 + Xbox 360 expose per-achievement rarity?
// Run: node scripts/probe-rarity.mjs
//
// Reuses the auth flow from fetch-achievements.mjs (NPSSO + Xbox refresh
// token, both read from ~/.game-list/ if no env vars are set).

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokenDir = process.env.TOKEN_DIR
  ? resolve(process.env.TOKEN_DIR)
  : resolve(homedir(), '.game-list');

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '..', '.env.local') });
} catch {}

// ── PS3 probe: Tales of Xillia (NPWR04338_00) ──

const PSN_NPSSO_TOKEN_FILE = resolve(tokenDir, 'psn-npsso-token');
const PSN_REFRESH_TOKEN_FILE = resolve(tokenDir, 'psn-refresh-token');
const PSN_NPSSO_TOKEN = process.env.PSN_NPSSO_TOKEN
  || (existsSync(PSN_NPSSO_TOKEN_FILE) ? readFileSync(PSN_NPSSO_TOKEN_FILE, 'utf-8').trim() : undefined);

async function probePsn() {
  console.log('\n=== PSN: Tales of Xillia (PS3, NPWR04338_00) ===');
  if (!PSN_NPSSO_TOKEN) { console.log('skip — no NPSSO'); return; }

  const psn = await import('psn-api');
  let auth;
  if (existsSync(PSN_REFRESH_TOKEN_FILE)) {
    try {
      auth = await psn.exchangeRefreshTokenForAuthTokens(
        readFileSync(PSN_REFRESH_TOKEN_FILE, 'utf-8').trim(),
      );
      writeFileSync(PSN_REFRESH_TOKEN_FILE, auth.refreshToken);
    } catch {
      const code = await psn.exchangeNpssoForAccessCode(PSN_NPSSO_TOKEN);
      auth = await psn.exchangeAccessCodeForAuthTokens(code);
      writeFileSync(PSN_REFRESH_TOKEN_FILE, auth.refreshToken);
    }
  } else {
    const code = await psn.exchangeNpssoForAccessCode(PSN_NPSSO_TOKEN);
    auth = await psn.exchangeAccessCodeForAuthTokens(code);
    writeFileSync(PSN_REFRESH_TOKEN_FILE, auth.refreshToken);
  }

  const npCommId = 'NPWR04338_00';
  // PS3 trophies need npServiceName: 'trophy' (PS4+ uses 'trophy2').
  const defs = await psn.getTitleTrophies(
    { accessToken: auth.accessToken },
    npCommId,
    'all',
    { npServiceName: 'trophy' },
  );
  const earned = await psn.getUserTrophiesEarnedForTitle(
    { accessToken: auth.accessToken },
    'me',
    npCommId,
    'all',
    { npServiceName: 'trophy' },
  );
  const def0 = defs.trophies?.[0] ?? {};
  const earn0 = earned.trophies?.[0] ?? {};
  console.log('definition keys:', Object.keys(def0));
  console.log('earned keys:    ', Object.keys(earn0));
  console.log('first definition:', JSON.stringify(def0, null, 2));
  console.log('first earned:   ', JSON.stringify(earn0, null, 2));
}

// ── Xbox 360 probe: Guitar Hero II (titleId 1096157159) ──

const XBOX_REFRESH_TOKEN_FILE = resolve(tokenDir, 'xbox-refresh-token');
const XBOX_REFRESH_TOKEN =
  (existsSync(XBOX_REFRESH_TOKEN_FILE)
    ? readFileSync(XBOX_REFRESH_TOKEN_FILE, 'utf-8').trim()
    : null) || process.env.XBOX_REFRESH_TOKEN;

async function probeXbox() {
  console.log('\n=== Xbox: Guitar Hero II (360, titleId 1096157159) ===');
  if (!XBOX_REFRESH_TOKEN) { console.log('skip — no refresh token'); return; }

  const tokenRes = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: '00000000402b5328',
      refresh_token: XBOX_REFRESH_TOKEN,
      scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) { console.error('xbox token refresh failed', tokens); return; }
  writeFileSync(XBOX_REFRESH_TOKEN_FILE, tokens.refresh_token);

  const { xnet } = await import('@xboxreplay/xboxlive-auth');
  const userToken = await xnet.exchangeRpsTicketForUserToken(tokens.access_token, 't');
  const xsts = await xnet.exchangeTokenForXSTSToken(userToken.Token);
  const xuid = xsts.DisplayClaims.xui[0].xid;
  const userHash = xsts.DisplayClaims.xui[0].uhs;
  const auth = `XBL3.0 x=${userHash};${xsts.Token}`;

  const titleId = '1096157159'; // Guitar Hero II (360)
  const variants = [
    { label: 'modern v4', url: `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=5`, ver: '4' },
    { label: 'modern v2', url: `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=5`, ver: '2' },
    { label: 'titlehub achievement decoration', url: `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titleid(${titleId})/decoration/achievement`, ver: '2' },
  ];
  for (const v of variants) {
    console.log(`\n--- ${v.label} ---`);
    const res = await fetch(v.url, {
      headers: { Authorization: auth, 'x-xbl-contract-version': v.ver, 'Accept-Language': 'en-US' },
    });
    if (!res.ok) { console.log('  HTTP', res.status, (await res.text()).slice(0, 200)); continue; }
    const data = await res.json();
    const list = data.achievements ?? data.titles?.[0]?.achievement?.achievements ?? [];
    console.log('  count:', list.length);
    if (list[0]) {
      console.log('  keys:', Object.keys(list[0]));
      console.log('  sample:', JSON.stringify(list[0], null, 2).slice(0, 1500));
    } else {
      console.log('  raw (truncated):', JSON.stringify(data, null, 2).slice(0, 800));
    }
  }
}

await probePsn().catch((e) => console.error('PSN probe error:', e.message));
await probeXbox().catch((e) => console.error('Xbox probe error:', e.message));
