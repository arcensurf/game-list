// Mint an Xbox Live refresh token via Microsoft's v1 Live Connect
// limited-input-device flow.
//
// Why this endpoint (and not v2.0 Microsoft Identity Platform):
//   - The old login.live.com redirect flow for public clients is now
//     blocked by Microsoft's anti-phishing page (codes get invalidated
//     server-side before the user can copy them).
//   - The v2.0 `consumers/oauth2/v2.0/devicecode` endpoint rejects
//     first-party Microsoft clients (like Azure CLI) for user consent,
//     and rejects legacy public clients (like the Minecraft launcher)
//     with "application not found."
//   - The v1 `login.live.com/oauth20_connect.srf` endpoint still honors
//     well-known public clients and supports its own device-code flow,
//     which is what prismarine-auth and the broader Minecraft/Xbox auth
//     ecosystem use.
//
// We borrow the Minecraft launcher's client_id — a widely-used public
// client whose auth endpoints have been stable for years.
//
// The token is never printed to stdout — it's written to
// ~/.game-list/xbox-refresh-token (mode 600) and copied to the
// clipboard via pbcopy on macOS so you can paste it into the GitHub
// secret UI without the value ever appearing on screen.
//
// Usage: npm run xbox-get-refresh-token

import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

const CLIENT_ID = '00000000402b5328'; // Minecraft launcher public client
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const DEVICECODE_URL = 'https://login.live.com/oauth20_connect.srf';
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n━━━ Xbox Live refresh token helper ━━━\n');
console.log('Requesting device code from Microsoft...\n');

// ── Step 1: request a device code ──
const deviceRes = await fetch(DEVICECODE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'device_code',
    scope: SCOPE,
  }),
});

if (!deviceRes.ok) {
  console.error('Device code request failed:', await deviceRes.text());
  process.exit(1);
}

const device = await deviceRes.json();
// { user_code, device_code, verification_uri, interval, expires_in }

console.log('1. Open this URL in your browser:\n');
console.log('   ' + device.verification_uri + '\n');
console.log('2. Enter this code when prompted:\n');
console.log('   ' + device.user_code + '\n');
console.log('3. Sign in with your Microsoft / Xbox Live account.');
console.log('   Two-factor auth works normally here.\n');
console.log('4. Approve the sign-in request.\n');
console.log(`Waiting for you to approve (code expires in ${Math.floor(device.expires_in / 60)} min)...\n`);

// ── Step 2: poll the token endpoint until approved or expired ──
let intervalMs = (device.interval || 5) * 1000;
const deadline = Date.now() + device.expires_in * 1000;

while (Date.now() < deadline) {
  await sleep(intervalMs);

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
    }),
  });

  const tokens = await tokenRes.json();

  // v1 and v2 use slightly different error strings — handle both.
  if (tokens.error === 'authorization_pending') {
    process.stdout.write('.');
    continue;
  }
  if (tokens.error === 'slow_down') {
    intervalMs += 5000;
    continue;
  }
  if (tokens.error === 'authorization_declined' || tokens.error === 'user_denied') {
    console.error('\n\nYou declined the sign-in. Run the script again if that was a mistake.');
    process.exit(1);
  }
  if (tokens.error === 'expired_token' || tokens.error === 'code_expired') {
    console.error('\n\nThe device code expired. Run the script again and approve faster.');
    process.exit(1);
  }
  if (tokens.error) {
    console.error('\n\nToken exchange failed:', tokens.error_description || tokens.error);
    process.exit(1);
  }

  if (!tokens.refresh_token) {
    console.error('\n\nMicrosoft returned tokens but no refresh_token.');
    console.error('Keys returned:', Object.keys(tokens).join(', '));
    process.exit(1);
  }

  // Save to the fallback location the fetch script already reads from,
  // so local runs work without needing XBOX_REFRESH_TOKEN in .env.local.
  const tokenDir = resolve(homedir(), '.game-list');
  if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
  const tokenFile = resolve(tokenDir, 'xbox-refresh-token');
  writeFileSync(tokenFile, tokens.refresh_token);
  try { chmodSync(tokenFile, 0o600); } catch { /* best-effort on non-posix */ }

  // Try to copy to clipboard so the user can paste into the GitHub
  // secret UI without ever seeing the value on screen. pbcopy is macOS;
  // fall back gracefully if it isn't available.
  let clipboardOk = false;
  try {
    await new Promise((resolveFn, rejectFn) => {
      const proc = spawn('pbcopy');
      proc.on('error', rejectFn);
      proc.on('close', (code) => code === 0 ? resolveFn(null) : rejectFn(new Error(`pbcopy exit ${code}`)));
      proc.stdin.write(tokens.refresh_token);
      proc.stdin.end();
    });
    clipboardOk = true;
  } catch { /* pbcopy not available — user can read the file manually */ }

  console.log('\n\n✓ Success.\n');
  console.log('The refresh token has been:');
  console.log('  • saved to ' + tokenFile + ' (mode 600)');
  console.log('    → local `npm run fetch-achievements` will pick it up automatically');
  if (clipboardOk) {
    console.log('  • copied to your clipboard');
    console.log('    → paste it into the GitHub secret now, then clear your clipboard');
  }
  console.log('');
  console.log('Next step: add it as a GitHub repo secret:');
  console.log('  Settings → Secrets and variables → Actions → New secret');
  console.log('  Name:  XBOX_REFRESH_TOKEN');
  if (clipboardOk) {
    console.log('  Value: ⌘V');
  } else {
    console.log('  Value: `cat ' + tokenFile + ' | pbcopy` (or open the file)');
  }
  console.log('');
  console.log('The token auto-rotates on every workflow run. You should only');
  console.log('need to repeat this if Microsoft invalidates it (password change,');
  console.log('suspicious-activity lockout, etc.).\n');
  process.exit(0);
}

console.error('\n\nTimed out waiting for approval. Run the script again.');
process.exit(1);
