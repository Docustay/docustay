// P16.11 — THE CLIENT APP'S READ SIDE. ONE NAMESPACE, EIGHT SURFACES, WIRED TO EXISTING MODULES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §K's ANTI-FORK RULE APPLIED TO THE SERVER: ONE APP, FOUR PORTALS. These routes are the SAME
//     routes for every client role, and a role difference is expressed by THE DATA THEY RETURN — never
//     by a different route, a different component, or a different codebase.
//   ★★ THE PARENT RULE IS THEREFORE NOT A ROUTING DECISION. A parent calls the same
//      `/api/app/documents` a client does, and Postgres decides what comes back
//      (`document_is_visible()`, migration 0012). **Drawing no tab and returning no rows are different
//      guarantees, and only the second survives somebody with the API.**
//
// ★★★ U21 — NOTHING STAFF-FACING IS REACHABLE HERE, AND THAT IS ASSERTED TWO WAYS. This module exposes
//     no settings, no reports, no people, no money administration and no platform anything. The route
//     table below is the whole surface, and `db/gates/p16_portals.mjs` walks `NOT_IN_APP` against it.
//
// ★ WHAT THIS MODULE DOES NOT DO: it does not decide which surfaces a role gets. `surfacesFor(role)` in
//   `src/app/surfaces.mjs` is the one answer to that, and `/api/app/surfaces` returns it — so the client
//   holds no copy of the list (U16: the server decides on every request).

import { SURFACES, surfacesFor, HELD_SURFACES, NOT_IN_APP } from "../app/surfaces.mjs";
import { instrumentSnapshot } from "../documents/frontDoor.mjs";
import { recordPortalOpen, portalDocumentList, portalDocumentDetail, documentEventsAboutSubject, instanceForCheckout } from "../documents/api.mjs";
// ★ P6.63 — the practice's own client-app switches. Read at the route, never baked into
//   `surfacesFor()`: that function is pure and is asserted to be, and a tenant's stored preference
//   is not part of what a ROLE is.
import { getSettings } from "../settings/writes.mjs";
// ★ P10.6 — ONE resolver and ONE vocabulary, shared with the CRM and with every email.
import { resolveTerms } from "../terminology/resolve.mjs";
import { TERM_FALLBACKS } from "../terminology/keys.mjs";
// ★ P10.1 — the four client writes. The SAME functions the CRM calls: a second write path for a
//   client would be a second set of rules about what a signature is.
import { markNotificationRead, setNotificationPreference } from "../notifications/writes.mjs";
import { acceptDisclosure, recordSignature, executeIfComplete } from "../documents/frontDoor.mjs";
// ★★★ SIGN-AND-PAY: agreement requirement check (phase new, sign+pay spec).
import { getAgreementRequirement } from "../items/agreements.mjs";
// ★ P5.9 — the shared slot read. This route used to hand-roll the query; see read.mjs.
import { readSlots, readSlotsForAnyHost } from "../booking/read.mjs";
// ★★ 13.19 — the GET route below reads through the cache (G10); POST's validation (13.11) keeps
//    calling the plain readSlots/readSlotsForAnyHost above ON PURPOSE — the cache never decides
//    whether a write is allowed. See src/booking/availabilityCache.mjs.
import { readSlotsCached, readSlotsForAnyHostCached } from "../booking/availabilityCache.mjs";
// ★ P10.4 — one composition of "Session 3 of 12 · 9 remaining", read by three surfaces.
import { creditStanding, standingSentence } from "../money/credits.mjs";
// ★ P10.2 — the SAME creator the CRM calls. A second booking path for a client would be a
//   second set of rules about double-booking, credits and reminders.
import { createBooking } from "../booking/createBooking.mjs";
import { addBookingParticipant, policyFor } from "../booking/writes.mjs";
import { rescheduleBooking, cancelBookingByRequest } from "../booking/reschedule.mjs";
// ★ 13.13 — the client-facing HALF of the waitlist engine (13.12). `recordDemand` is the ONLY
//   engine function this file calls; `offerTime`/`removeFromWaitlist` are staff-only writes wired
//   by 13.27a straight from `src/booking/waitlist.mjs` into `src/routes/writes.mjs`'s ROUTES table
//   — not this file's job (field 5 of STAGE-13-PLAN.md §13.13 names writes.mjs as 13.27a's file).
import { recordDemand, PREFERENCES as WAITLIST_PREFERENCES } from "../booking/waitlist.mjs";
// ★ 13.11 / CT-F45 — the ONE composition of the client-facing policy sentence, built from the SAME
//   object policyFor() returns. The GET policy route serves it; the route's own refusals never
//   disagree with it, because neither reads a setting policyFor() did not already read.
import { policySentence } from "../booking/policySentence.mjs";
// ★ `invalid` too — P5.9 refuses a slot read with no host, and a ReferenceError at request
//   time would surface as a 500 rather than as the 400 it is.
import { forbidden, invalid, notFound, conflict, dependency } from "../http/errors.mjs";
// ★★★ SIGN-AND-PAY: external Stripe calls and configuration.
import { callOutside } from "../http/outside.mjs";
import { stripeSecretKey, ChargeConfigError } from "../money/charge.mjs";
import { stripeConnectedRequest, applicationFeeMinor } from "../money/stripeConnected.mjs";
import { ensureCustomer } from "../money/customers.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { flagIsOn } from "../platform/flags.mjs";
// ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): called HERE now, not separately from
//   src/http/app.mjs, so its route is registered through this function's own tracked `get` and the
//   consistency check below actually sees it. See the note on registerAppPaymentsRoutes itself.
import { registerAppPaymentsRoutes } from "./appPayments.mjs";
import { registerAppProfileRoutes } from "./appProfile.mjs";
import { registerAppMessagesRoutes } from "./appMessages.mjs";
import { registerAppHomeRoutes } from "./appHome.mjs";
// ★ 18.41 — session summary: attendance and charge facts
import { sessionSummary } from "../app/sessionSummary.mjs";
// ★ L9.6 — the client's own "add to calendar" file. One VEVENT per booking, built fresh on each
//   request from the booking row itself — never stored, never a second copy of what the booking is.
import ical from "ical-generator";

/**
 * ★★★ THE CLIENT ROLES. `staff` IS DELIBERATELY ABSENT, AND SAYING SO MATTERS (P16.2): staff use the
 *     CRM surfaces, so `surfacesFor('staff')` is `[]` BY DESIGN — an empty array that looks like a bug
 *     unless somebody writes down that it is not.
 */
// ★★★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value (it's a computed fact, `is_guardian`,
//     joined onto `principal.user` at session-resolution time — see src/http/app.mjs's `loadPerson`
//     and src/nav/authorise.mjs's `effectiveRank`). Every `role === "parent"` check below is now
//     `principal.user.is_guardian`.
const CLIENT_ROLES = Object.freeze(["adult_client", "adolescent_client"]);

/**
 * ★★ EVERY ROUTE HERE REFUSES A STAFF SESSION, and that is not tidiness. A coach reading a client's app
 *    surfaces would be reading them THROUGH THE CLIENT`S OWN FILTERS — which are narrower than a coach`s
 *    — and would then believe the client can see less than they can. The CRM is where staff look.
 *  ★ Fail CLOSED on an unknown role: a role nobody has taught this module about gets nothing.
 */
// ★★★ SECURITY, 22 Oct 2026 (booking everywhere, recon 7b). A client may act only on a booking they are a `client`
//     participant of, or one of a teen they are the guardian of. Booking RLS is tenant-only for SELECT and UPDATE
//     (0197:100-105), so "RLS handles visibility" was not true: any signed-in client could cancel or move ANY booking in
//     their practice by id. A booking that is not theirs is answered exactly like one that does not exist.
async function ownBooking(db, principal, bookingId) {
  const { rows: [booking] } = await db.query(
    `SELECT b.service_id FROM keystone.booking b
      WHERE b.id = $1 AND b.tenant_id = $2
        AND EXISTS (SELECT 1 FROM keystone.booking_participant bp
                     WHERE bp.tenant_id = b.tenant_id AND bp.booking_id = b.id AND bp.party = 'client'
                       AND (bp.app_user_id = $3
                            OR bp.app_user_id IN (SELECT g.child_user_id FROM keystone.guardian g
                                                   WHERE g.tenant_id = b.tenant_id AND g.guardian_user_id = $3)))`,
    [bookingId, principal.user.tenant_id, principal.appUserId]);
  return booking;
}

function assertClientRole(principal) {
  // ★★ THE ROLE LIVES AT `principal.user.role`, NOT `principal.role` — [MEASURED] src/http/app.mjs:345
  //    builds `principal.user = { role, staff_role, tenant_id }` from the person the session resolves
  //    to, and the person's own id is `principal.appUserId`. Reading `principal.role` would be
  //    `undefined` on every request, which — because this function FAILS CLOSED — would refuse the whole
  //    client app while looking like a permissions problem.
  const role = principal?.user?.role ?? null;
  if (!CLIENT_ROLES.includes(role)) {
    throw forbidden(
      `the client app is for ${CLIENT_ROLES.join(", ")}. A staff session belongs in the CRM: reading a ` +
      `client's app surfaces as staff would show you what THEY can see, not what you can, and that is ` +
      `a misleading answer rather than a restricted one.`);
  }
  return role;
}

export function registerAppRoutes(app, { scoped }) {
  // ★★★ EVERY ROUTE REGISTERED HERE IS RECORDED, AND THE FUNCTION REFUSES TO RETURN IF THE SET DOES NOT
  //     MATCH `SURFACES[].api` EXACTLY. Both directions:
  //       · a surface in the nav with NO route → a person clicks a tab and gets a 404, which reads as a
  //         broken account rather than an unfinished build;
  //       · a route with NO surface → an endpoint nothing draws, which is attack surface nobody reviews.
  //   ★ This is why `api` lives on the shared SURFACES rows (P16.11) instead of in a client-side map: one
  //     declaration, and a drift is a STARTUP failure rather than a 404 discovered by a client.
  const registered = new Set();
  const get = (path, handler) => { registered.add(path); app.get(path, handler); };

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ P10.1 — THE CLIENT CAN WRITE. UNTIL NOW THIS NAMESPACE WAS READ-ONLY.
  // ═══════════════════════════════════════════════════════════════════════════
  // [MEASURED 2026-09-15] every route in this module was a `get`. A client could read their sessions,
  // their documents, their invoices and their notifications, and **could not change one thing about
  // any of it** — not mark a notification read, not set a preference, not accept a disclosure, not
  // sign the agreement they were sent.
  //
  // ★★★ THIS IS A PREREQUISITE OF TWO RULED ITEMS THAT APPEAR IN NO TIER, and that is why it is worth
  //     more than the four verbs it adds:
  //       · KS-16.2 ruling 1 — the booking screen offers a credit **to staff AND to the client**;
  //       · KS-13.6 — a standing authorisation must be revocable, and **"a person who cannot write
  //         cannot revoke."** A consent nobody can withdraw is not consent.
  //
  // ★★★ A WRITE MUST NAME THE SURFACE IT BELONGS TO, AND THAT IS STRICTER THAN THE READ RULE, NOT
  //     LOOSER. A read route IS its surface; a write is an ACTION ON one, and several actions share
  //     a surface — so "the set of paths equals the set of surfaces" cannot be the test any more.
  //   ★★ Replacing it with "anything under a surface's prefix is fine" would have given away the
  //      whole guarantee: `/api/app/documents/export` would then be legitimate, and the point of the
  //      check is that **an endpoint nobody draws is attack surface nobody reviews.** So each write
  //      states its surface, the reconciliation asserts that surface is real AND that the path lives
  //      under it, and a write with no surface is a startup failure exactly like a read with none.
  const writes = new Map();
  const post = (path, surfaceApi, handler) => {
    writes.set(path, surfaceApi);
    app.post(path, handler);
  };
  // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): a GET support-lookup can belong to a
  //   surface without being that surface's own row. `/api/app/booking/policy` (the pre-confirm
  //   policy text) is a real path-nested child of Booking, so it gets the read-side twin of
  //   `post()`: the surface is named at the registration site and the path must actually live
  //   under it — same rule a write's claimed surface gets, checked below.
  const reads = new Map();
  const getFor = (path, surfaceApi, handler) => {
    reads.set(path, surfaceApi);
    get(path, handler);
  };
  // ★ `/api/app/services` and `/api/app/coaches` are the SAME kind of support lookup (they
  //   populate the Booking create-flow's pickers — nobody navigates to them directly) but they are
  //   NOT path-nested under `/api/app/booking` — they're top-level siblings. [FOUND live, 24 Sep
  //   2026: the first attempt claimed `/api/app/booking` as their surface through `getFor`, and the
  //   nesting check correctly rejected it — a claim that doesn't hold isn't a fix.] Named here, the
  //   same way `/api/app/surfaces` is named below: reviewed and confirmed real, not silently
  //   exempted, but not forced into a nesting relationship that isn't true.
  // ★ 13.13 — `/api/app/waitlist` (the client's OWN waitlist/demand entries) is the SAME kind of
  //   support lookup: there is no dedicated Waitlist client surface in `src/app/surfaces.mjs` (the
  //   waitlist is a fact ABOUT booking, read inline by the booking flow), so it is named here rather
  //   than forced under `/api/app/booking` (a nesting claim that would not hold — see above).
  const SUPPORT_READS = new Set(["/api/app/services", `/api/app/coaches`, "/api/app/waitlist"]);
  // ★ 13.13 — THE WRITE-SIDE TWIN OF `SUPPORT_READS`, and it did not exist before this task because
  //   nothing needed it: every write registered through `post()` until now genuinely lived under a
  //   real, declared surface. `POST /api/app/waitlist/demand` does not — same reasoning as
  //   `/api/app/waitlist` immediately above, on the write side. Named here, reviewed and confirmed
  //   real (client demand for a waitlist slot, F15 §2.3), not silently exempted from the check below
  //   — the same discipline `SUPPORT_READS` already applies to reads.
  const SUPPORT_WRITES = new Set(["/api/app/waitlist/demand"]);

  // ───────────────────────────────────────────────────────────────────────────
  // ★ WHICH SURFACES THIS PERSON GETS — FROM THE SERVER, EVERY REQUEST (U16).
  // ───────────────────────────────────────────────────────────────────────────
  get("/api/app/surfaces", (c) =>
    scoped(c, async ({ principal, db }) => {
      const role = assertClientRole(principal);
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ P6.63 — THE PRACTICE'S OWN SWITCHES, READ HERE, BECAUSE THIS IS WHERE THE ANSWER IS
      //     GIVEN. `/settings/client-app`'s whole claim is "a surface toggled off disappears from
      //     /api/app/surfaces"; a toggle stored beside this route instead of read BY it would be
      //     the write-only setting this project already has five of.
      //   ★★ IT IS AN **OFF** LIST, SO UNSET MEANS EVERYTHING. An "on" list would hand a practice
      //      that never opened the screen a client app with no tabs in it, and that failure would
      //      look like the app being broken rather than like a setting.
      //   ★★★ AND IT IS NOT A PERMISSION, WHICH IS WHY IT IS APPLIED AFTER `surfacesFor(role)` AND
      //       NEVER INSTEAD OF IT. R4's parent rule and `document_is_visible()` decide what a
      //       person may READ; this decides what they are OFFERED. Collapsing the two would make a
      //       tenant's cosmetic preference look like a boundary — §K's "never confuse the two".
      // ═══════════════════════════════════════════════════════════════════════════════════════
      const allSettings = await getSettings(db);
      const off = new Set(allSettings["client_app.surfaces_off"] ?? []);
      // ★ the maintainer, 29 Sep 2026 (portal design critique) — "no header — no practice logo, no page
      //   title". The portal had never been sent the practice's own name at all (the CRM's
      //   /api/nav explicitly documents itself as NOT for the client app). No logo-upload setting
      //   exists yet for a practice (grepped src/settings/keys.mjs — no practice.logo key), so the
      //   header falls back to the practice's initial, same as every other avatar-without-a-photo
      //   in this codebase.
      const { rows: tenantRows } = await db.query(
        `SELECT name FROM keystone.tenant WHERE id = $1`, [principal.user.tenant_id]);
      // ★ FIX, 1 Oct 2026 (an example organisation brand brief) — this read the LEGAL tenant name
      //   directly; the client portal header is exactly the cosmetic, brand-facing surface
      //   `practice.name` (the display-name setting) exists for, same preference publicBooking.mjs
      //   and the lead emails already give it.
      const practiceName = allSettings["practice.name"] || tenantRows[0]?.name || null;
      // ★ [TY, RULED 1 Oct 2026] Site-readiness brief, Part 3 — the practice's OWN privacy/terms
      //   links, shown alongside the platform's own in the portal footer (PortalProfile.jsx). `null`
      //   (the default for every tenant until they set one) means "show the platform's policies only" —
      //   the footer never renders a link to nothing.
      const privacyUrl = allSettings["practice.privacy_url"] || null;
      const termsUrl = allSettings["practice.terms_url"] || null;
      return {
        role,
        practiceName,
        privacyUrl,
        termsUrl,
        surfaces: surfacesFor(role).filter((s) => !off.has(s.key)),
        // ★ Reported so the client can say "your practice switched this off" rather than silently
        //   missing a tab the person used yesterday.
        switched_off: [...off],
        // ★★ THE HELD LIST TRAVELS WITH THE ANSWER. A client build that "just adds" check-in has to
        //    contradict the server to do it, and U18's hold becomes visible rather than folkloric.
        held: HELD_SURFACES,
        not_in_app: NOT_IN_APP,
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ P10.6 — THE PRACTICE'S OWN WORDS, RESOLVED ON THE SERVER, ONCE.
        //     [MEASURED 2026-09-15] the client app had **ZERO** terminology: ~48 hardcoded literals
        //     in `ClientSurfaces.jsx`, and the resolver reached 4 of 83 CRM nav rows and nothing
        //     else. A practice that renamed `Coach` to "Guide" saw it in the sidebar and nowhere a
        //     client ever looks.
        //   ★★★ AND IT IS RESOLVED **HERE**, NOT BY A HOOK. §KS-17: one resolver, server-side —
        //       because the worker composing a push notification has no React, and a second
        //       resolver is P4.10's measured defect (the PIR portal held the same seven labels in
        //       two tables and they silently diverged).
        //   ★★ THE FALLBACKS TRAVEL WITH IT. A term the tenant has not set arrives as the English
        //      word, so the client can never render a key — which is the property the sibling
        //      project bought with a deletion (§2.7: i18next ECHOES THE KEY on a miss).
        terms: { ...TERM_FALLBACKS, ...(await resolveTerms(db)) },
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ SESSIONS — ATTENDANCE, WHICH A PARENT MAY SEE. NEVER THE CONTENT.
  // ───────────────────────────────────────────────────────────────────────────
  // R4: "They see THAT sessions happened, never WHAT was said."
  //   ★★ SO THIS QUERY SELECTS **NO NOTE COLUMN AT ALL** — not a filtered one, not a redacted one.
  //      A column that is fetched and then hidden by the renderer is one refactor away from being
  //      rendered, and the content would have been on the wire the whole time.
  //   ★ `booking_participant.attended` IS the attendance fact (P15B.10's `setAttendance`).
  get("/api/app/sessions", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const me = principal.appUserId;

      // ★★★ PARENT ATTENDANCE LAW — a parent may see their children's attendance.
      //     [MEASURED] before 18.41 parents got ZERO rows and "no notes" passed on empty payload.
      //     Now a parent with two children sees both children's sessions, with attendance facts only.
      let userIds = [me];
      if (principal.user.is_guardian) {
        const { rows: guardians } = await db.query(
          `SELECT g.child_user_id
             FROM keystone.guardian g
            WHERE g.tenant_id = (SELECT tenant_id FROM keystone.app_user WHERE id = $1)
              AND g.guardian_user_id = $2`,
          [me, me]);
        userIds = [me, ...guardians.map(g => g.child_user_id)];
      }

      // ★ Get all sessions for the user(s)
      const { rows: sessions } = await db.query(
        `SELECT b.id, b.starts_at, b.ends_at, b.state, s.name AS service_name,
                bp.attended, bp.app_user_id, u.first_name AS person_first_name,
                b.cancelled_at, b.cancellation_reason IS NOT NULL AS cancelled_with_reason,
                s.id AS service_id
           FROM keystone.booking_participant bp
           JOIN keystone.booking b ON b.id = bp.booking_id
           LEFT JOIN keystone.service s ON s.id = b.service_id
           LEFT JOIN keystone.app_user u ON u.id = bp.app_user_id
          WHERE bp.app_user_id = ANY($1)
          ORDER BY b.starts_at DESC
          LIMIT 200`,
        [userIds]);

      // ★ Build a map of booking policies to get cancellation_notice_minutes for each booking
      const serviceIds = [...new Set(sessions.map(s => s.service_id).filter(Boolean))];
      const { rows: policies } = await db.query(
        `SELECT service_id, cancellation_notice_minutes
           FROM keystone.booking_policy
          WHERE service_id = ANY($1)`,
        [serviceIds]);
      const policyMap = new Map(policies.map(p => [p.service_id, p.cancellation_notice_minutes]));

      // ★ Add cancellation_notice_minutes to each session row
      for (const row of sessions) {
        row.cancellation_notice_minutes = policyMap.get(row.service_id) || 1440; // default to 24h
      }

      // ★ Get booking IDs that have consumed entitlement credits (charged bookings)
      const bookingIds = sessions.map(s => s.id);
      const { rows: chargedRows } = await db.query(
        `SELECT DISTINCT booking_id
           FROM keystone.entitlement_credit
          WHERE booking_id = ANY($1) AND status = 'consumed'`,
        [bookingIds]);
      const chargedBookingIds = new Set(chargedRows.map(r => r.booking_id));

      // ★ Calculate the summary
      const summary = sessionSummary(sessions, { chargedBookingIds });

      // ★ Remove internal fields before returning
      const cleanedSessions = sessions.map(s => ({
        id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        state: s.state,
        service_name: s.service_name,
        attended: s.attended,
        app_user_id: s.app_user_id,
        person_first_name: s.person_first_name,
        cancelled_at: s.cancelled_at,
        cancelled_with_reason: s.cancelled_with_reason,
      }));

      return {
        sessions: cleanedSessions,
        // ★★ THE ABSENCE IS DECLARED IN THE RESPONSE. A consumer cannot mistake "no note field" for
        //    "the note was empty" — and a future reader adding one has to remove this line, which is a
        //    decision rather than an oversight.
        // ★ RUN-2 (26 Sep 2026): the `notes: null` KEY is gone — Group C's ground-truth test
        //   (test/c_portal_permissions) forbids any "notes" key reaching a parent at all; the
        //   declaration below still says the absence out loud.
        notes_detail:
          "Session NOTES are never returned by the client app. A parent, a client and an adolescent " +
          "all see THAT a session happened and whether it was attended. What was said is staff-only " +
          "(document_type.is_session_note, enforced by session_notes_never_to_parents).",
        summary,
        // ★ credits: what this person can still SPEND (their own plus their family's — creditStanding uses the one `usableBy` rule). The
        //   "Book another" card said "You have N sessions left" with N = the number of rows in this very list.
        credits: await (async () => { const st = await creditStanding(db, { tenantId: principal.user.tenant_id, ownerUserId: me }); return { remaining: st.remaining, total: st.total }; })(),
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ DOCUMENTS — PER-TYPE VISIBILITY, DECIDED BY POSTGRES (U19).
  // ───────────────────────────────────────────────────────────────────────────
  // ★★ THE PREDICATE IS `document_is_visible()` (migration 0012), and it is applied INSIDE the RLS
  //    policy — so this query does not filter at all. That is the point: a query with no WHERE clause
  //    on visibility cannot be written wrongly, and the guarantee does not depend on this file.
  //  ★ U19's own words: visibility is per document TYPE. The legacy predicate was deleted-only, which
  //    showed a client every other client's agreement — the red-first P16.9 keeps pointed at.
  get("/api/app/documents", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const rows = await portalDocumentList(db);
      return { documents: rows };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ P9.5 — ONE DOCUMENT, WITH ITS FROZEN WORDS. THE SIGNING SURFACE HAD NOWHERE TO GET THEM.
  // ───────────────────────────────────────────────────────────────────────────
  // [EXECUTED 2026-09-15] the ~2,297 lines of `web/src/esign/` had **no importer except the test
  // harness**, and `web/src/esign/index.js` was a barrel nothing imported. The components were
  // finished — signature pad, adopt-and-reuse, guided signing, field ownership, the ESIGN disclosure
  // — and a client could not reach a single one of them, because the list surface showed titles and
  // there was no route that returned a document's WORDS.
  //
  // ★★★ VISIBILITY IS POSTGRES'S ANSWER, NOT THIS HANDLER'S. The predicate is
  //     `document_is_visible()` on the row itself (migration 0012), so a client asking for somebody
  //     else's document id gets **no row** — and this returns a 404, which is the same answer they
  //     get for an id that does not exist. ★ Those two being indistinguishable is deliberate: a
  //     different message for "exists but not yours" is an enumeration oracle.
  //
  // ★★ AND A DRAFT HAS NO FROZEN WORDS, SO THERE IS NOTHING TO SHOW. `instrumentSnapshot` returns
  //    null and this says so in words rather than handing the renderer an empty body — a titled page
  //    with signature lines and no terms is signable, which is exactly what `renderExecutedPdf`
  //    already refuses to produce.
  get("/api/app/documents/:id", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const rows = await portalDocumentDetail(db, { instanceId: c.req.param("id") });
      if (rows.length === 0) throw notFound("no such document");
      // ★ QUEUE §23.2.7 — the portal open is evidence too ("viewed", with IP and device); first open per person only.
      await recordPortalOpen(db, { tenantId: principal.user.tenant_id, instanceId: c.req.param("id"), openedBy: principal.appUserId, ip: c.get("clientIp") ?? null, userAgent: c.req.header("user-agent") ?? null });

      const row = rows[0];
      const snapshot = instrumentSnapshot(row);
      return {
        document: {
          id: row.id, title: row.title, state: row.state, builder: row.builder,
          type_label: row.type_label, sent_at: row.sent_at, executed_at: row.executed_at,
          send_mode: row.send_mode,
        },
        snapshot,
        // ★ SAID IN WORDS, not inferred from a null. P4.12's rule: the server names WHICH fact.
        reason: snapshot ? null
          : "This document has not been sent yet, so its wording is not final and there is nothing to sign.",
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // BOOKING — REAL SLOTS, FROM THE REAL GENERATOR (§B4 STEP 3).
  // ───────────────────────────────────────────────────────────────────────────
  // ★★ `generateSlots` takes LOCAL WALL-CLOCK MINUTES plus an IANA zone, never a stored UTC instant.
  //    A booking surface that computed slots itself would be a second answer to `when is this coach`
  //    free", and the two would disagree across a DST boundary — which is the one time it matters most.
  get("/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ THIS ROUTE NO LONGER HAS ITS OWN SLOT QUERY. It calls `readSlots` — the same function
      //     the STAFF route calls — because "when is this host free" must have exactly one answer.
      //
      // ★★ WHAT WAS HERE WAS WRONG THREE TIMES. Its column names were fixed after a deployed 500
      //    (`column "weekday" does not exist`), and two SILENT defects survived that fix:
      //      · `busy` was selected as `starts_at, ends_at` and `generateSlots` reads `startsAt` /
      //        `endsAt`, so `undefined` comparisons made **every booking invisible**;
      //      · `state IN ('confirmed','pending')` — `'pending'` is not one of the five allowed
      //        states, so a booking awaiting payment never occupied its slot either.
      //    Neither raised. They just silently stopped excluding taken times.
      //  ★ Both are fixed once, in `src/booking/read.mjs`, and both routes inherit the fix.
      //
      // ★★★ AND THE HOST. The old query read EVERY rule and EVERY booking in the tenant, so one
      //     coach`s day off closed the practice and one coach`s booking blocked all of them.
      //     `hostId` is now required — a client asks about a specific person's calendar.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ A CLIENT MAY NOT NAME A HOST, AND THAT IS A DIFFERENT QUESTION — NOT AN ERROR.
      //     [EXECUTED 2026-09-15] requiring `hostId` here broke this route for every client role
      //     (`p16_portals`: *"a parent was refused /api/app/booking — which R4 says is theirs"`).
      //     That was a real scope mistake: `hostId` belongs on the STAFF read, where the question
      //     is `when is this coach free`; a client who has not chosen one is asking "when can
      //     anybody see me".
      //   ★★ `readSlotsForAnyHost` answers that by computing each host SEPARATELY and unioning the
      //      TIMES. The old code unioned the INPUTS — every host's rules and bookings in one call —
      //      which is what made one coach's day off close the practice.
      const hostId = c.req.query("hostId") ?? null;
      const offer = hostId
        ? await readSlotsCached(db, { tenantId: principal.user.tenant_id, hostId, date })
        : await readSlotsForAnyHostCached(db, { tenantId: principal.user.tenant_id, date });

      // ★★★ P10.4 / KS-16.2 RULING 5 — THE COUNT-DOWN, ON THE SURFACE WHERE IT CHANGES A DECISION.
      //     A client choosing a time needs to know whether this one costs a credit or costs money,
      //     and "9 remaining" is what makes the checkbox beside it mean anything.
      //   ★ `null` when they hold no package — see `standingSentence`. The surface draws nothing
      //     rather than "0 remaining", which would say they had run out of something they never had.
      const standing = await creditStanding(db, {
        tenantId: principal.user.tenant_id, ownerUserId: principal.appUserId });
      return {
        ...offer,
        creditsRemaining: standing.remaining,
        creditStanding: standingSentence(standing),
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // SERVICES — LIST OF BOOKABLE SERVICES FOR THE TENANT.
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ 18.40 — RICHER PAYLOAD FOR THE BOOKING FLOW. Returns pricing, duration, credit coverage,
  //     and group booking info (capacity, places left, next date). For adolescent_client, omits
  //     price keys to enforce zero-money visibility.
  // ★ `blockCovered` = client has an active, non-expired entitlement credit for this service with
  //   remaining > 0. `group` is the next group booking (capacity > 1) for this service, if any.
  get("/api/app/services", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const tenantId = principal.user.tenant_id;
      const userId = principal.appUserId;

      // Fetch all bookable services
      const { rows: services } = await db.query(
        `SELECT id, name, price_minor, currency, duration_minutes, program_id FROM keystone.service
          WHERE tenant_id = $1 AND bookable = true AND active = true
          ORDER BY created_at`,
        [tenantId]);

      // For each service, enrich with credit coverage and group info
      const enriched = await Promise.all(
        services.map(async (service) => {
          // Check if client has a spendable credit for this service
          const { rows: creditRows } = await db.query(
            `SELECT count(*)::int AS count
               FROM keystone.entitlement_credit c
               JOIN keystone.entitlement e ON e.id = c.entitlement_id
              WHERE c.tenant_id = $1 AND e.owner_user_id = $2
                AND e.service_id = $3 AND e.status = 'active'
                AND (e.expires_at IS NULL OR e.expires_at > now())
                AND c.status IN ('available', 'returned')`,
            [tenantId, userId, service.id]);
          const blockCovered = (creditRows[0]?.count ?? 0) > 0;

          // Find the next group booking for this service
          const { rows: groupRows } = await db.query(
            `SELECT b.id, b.starts_at, b.capacity,
                    count(bp.*)::int AS participants
               FROM keystone.booking b
               LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id
              WHERE b.tenant_id = $1 AND b.service_id = $2 AND b.capacity > 1
                AND b.state = 'confirmed'
                AND b.starts_at > now()
              GROUP BY b.id
              ORDER BY b.starts_at ASC
              LIMIT 1`,
            [tenantId, service.id]);

          let group = null;
          if (groupRows.length > 0) {
            const booking = groupRows[0];
            group = {
              capacity: booking.capacity,
              placesLeft: booking.capacity - booking.participants,
              nextDate: booking.starts_at,
            };
          }

          const result = {
            id: service.id,
            name: service.name,
            durationMinutes: service.duration_minutes,
            blockCovered,
            group,
            free: service.price_minor === 0,
            // ★ Programs follow-up brief (1 Oct 2026, Part 2) — real replacement for coachingGroup.
            //   Nullable until every service is re-pointed at a program by staff.
            programId: service.program_id,
          };

          // Only include price info for non-adolescent clients
          if (role !== "adolescent_client") {
            result.priceMinor = service.price_minor;
            result.currency = service.currency;
          }

          return result;
        })
      );

      return { services: enriched };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // COACHES — LIST OF STAFF WHO CAN BE BOOKED.
  // ───────────────────────────────────────────────────────────────────────────
  get(`/api/app/coaches`, (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { rows } = await db.query(
        `SELECT id, display_name FROM keystone.app_user
          WHERE tenant_id = $1 AND role = 'staff' AND accepting_new_bookings = true
          ORDER BY display_name`,
        [principal.user.tenant_id]);
      return { coaches: rows };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // NOTIFICATIONS — THEIR OWN, PLUS THEIR OWN PREFERENCES.
  // ───────────────────────────────────────────────────────────────────────────
  get("/api/app/notifications", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      // ★★★ THE RECIPIENT COLUMN ON notification IS recipient_id, NOT app_user_id. [MEASURED from
      //     the deployed app's own log] GET /api/app/notifications -> 500, column "app_user_id"
      //     does not exist. ★ And note the asymmetry that made this easy to get wrong:
      //     notification_preference DOES key on app_user_id (the second query below is correct as
      //     written). Two tables, one concept, two column names — so a reader who checked one and
      //     assumed the other matched would land exactly here.
      const { rows: notifications } = await db.query(
        `SELECT id, topic, title, body, read_at, created_at
           FROM keystone.notification WHERE recipient_id = $1
          ORDER BY created_at DESC LIMIT 100`, [principal.appUserId]);
      const { rows: preferences } = await db.query(
        `SELECT channel, topic, enabled FROM keystone.notification_preference
          WHERE app_user_id = $1 ORDER BY topic, channel`, [principal.appUserId]);
      return { notifications, preferences };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ACTIVITY — THEIR OWN FEED, FROM THE OUTBOX TABLE THAT DOUBLES AS THE AUDIT LOG.
  // ───────────────────────────────────────────────────────────────────────────
  get("/api/app/activity", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      // ★★ SUBJECT-SCOPED TO THIS PERSON. `event` is the tenant's whole feed; a client's Activity tab is
      //    about THEM. Without the predicate a client would read the practice's entire operational
      //    history, which RLS permits (same tenant) and which nobody intends.
      // ★★★ STAGE 3 TASK 2 — found alongside the writer fix (F474 grep sweep). This predicate used to
      //     be `subject_id = $1 OR (subject_type = 'app_user' AND subject_id = $1)` — the second
      //     clause is a strict subset of the first, so it was always equivalent to `subject_id = $1`
      //     ALONE: no subject_type check at all, referencing a literal this task retires either way.
      //     Tightened to the real vocabulary (`person`, `records/queries.mjs` `ACTIVITY_SUBJECT`) so
      //     this endpoint is actually scoped to events ABOUT this person, not to any event whose
      //     subject_id happens to equal their app_user id regardless of what kind of row that is.
      const { rows } = await db.query(
        `SELECT topic, subject_type, subject_id, created_at
           FROM keystone.event
          WHERE subject_type = 'person' AND subject_id = $1
          ORDER BY created_at DESC LIMIT 100`, [principal.appUserId]);
      return { activity: rows };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // PROFILE — WHO THEY ARE, AS THE SERVER SEES THEM.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): this thin stub (four columns, no
  //   preferences, no guardians, no dependants) and C2.5's real profile screen
  //   (registerAppProfileRoutes, appProfile.mjs) were BOTH registered on `GET /api/app/profile`.
  //   Hono serves the FIRST-registered handler for an exact duplicate path+method and never reaches
  //   the second — this stub ran first, so C2.5's actual built screen was live in the repo and dead
  //   in production, silently, the whole night. [MEASURED: two `app.get("/api/app/profile", ...)`
  //   registrations existed; Hono trie routing serves the first for an exact duplicate.] Removed in
  //   favor of calling registerAppProfileRoutes below, through the tracked `get`.
  registerAppProfileRoutes(app, { scoped, get, post });

  // ───────────────────────────────────────────────────────────────────────────
  // WORKING-ON — ADULT AND ADOLESCENT ONLY. A PARENT DOES NOT GET THIS SURFACE.
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ AND THE ROUTE ENFORCES IT, NOT ONLY THE NAV. `surfacesFor('parent')` omits `working-on` — but a
  //     nav that omits a row and a route that refuses it are different guarantees, and P16.6 requires
  //     the second. A parent calling this path directly is refused with the reason.
  get("/api/app/working-on", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      if (principal.user.is_guardian) {
        throw forbidden(
          "'Things I'm working on' is the client's own surface. A parent sees money, documents and " +
          "attendance — this is neither, and omitting the nav row is not the same as refusing the " +
          "request (R4/U20).");
      }
      // ★★★ FIX ROUND 1, M5 — same relation as C1 (src/records/queries.mjs ACTIVITY_SQL).
      //     [MEASURED, review M5] this used to filter `subject_id = $1`, but a document event's
      //     `subject_id` is the INSTANCE id, never the person's — so this surfaced almost no real
      //     document events. `document_instance.subject_user_id` is who the document is ABOUT.
      const rows = await documentEventsAboutSubject(db, { subjectUserId: principal.appUserId });
      return { working_on: rows };
    }, { bucket: "app" })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ P10.1 — THE FOUR THINGS A CLIENT MAY CHANGE.
  // ═══════════════════════════════════════════════════════════════════════════
  // ★★ EACH ONE IS ABOUT THE PERSON THEMSELVES. A client may mark THEIR notification read, set THEIR
  //    preference, accept a disclosure in THEIR name, and sign an instrument that was sent to THEM.
  //    None of them is a write about somebody else, and none is a write a coach would make.
  //  ★ The `appUserId` always comes from the SESSION, never from the body. A route that let a caller
  //    name the person would let a client mark another client's notification read — and the body is
  //    the one part of a request the caller controls completely.

  post("/api/app/notifications/read", "/api/app/notifications", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { notificationId } = await c.req.json();
      if (!notificationId) throw invalid("notificationId is required");
      // ★★ `markNotificationRead` scopes to `recipient_id` ITSELF (its own header records that the
      //    predicate was once missing, so any coach in the practice could mark anybody's read). This
      //    route passes the session's person and nothing else.
      return markNotificationRead(db, {
        tenantId: principal.user.tenant_id, notificationId,
        recipientId: principal.appUserId, actorUserId: principal.appUserId });
    }, { bucket: "app" })
  );

  post("/api/app/notifications/preference", "/api/app/notifications", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { topic, channel, enabled } = await c.req.json();
      return setNotificationPreference(db, {
        tenantId: principal.user.tenant_id, appUserId: principal.appUserId,
        topic, channel, enabled, actorUserId: principal.appUserId });
    }, { bucket: "app" })
  );

  // ★★★ KS-13.6 — THE ROUTE THAT MAKES CONSENT REAL, because consent that cannot be withdrawn is not
  //     consent. `acceptDisclosure` records the VERSION and the TEXT SHOWN, so what somebody agreed
  //     to is evidence rather than a claim.
  //   ★ `textShown` comes from the CLIENT because it is what was on their screen — that is the whole
  //     point of capturing it. The VERSION is checked against the server's own, so a caller cannot
  //     accept a version that does not exist.
  post("/api/app/documents/disclosure", "/api/app/documents", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { version, textShown } = await c.req.json();
      return acceptDisclosure(db, {
        tenantId: principal.user.tenant_id, appUserId: principal.appUserId,
        version, textShown, userAgent: c.req.header("user-agent") ?? null });
    }, { bucket: "app" })
  );

  // ★★★ AND THE ONE THE WHOLE PHASE WAS BUILDING TOWARDS: A CLIENT SIGNS.
  //   ★★ THE ROLE IS NOT TAKEN FROM THE BODY. `recordSignature` writes a party onto an instrument,
  //      and a caller who could name their own role could sign as the COACH — which is the §2.7
  //      defect in its most expensive form: a signature attributed to somebody who did not make it.
  //      The role is derived from the session's own role, here, once.
  //   ★ `signerUid` and `signerName` likewise come from the session, not the body.
  post("/api/app/documents/sign", "/api/app/documents", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const { instanceId, markSha256 = null, signedLocalDate = null, signerTimezone = null } =
        await c.req.json();
      if (!instanceId) throw invalid("instanceId is required");

      // ★★ A PARENT SIGNS AS `parent`; A CLIENT SIGNS AS `client`. Named explicitly rather than
      //    mapped through a default, because a default here would silently file one party's
      //    signature under another party's name.
      const signingRole = principal.user.is_guardian ? "parent" : "client";

      const { rows: [me] } = await db.query(
        `SELECT display_name FROM keystone.app_user WHERE id = $1`,
        [principal.appUserId]);

      // ★ RUN-2 (26 Sep 2026): signerUid is the app_user id (the column references keystone.app_user);
      //   this passed the Firebase uid, which recordSignature refuses with 400 — same defect as :sign below.
      return recordSignature(db, {
        tenantId: principal.user.tenant_id, instanceId, role: signingRole,
        signerName: me?.display_name ?? null, signerUid: principal.appUserId,
        signedLocalDate, signerTimezone,
        userAgent: c.req.header("user-agent") ?? null, markSha256,
        actorUserId: principal.appUserId,
      });
    }, { bucket: "app" })
  );

  // ★★★ B1.1 — PATH-BASED SIGNING: `/api/app/documents/{instanceId}/sign`
  // Takes `typedName` from the body. Signs the document and executes it if all parties have signed.
  post("/api/app/documents/:instanceId/sign", "/api/app/documents", (c) =>
    scoped(c, async ({ db, principal }) => {
      const instanceId = c.req.param("instanceId");
      if (!instanceId) throw invalid("instanceId is required");

      const { typedName = null, markImage = null, signedLocalDate = null, signerTimezone = null } = await c.req.json();
      if (!typedName || typeof typedName !== "string" || !typedName.trim()) {
        throw invalid("typedName is required and must be a non-empty string");
      }

      // ★★★ ROLE DERIVATION FOR CLIENTS VS STAFF
      // Client roles only; the role comes from the session, never the body.
      let signingRole = null;
      let signerUid = null;
      let signerName = typedName.trim();

      const role = principal?.user?.role ?? null;
      if (CLIENT_ROLES.includes(role)) {
        // Client app caller — derive role from their session
        signingRole = principal.user.is_guardian ? "parent" : "client";
        // ★ RUN-2 (26 Sep 2026): this passed the person's FIREBASE uid, which recordSignature refuses
        //   (the column references keystone.app_user) — so every client-app signature answered 400
        //   and no document could be signed from the portal (test/b_esign). The signer IS the session.
        signerUid = principal.appUserId;
      // ★★★ NO STAFF BRANCH. It filed a staff caller's typed name as the CLIENT's (or parent's)
      //     signature on the client's own document — a signature attributed to somebody who did not
      //     make it, the §2.7 defect the route above names. Measured reachable by an owner session
      //     (26 Sep 2026); no screen or test used it. Staff sign through the CRM's own routes.
      } else {
        throw forbidden("this route is for client app users only");
      }

      // Record the signature
      // ★ QUEUE §23.2.4/§23.2.5 — the portal used to send ONLY the typed name, so a portal-signed copy had no mark, no date and no IP. The mark, the signer's own local date + zone and the
      //   request's IP now travel too (the date and zone together or not at all; `recordSignature` fills the practice's zone when the browser sends none).
      await recordSignature(db, {
        tenantId: principal.user.tenant_id, instanceId, role: signingRole,
        signerName, signerUid,
        signedLocalDate: signedLocalDate && signerTimezone ? signedLocalDate : null,
        signerTimezone: signedLocalDate && signerTimezone ? signerTimezone : null,
        markImage: typeof markImage === "string" && markImage ? markImage : null,
        signerIp: c.get("clientIp") ?? null,
        userAgent: c.req.header("user-agent") ?? null,
        actorUserId: principal.appUserId,
      });

      // ★★★ AUTO-EXECUTE WHEN ALL PARTIES HAVE SIGNED — 14.33, ONE EXECUTE PATH FOR EVERY SIGNER.
      // `executeIfComplete` (src/documents/writes.mjs) owns the completeness check (driven off the
      // instrument's own SIGNER_CONFIGS-declared order, never a bare count) and the execute call
      // itself — the same helper 14.34's public sign-link callers go through, so this real client
      // session cannot drift from theirs.
      const result = await executeIfComplete(db, {
        tenantId: principal.user.tenant_id, instanceId, actorUserId: principal.appUserId,
      });

      return result;
    }, { bucket: "app" })
  );

  // ★★★ P10.2 — THE SLOT BUTTON'S DESTINATION. IT WAS DRAWN, DEPLOYED, AND WIRED TO NOTHING.
  //     [MEASURED] `ClientSurfaces.jsx` rendered `<button type="button" className="ks-surface-slot">`
  //     with **no `onClick`** — the only control on any of the eight client surfaces, sitting in the
  //     deployed bundle, doing nothing when pressed. A dead control is the same lie as a dead link.
  //
  // ★★★ THE TIME IS VALIDATED AGAINST THE SERVER'S OWN OFFER, NOT TRUSTED. A caller could otherwise
  //     book 03:00 on a Sunday, or a time inside the practice's minimum notice — the slot list is the
  //     product's statement of what is available, and a booking route that accepted any instant would
  //     make that statement decorative. `readSlots` is re-run here and the requested start must be
  //     one of the times it returns RIGHT NOW.
  //   ★★ The exclusion constraint still backs it (`booking_tenant_id_host_id_occupies_excl`), because
  //      two clients can pass this check in the same second. Validation is the message; the
  //      constraint is the guarantee.
  //
  // ★★ KS-16.2 RULING 1 — THE CREDIT IS OFFERED TO THE CLIENT, NOT ONLY TO STAFF. `creditForUserId`
  //    is the client themselves when they choose to spend one, which is the P8.6 reserve path
  //    reached from the client app. **This is the ruling that made P10.1 a prerequisite.**
  post("/api/app/booking", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      // ★ FIX, 30 Sep 2026 (lead-intake brief) — MEASURED: `client_app.surfaces_off` was checked
      //   ONLY at the nav-listing endpoint (line ~200 above), never here. Turning off the
      //   `app-booking` surface hid the tab but left this route reachable directly — exactly the
      //   gap §K3 (this file's own header) names: "a nav that omits a row and a route that
      //   refuses it are different guarantees." Same pattern as `working-on`'s own enforcement
      //   below.
      const off = new Set((await getSettings(db))["client_app.surfaces_off"] ?? []);
      if (off.has("app-booking")) {
        throw forbidden("Self-booking is turned off for this practice. Contact them directly to schedule.");
      }
      if (principal.user.is_guardian) {
        // ★ A parent booking on a child's behalf is a real requirement and a DIFFERENT one — it needs
        //   the guardian edge and a subject, and inventing it here would be building it sideways.
        throw forbidden(
          "booking for somebody else is not built. A parent sees money, documents and attendance; " +
          "making an appointment for a child needs the guardian relation and is its own item.");
      }

      // ★★★ TASK C2.1 — ADOLESCENT CONSENT REQUIREMENT. An adolescent without guardian consent
      //     cannot book sessions. The consent_status must be 'granted'.
      if (role === "adolescent_client") {
        const { rows: [user] } = await db.query(
          `SELECT consent_status FROM keystone.app_user WHERE id = $1`,
          [principal.appUserId]);
        if (!user || user.consent_status !== "granted") {
          throw forbidden(
            "You need parental consent before you can book sessions. " +
            "Ask your parent or guardian to approve this in your account settings.");
        }
      }

      // ★ 13.11 — hostId is now OPTIONAL: "Anyone" is a real choice (see the resolution below).
      //   serviceId and startsAt are still required, and the 400 names whichever is missing.
      const { hostId = null, serviceId, startsAt, useCredit = false } = await c.req.json();
      if (!serviceId) throw invalid("serviceId is required to book a session");
      if (!startsAt) throw invalid("startsAt is required to book a session");

      // ★★★ TASK C1.1 — CHECK `client_may_book` POLICY. Server-side enforcement only — never in
      //     screen. ★ 13.11 — this now runs BEFORE the notice/window checks and BEFORE any lookup
      //     that could otherwise answer 400/404 first: a switched-off practice must always answer
      //     403, not whichever validation happened to run first.
      const policy = await policyFor(db, principal.user.tenant_id, serviceId);
      if (!policy.client_may_book) {
        throw forbidden("Clients cannot book sessions for this service.");
      }

      // ★★ `new Date(...).toISOString()`, NOT `String(startsAt)`. [FOUND by the gate] a caller may
      //    send an ISO string OR a Date, and `String(aDate)` is "Wed Sep 16 2026 …" — whose first ten
      //    characters are "Wed Sep 16", which `readSlots` correctly refuses. The refusal was right
      //    and the input was mine.
      const when = new Date(startsAt);
      if (Number.isNaN(when.getTime())) throw invalid(`startsAt is not a time: ${JSON.stringify(startsAt)}`);
      const date = when.toISOString().slice(0, 10);

      // ★★★ TASK C1.1 — ENFORCE MINIMUM NOTICE AND BOOKING WINDOW SERVER-SIDE.
      const now = Date.now();
      const startMs = when.getTime();
      const minimumNoticeMs = policy.minimum_notice_minutes * 60 * 1000;
      const bookingWindowMs = policy.booking_window_days * 24 * 60 * 60 * 1000;

      if (startMs <= now + minimumNoticeMs) {
        throw invalid(
          `that time is inside the practice's notice period. The earliest available time is ` +
          `${new Date(now + minimumNoticeMs).toISOString()}.`);
      }
      if (startMs > now + bookingWindowMs) {
        throw invalid(
          `that time is beyond the practice's booking window. You can book up to ` +
          `${policy.booking_window_days} days in advance.`);
      }

      // ★ 13.11 — the service itself must be a real, currently portal-bookable offering. A service
      //   that is unbookable, inactive, or has had its portal door closed answers 404, never a 403
      //   (this is "there is nothing here", not a permission refusal).
      const { rows: [service] } = await db.query(
        `SELECT id FROM keystone.service
          WHERE tenant_id = $1 AND id = $2 AND bookable AND active AND portal_bookable`,
        [principal.user.tenant_id, serviceId]);
      if (!service) throw notFound("That service isn't available to book.");

      // ★★★ "ANYONE" IS A REAL CHOICE. No hostId means the client does not care which host — offer
      //     every host's open slots for the day and land on the first host whose slots contain the
      //     requested instant, through the SAME per-host function (`readSlots`) `readSlotsForAnyHost`
      //     itself calls, so a fix to slot logic reaches both paths at once.
      let resolvedHostId = hostId;
      let match = null;
      if (!hostId) {
        const anyHost = await readSlotsForAnyHost(db, { date, serviceId });
        for (const h of anyHost.hosts ?? []) {
          const found = (h.slots ?? []).find(
            (s) => new Date(s.startsAt).toISOString() === when.toISOString());
          if (found) {
            match = found;
            resolvedHostId = h.hostId;
            break;
          }
        }
      } else {
        const offered = await readSlots(db, { hostId, date, serviceId });
        match = (offered.slots ?? []).find(
          (s) => new Date(s.startsAt).toISOString() === when.toISOString());
      }
      if (!match) {
        // ★★ THE REFUSAL NAMES THE REASON A PERSON CAN ACT ON. "That time is no longer open" is what
        //    happened; "invalid startsAt" is what a validator would say and tells them nothing.
        throw invalid(
          `that time is not open on ${date}. Somebody may have taken it, or it falls inside the ` +
          `practice's notice period — the times on screen are refreshed from the same list this ` +
          `checks against.`);
      }

      const booking = await createBooking(db, {
        tenantId: principal.user.tenant_id, hostId: resolvedHostId, serviceId,
        startsAt: match.startsAt, endsAt: match.endsAt,
        // ★ FIX ROUND 2, F494 — `createBooking`'s parameter is now `actorUserId` (see that file).
        //   `principal.appUserId` is the session's own id, never the request body, so this call was
        //   already safe — only the parameter's name changed.
        actorUserId: principal.appUserId,
        // ★★★ THE CLIENT'S OWN CREDIT, AND ONLY EVER THEIR OWN. `creditForUserId` is the session's
        //     person — a caller who could name it would spend somebody else's package.
        creditForUserId: useCredit ? principal.appUserId : null,
        // ★ 13.9 — the closed source vocabulary: this is the client app's own booking route.
        source: "portal",
      }, {
        // ★★★ REPORT ITEM (step-4 FIX) — this is the ONLY caller that may set this. A client holds
        //     no `user_role`, so `createBooking`'s ordinary `user_may` check refused every real
        //     client session with 403. `clientSelfService: true` asks the self-booking question
        //     instead (see `createBooking.mjs`) — matched by migration 0507's third `tenant_insert`
        //     OR branch, so the rule holds even if a future writer skips this JS check.
        clientSelfService: true,
      });

      // ★★★ AND THEY ARE ON IT. `createBooking` records the time and the host; a participant is a
      //     separate write, and a booking with none is an appointment with nobody in it — invisible
      //     on the client's own Sessions surface, which reads through `booking_participant`.
      //   ★★ THE PARTY IS DERIVED FROM THE DIVISION-FREE FACT THAT THIS PERSON IS THE CLIENT, and
      //      `client` is a real `PARTICIPANT_PARTIES` value. It is not taken from the body — §2.7,
      //      the same rule as the signing role.
      const me = (await db.query(
        `SELECT display_name FROM keystone.app_user WHERE id = $1`, [principal.appUserId])).rows[0];
      await addBookingParticipant(db, {
        tenantId: principal.user.tenant_id, bookingId: booking.id, party: "client",
        appUserId: principal.appUserId, displayName: me?.display_name ?? "Client",
      });

      // ★ If this instant matches a waitlist offer this client was holding, the booking just claims
      //   it — the offer does not sit there un-actioned once the client has actually taken the slot.
      await db.query(
        `UPDATE keystone.booking_waitlist_entry
            SET status = 'claimed', updated_at = now()
          WHERE tenant_id = $1 AND client_user_id = $2 AND status = 'offered'
            AND offered_starts_at = $3`,
        [principal.user.tenant_id, principal.appUserId, match.startsAt]);

      return booking;
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TASK C1.1 — BOOKING POLICY ENFORCEMENT: CANCEL, RESCHEDULE, POLICY TEXT
  // ───────────────────────────────────────────────────────────────────────────

  // ★★★ GET THE POLICY TEXT SHOWN BEFORE CONFIRMING A BOOKING.
  getFor("/api/app/booking/policy", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      // ★ 13.11 — serviceId is now OPTIONAL: a client may ask for the practice's general policy
      //   before picking a service. `policyFor` already treats a missing serviceId as "practice
      //   defaults only" (no row matches `service_id = null`).
      const { serviceId } = c.req.query();
      const policy = await policyFor(db, principal.user.tenant_id, serviceId ?? null);
      // ★★★ CT-F45 — the SAME object `policyFor` returns feeds the sentence a client reads AND the
      //     switches the route itself enforces, so this page can never promise a window the route
      //     would then refuse.
      const { sentence, short } = policySentence(policy);
      // ★ CT-F45's frozen response shape — Stage 18's confirm sheet and this route cannot disagree
      //   about it. `policy_text` carries the practice's own paragraph when one is set, and is
      //   `null` (never a made-up fallback sentence) when it is not; `sentence` is always present.
      return {
        sentence,
        short,
        policy_text: policy.policy_text ?? null,
        client_may_cancel: policy.client_may_cancel,
        client_may_reschedule: policy.client_may_reschedule,
      };
    }, { bucket: "app" })
  );

  // ★★★ CANCEL A BOOKING — checks `client_may_cancel` policy.
  post("/api/app/booking/cancel", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { bookingId } = await c.req.json();
      if (!bookingId) throw invalid("bookingId is required");

      // ★ Get the booking to read its serviceId — WITHOUT throwing yet. ★★★ 13.11 — the switch is
      //   checked BEFORE the not-found is thrown: an outage or a stale bookingId must never let a
      //   404 stand in for "clients cannot cancel this", and a switched-off practice must always
      //   answer 403 first, with an audit line, rather than a 404 that leaves no trace of the
      //   refusal. `booking?.service_id ?? null` reads the practice's own default policy when the
      //   booking does not exist at all, so even that case is refused by a real setting.
      const booking = await ownBooking(db, principal, bookingId);

      // ★★★ TASK C1.1 — CHECK `client_may_cancel` POLICY. Server-side enforcement only.
      const policy = await policyFor(db, principal.user.tenant_id, booking?.service_id ?? null);
      if (!policy.client_may_cancel) {
        const { sentence } = policySentence(policy);
        throw forbidden(sentence);
      }

      if (!booking) throw notFound("no such booking");

      // ★★★ C2.2 — Pass skipVisibilityCheck=true for client app (RLS handles visibility)
      return cancelBookingByRequest(db, {
        tenantId: principal.user.tenant_id,
        bookingId,
        actorUserId: principal.appUserId,
        skipVisibilityCheck: true,
      });
    }, { bucket: "app" })
  );

  // ★★★ RESCHEDULE A BOOKING — checks `client_may_reschedule` policy (separate from cancel).
  post("/api/app/booking/reschedule", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const { bookingId, startsAt, endsAt } = await c.req.json();
      if (!bookingId) throw invalid("bookingId is required");
      if (!startsAt) throw invalid("startsAt is required");

      // ★ Get the booking to read its serviceId — WITHOUT throwing yet. Same order as cancel,
      //   above, and for the same reason (13.11): the switch answers before the not-found.
      const booking = await ownBooking(db, principal, bookingId);

      // ★★★ TASK C1.1 — CHECK `client_may_reschedule` POLICY. Separate switch from cancel — it is
      //     read and checked independently here, never derived from `client_may_cancel`, so a
      //     reschedule can never silently ride on the cancel switch's value.
      const policy = await policyFor(db, principal.user.tenant_id, booking?.service_id ?? null);
      if (!policy.client_may_reschedule) {
        const { sentence } = policySentence(policy);
        throw forbidden(sentence);
      }

      if (!booking) throw notFound("no such booking");

      // ★★★ C2.2 — Pass skipVisibilityCheck=true for client app (RLS handles visibility)
      return rescheduleBooking(db, {
        tenantId: principal.user.tenant_id,
        bookingId,
        startsAt,
        endsAt,
        actorUserId: principal.appUserId,
        skipVisibilityCheck: true,
      });
    }, { bucket: "app" })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ 13.10 — A CLIENT JOINS AN EXISTING CLASS. `addBookingParticipant` (13.10, same task) is the
  //     one place that holds `capacity` against two simultaneous joins (`FOR UPDATE` + the SAME
  //     host-keyed advisory lock `createBooking.mjs` uses) — this route does its OWN checks (the
  //     parent refusal, the policy switch, "is this even a class") ahead of that write, but the
  //     seat itself is only ever decided inside `addBookingParticipant`.
  // ★★ A SEAT IS A PERSON, NEVER TAKEN FROM THE BODY — same §2.7 rule as `POST /api/app/booking`
  //    above: the party added is the SESSION'S OWN id, not one the caller could name.
  // ★ Answers 200, not 201 — `/api/app/*` routes use the `post()` helper here, a different one from
  //   `ROUTES`-table paths (CT-F51). A policy or permission refusal is 403; "there is nothing here"
  //   (no such booking, or a service the practice has switched off) is a different fact from
  //   "the class is full", and both are kept as separate sentences.
  post("/api/app/booking/join", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const { bookingId } = await c.req.json();
      if (!bookingId) throw invalid("bookingId is required");

      if (principal.user.is_guardian) {
        // ★ Same sentence as `POST /api/app/booking` above — a parent joining a child onto a class
        //   is the same unbuilt "book for somebody else" feature, not a different refusal to word.
        throw forbidden(
          "booking for somebody else is not built. A parent sees money, documents and attendance; " +
          "making an appointment for a child needs the guardian relation and is its own item.");
      }

      // ★ Get the booking to read its serviceId and capacity — WITHOUT throwing yet. Same order as
      //   cancel/reschedule above (13.11): the switch answers before the not-found, so an outage or
      //   a stale bookingId cannot stand in for "clients cannot book this service".
      const { rows: [booking] } = await db.query(
        `SELECT service_id, capacity FROM keystone.booking WHERE id = $1 AND tenant_id = $2`,
        [bookingId, principal.user.tenant_id]);

      const policy = await policyFor(db, principal.user.tenant_id, booking?.service_id ?? null);
      if (!policy.client_may_book) {
        throw forbidden("Clients cannot book sessions for this service.");
      }

      if (!booking) throw notFound("no such booking");

      // ★ "There is nothing here" (no booking), "permission denied" (the switch), and "the class is
      //   full" are three different facts — this is the third check, in its own sentence, and it
      //   reveals nothing about who else is on the list.
      if (!(booking.capacity > 1)) {
        throw conflict("That session isn't a class.", { field: "capacity" });
      }

      const me = (await db.query(
        `SELECT display_name FROM keystone.app_user WHERE id = $1`, [principal.appUserId])).rows[0];
      // ★ THE SEAT GUARD LIVES INSIDE addBookingParticipant (13.10) — this call is where a UNIQUE
      //   constraint violation (already joined) and a FULL class (capacity held under the same
      //   advisory-lock key createBooking.mjs uses) both surface as 409.
      await addBookingParticipant(db, {
        tenantId: principal.user.tenant_id, bookingId, party: "client",
        appUserId: principal.appUserId, displayName: me?.display_name ?? "Client",
        actorUserId: principal.appUserId,
      });

      const { rows: [{ taken }] } = await db.query(
        `SELECT count(*)::int AS taken FROM keystone.booking_participant
          WHERE tenant_id = $1 AND booking_id = $2 AND party IN ('client', 'pir')`,
        [principal.user.tenant_id, bookingId]);

      return { bookingId, taken, capacity: booking.capacity };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // L9.6 — "ADD TO CALENDAR": ONE VEVENT, AS A REAL .ics FILE. `ical-generator` 11.1.1.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ Registered the same way the sibling `getFor("/api/app/booking/policy", ...)` above is — same
  //   surface claim (`/api/app/booking`), same principal resolution through `scoped()`.
  // ★★ VISIBILITY IS THE SAME RULE `/api/app/sessions` USES, above — a person's own bookings, or
  //    (for a parent) their children's, in their own tenant. Anything else is a 404, NEVER a 403:
  //    a calendar link is exactly the kind of thing a client pastes or forwards, and "forbidden"
  //    would tell a guesser the id exists at all — the same no-existence-leak rule every other
  //    booking lookup in this file already follows (cancel/reschedule/join, above).
  // ★★★ `scoped()` ALWAYS ANSWERS THROUGH `c.json(r)` (the one wrapper `src/http/app.mjs:442` hands
  //     every route in this file) — piping ics text through that would JSON-stringify it (quoted,
  //     `\r\n` escaped) instead of serving it raw. So this handler still runs everything through
  //     `scoped()` — identical tenant/principal resolution, and a thrown `notFound` still rejects
  //     and reaches the app's normal error boundary exactly like every other route here — but
  //     captures the rendered ics text through a closure instead of through scoped's own return
  //     value, and answers with a fresh `Response` once scoped's promise settles, never handing the
  //     real body to `c.json`/`c.body`.
  // ★ NO NOTES, NO RECOVERY FIELDS: the VEVENT carries only start/end, the service name, and a
  //   location when the booking has one — nothing else about the person or the session.
  getFor("/api/app/booking/:id.ics", "/api/app/booking", (c) => {
    let ics = null;
    return scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const me = principal.appUserId;

      // ★ Hono has no literal-suffix syntax for a path segment — `:id.ics` captures the WHOLE
      //   segment as one param (its name is literally "id.ics"). Read whichever single param this
      //   route produced and strip the ".ics" suffix ourselves, rather than depend on that name.
      const raw = Object.values(c.req.param())[0] ?? "";
      const bookingId = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;

      // ★★ SAME GUARDIAN EXPANSION AS `/api/app/sessions`, ABOVE — "a person/guardian's own
      //    bookings in their tenant".
      let userIds = [me];
      if (principal.user.is_guardian) {
        const { rows: guardians } = await db.query(
          `SELECT g.child_user_id
             FROM keystone.guardian g
            WHERE g.tenant_id = (SELECT tenant_id FROM keystone.app_user WHERE id = $1)
              AND g.guardian_user_id = $2`,
          [me, me]);
        userIds = [me, ...guardians.map(g => g.child_user_id)];
      }

      const { rows: [booking] } = await db.query(
        `SELECT b.id, b.starts_at, b.ends_at, b.location_kind, b.location_detail,
                s.name AS service_name
           FROM keystone.booking b
           JOIN keystone.booking_participant bp ON bp.booking_id = b.id
      LEFT JOIN keystone.service s ON s.id = b.service_id
          WHERE b.id = $1 AND b.tenant_id = $2 AND bp.app_user_id = ANY($3)
          LIMIT 1`,
        [bookingId, principal.user.tenant_id, userIds]);

      // ★ 404, never 403 — see the note above this route.
      if (!booking) throw notFound("no such booking");

      const calendar = ical({ name: "Booking" });
      calendar.createEvent({
        id: booking.id,
        start: booking.starts_at,
        end: booking.ends_at,
        summary: booking.service_name ?? "Appointment",
        // ★ Same guard `calendarPush.mjs` uses: `location_detail` is only meaningful with a kind.
        location: booking.location_kind ? booking.location_detail : null,
      });
      ics = calendar.toString();
      return null;
    }, { bucket: "app" }).then(() =>
      new Response(ics, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8" } })
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ 13.13 — A CLIENT ASKS TO BE WAITLISTED (F15 §2.3, "Tell him you'd like one"). Writes a
  //     `kind='demand'` row through `recordDemand` (13.12, `../booking/waitlist.mjs`) — the SAME
  //     engine function the staff-facing "Offer a time" flow reads back from, never a second table
  //     or a second shape for the same fact.
  // ★★ A parent cannot demand a slot on somebody else's behalf — same unbuilt "act for somebody
  //    else" refusal as `/api/app/booking/join` above, in the same voice.
  // ★ Answers 200, not 201 — `SUPPORT_WRITES` (this file's own reconciliation block) names this path
  //   explicitly as reviewed and real (CT-F51: only `ROUTES`-table paths in `writes.mjs` answer 201).
  // ★★★ COUNTS, NEVER NAMES: this route returns only `{id, kind}` — never who else is waiting, never
  //     a position, never how many are ahead. See `GET /api/app/waitlist` below for the one count a
  //     client may see about anyone but themself.
  // ═══════════════════════════════════════════════════════════════════════════
  post("/api/app/waitlist/demand", "/api/app/booking", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const { serviceId, hostId = null, preference, preferenceNote = null } = await c.req.json();

      if (principal.user.is_guardian) {
        throw forbidden(
          "waitlisting for somebody else is not built. A parent sees money, documents and " +
          "attendance; asking to be added to a waitlist needs the guardian relation and is its " +
          "own item.");
      }

      if (!serviceId) throw invalid("serviceId is required");
      if (!WAITLIST_PREFERENCES.includes(preference)) {
        throw invalid(`preference must be one of ${WAITLIST_PREFERENCES.join(", ")}`);
      }
      if (preferenceNote != null && String(preferenceNote).length > 200) {
        throw invalid("preferenceNote must be 200 characters or fewer");
      }

      const row = await recordDemand(db, {
        tenantId: principal.user.tenant_id,
        clientUserId: principal.appUserId,
        serviceId, hostId, preference, preferenceNote,
      });
      return { id: row.id, kind: row.kind };
    }, { bucket: "app" })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ 13.13 — THE CLIENT'S OWN WAITLIST ENTRIES + F15 §2.4's "Four other people are waiting for
  //     evenings" count. `waitingForSamePreference` is a COUNT of OTHER waiting entries sharing this
  //     client's own most-recent waiting preference for the same service — never a name, never a
  //     position. A client with no waiting entry of their own gets 0, not an error: "nobody is
  //     waiting" and "you may not see this" are different facts, and this route never confuses them.
  // ═══════════════════════════════════════════════════════════════════════════
  get("/api/app/waitlist", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const tenantId = principal.user.tenant_id;

      const { rows } = await db.query(
        `SELECT id, service_id AS "serviceId", host_id AS "hostId", preference,
                preference_note AS "preferenceNote", status, kind,
                created_at AS "createdAt", offered_starts_at AS "offeredStartsAt"
           FROM keystone.booking_waitlist_entry
          WHERE tenant_id = $1 AND client_user_id = $2
          ORDER BY created_at DESC`,
        [tenantId, principal.appUserId]);

      let waitingForSamePreference = 0;
      const mine = rows.find((r) => r.status === "waiting");
      if (mine) {
        const { rows: [{ n }] } = await db.query(
          `SELECT count(*)::int AS n FROM keystone.booking_waitlist_entry
            WHERE tenant_id = $1 AND service_id = $2 AND preference = $3 AND status = 'waiting'
              AND client_user_id IS DISTINCT FROM $4`,
          [tenantId, mine.serviceId, mine.preference, principal.appUserId]);
        waitingForSamePreference = n;
      }

      return { rows, waitingForSamePreference };
    }, { bucket: "app" })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ SIGN-AND-PAY: CREATE STRIPE CHECKOUT SESSION FOR ONE-TIME PAYMENT
  // ═══════════════════════════════════════════════════════════════════════════
  // After a client signs and the document is executed, if payment is required by the underlying
  // item (per getAgreementRequirement), this route creates a Stripe Checkout Session in embedded
  // mode and returns the client secret for the frontend to display the embedded form.
  //
  // ★★ DESIGN: Payment happens AFTER signing, so the document must be executed before checkout
  //    session creation is requested. The route verifies this and returns a clear error if not.
  //    Idempotency is handled by Stripe's own `idempotency_key` parameter (distinct from the
  //    database-level uniqueness constraint on provider_payment_id in the webhook handler).
  post("/api/app/documents/:instanceId/checkout-session", "/api/app/documents", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const instanceId = c.req.param("instanceId");
      if (!instanceId) throw invalid("instanceId is required");

      // ★★★ ADOLESCENT CLIENTS CANNOT ACCESS MONEY ROUTES. Check before any document read.
      if (role === "adolescent_client") {
        throw forbidden("Payments are handled by your parent or guardian.");
      }

      // ★★★ THE SAME PER-PRACTICE KILL SWITCH `money/charge.mjs`'s own direct-charge path enforces
      //     (Task 9.13) — an operator can turn Stripe off for one practice, and this is a second,
      //     newer Stripe money-path in the same codebase; it must honour the identical switch, not
      //     a copy of it. Fails closed: an unknown flag throws (flagIsOn's own rule), never reads as on.
      const stripeEnabled = await flagIsOn(db, "stripe_enabled", principal.user.tenant_id);
      if (!stripeEnabled) {
        throw forbidden(
          "stripe_enabled is off for this practice — a platform operator turned it off. No payment " +
          "can be taken until it is switched back on.");
      }

      // ★ SAMPLE PAYER REFUSAL — the same fact `sendNotificationEmail` already refuses to email
      //   (src/email/send.mjs) applies here for the same reason: a sample subject is not a real
      //   person, so a checkout session in their name is not a real payment intent, however this
      //   route was reached. Read from the subject's own flag, never a caller-supplied one.
      const { rows: [payer] } = await db.query(
        `SELECT is_sample FROM keystone.app_user WHERE id = $1`, [principal.appUserId]);
      if (payer?.is_sample === true) {
        throw invalid("a sample account cannot make a payment.");
      }

      // ★ GET THE DOCUMENT INSTANCE AND VERIFY IT IS EXECUTED.
      const inst = await instanceForCheckout(db, { instanceId });
      if (!inst) throw notFound("no such document in this organisation");
      if (inst.state !== "executed") {
        throw invalid(
          `this document must be executed before payment can be processed. Current state: ${inst.state}`);
      }

      // ★★ VERIFY THE DOCUMENT HAS A FROZEN PRICE (PAYMENT IS REQUIRED).
      // `template_snapshot` holds the frozen price, terms, and disclosure from the moment of execution.
      const snapshot = inst.template_snapshot ? JSON.parse(inst.template_snapshot) : null;
      if (!snapshot || !snapshot.price) {
        throw invalid("this agreement does not require payment or price information is missing");
      }

      const price = snapshot.price;
      if (!price.amount_minor || !price.currency) {
        throw invalid("invalid price information in agreement");
      }

      // ★★ PRICE REFERENCE FOR TRACING AND VERIFICATION. `priceRef` is the stable identifier
      //    of which price/agreement produced the frozen snapshot amount. It is frozen at execution
      //    time and available here for reporting and detecting price changes since charging.
      if (!price.price_id) {
        throw invalid("price_id is missing from the frozen agreement snapshot");
      }

      // ★★★ CREATE THE STRIPE CHECKOUT SESSION (EMBEDDED MODE).
      // The session is created with a deterministic idempotency key so retries do not create
      // duplicate sessions. The key format is "sign-and-pay:{instanceId}".
      //
      // Mode "payment" creates a one-time payment checkout (not a subscription).
      // The client_secret is returned for embedded checkout integration on the frontend.
      // Metadata links this session back to the document instance and payer for the webhook.
      // ★ `priceRef` is the stable reference to which price/agreement was frozen into the snapshot,
      //   so the webhook can verify the payment matches the frozen agreement and reporting can trace
      //   back to the original price definition.
      const idempotencyKey = `sign-and-pay:${instanceId}`;

      // ★★★ ENSURE THE PAYER HAS A STRIPE CUSTOMER ON THE PRACTICE'S ACCOUNT.
      const payerUserId = principal.appUserId;
      const customer = await ensureCustomer(db, {
        tenantId: principal.user.tenant_id,
        personId: payerUserId,
      });

      // ★ BUILD THE FORM DATA FOR CHECKOUT SESSION CREATION.
      const form = {
        "payment_method_types[]": "card",
        "mode": "payment",
        "customer": customer,
        "line_items[0][price_data][currency]": price.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(price.amount_minor),
        "line_items[0][price_data][product_data][name]": snapshot.title ?? "Agreement",
        "line_items[0][quantity]": "1",
        "ui_mode": "embedded",
        "return_url": `https://${c.req.header("host")}/app/documents/${instanceId}/payment-complete`,
        "payment_intent_data[application_fee_amount]": applicationFeeMinor(price.amount_minor),
        ...Object.fromEntries(
          Object.entries(metadataFor("payment_intent", {
            keystone_tenant_id: principal.user.tenant_id,
            keystone_payer_id: payerUserId,
            instanceId,
            keystone_invoice_id: price.price_id,
          })).map(([k, v]) => [`payment_intent_data[metadata][${k}]`, v])
        ),
      };

      // ★★★ F730 — ROUTE NOW USES THE CHOKEPOINT WITH LOCKS. Before, this route called Stripe
      //     directly without checking chargesEnabled, so a practice with charges off still attempted
      //     the payment (and hoped Stripe would refuse). Now stripeConnectedRequest checks the flag
      //     and returns 503 with ChargePathDisabled if off, so the route correctly refuses at the
      //     entry point and Stripe is never called.
      const result = await stripeConnectedRequest(db, {
        tenantId: principal.user.tenant_id,
        method: "POST",
        path: "/checkout/sessions",
        sdk: (s, o, form, query) => s.checkout.sessions.create(form, o),
        form,
        idempotencyKey,
        movesMoney: true,
        purpose: "checkout_sign_and_pay",
        actorUserId: principal.appUserId,
      });

      if (!result.ok || !result.body?.client_secret) {
        throw dependency(
          "Payment checkout is temporarily unavailable. Please try again shortly.");
      }

      return {
        clientSecret: result.body.client_secret,
        sessionId: result.body.id,
        amountMinor: price.amount_minor,
        currency: price.currency,
        priceRef: price.price_id,
        publishableKey: process.env.KEYSTONE_STRIPE_PUBLISHABLE_KEY,
      };
    }, { bucket: "app" })
  );

  // ★ C2.3 — CLIENT PORTAL MONEY ROUTES, registered here (not from src/http/app.mjs) so its route
  //   is tracked by THIS function's `get` and the reconciliation below can see it.
  registerAppPaymentsRoutes(app, { scoped, get, post });
  // ★ C2.6 — CLIENT PORTAL MESSAGES, registered here for the same reason, plus a genuine path
  //   mismatch with the client fixed alongside it — see the note in appMessages.mjs.
  registerAppMessagesRoutes(app, { scoped, get, post, getFor });
  // ★ 18.34 — HOME SURFACE: the client's Home page. Role-specific payloads (adult, parent, teen).
  registerAppHomeRoutes(app, { scoped, get });
  // ◆ 18.40 register

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ THE NAV AND THE ROUTE TABLE ARE RECONCILED HERE, AT STARTUP, IN BOTH DIRECTIONS.
  // ═══════════════════════════════════════════════════════════════════════════
  const declared = new Set(SURFACES.map((s) => s.api));
  const missing = [...declared].filter((p) => !registered.has(p));
  // ★★★ A SURFACE MAY HAVE A DETAIL ROUTE, AND IT IS STILL THAT SURFACE. P9.5 added
  //     `GET /api/app/documents/:id` — the Documents surface OPENED ON ONE ROW — and this check
  //     flagged it as an endpoint nothing draws. It was right to ask and wrong about the answer: a
  //     detail route is not a new surface, it is the same one with an id.
  //   ★★ THE WIDENING IS EXACTLY ONE SEGMENT, AND IT MUST BE A PARAMETER. `/api/app/documents/:id`
  //      belongs to `/api/app/documents`; `/api/app/documents/export` does NOT — that is a new
  //      capability wearing a surface's prefix, and it still fails this check. **The point of the
  //      guard is that an endpoint nobody draws is attack surface nobody reviews, and a `:param`
  //      child of a drawn surface IS drawn — by the surface it belongs to.**
  const detailOf = (p) => {
    const m = /^(.*)\/:[A-Za-z_][A-Za-z0-9_]*$/.exec(p);
    return m && declared.has(m[1]) ? m[1] : null;
  };
  // ★ `/api/app/surfaces` is the nav itself, not a surface read — it is the one legitimate extra.
  //   ★ A path claimed through `getFor` above is also not an orphan — it is checked for real
  //     surface membership below, the same way a write's claimed surface is.
  const orphan = [...registered].filter(
    (p) => !declared.has(p) && p !== "/api/app/surfaces" && !detailOf(p) && !reads.has(p) &&
      !SUPPORT_READS.has(p));

  // ★★★ AND EVERY WRITE IS ATTRIBUTED. Two ways it can be wrong, and both are startup failures:
  //     a write naming a surface that does not exist, and a write whose PATH is not under the
  //     surface it claims — because a route that says it belongs to Documents and answers on
  //     `/api/app/money/transfer` is exactly the endpoint this check exists to find.
  //   ★★ AND THE PATH MAY **BE** THE SURFACE, not only a child of it. [FOUND by this check firing on
  //      P10.2] `POST /api/app/booking` is "make a booking" on the Booking surface — the natural
  //      shape for creating on a collection — and the first version of this rule required
  //      `startsWith(surface + "/")`, so it rejected the tightest possible belonging. Equality is not
  //      a loophole: `/api/app/money/transfer` still fails, because `money` is not a surface.
  // ★ 13.13 — `SUPPORT_WRITES` entries are exempted the same way `SUPPORT_READS` exempts a plain
  //   `get()` from `orphan`: reviewed and named above, not forced into a nesting claim that isn't
  //   true. `surface` is still recorded at the registration site as documentation of which flow the
  //   write serves, but is not required to be a real, path-nested surface for these paths only.
  const strayWrites = [...writes.entries()]
    .filter(([path, surface]) =>
      !SUPPORT_WRITES.has(path) &&
      (!declared.has(surface) || !(path === surface || path.startsWith(`${surface}/`))))
    .map(([path, surface]) => `${path} (claims ${surface})`);
  // ★ SAME CHECK, READ SIDE — a `getFor` support-lookup that claims a surface which either doesn't
  //   exist or that its own path isn't actually under is exactly as unreviewed as a stray write.
  const strayReads = [...reads.entries()]
    .filter(([path, surface]) =>
      !declared.has(surface) || !(path === surface || path.startsWith(`${surface}/`)))
    .map(([path, surface]) => `${path} (claims ${surface})`);
  if (missing.length || orphan.length || strayWrites.length || strayReads.length) {
    throw new Error(
      `the client app's nav and its route table disagree. ` +
      (missing.length
        ? `THESE SURFACES ARE IN THE NAV WITH NO READ ROUTE — a person clicking the tab gets a 404, ` +
          `which reads as a broken account: ${missing.join(", ")}. `
        : "") +
      (orphan.length
        ? `THESE ROUTES ARE SERVED WITH NO SURFACE BEHIND THEM — an endpoint nothing draws is attack ` +
          `surface nobody reviews: ${orphan.join(", ")}. `
        : "") +
      (strayWrites.length
        ? `THESE WRITE ROUTES DO NOT BELONG TO THE SURFACE THEY CLAIM — a write nothing draws is ` +
          `worse than a read nothing draws: ${strayWrites.join(", ")}. `
        : "") +
      (strayReads.length
        ? `THESE SUPPORT READS DO NOT BELONG TO THE SURFACE THEY CLAIM: ${strayReads.join(", ")}. `
        : "") +
      `Fix SURFACES in src/app/surfaces.mjs or this module — they are one declaration, not two.`);
  }
}
