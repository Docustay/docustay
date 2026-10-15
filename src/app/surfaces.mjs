// P10.2–P10.8 — ★★★ ONE APP, FOUR PORTALS. §K.
//
// ★★★ §K, verbatim: "The only difference between the client portals is ACCESS. Same surfaces,
// same components, different visibility. ★ DO NOT FORK A PORTAL TO EXPRESS A PERMISSION
// DIFFERENCE — that is how four portals became five surfaces and 160 routes last time."
//
// ★★ SO THERE IS ONE LIST. An adult client, an adolescent client and a parent read the SAME
// array; what differs is which rows `surfacesFor()` returns and what the server lets each row's
// data query see. ★ A forked portal starts as a copy and ends as a divergence: the bug fixed in
// one is still live in the other, and nobody can say which of the five is authoritative.
//
// ★★★ AND §K3 GOVERNS ALL OF IT: "CLIENT-SIDE ROLE GATING IS NOT A SECURITY BOUNDARY. Hiding a
// tab renders nothing unreachable. The server decides, every time, on every request."
// ★ This file decides what to DRAW. `authoriseSection()` (P5.10) and RLS decide what may be
// REACHED. They are different jobs and this file does not pretend to do the second one.

/**
 * ★ R1 — THE EIGHT SURFACES AT LAUNCH, PLUS MESSAGING (added 24 Sep 2026, the maintainer's ruling — see
 *   R6_RULINGS.messaging below), NINE NOW AND ONLY THESE.
 * ★★ R5: "No org settings (those live in the CRM) · no reports · nothing staff-facing."
 */
// ★★ P16.11 — EACH ROW ALSO CARRIES ITS READ ENDPOINT (`api`), so the browser holds NO map from
//    surface key to URL. The key `app-documents` and the path `/api/app/documents` differ (the `app-`
//    prefix exists because `documents` is ALSO a CRM section), and a client-side translation table is
//    exactly the second declaration P4.10 measured the cost of. `registerAppRoutes` asserts at
//    registration time that it served every `api` named here — so the two cannot drift silently.
export const SURFACES = Object.freeze([
  // ★ 18.33 — THE HOME SURFACE, FIRST. Role-specific homes (ClientHome, ClientTeenHome,
  //   ClientParentHome) dispatch on the role. The same surface for all three client portals.
  { key: 'home',          path: '/app/home',          label: 'Home',
    api: '/api/app/home',          roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: 1 },
  { key: 'sessions',      path: '/app/sessions',      label: 'Schedule',
    api: '/api/app/sessions',      roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: 2 },
  { key: 'messages',      path: '/app/messages',      label: 'Messages',
    api: '/api/app/messages',      roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: 3 },
  { key: 'app-documents', path: '/app/documents',     label: 'Documents',
    api: '/api/app/documents',     roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: 4 },
  { key: 'profile',       path: '/app/profile',       label: 'Account',
    api: '/api/app/profile',       roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: 5 },
  // ★ 18.33 — THE NON-TABBED SURFACES. These are reachable by direct link where the role has them,
  //   but not drawn on the tab bar.
  { key: 'working-on',    path: '/app/working-on',    label: "Things I'm working on",
    api: '/api/app/working-on',    roles: ['adult_client', 'adolescent_client'],
    tab: null },
  { key: 'activity',      path: '/app/activity',      label: 'Activity',
    api: '/api/app/activity',      roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: null },
  { key: 'app-booking',   path: '/app/booking',       label: 'Booking',
    api: '/api/app/booking',       roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: null },
  { key: 'app-payments',  path: '/app/payments',      label: 'Payments',
    api: '/api/app/payments',      roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: null },
  { key: 'app-notifications', path: '/app/notifications', label: 'Notifications',
    api: '/api/app/notifications', roles: ['adult_client', 'adolescent_client', 'parent'],
    tab: null },
]);

/**
 * ★ The browser's resolver: screen path → read endpoint. ONE source (the rows above), so a nav row
 *   without a read path is a startup failure rather than a 404 a person discovers.
 */
function apiForSurface(surfaceKey) {
  const s = SURFACES.find((x) => x.key === surfaceKey);
  if (!s) throw new Error(`no surface "${surfaceKey}" — the eight are ${SURFACES.map(x => x.key).join(', ')}`);
  return s.api;
}

/**
 * ★★ R2 — HELD, RULED 12 SEP 2026: "Check-in. Held. Do not build. **DO NOT DESIGN THE SCHEMA
 * AROUND IT YET.** Library / guides. Held. The 2,057 guides stay parked."
 *
 * ★★★ THIS CONSTANT EXISTS SO THE HOLD IS TESTABLE. A decision recorded only in a planning
 * document is a decision that gets quietly reversed by someone who never read it; a named,
 * asserted list makes reappearance a failing build. ★ Holding them does NOT abandon the
 * configurable-primitive mechanism — these two surfaces are simply not in scope now.
 */
export const HELD_SURFACES = Object.freeze(['check-in', 'checkin', 'library', 'guides']);

/** ★ R5 — things that are NOT in the client app at all. Also asserted, for the same reason. */
export const NOT_IN_APP = Object.freeze([
  'settings', 'reports', 'people', 'accounts', 'network', 'items', 'money', 'run',
  'tasks', 'engagements', 'platform',
]);

/**
 * ★★ THE FOUR PORTALS, §K. They are ROLES, not codebases.
 * ★ `staff` is here because §K says "The CRM is on the app too — a coach does not need a laptop
 * to see their day." It is the same app; it is not a fifth client portal.
 */
export const PORTALS = Object.freeze(['staff', 'adult_client', 'adolescent_client', 'parent']);

/**
 * ★★★ WHAT A ROLE MAY SEE — AND THE PARENT RULE IS NOT A UI DECISION.
 * R4: "Parent — MONEY, DOCUMENTS, ATTENDANCE. **NEVER session notes.** They see THAT sessions
 * happened, never WHAT was said. ★ This has survived four rounds and is not up for discussion."
 *
 * ★★ A parent DOES get the Sessions surface — attendance is theirs to see. What they never get is
 * the CONTENT, and that is enforced by `document_is_visible()` in Postgres (migration 0012), not
 * by omitting a component. ★ Drawing no tab and returning no rows are different guarantees; only
 * the second survives someone with the API.
 */
export function surfacesFor(role) {
  if (!PORTALS.includes(role)) return [];          // ★ fail closed on an unknown role
  if (role === 'staff') return [];                 // ★ staff use the CRM surfaces, not these
  return SURFACES.filter((s) => s.roles.includes(role));
}

/**
 * ★ §K: "Code-split the staff surface so it is not downloaded by a client device. That is a
 * PAYLOAD AND PRIVACY decision, **not a security one** — ★★ never confuse the two."
 *
 * ★★★ THAT DISTINCTION IS THE WHOLE FUNCTION. Splitting the bundle means a client's phone does
 * not carry staff screens — good for download size, and good because a stolen phone yields less.
 * ★ It does NOT make staff data unreachable: the API is still there, and a modified client can
 * still call it. **RLS is what makes it unreachable.** Treating the code-split as the boundary is
 * how a team ends up believing they are protected by a webpack config.
 */
export const BUNDLE_SPLIT_IS_SECURITY = false;

export function bundlesFor(role) {
  const shared = ['shell', 'auth', 'design-tokens'];
  if (role === 'staff') return [...shared, 'crm', 'client-app'];
  if (PORTALS.includes(role)) return [...shared, 'client-app'];
  return shared;
}

/**
 * ★★ THE SAME COMPONENT TREE, FOR EVERY ROLE. §K's anti-fork rule, made checkable.
 * Returns the component key each surface renders — and it is the same key regardless of role,
 * because a role difference is expressed by the DATA the component receives, never by swapping
 * in a different component.
 */
export function componentFor(surfaceKey) {
  const s = SURFACES.find((x) => x.key === surfaceKey);
  if (!s) throw new Error(`no surface "${surfaceKey}" — the eight are ${SURFACES.map(x => x.key).join(', ')}`);
  // ★ ONE component per surface. If this ever became `role === 'parent' ? X : Y`, the fork has
  // begun — and it begins exactly this innocently.
  return `surface/${s.key}`;
}

/**
 * ★ R6's two open questions, RULED HERE under stated assumptions rather than surfaced.
 * ★★ Both are recorded in HANDOFF.md with reasoning; these constants make the rulings testable
 * so a later session cannot quietly assume the opposite.
 */
export const R6_RULINGS = Object.freeze({
  // ★ SUPERSEDED (the maintainer, 24 Sep 2026, Group C checkpoint): messaging WAS authorized for the Group
  //   B+C run — C2.6 built it (message_thread/message tables, migration 0364, `appMessages.mjs`,
  //   this file's `messages` surface below) and the maintainer confirmed explicitly it should stay when asked
  //   directly, rather than the below ruling being silently overruled by a build. Per CLAUDE.md's
  //   own "a new ruling from the maintainer beats a code comment" rule, kept here as history, not as standing
  //   authority — the line below is what's live now.
  //
  // ↓ THE ORIGINAL RULING, FOR CONTEXT, NO LONGER IN EFFECT:
  // ★★ MESSAGING: NOT a launch surface. R1 lists eight and messaging is not among them; adding a
  // ninth changes the launch scope on my own authority, which is not mine to change.
  // ★ The need is real — "a client who wants to ask their coach a question currently has nowhere
  // to do it" — and it is met at launch by the EXISTING surfaces: a booking has a notes field and
  // notifications are two-way-capable. A dedicated inbox is a product decision with retention,
  // moderation and duty-of-care consequences in a RECOVERY context, and those are the maintainer's to weigh.
  messaging: 'authorized_c2_6',

  // ★★ SOLO / PUBLIC DOWNLOAD MODE: a stranger with no coach gets the PUBLIC SAFETY SURFACE ONLY.
  // ★ R6 notes that check-in and the library "WERE the solo-mode value proposition" and both are
  // held — so solo mode currently has no product behind it. Shipping an empty app to the public
  // is worse than shipping none. ★ The exception is crisis resources, which the legacy system
  // already treats as public and which no one should need an account to reach.
  solo_mode: 'crisis_resources_only',
});
