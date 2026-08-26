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

// ── IntersectionObserver ──
//
// jsdom doesn't implement it, and two views depend on it (the card grid's
// grain and the leaderboard's, via useInView) — so without a stub any
// component under them throws on mount. Nothing here needs real
// intersection behaviour: the stub records targets so a test can assert
// observation happened, and never fires the callback, which leaves
// elements in their un-intersected state.
class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  readonly observed = new Set<Element>();

  // Plain fields rather than constructor parameter properties: the app's
  // tsconfig sets `erasableSyntaxOnly`, which rules those out.
  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
  }

  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Test hook: drive the callback as if `target` crossed the threshold. */
  emit(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  writable: true,
  value: StubIntersectionObserver,
});

// ── ResizeObserver ──
//
// Also absent from jsdom, and reached on mount by GameCardHud. jsdom has
// no layout engine, so there is nothing meaningful to report — the stub
// exists so components that observe their own size can mount at all.
class StubResizeObserver implements ResizeObserver {
  readonly observed = new Set<Element>();
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: StubResizeObserver,
});

// React Testing Library doesn't auto-clean under `globals: true` unless it
// can detect the test framework's afterEach — wire it explicitly so a
// component left mounted by one test can't be found by the next one.
afterEach(cleanup);
