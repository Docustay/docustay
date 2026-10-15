// React access to the one AppState instance (REACT-PLAN R1.5). The provider holds the instance; any
// component calls useAppState() and re-renders when any field changes (useSyncExternalStore).
import { createContext, useContext, useSyncExternalStore } from "react";

export const AppStateContext = createContext(null);

export function useAppState() {
  const app = useContext(AppStateContext);
  if (!app) throw new Error("useAppState: no <AppStateContext.Provider> above this component");
  useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  return app;
}

/**
 * ★★★ Subscribe to an AppState handed in as a PROP. The React Compiler memoises a child whose props are the same
 *     references — and `app` is the same object before and after any field changes — so a component that reads
 *     `app.x` from a prop without subscribing renders STALE forever (found live, 27 Sep: the practice switcher sat on
 *     "Loading your practice…" after /api/auth/practices had answered). Gate react_code_rules.mjs K15 requires it.
 */
export function useSubscribed(app) {
  useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  return app;
}

const noSubscribe = () => () => {};
const noSnapshot = () => 0;
/** useSubscribed for a component that may be mounted with no provider (a gate or a story): subscribes when there is one. */
export function useSubscribedOptional(app) {
  useSyncExternalStore(app?.subscribe ?? noSubscribe, app?.getSnapshot ?? noSnapshot, app?.getSnapshot ?? noSnapshot);
  return app;
}
