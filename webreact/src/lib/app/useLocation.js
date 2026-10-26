// The URL, as React state (Ruling 27 Sep: the route table is routes.js; there is no second router to disagree with
// it). Mirrors webui's catch-all route: every nav row is a real, bookmarkable URL the server answers with the shell.
// ★★★ The navigate guard compares the WHOLE URL (pathname + search), never the pathname alone — F441: comparing the
//     pathname made every `?new=1` drawer impossible to close, and a save that "failed" to close invited a duplicate.
import { useCallback, useEffect, useMemo, useState } from "react";

const read = () => ({ path: window.location.pathname, search: window.location.search });

export function useLocation() {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to, { replace = false } = {}) => {
    if (!to) return;
    const here = window.location.pathname + window.location.search;
    if (to === here) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", to);
    setLoc(read());
  }, []);
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(loc.search)), [loc.search]);
  return { path: loc.path, search: loc.search, query, navigate: go };
}
