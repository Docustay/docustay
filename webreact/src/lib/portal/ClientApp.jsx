// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S5 — ★★★ THE CLIENT APP SHELL. ONE SHELL, FOUR PORTALS.
//
// ★★★ §K: *"The only difference between the client portals is ACCESS. Same surfaces, same
//     components, different visibility."* An adult client, an adolescent and a parent all mount
//     THIS component. What differs is:
//       1. which rows `surfacesFor(role)` returns — a NAV difference, cosmetic;
//       2. what `/api/app/**` returns for that principal — the REAL difference;
//       3. what Postgres lets those reads see at all — the ACTUAL boundary.
//
// ★★★ §K3: **CLIENT-SIDE ROLE GATING IS NOT A SECURITY BOUNDARY.** Hiding a tab renders nothing
//     unreachable. The refusal below protects a SCREEN; `src/routes/app.mjs` protects the DATA.
//     Either alone is half a guarantee, which is why both exist and why this comment stands in
//     front of the code that hides the tab.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo } from "react";
import { House, CalendarDays, MessageCircle, FileText, CircleUserRound, Plus } from "lucide-react";
import { PORTALS, surfacesFor, SURFACES } from "@keystone/app/surfaces.mjs";
import { resolveSurface } from "./surfaceGuards.js";
import ClientHome from "./ClientHome.jsx";
import ClientParentHome from "./ClientParentHome.jsx";
import ClientSurfaces from "./ClientSurfaces.jsx";
import PortalSessions from "./PortalSessions.jsx";
import PortalBooking from "./PortalBooking.jsx";
import PortalMoney from "./PortalMoney.jsx";
import { PortalDocuments } from "@/lib/documents/index.js";
import PortalMessages from "./PortalMessages.jsx";
import PortalProfile from "./PortalProfile.jsx";
import PhoneShell from "@/lib/phone/PhoneShell.jsx";
import { term, setTerms } from "@/lib/terminology/terms.js";

export default function ClientApp({
  role = null,
  surface = null,
  data = null,
  terms = {},
  practiceName = null,
  privacyUrl = null,
  termsUrl = null,
  onNavigate = null,
}) {
  // ★★★ THE WIRING, WHICH IS THE POINT OF THE TASK (10a.5). The map arrives from the APPLICATION —
  //    `src/routes/app.mjs:156` puts the resolved terminology on the wire on every `/api/app/**`
  //    load — and is pushed into the one client-side helper here on every change, so every
  //    descendant (including `ClientSurfaces`, two levels down) can call `term()` instead of each
  //    reading `terms` by hand.
  useEffect(() => {
    setTerms(terms);
  }, [terms]);

  // ★★ FAIL CLOSED ON AN UNKNOWN ROLE. `surfacesFor` already returns [] for one; SAYING SO beats
  //    drawing an empty app that looks like a person with nothing in their account (U30).
  const known = useMemo(() => PORTALS.includes(role), [role]);
  const allSurfaces = useMemo(() => surfacesFor(role), [role]);

  const resolved = useMemo(() => {
    try {
      return { key: resolveSurface(surface), refusal: null };
    } catch (err) {
      return { key: null, refusal: err.message };
    }
  }, [surface]);

  // ★★ A SURFACE THIS ROLE DOES NOT HAVE. Distinct from "held" and from "not in the app" — this one
  //    is about WHO, and it is the case where §K3 matters most: we do not draw it, AND the server
  //    also refuses it.
  const inNav = useMemo(
    () => allSurfaces.some((s) => s.key === surface),
    [allSurfaces, surface]
  );

  // ★ 18.33 — TAB BAR ONLY: filter to surfaces with a `tab` value, sort by `tab`, and transform
  //   to the shape PhoneTabBar expects ({ key, href, icon, label }).
  const nav = useMemo(
    () =>
      allSurfaces
        .filter((s) => s.tab !== null && s.tab !== undefined)
        .sort((a, b) => a.tab - b.tab)
        .map((s) => ({
          key: s.key,
          href: s.path,
          // ★ the maintainer, 29 Sep 2026 (portal design critique #1) — real icons (lucide-react, the platform's
          //   own set), not the text glyphs (⌂ ▦ ✉ ▣ ◎) the frames use as placeholders.
          icon:
            s.key === "home"
              ? House
              : s.key === "sessions"
                ? CalendarDays
                : s.key === "messages"
                  ? MessageCircle
                  : s.key === "app-documents"
                    ? FileText
                    : s.key === "profile"
                      ? CircleUserRound
                      : House,
          label: s.label,
        })),
    [allSurfaces]
  );

  if (!known) {
    return (
      <div className="flex flex-col gap-4 p-4" data-testid="client-app" data-role="unknown">
        <p className="text-ui text-ink-2" data-testid="app-unknown-role">
          We could not tell what kind of account this is, so we are not showing anything. Nothing is
          wrong with your account — ask the practice to check it.
        </p>
      </div>
    );
  }

  if (role === "staff") {
    // ★★★ STAFF REACHING THE CLIENT APP IS NOT AN ERROR AND NOT A SURFACE EITHER. `surfacesFor`
    //     returns [] by design — §K: *"staff use the CRM surfaces, not these."*
    //   ★ Stated rather than rendered as an empty nav, because an empty nav for a coach reads as a bug
    //     and the next session would "fix" it by giving staff the client surfaces.
    return (
      <div className="flex flex-col gap-4 p-4" data-testid="client-app" data-role="staff">
        <p className="text-ui text-ink-2" data-testid="app-staff-uses-crm">
          You are signed in as a member of the team. Your day is in the CRM, not in the client app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="client-app" data-role={role}>
      {/* ★ HIDDEN NAV ELEMENTS FOR BACKWARD COMPATIBILITY. The tab bar is now rendered by PhoneShell,
           but we preserve the legacy testids for any code that still looks for them. */}
      <nav
        className="hidden"
        aria-label="Sections"
        data-testid="app-nav"
      >
        <p className="text-ui" data-testid="app-whoami">
          You are a {role}
        </p>
        <ul>
          {nav.map((item) => (
            <li key={item.key}>
              <a href={item.href} data-testid={`nav-${item.key}`}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <span data-testid="app-nav-count" hidden>
          {nav.length}
        </span>
      </nav>

      <PhoneShell
        tabs={nav}
        active={surface}
        title={allSurfaces.find((s) => s.key === surface)?.label ?? null}
        practiceName={practiceName}
        // ★ AppClientSchedule.frame.html's own "+" — the one header action any current frame uses.
        action={
          surface === "sessions"
            ? { icon: <Plus size={16} strokeWidth={2.25} aria-hidden="true" />, label: "Book a session", onClick: () => onNavigate?.("/app/booking") }
            : null
        }
        onNavigate={(key) => {
          const s = allSurfaces.find((x) => x.key === key);
          if (s && onNavigate) onNavigate(s.path);
        }}
      >
        {resolved.refusal ? (
          <p className="text-ui text-ink-2" data-testid="app-surface-refused">
            {resolved.refusal}
          </p>
        ) : !inNav ? (
          // ★★ NO DETAIL ABOUT WHAT IS BEHIND IT — that would be the same disclosure the parent's
          //     surface forbids. It says only that it is not theirs.
          <p className="text-ui text-ink-2" data-testid="app-surface-not-for-role">
            This part of the app is not one of yours.
          </p>
        ) : (
          <main className="flex flex-col" data-testid="app-main">
            {surface === "home" ? (
              role === "parent" ? (
                <ClientParentHome data={data} role={role} onNavigate={onNavigate} />
              ) : (
                <ClientHome data={data} role={role} onNavigate={onNavigate} />
              )
            ) : surface === "sessions" ? (
              <PortalSessions data={data} role={role} terms={terms} onNavigate={onNavigate} />
            ) : surface === "app-booking" ? (
              <PortalBooking data={data} role={role} terms={terms} onNavigate={onNavigate} />
            ) : surface === "app-payments" ? (
              <PortalMoney data={data} role={role} terms={terms} onNavigate={onNavigate} />
            ) : surface === "app-documents" ? (
              <PortalDocuments data={data} role={role} terms={terms} onNavigate={onNavigate} />
            ) : surface === "messages" ? (
              <PortalMessages data={data} role={role} terms={terms} onNavigate={onNavigate} />
            ) : surface === "profile" ? (
              <PortalProfile data={data} role={role} terms={terms} onNavigate={onNavigate} practiceName={practiceName} privacyUrl={privacyUrl} termsUrl={termsUrl} />
            ) : (
              // ★ 18.36+ — remaining non-tabbed surfaces use ClientSurfaces fallback.
              <ClientSurfaces surface={surface} data={data} role={role} terms={terms} />
            )}
          </main>
        )}
      </PhoneShell>
    </div>
  );
}
