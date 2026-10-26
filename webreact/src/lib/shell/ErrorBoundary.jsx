// The boundary around the SCREEN, not the app (R3.008, ErrorBoundary.svelte): one list returning {"rows": null} once
// took the whole application down; scoped here it costs one panel and the navigation survives.
// ★ A real retry: "Try again" remounts the children. `resetKey` (the path) clears a failure on navigation.
import { Component } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert";
import { Button } from "@/lib/components/ui/button";

// ★ FOUND LIVE, 28 Sep 2026 — a deploy replaces every hashed chunk file (vite's emptyOutDir); a
//   tab already open from before the deploy still holds the OLD hash in its own already-loaded
//   app.js, and the next lazy screen it opens 404s trying to fetch a chunk that no longer exists.
//   Our server's catch-all answers that 404 with the SPA shell (text/html), so the browser reports
//   it as "Expected a JavaScript module but got text/html" — and "Try again" below just remounts
//   the same broken import, failing identically forever. A real `location.reload()` fetches the
//   CURRENT index.html, which names the CURRENT chunks, and fixes it in one reload. Guarded by
//   sessionStorage so a genuinely broken chunk (not a stale one) reloads once, not in a loop.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
function isStaleChunkError(error) {
  return CHUNK_ERROR.test(String(error?.message ?? error ?? ""));
}

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, attempt: 0 }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    try { this.props.onError?.(error, this.props.where ?? null); } catch { /* a reporter that throws must not re-enter */ }
    console.error(`[error-boundary${this.props.where ? ` ${this.props.where}` : ""}]`, error);
    if (isStaleChunkError(error)) {
      // ★ Time-windowed, not session-long: a flat "already reloaded once this tab" flag would
      //   block a SECOND legitimate incident later the same session (another deploy an hour from
      //   now). 10s is long enough to stop a tight loop from one bad reload, short enough that a
      //   later, unrelated stale-chunk hit still gets its own reload.
      let recentlyReloaded = false;
      try {
        const last = Number(sessionStorage.getItem("ks-stale-chunk-reload") ?? 0);
        recentlyReloaded = Date.now() - last < 10_000;
      } catch { /* private mode etc — treat as not recently reloaded */ }
      if (!recentlyReloaded) {
        try { sessionStorage.setItem("ks-stale-chunk-reload", String(Date.now())); } catch { /* best effort */ }
        window.location.reload();
      }
    }
  }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    const { error, attempt } = this.state;
    if (!error) return <div key={attempt} className="contents">{this.props.children}</div>;
    return (
      <Alert variant="destructive" className="m-7 max-w-(--size-modal-wide)" data-testid="error-boundary" data-where={this.props.where ?? undefined} role="alert">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>This part of the screen stopped working.</AlertTitle>
        <AlertDescription>
          <p className="m-0">{error?.message ?? String(error ?? "Unknown error.")}</p>
          {error?.requestId ? <p className="m-0 text-caption">Reference: <code>{error.requestId}</code></p> : null}
          <Button variant="outline" className="mt-2" data-testid="error-retry" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>Try again</Button>
        </AlertDescription>
      </Alert>
    );
  }
}
