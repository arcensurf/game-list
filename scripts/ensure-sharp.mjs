/**
 * postinstall hook: make sure sharp is available for local cover work
 * (the dev server's CoverPicker, fetch-covers.mjs, covers-to-webp.mjs)
 * without ever installing it on CI.
 *
 * sharp is deliberately NOT a tracked dependency — see scripts/lib/load-sharp.mjs
 * for why (its per-platform native packages break `npm ci` on the Linux
 * CI runner). Without it, a picked cover silently degrades to raw
 * PNG/JPG instead of WebP (dev-api-plugin.ts's encodeCover falls back
 * rather than failing the pick) — easy to miss until a batch of covers
 * has already piled up unconverted, which is exactly what happened
 * locally before this existed.
 *
 * GitHub Actions sets CI=true, and npm ci runs postinstall by default,
 * so this has to opt out explicitly rather than rely on npm ci somehow
 * behaving differently from npm install.
 */
import { execSync } from 'child_process';

if (process.env.CI) process.exit(0);

try {
  await import('sharp');
  process.exit(0); // already installed
} catch {
  // fall through to install
}

console.log('[postinstall] Installing sharp for local cover processing (not tracked in package.json)...');
try {
  execSync('npm install --no-save sharp', { stdio: 'inherit' });
} catch {
  console.warn(
    '[postinstall] Could not install sharp automatically — covers picked locally will ' +
      'save unconverted (PNG/JPG instead of WebP) until you run:\n\n  npm install --no-save sharp\n',
  );
}
