// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.23 — STAFF APP SHELL AND ROUTER.
//
// ★★★ THE PHONE APP FOR STAFF. Five tabs (Today, People, Calendar, Get paid, More) with
//     routing to dedicated screens. Routes to screens in 18.24–18.30 that don't exist yet;
//     those screens have their own task sections.
//   ★ Refuses (ScreenState denied) when `app.nav.staff` is null — that is, when the session
//     is not staff-only. Every role but staff sees the CRM app instead (App.svelte's Shell +
//     Screen branch).
//   ★ The five tabs are read from `app.nav.staff`, the same source the nav itself uses, so
//     a rebuild always keeps them in step — F447 § "the nav travels once and the whole tree
//     reads it unchanged."
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import PhoneShell from "@/lib/phone/PhoneShell.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StaffPeople from "./StaffPeople.jsx";
import StaffRecord from "./StaffRecord.jsx";
import StaffSession from "./StaffSession.jsx";
import StaffCalendar from "./StaffCalendar.jsx";
import StaffGetPaid from "./StaffGetPaid.jsx";
import StaffTapToPay from "./StaffTapToPay.jsx";
import StaffMore from "./StaffMore.jsx";

export default function StaffApp({ app, path, onNavigate }) {
  // ★ The staff nav was already checked by App.jsx before rendering this; this re-check is
  //   defensive. It is impossible to reach this component with `app.nav.staff` null, but the type
  //   contract and the guard keep the logic explicit.
  const denied = useMemo(() => !app.nav?.staff, [app.nav?.staff]);

  // ★ Extract the active tab from the current path. "/staff" and "/staff/today" both activate
  //   the "today" tab. Other paths fall back to the first tab.
  const activeTab = useMemo(() => {
    if (denied) return null;
    const tabs = app.nav.staff ?? [];
    if (path === "/staff" || path === "/staff/today") return "today";
    const match = path.match(/^\/staff\/([^/]+)/);
    if (match) {
      const maybeKey = match[1];
      if (tabs.some((t) => t.key === maybeKey)) return maybeKey;
    }
    return tabs[0]?.key ?? null;
  }, [denied, path, app.nav.staff]);

  // ★ Handle tab navigation. The onNavigate callback is called with the path for the
  //   selected tab. Every tab has a path in `app.nav.staff`.
  const handleTabChange = (tabKey) => {
    const tab = app.nav.staff?.find((t) => t.key === tabKey);
    if (tab) onNavigate(tab.path);
  };

  // ★ Route to the appropriate screen component based on the current path.
  // Most screens are imported lazily (18.24–18.30 task sections); they do their own fetching.
  // This component just wires the path to the URL and mounts the appropriate screen.
  const screenKey = useMemo(() => {
    if (denied) return null;
    if (path === "/staff" || path === "/staff/today") return "today";
    const match = path.match(/^\/staff\/([^/]+)/);
    if (match) return match[1];
    return null;
  }, [denied, path]);

  // ★ Is the path unknown (does not match any staff route)?
  const isUnknownPath = useMemo(() => {
    if (denied) return false;
    if (path === "/staff" || path === "/staff/today") return false;
    if (path.match(/^\/staff\/(people|calendar|get-paid|more)(?:\/|$)/)) return false;
    if (path.match(/^\/staff\/(session|people)\//)) return false;
    return true;
  }, [denied, path]);

  if (denied) {
    return <ScreenState phase="denied" reason="The phone app is for the practice's team." />;
  }

  if (isUnknownPath) {
    // ★ STATE: unknown path. The spec names "error screen with 'There is nothing here.' + link to Today".
    return (
      <ScreenState
        phase="error"
        error={new Error("There is nothing here.")}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <PhoneShell
      tabs={app.nav.staff ?? []}
      active={activeTab}
      onNavigate={handleTabChange}
    >
      {/* ★ This is where the screen components mount. The screen choice is determined by screenKey,
           which corresponds to a task section (18.24–18.30). Until those screens are built,
           this renders "loading" as a placeholder. Once built, each screen will import its
           dependencies and render its own UI.

           The screens are lazy-loaded by their own barrel files (one per screen, per the architecture
           rule that a screen has its own chunk). This component just determines which path is active
           and hands it to the screen to render.

           Routes:
           - today (or /staff, /staff/today) → StaffToday (18.24)
           - people → StaffPeople (18.25)
           - people/<uuid> → StaffRecord (18.26)
           - session/<uuid> → StaffSession (18.27)
           - calendar → StaffCalendar (18.28)
           - get-paid → StaffGetPaid (18.30)
           - get-paid/tap/<invoiceId> → StaffTapToPay (18.30)
           - more → inline list (18.23, no separate component)
      */}
      {screenKey === "today" && (
        // Awaiting StaffToday (18.24)
        <ScreenState phase="loading" />
      )}
      {screenKey === "people" && (
        <>
          {path === "/staff/people" && (
            <StaffPeople app={app} path={path} onNavigate={onNavigate} />
          )}
          {path.match(/^\/staff\/people\/([0-9a-f-]{36})$/) && (
            // 18.26 — StaffRecord mounted here
            <StaffRecord />
          )}
          {!path.match(/^\/staff\/people\/([0-9a-f-]{36})$/) && path !== "/staff/people" && (
            // Unknown people sub-path
            <ScreenState phase="error" error={new Error("There is nothing here.")} />
          )}
        </>
      )}
      {screenKey === "session" && (
        <>
          {path === "/staff/session" && (
            // Unknown session path (no ID)
            <ScreenState phase="error" error={new Error("There is nothing here.")} />
          )}
          {path.match(/^\/staff\/session\/([0-9a-f-]{36})$/) && (
            // 20.29 — StaffSession mounted here
            <StaffSession />
          )}
          {!path.match(/^\/staff\/session\/([0-9a-f-]{36})$/) && path !== "/staff/session" && (
            // Unknown session sub-path
            <ScreenState phase="error" error={new Error("There is nothing here.")} />
          )}
        </>
      )}
      {screenKey === "calendar" && <StaffCalendar app={app} onNavigate={onNavigate} />}
      {screenKey === "get-paid" && (
        <>
          {path === "/staff/get-paid" && <StaffGetPaid app={app} onNavigate={onNavigate} />}
          {path.match(/^\/staff\/get-paid\/tap\/([^/]+)$/) && (
            <StaffTapToPay app={app} path={path} onNavigate={onNavigate} />
          )}
          {!path.match(/^\/staff\/get-paid\/tap\/([^/]+)$/) && path !== "/staff/get-paid" && (
            // Unknown get-paid sub-path
            <ScreenState phase="error" error={new Error("There is nothing here.")} />
          )}
        </>
      )}
      {screenKey === "more" && <StaffMore app={app} onNavigate={onNavigate} />}
      {!screenKey && (
        // Unknown or loading
        <ScreenState phase="loading" />
      )}
    </PhoneShell>
  );
}
