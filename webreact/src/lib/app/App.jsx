// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE APPLICATION (R3.001 + R3.1) — ported from webui/src/lib/app/App.svelte. ONE tree: the entry (main.jsx) is a
// thin adapter over the URL; this is the application, and it is what the gates mount.
// ★ Providers once, here: the AppState context, the Toaster (sonner) and the TooltipProvider (RX-2 closed).
// ★ Boot branches, each named: booting · signed out (link carries ?practice= mid-switch) · the client portal (a 403 on
//   /api/nav means "a session that is not staff", F440 — never "signed out") · nav unavailable · the staff app · Shell.
// ★ `boot` is off by default so a gate mounting App does not reach the network; the entry turns it on.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useState } from "react";
import { AppStateContext, useAppState } from "./useAppState.js";
import { AppState } from "./appState.js";
import Shell from "./Shell.jsx";
import Screen from "./Screen.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import { Toaster } from "@/lib/components/ui/sonner";
import { TooltipProvider } from "@/lib/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/lib/components/ui/button";
import { SURFACES } from "@keystone/app/surfaces.mjs";
import { fileComponent } from "./lazyScreens.js";

const ClientApp = fileComponent("lib/portal/ClientApp.jsx");
const StaffApp = fileComponent("lib/staff/StaffApp.jsx");

const Booting = () => <div className="grid h-dvh place-items-center" data-testid="booting-wrap"><p className="sr-only" data-testid="booting">Starting Workbench…</p><AppSpinner label="Starting Workbench…" /></div>;
const Fatal = ({ testId, title, error, onRetry }) => (
  <div className="mx-auto mt-24 flex max-w-(--size-modal) flex-col gap-3 rounded-card border border-bad-border bg-bad-bg p-6" role="alert" data-testid={testId}>
    <h1 className="m-0 text-empty-title font-medium text-ink">{title}</h1>
    <p className="m-0 text-ui text-ink-2">{error.message}</p>
    {error.requestId ? <p className="m-0 text-caption text-mute">Reference: {error.requestId}</p> : null}
    <div><Button variant="outline" onClick={onRetry}>Try again</Button></div>
  </div>
);

function Tree({ path, onNavigate }) {
  const app = useAppState();
  const surfaceKey = SURFACES.find((s) => s.path === path)?.key ?? app.portalNav?.surfaces?.[0]?.key ?? null;
  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE testing the portal redesign: a race between loadNav() (a 403
  //   sets app.portal=true) and loadPortal() (sets app.portalNav) that permanently breaks the
  //   whole client portal whenever the FIRST lands before the SECOND. loadPortalSurface(key) reads
  //   `this.portalNav?.surfaces` to find the row for `key`; if portalNav is still null at that
  //   instant, the row is never found, `portalSurfaceKey` is never set (the early-return happens
  //   BEFORE that assignment), and portalData stays null forever. Nothing ever retried it, because
  //   `surfaceKey` itself is resolved from the static SURFACES table by `path` alone and never
  //   depends on portalNav once that lookup succeeds — so this effect's own dependency array never
  //   changed again, and every phone screen showed its permanent-loading spinner. Adding
  //   `app.portalNav` to the deps makes the moment it actually arrives re-run this check.
  useEffect(() => {
    if (app.portal && surfaceKey && surfaceKey !== app.portalSurfaceKey) app.loadPortalSurface(surfaceKey);
  }, [app.portal, surfaceKey, app.portalSurfaceKey, app.portalNav]); // eslint-disable-line react-hooks/exhaustive-deps

  if (app.authed === null) return <Booting />;
  if (app.authed === false) {
    return (
      <div className="mx-auto mt-24 flex max-w-(--size-modal) flex-col gap-3">
        <ScreenState phase="denied" reason="You are signed out." />
        <p className="m-0 text-ui"><a className="text-brand" href={app.switchingTo ? `/login?practice=${encodeURIComponent(app.switchingTo)}` : "/login"} data-testid="to-login">Go to sign in</a></p>
      </div>
    );
  }
  if (app.portal) {
    if (app.portalError) return <Fatal testId="portal-unavailable" title="We could not load your app" error={app.portalError} onRetry={app.loadPortal} />;
    if (!app.portalNav) return <Booting />;
    return <Suspense fallback={<Booting />}><ClientApp role={app.portalNav.role} surface={surfaceKey} data={app.portalData} terms={app.portalNav.terms ?? {}} practiceName={app.portalNav.practiceName ?? null} privacyUrl={app.portalNav.privacyUrl ?? null} termsUrl={app.portalNav.termsUrl ?? null} onNavigate={onNavigate} /></Suspense>;
  }
  if (app.navError) return <Fatal testId="nav-unavailable" title="Workbench could not load your workspace" error={app.navError} onRetry={app.loadNav} />;
  if (!app.nav) return <Booting />;
  if (path === "/staff" || path.startsWith("/staff/")) return <Suspense fallback={<Booting />}><StaffApp app={app} path={path} onNavigate={onNavigate} /></Suspense>;
  return <Shell app={app} path={path} onNavigate={onNavigate}><Screen app={app} path={path} onNavigate={onNavigate} /></Shell>;
}

// ★ Part 3 invoice rebuild — ONE QueryClient for the whole tree, created once per App instance
//   (not per render, which would drop every cache on each re-render). The invoice editor's
//   debounced draft-sync is the first caller; any future screen that wants TanStack Query reads
//   from the SAME client rather than mounting its own.
function App({ app = null, path = "/home", onNavigate = () => {}, boot = false }) {
  const [own] = useState(() => (app ? null : new AppState()));
  const instance = app ?? own;
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => { if (boot) instance.boot(); }, [boot, instance]);
  return (
    <AppStateContext.Provider value={instance}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Tree path={path} onNavigate={onNavigate} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppStateContext.Provider>
  );
}
export default App;
