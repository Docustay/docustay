// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE APPLICATION SHELL (R3.001) — ported from webui/src/lib/app/Shell.svelte; layout from SidebarV2.frame.html.
// ★★ It COMPOSES, it does not decide: every list, record, refusal and not-built state comes from the server.
// ★ SIDEBAR V2 [the maintainer, 23 Sep]: the sidebar never collapses. Header = identity + setup meter; body = search + nav;
//   floor = four 32px icon buttons + ONE primary "New" menu. The error boundary wraps the SCREEN, never the app.
// ★★★ NO HEADER [the maintainer, 29 Sep] — REVERSES Ruling 27 Sep, which had put breadcrumbs in a 56px top bar. There is
//   no bar of any kind above the content column: `<main>` starts flush at the top of it, full width, full
//   height. `Breadcrumbs.jsx` (and the crumbQuery/back-restores-filters mechanism that only existed to feed
//   it) is retired, not merely hidden — see `db/gates/p5_end_to_end.mjs`'s P5_MARKERS, updated to match.
// ★ Two chrome-owned surfaces (⌘K and Book a session) live here because both open from anywhere.
// ★★ CANVAS = SURFACE [the maintainer, 29 Sep] — the root was `bg-paper` (#FAFAFC), visibly different from the
//   sidebar's `bg-surface` (#FFFFFF) once the whole-page-scroll bug (F812) stopped hiding large flat
//   stretches of it. `bg-paper` still means something elsewhere (a hover/locked-field muted tint) —
//   this is the one place it was standing in for "the app's own background," which is now pure white.
//   Same reasoning applied to `EditorPage.jsx` (the service/package/plan/invoice editor archetype)
//   and `TemplateBuilder.jsx`'s own full-screen root — the other two places `bg-paper` played this
//   same "whole screen's canvas" role rather than a small muted-state one.
// ★★ PHONES [F68] — below `md` (768px) the sidebar is hidden and a top bar (practice name + menu button) opens the SAME
//   sidebar as an overlay drawer (closes on navigation, Escape, backdrop). From `md` up nothing changes: the wrapper is
//   `display: contents`, so the <nav> is the flex item it always was. The "never collapses" rule is about desktop.
// ★★ F71 — the root is `relative`: `absolute` descendants (sr-only labels, popper anchors) in a long settings page have the
//   initial containing block as their box, so `overflow-hidden` did NOT clip them — they stretched the DOCUMENT taller than
//   the viewport (sidebar ended partway, grey band under it). A positioned root + positioned <main> contain them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useSubscribed } from "@/lib/app/useAppState.js";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, X, MessageCircle, Globe, ChevronDown, Menu } from "lucide-react";
import Sidebar from "@/lib/shell/Sidebar.jsx";
import TenantSwitcher from "@/lib/shell/TenantSwitcher.jsx";
import SetupBar from "@/lib/shell/SetupBar.jsx";
import SetupSheet from "@/lib/shell/SetupSheet.jsx";
import NotificationBell from "@/lib/shell/NotificationBell.jsx";
import AvatarMenu from "@/lib/shell/AvatarMenu.jsx";
import useSharedEngine from "@/lib/screens/documents/useSharedEngine.js";
import CommandSurface from "@/lib/shell/CommandSurface.jsx";
import BookSessionDialog from "@/lib/shell/BookSessionDialog.jsx";
import { DeleteHost } from "@/lib/record/DeleteDialog.jsx";
import ErrorBoundary from "@/lib/shell/ErrorBoundary.jsx";
import ViewingAsBanner from "@/lib/shell/ViewingAsBanner.jsx";
import ShellPopover2Popover from "./ShellPopover2Popover.jsx";
import { api } from "@/lib/api.js";
import { performWrite } from "@/lib/permissions/write.js";
import { navForViewer, rankAtLeast } from "@/lib/permissions/can.js";
import { networkStatus } from "@/lib/app/networkStatus.js";
import { useStore } from "@/lib/app/store.js";
import { ICON_STROKE } from "@/lib/icons/stroke.js";

const chromeBtn = "grid size-8 place-items-center rounded-control border border-line text-ink-2 no-underline hover:bg-mute-bg";

export default function Shell({ app, path, onNavigate, children }) {
  useSubscribed(app);
  const net = useStore(networkStatus);
  const [showDegraded, setShowDegraded] = useState(true);
  const [helpInfo, setHelpInfo] = useState(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const [setupSheetOpen, setSetupSheetOpen] = useState(false);
  const newMenu = useRef(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sharedEngine = useSharedEngine();

  // The "New" menu closes on an outside click (capture phase: a list action that stops propagation still closes it).
  useEffect(() => {
    const close = (e) => { if (newMenu.current?.open && !newMenu.current.contains(e.target)) newMenu.current.open = false; };
    document.addEventListener("pointerdown", close, { capture: true });
    return () => document.removeEventListener("pointerdown", close, { capture: true });
  }, []);
  // Screen-view telemetry, fire-and-forget, through the one write path.
  useEffect(() => { performWrite(app.permissions, "recordTelemetry", ["screen_view", path]).catch(() => {}); }, [path, app.permissions]);
  useEffect(() => { if (net.degraded) setShowDegraded(true); }, [net.degraded]);
  // The phone drawer closes on any navigation and on Escape.
  useEffect(() => { setDrawerOpen(false); }, [path]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const loadHelp = async () => {
    if (helpInfo || helpLoading) return;
    setHelpLoading(true);
    try { setHelpInfo(await api.help()); } catch { setHelpInfo({ configured: false }); } finally { setHelpLoading(false); }
  };
  const avatar = (
    <AvatarMenu displayName={app.me?.displayName ?? null} role={app.me?.staffRole ?? app.me?.role ?? null} appUserId={app.me?.appUserId ?? null}
      operatorGrantActive={app.me?.operatorGrantActive ?? false} onNavigate={onNavigate} onSignOut={app.signOut} density={app.density} onSetDensity={app.setDensity} />
  );

  const header = () => (
    <>
      <div className="flex items-center gap-2" data-testid="sidebar-identity-row">
        <TenantSwitcher practices={app.practices} tenant={app.tenant} loading={app.practices === null && !app.practicesError} error={app.practicesError} onSwitch={app.switchPractice} />
        {avatar}
      </div>
      {/* F49: setting the practice up is the Owner's and Admins' job — a Coach never sees the meter. */}
      {!app.permissions || rankAtLeast(app.permissions, "admin") ? <SetupBar summary={app.setupSummary} nextStep={app.nextSetupStep} onOpen={(href) => { if (href) onNavigate(href); else setSetupSheetOpen(true); }} /> : null}
    </>
  );
  const footer = () => (
    <>
      <div className="mb-2.25 flex gap-1.5" data-testid="sidebar-chrome-row">
        <NotificationBell unread={app.unread} notifications={app.notifications} loading={app.notifLoading} error={app.notifError}
          onOpen={app.openNotifications} onRead={app.markRead} onMarkAllRead={app.markAllRead} onFollow={onNavigate} />
        <button type="button" className={chromeBtn} data-testid="chrome-messages" onClick={() => onNavigate("/app/messages")} aria-label="Messages" title="Messages">
          <MessageCircle className="size-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
        <ShellPopover2Popover path={path} helpInfo={helpInfo} helpLoading={helpLoading} loadHelp={loadHelp} />
        <a className={chromeBtn} data-testid="chrome-examplecore" href="https://example.com" target="_blank" rel="noopener noreferrer" aria-label="example.com" title="example.com">
          <Globe className="size-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </a>
      </div>
      <details className="group relative" data-testid="sidebar-new" ref={newMenu}>
        <summary className="flex h-(--size-control) w-full cursor-pointer list-none items-center justify-center gap-2 rounded-control bg-brand text-ui font-medium text-white [&::-webkit-details-marker]:hidden" data-testid="chrome-new">
          New <ChevronDown className="size-4 opacity-70 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="absolute inset-x-0 bottom-full z-40 mb-1.5 flex flex-col rounded-card border border-line bg-surface p-1 shadow-modal" role="menu">
          {[["chrome-new-client", "New client", () => onNavigate("/people/clients?new=1")], ["chrome-book-session", "New booking", () => { app.bookOpen = true; }], ["chrome-new-invoice", "New invoice", () => onNavigate("/money/invoices?new=1")], ...(sharedEngine.enabled ? [["chrome-new-doc-template", "Document template (shared editor)", () => onNavigate("/documents/write")]] : [])]
            .map(([tid, label, run]) => <button key={tid} type="button" role="menuitem" data-testid={tid} className="rounded-sm px-3 py-2 text-left text-ui text-ink-2 hover:bg-mute-bg" onClick={() => { if (newMenu.current) newMenu.current.open = false; run(); }}>{label}</button>)}
        </div>
      </details>
    </>
  );

  return (
    <>
      <ViewingAsBanner viewingAs={app.viewingAs} onExit={app.exitSeeAs} />
      {net.degraded && showDegraded ? (
        <div className="fixed inset-x-0 top-0 z-60 flex items-center justify-center gap-3 bg-warn-soft px-4 py-2 text-control text-warn" role="alert">
          <CircleAlert className="size-4" strokeWidth={2} aria-hidden="true" /><span>Having trouble reaching the server. Retrying…</span>
          <button type="button" aria-label="Dismiss" onClick={() => setShowDegraded(false)}><X className="size-4" strokeWidth={2} aria-hidden="true" /></button>
        </div>
      ) : null}
      <div className={`relative flex h-dvh flex-col overflow-hidden bg-surface text-ink md:flex-row ${app.viewingAs ? "pt-11" : ""}`} data-testid="app" data-active-path={path} data-density={app.density}>
        {/* Phone top bar (F68): below md only. */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:hidden" data-testid="mobile-topbar">
          <button type="button" className={chromeBtn} data-testid="mobile-menu-button" aria-label="Open menu" aria-expanded={drawerOpen} aria-controls="app-sidebar-drawer" onClick={() => setDrawerOpen(true)}>
            <Menu className="size-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink" data-testid="mobile-practice-name">{app.tenant?.name ?? "Workbench"}</span>
        </div>
        {drawerOpen ? <div className="fixed inset-0 z-40 bg-ink/40 md:hidden" data-testid="mobile-drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} /> : null}
        <div id="app-sidebar-drawer" className={drawerOpen ? "fixed inset-y-0 left-0 z-50 flex max-w-[85vw] shadow-modal md:contents" : "hidden md:contents"} data-testid="sidebar-drawer" data-open={drawerOpen ? "true" : "false"}>
          <Sidebar nav={navForViewer(app.permissions, app.nav?.sections ?? [])} activePath={path} stateFor={app.stateFor} counts={app.navCounts} onNavigate={(href) => { setDrawerOpen(false); onNavigate(href); }}
            onSearchEverything={(q) => { setDrawerOpen(false); app.paletteQuery = q ?? ""; app.paletteOpen = true; }} collapsed={false} header={header} footer={footer} />
        </div>
        <SetupSheet open={setupSheetOpen} groups={app.capabilities?.checklist?.groups ?? []} summary={app.setupSummary} onClose={() => setSetupSheetOpen(false)} onNavigate={onNavigate} />
        <main className="relative min-w-0 min-h-0 flex-1 overflow-y-auto" data-testid="main">
          <ErrorBoundary where={path} resetKey={path}>
            <div key={path} className="flex min-h-full flex-col px-4 pt-5 pb-17.5 md:px-7.5 md:pt-6.5 motion-safe:animate-[ks-rise_160ms_ease-out]">{children}</div>
          </ErrorBoundary>
        </main>
        <CommandSurface nav={navForViewer(app.permissions, app.nav?.sections ?? [])} stateFor={app.stateFor} open={app.paletteOpen} onOpenChange={(v) => { app.paletteOpen = v; }}
          initialQuery={app.paletteQuery} path={path} onCreateSession={() => { app.bookOpen = true; }} onNavigate={onNavigate} />
        <DeleteHost />
        <BookSessionDialog open={app.bookOpen} onOpenChange={(v) => { app.bookOpen = v; }} onBooked={() => { app.refetchSignal += 1; app.loadCounts(); }} />
      </div>
    </>
  );
}
