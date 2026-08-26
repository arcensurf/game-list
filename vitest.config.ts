import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deliberately separate from vite.config.ts rather than a `test` block
// inside it: the app config carries `base: '/game-list/'` and the dev
// API plugin, neither of which has any meaning in a test run (the dev
// plugin would spin up its route handlers on every `vitest` invocation).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // jsdom by default so component and hook tests just work; the
    // pure-logic and script suites opt back down to node with a
    // `// @vitest-environment node` pragma where the DOM is dead weight.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'test/**/*.test.{ts,mjs}'],
    restoreMocks: true,
  },
});
