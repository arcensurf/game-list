import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// ── Web Storage ──
//
// Node 22+ ships its own experimental `localStorage` global, and it wins
// over jsdom's on both `localStorage` and `window.localStorage` (the two
// are the same object under vitest's jsdom environment). Without a
// `--localstorage-file` it is an inert stub with no `getItem`/`clear` at
// all, so browser code written the ordinary way — see useLeaderboardFilters
// and useGogFilter — would blow up in tests for reasons that have nothing
// to do with the code under test.
//
// Install a real in-memory Storage instead. It replaces the global
// `Storage` constructor too, so `vi.spyOn(Storage.prototype, 'setItem')`
// and `instanceof Storage` both still work the way a test would expect.
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }
  clear(): void {
    this.#entries.clear();
  }
  [name: string]: unknown;
}

const localStorageStub = new MemoryStorage();
const sessionStorageStub = new MemoryStorage();

Object.defineProperty(globalThis, 'Storage', { configurable: true, writable: true, value: MemoryStorage });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => localStorageStub });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => sessionStorageStub });

// Storage outlives an individual test, so a value one case persists would
// otherwise be read back as initial state by the next one.
beforeEach(() => {
  localStorageStub.clear();
  sessionStorageStub.clear();
});

// React Testing Library doesn't auto-clean under `globals: true` unless it
// can detect the test framework's afterEach — wire it explicitly so a
// component left mounted by one test can't be found by the next one.
afterEach(cleanup);
