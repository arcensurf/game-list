// Guide the user through obtaining a PSN NPSSO token.
//
// The NPSSO token is a session cookie that the PSN API library uses to
// authenticate. It expires roughly every 60 days, at which point it
// needs to be refreshed manually.
//
// This script opens the browser to the right page and waits for the
// user to paste the token, then saves it to ~/.game-list/ and copies
// it to the clipboard for pasting into GitHub secrets.
//
// Usage: npm run psn-get-npsso-token

import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { spawn, execSync } from 'child_process';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

console.log('\n━━━ PSN NPSSO token helper ━━━\n');
console.log('This will walk you through getting a fresh NPSSO token.\n');
console.log('Step 1: Sign in to PlayStation Network in your browser.\n');

// Try to open the browser automatically
const loginUrl = 'https://www.playstation.com';
try {
  execSync(`open "${loginUrl}" 2>/dev/null || xdg-open "${loginUrl}" 2>/dev/null`, { stdio: 'ignore' });
  console.log('  → Opened ' + loginUrl + ' in your browser.\n');
} catch {
  console.log('  → Open this URL in your browser: ' + loginUrl + '\n');
}

await ask('Press Enter once you are signed in...');

console.log('\nStep 2: Visit the SSO cookie endpoint.\n');

const ssoUrl = 'https://ca.account.sony.com/api/v1/ssocookie';
try {
  execSync(`open "${ssoUrl}" 2>/dev/null || xdg-open "${ssoUrl}" 2>/dev/null`, { stdio: 'ignore' });
  console.log('  → Opened ' + ssoUrl + ' in your browser.\n');
} catch {
  console.log('  → Open this URL in your browser: ' + ssoUrl + '\n');
}

console.log('  You should see a JSON response like: {"npsso":"abc123..."}\n');
console.log('  Copy the value inside the quotes (just the token, not the key or braces).\n');
console.log('  If you see {"npsso":null} you are not signed in — go back to Step 1.\n');

const token = (await ask('Paste the NPSSO token here: ')).trim();

if (!token || token === 'null') {
  console.error('\nNo valid token provided. Run the script again after signing in.');
  rl.close();
  process.exit(1);
}

// Basic sanity check — NPSSO tokens are typically 64 chars, base64-ish
if (token.length < 20) {
  console.error('\nThat looks too short to be an NPSSO token. Make sure you copied the full value.');
  rl.close();
  process.exit(1);
}

// Save to ~/.game-list/
const tokenDir = resolve(homedir(), '.game-list');
if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
const tokenFile = resolve(tokenDir, 'psn-npsso-token');
writeFileSync(tokenFile, token);
try { chmodSync(tokenFile, 0o600); } catch { /* best-effort on non-posix */ }

// Try to copy to clipboard
let clipboardOk = false;
try {
  await new Promise((resolveFn, rejectFn) => {
    const proc = spawn('pbcopy');
    proc.on('error', rejectFn);
    proc.on('close', (code) => code === 0 ? resolveFn(null) : rejectFn(new Error(`pbcopy exit ${code}`)));
    proc.stdin.write(token);
    proc.stdin.end();
  });
  clipboardOk = true;
} catch { /* pbcopy not available */ }

console.log('\n✓ Success.\n');
console.log('The NPSSO token has been:');
console.log('  • saved to ' + tokenFile + ' (mode 600)');
console.log('    → local `npm run fetch-achievements` will pick it up automatically');
if (clipboardOk) {
  console.log('  • copied to your clipboard');
  console.log('    → paste it into the GitHub secret now, then clear your clipboard');
}
console.log('');
console.log('Next step: add it as a GitHub repo secret:');
console.log('  Settings → Secrets and variables → Actions → PSN_NPSSO_TOKEN');
if (clipboardOk) {
  console.log('  Value: ⌘V');
} else {
  console.log('  Value: `cat ' + tokenFile + ' | pbcopy` (or open the file)');
}
console.log('');
console.log('This token expires roughly every 60 days. The GitHub Actions');
console.log('workflow will open an issue automatically when it needs renewal.\n');

rl.close();
