// A framework-free observable — the replacement for Svelte's `$state` objects (REACT-PLAN R-6).
// Plain objects that notify; React reads them through useSyncExternalStore (useStore below),
// gates and tests read them directly with no React at all.
import { useSyncExternalStore } from "react";

/**
 * createStore(initial) → a proxy object: reads are plain property reads; every write notifies.
 * `subscribe(fn)` returns an unsubscribe. `getSnapshot()` returns a version number that changes on
 * every write, so useSyncExternalStore re-renders exactly when something changed.
 */
export function createStore(initial) {
  const listeners = new Set();
  let version = 0;
  const target = { ...initial };
  const notify = () => { version += 1; for (const l of [...listeners]) l(); };
  const proxy = new Proxy(target, {
    set(t, k, v) { if (t[k] === v) return true; t[k] = v; notify(); return true; },
    deleteProperty(t, k) { delete t[k]; notify(); return true; },
  });
  Object.defineProperties(proxy, {
    subscribe: { value: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, enumerable: false },
    getSnapshot: { value: () => version, enumerable: false },
  });
  return proxy;
}

/** Re-render the calling component whenever `store` changes; returns the store. */
export function useStore(store) {
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store;
}
