/**
 * Load sharp on demand, for the cover scripts only.
 *
 * sharp is deliberately NOT in package.json. It ships ~26 platform-specific
 * native packages plus a wasm fallback whose @emnapi transitive deps npm
 * resolves differently per platform — so a lockfile written on macOS is
 * missing entries that `npm ci` on the Linux CI runner demands, and the Pages
 * deploy fails at install time before it ever reaches the build. Nothing in
 * src/ imports sharp; only these maintenance scripts need it, and they only
 * ever run locally. Keeping it out of the manifest keeps CI's dependency tree
 * platform-neutral.
 *
 * Install it ad hoc when you need to run a cover script:
 *   npm install --no-save sharp
 */
export async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.error('This script needs sharp, which is not a tracked dependency.');
    console.error('Install it for this checkout with:\n');
    console.error('  npm install --no-save sharp\n');
    console.error("It's kept out of package.json on purpose — its per-platform");
    console.error('native packages break `npm ci` on the Linux CI runner.');
    process.exit(1);
  }
}
