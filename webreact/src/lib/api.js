// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PORTED from webui/src/lib/api.js by specs/react-rebuild/_recon/port-api.mjs — NOT verbatim (R-44):
//   · 21 methods removed whose route does not exist and that nothing called
//   · 3 removed whose route does not exist but a screen called (setMine, uploadMyPhoto,
//     getEmailDomainHealth) — those screens render the control DisabledWithReason
//   · 8 duplicated keys resolved (in the Svelte file the LATER copy silently won): setNotificationRule now
//     reaches POST /api/settings/notifications/rule (the working one); the Growth form creator is
//     createGrowthForm and createFormTemplate is the documents one again
//   · setAutomation → POST /api/tasks/automations/:key (the route that exists)
// db/gates/react_client_routes.mjs (K5) proves every method here names a real route.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P17.2 — THE ONE PLACE THE BROWSER TALKS TO THE SERVER.
//
// ★★★ EVERY REQUEST GOES THROUGH HERE, AND THAT IS A SECURITY PROPERTY, NOT TIDINESS. U16:
// "client-side role gating is NOT a security boundary — the server decides on every request."
// A component that fetched for itself could forget `credentials`, forget to surface a 403, or
// quietly treat a refusal as an empty list — and an empty list looks exactly like "no data".
// ★ So: a 403 and a 404 and a 200-with-zero-rows are THREE DIFFERENT RETURN SHAPES here, never
//   collapsed into one. Collapsing them is the defect P13.7 was rewritten to stop measuring.

// ★ 5F-22 — the four methods that used to send no key (`login`, `markRead`, `signup`, `logout`) mint
//   theirs here. The other ~70 methods still call `crypto.randomUUID()` inline, deliberately untouched.
import { newIdempotencyKey } from "./idempotency.js";
import { networkStatus } from "@/lib/app/networkStatus.js";
// ★ ISLAND-PROGRAMS §2 FE — every Documents method (create/send/sign/execute/variables/disclosure/
//   categories/types/verify/starters/templates, plus the two `/api/settings/documents*` reads) lives in
//   `./documents/api.js`, the island's own file, and is spread back into `api` below so every existing
//   `api.xxx(...)` call site keeps working unchanged. Built with injected `request`/`ApiError` so there
//   is no import cycle between the two files.
import { createDocumentsApi } from "./documents/api.js";

/** Thrown for any non-2xx. Carries the status so a caller can branch on 401 vs 403 vs 404. */
export class ApiError extends Error {
  constructor(status, body, path) {
    // ★ The server's own message, never a re-worded one. errors.mjs:1-9 forbids substring-matching
    //   a vendor message to classify it; inventing our own text here would be the same mistake
    //   from the other end — two descriptions of one failure that can drift apart.
    super(body?.error?.message ?? `${status} on ${path}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.path = path;
    this.kind = body?.error?.kind ?? null;
    this.requestId = body?.error?.requestId ?? null;
  }
}

/**
 * ★ `credentials: "same-origin"` is REQUIRED, not decorative. The session is an HttpOnly cookie
 *   (`ks_session`, set by POST /api/auth/login at auth/install.mjs:77). A fetch without this
 *   sends no cookie, gets a 401, and the screen renders a login form for an already-logged-in
 *   user — which reads as "my session keeps dropping" and is one line of configuration.
 * ★ HttpOnly is the point: install.mjs:82 records that a token in JS "is a value an XSS could
 *   exfiltrate more conveniently than it could a cookie." So the front end never SEES the session
 *   and there is nothing here to store.
 */
// ★★ 6.0b — every mutating verb carries an Idempotency-Key (P15B.13). Most call sites already mint
//    their own (5F-22's four methods, plus ~70 others via inline `crypto.randomUUID()`); this is the
//    fallback for a future method that forgets one, so the guarantee holds even when a call site does
//    not think to make it.
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function request(path, { method = "GET", body, idempotencyKey, extraHeaders } = {}) {
  const headers = { accept: "application/json", ...(extraHeaders ?? {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (MUTATING.has(method)) headers["idempotency-key"] = idempotencyKey ?? crypto.randomUUID();

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // ★ A pre-response network failure (e.g., offline, DNS failure, connection refused) — not an
    //   HTTP error response. Set the degraded flag and re-throw unchanged so all callers' error
    //   handling is completely unaffected.
    networkStatus.degraded = true;
    throw err;
  }

  // ★ 204 has no body and JSON.parse("") throws. A successful delete must not surface as a parse
  //   error — that would be a working operation reported as broken.
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { error: { message: text.slice(0, 500) } }; }
  }

  if (!res.ok) throw new ApiError(res.status, parsed, path);

  // ★ Successful request — clear the degraded flag.
  networkStatus.degraded = false;
  return parsed;
}

export const documentsApi = createDocumentsApi({ request, ApiError });

export const api = {
  // The Documents island's methods (see ./documents/api.js) — spread first so no later key can be shadowed by accident.
  ...documentsApi,

  /** Generic POST request helper: POST `path` with `body`. */
  post: (path, body, idempotencyKey) =>
    request(path, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/nav — sections with children, ALREADY AUTHORISED SERVER-SIDE. */
  nav: () => request("/api/nav"),

  /** D6 [TY, RULED 23 Sep 2026] — `POST /api/me/sidebar-collapsed` → `{sidebarCollapsed}`. */
  setSidebarCollapsed: (collapsed, idempotencyKey) =>
    request("/api/me/sidebar-collapsed", {
      method: "POST", body: { collapsed: Boolean(collapsed) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** D4 [TY, RULED 23 Sep 2026] — `POST /api/me/density` → `{density}`. */
  setDensity: (density, idempotencyKey) =>
    request("/api/me/density", {
      method: "POST", body: { density },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * ★★★ THE RESOLVER, AND IT DELIBERATELY HOLDS NO COPY OF THE ROUTE TABLE.
   * [MEAS] `LIST_VIEWS` has 29 entries (src/records/lists.mjs:64). A `const LIST_PATHS = [...]`
   * here would be a SECOND declaration of which rows have a read path — and P4.10 measured what
   * that costs: the PIR portal held the same seven labels in two disagreeing tables.
   * ★ So the client ASKS. It tries the list endpoint; a 404 means "no list view at this path",
   *   and it falls back to the section endpoint, which answers with a NAMED SectionNotBuilt.
   *   The server stays the only place that knows. One extra round trip on 46 of 75 rows is the
   *   price, and it is the right price.
   */
  async view(path) {
    try {
      return { kind: "list", data: await request(`/api/list${path}`) };
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      // ★ NOT a bare 404. routes/index.mjs:239-258 answers with state:"SectionNotBuilt" and a
      //   reason, because "a bare 404 is indistinguishable from a typo, and that is how a dead
      //   link survives." A 403 from either endpoint propagates — a refusal is not a not-built.
      return { kind: "section", data: await request(`/api/section${path}`) };
    }
  },

  record: (type, id) => request(`/api/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),

  /** POST /api/records/custom-field-value — Set a custom field value. */
  setCustomFieldValue: ({ fieldId, recordId, value }, idempotencyKey) =>
    request("/api/records/custom-field-value", {
      method: "POST", body: { fieldId, recordId, value },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  home: () => request("/api/home"),
  capabilities: () => request("/api/capabilities"),
  /** GET /api/whats-new — Release notes and feature log (17.25). */
  whatsNew: () => request("/api/whats-new"),
  notificationPrefs: () => request("/api/settings/notifications"),
  setMine: ({ displayName, bio }, idempotencyKey) =>
    request("/api/me", {
      method: "POST", body: { displayName, bio },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  uploadMyPhoto: ({ dataBase64 }, idempotencyKey) =>
    request("/api/me/photo", {
      method: "POST", body: { dataBase64 },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  // ★★★ Task 6.2 / 06-settings.md §2.1-§2.2 — `settingsIntegrations` IS BACK, WITH A NEW CALLER.
  //     The orphan note above described `Screen.svelte`'s old `/settings/integrations` interception,
  //     which routed that path to `GET /api/capabilities` instead — that interception is removed as
  //     part of this same task (§2.2: "Screen.svelte:191-192's interception is removed so the path
  //     renders IntegrationsScreen"), so this method now has exactly the one caller its route was
  //     always meant to have. `settingsHome` is new: `GET /api/settings`, SettingsHome's own read.
  settingsHome: () => request("/api/settings"),
  settingsIntegrations: () => request("/api/settings/integrations"),
  // §25.4 — own-domain signing links (Settings → Domains)
  customDomains: () => request("/api/domains"),
  addCustomDomain: ({ hostname }, idempotencyKey) => request("/api/domains", { method: "POST", body: { hostname }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  checkCustomDomain: ({ id }, idempotencyKey) => request("/api/domains/check", { method: "POST", body: { id }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  removeCustomDomain: ({ id }, idempotencyKey) => request("/api/domains/remove", { method: "POST", body: { id }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  // Batch A — the organisation's ONE sending identity (the mail module): Settings → Email → "Use your own domain", and the same panel on Documents settings
  mailIdentity: () => request("/api/email/identity"),
  saveMailIdentity: ({ fields }, idempotencyKey) => request("/api/email/identity", { method: "POST", body: { fields }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  addMailDomain: ({ domain }, idempotencyKey) => request("/api/email/domain", { method: "POST", body: { domain }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  verifyMailDomain: (idempotencyKey) => request("/api/email/domain/verify", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  removeMailDomain: (idempotencyKey) => request("/api/email/domain/remove", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  saveMailSmtpPassword: ({ password }, idempotencyKey) => request("/api/email/smtp-password", { method: "POST", body: { password }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  sendMailTest: ({ to }, idempotencyKey) => request("/api/email/test", { method: "POST", body: { to }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  docustayStatus: () => request("/api/product/docustay/status"),
  activateDocustay: (idempotencyKey) => request("/api/product/docustay/activate", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  docustayCheckout: (idempotencyKey) => request("/api/product/docustay/checkout", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  tenants: () => request("/api/platform/tenants"),
  provisioning: () => request("/api/platform/provisioning"),
  /**
   * GET /api/platform/flags — Task 9.13. Always returns the eight-flag catalog; with a `tenantId`
   * it also returns that ONE practice's overrides, effective on/off per flag and change log
   * (`src/routes/platform.mjs`'s GUC-swap read — 0218 adds no cross-tenant SQL function, so this
   * screen inspects one practice at a time rather than every practice at once).
   */
  platformFlags: (tenantId) =>
    request(tenantId ? `/api/platform/flags?tenantId=${encodeURIComponent(tenantId)}` : "/api/platform/flags"),
  /** POST /api/platform/flags — Task 9.13. Flips one flag for one practice; the server appends the change-log row in the same transaction (`setFlagForPractice`, 9.3). */
  setPlatformFlag: ({ key, tenantId, on, reason = null }, idempotencyKey) =>
    request("/api/platform/flags", {
      method: "POST", body: { key, tenantId, on, reason },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** GET /api/platform/health — Task P6.82. Platform system health: queue depth/backlog, recent failures, backups and restore tests, and platform events (alerts). */
  platformHealth: () => request("/api/platform/health"),

  /**
   * TASK 20.39 — GET /api/platform/tiers/capabilities/:tierId/:capKey/impact — OFF-transition
   * impact counts for confirmation modal. Returns { practiceCount, recentCount, scheduledCount,
   * editedCount } — only figures that can be computed appear (no zeros, no guesses).
   */
  tierCapabilityImpact: (tierId, capKey) =>
    request(`/api/platform/tiers/capabilities/${encodeURIComponent(tierId)}/${encodeURIComponent(capKey)}/impact`),

  // ── PHASE 16 — THE CLIENT APP ────────────────────────────────────────────
  /**
   * ★ GET /api/app/surfaces — WHICH surfaces this person gets, decided by the server on every request
   *   (§K3/U16). Each row carries its own `api` endpoint, so the browser holds no map from surface key
   *   to URL and cannot drift from the route table.
   */
  appSurfaces: () => request("/api/app/surfaces"),

  /**
   * ★★★ READ ONE SURFACE — AT THE URL THE SERVER NAMED, NOT ONE ASSEMBLED HERE.
   *   ★★ The path is checked against the `/api/app/` prefix before it is used. That is not paranoia
   *      about our own server: it is the rule that a URL arriving in a response is DATA, and data that
   *      becomes a request target without a check is how a redirect becomes a request to somewhere else.
   *      A client-app read may only ever hit the client-app namespace.
   */
  appRead: (endpoint) => {
    if (typeof endpoint !== "string" || !/^\/api\/app\/[a-z-]+$/.test(endpoint)) {
      throw new Error(
        `refusing to read "${endpoint}": a client-app surface is served only from /api/app/<name>. ` +
        `The endpoint comes from the server's own surface list — an endpoint of any other shape means ` +
        `the list has been tampered with or the nav has drifted, and neither is worth a request.`);
    }
    return request(endpoint);
  },


  // ── PEOPLE — CREATE AND EDIT ────────────────────────────────────────────
  // ★★★ THE TAPS FOR PLUMBING THAT ALREADY EXISTED. P21's answer to "is the CRM usable" was NO
  //     for one reason: all 44 write routes worked and NO SCREEN CONNECTED A PERSON TO ONE.
  //     These two methods are that connection for People.
  // ★ Every mutating call carries an Idempotency-Key generated HERE, once per submit, so a
  //   double-click or a retry cannot create two people. The server requires it (P15B.13).

  /** POST /api/people/check-duplicate — check for a duplicate before creating. Returns { possible: null } or { possible: { id, display_name, email, mobile_phone, matchedOn } }. */
  checkDuplicatePerson: ({ displayName, email, mobilePhone }) =>
    request("/api/people/check-duplicate", {
      method: "POST",
      body: { displayName, email, mobilePhone },
      idempotencyKey: crypto.randomUUID(),
    }),

  /** POST /api/people — create a person. Returns { id }. */
  // ★★★ A3.1 — `invite` TRAVELS WITH THE CREATE, BECAUSE THE SERVER DOES BOTH IN ONE TRANSACTION.
  //     [TY, RULED] Creating a client, adolescent or parent creates their portal access too. The
  //     alternative is a client record nobody can log in as, with no signal anything is missing.
  //   ★★ IT IS SENT EXPLICITLY, INCLUDING WHEN FALSE. A default applied on the server would mean
  //      the checkbox's OFF state and "an older client that does not know about the field" are the
  //      same request — and one of those must invite nobody while the other must not change.
  // ★ TOUCH-UP · WORKSTREAM 7.2/7.3 — `mobilePhone`/`dateOfBirth`/`source` join the create payload,
  //   all optional (omitted when `undefined`, same "send only what is present" discipline
  //   `updatePerson` already uses below). Server-side: `createPerson` (`src/people/writes.mjs`).
  // ★ D7 [TY, RULED 23 Sep 2026] — `lifecycleStatus` ("Stage") joins the create payload.
  //   `createPerson` (`src/people/writes.mjs:132`) already accepts and validates it.
  // ★ TASK 12.21 — `referredById`/`referredByPartyId` join the create payload, both optional, same
  //   "send only what is present" idiom as every other optional field below. Server-side:
  //   `createPerson` (`src/people/writes.mjs`); columns `app_user.referred_by_id`/`referred_by_party_id`.
  createPerson: ({ email, displayName, role, staffRole, invite = true,
                   mobilePhone, dateOfBirth, source, lifecycleStatus,
                   preferredName, pronouns, homePhone, secondaryEmail, preferredContactMethod,
                   doNotEmail, doNotText, doNotCall, country, addressLine1, addressLine2, city,
                   stateRegion, postcode, timezone, tags, emergencyContactName,
                   emergencyContactRelationship, emergencyContactPhone, sobrietyDate, recoveryProgramme,
                   sponsorName, supportNetwork, notes, referredById, referredByPartyId }, idempotencyKey) =>
    request("/api/people", {
      method: "POST",
      body: {
        email, displayName, role, invite: Boolean(invite),
        ...(staffRole ? { staffRole } : {}),
        ...(mobilePhone !== undefined ? { mobilePhone } : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(lifecycleStatus !== undefined ? { lifecycleStatus } : {}),
        ...(preferredName !== undefined ? { preferredName } : {}),
        ...(pronouns !== undefined ? { pronouns } : {}),
        ...(homePhone !== undefined ? { homePhone } : {}),
        ...(secondaryEmail !== undefined ? { secondaryEmail } : {}),
        ...(preferredContactMethod !== undefined ? { preferredContactMethod } : {}),
        ...(doNotEmail !== undefined ? { doNotEmail } : {}),
        ...(doNotText !== undefined ? { doNotText } : {}),
        ...(doNotCall !== undefined ? { doNotCall } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(addressLine1 !== undefined ? { addressLine1 } : {}),
        ...(addressLine2 !== undefined ? { addressLine2 } : {}),
        ...(city !== undefined ? { city } : {}),
        ...(stateRegion !== undefined ? { stateRegion } : {}),
        ...(postcode !== undefined ? { postcode } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(emergencyContactName !== undefined ? { emergencyContactName } : {}),
        ...(emergencyContactRelationship !== undefined ? { emergencyContactRelationship } : {}),
        ...(emergencyContactPhone !== undefined ? { emergencyContactPhone } : {}),
        ...(sobrietyDate !== undefined ? { sobrietyDate } : {}),
        ...(recoveryProgramme !== undefined ? { recoveryProgramme } : {}),
        ...(sponsorName !== undefined ? { sponsorName } : {}),
        ...(supportNetwork !== undefined ? { supportNetwork } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(referredById !== undefined ? { referredById } : {}),
        ...(referredByPartyId !== undefined ? { referredByPartyId } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/people/update — change a person.
   * ★ Only the fields actually being changed are sent. `updatePerson` builds its SET clause from
   *   what is PRESENT, so sending an unchanged field would still write it and still emit a change
   *   event naming it — an audit trail that records edits nobody made.
   */
  // ★ TOUCH-UP GROUP A, WORKSTREAM 4.5 — `mobilePhone` joins `displayName`/`email` as an inline-edit
  //   field, same "only send what changed" rule (see `updatePerson`'s own comment in
  //   `src/people/writes.mjs`): `undefined` means "not being edited", `null` means "clear it".
  // ★ TASK 12.21 — `referredById` joins the update payload, optional, same "only send what changed"
  //   idiom. Server-side: `updatePerson` (`src/people/writes.mjs`); column `app_user.referred_by_id`.
  updatePerson: ({ personId, displayName, email, mobilePhone, tags, referredById }, idempotencyKey) =>
    request("/api/people/update", {
      method: "POST",
      body: {
        personId,
        ...(displayName !== undefined ? { displayName } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(mobilePhone !== undefined ? { mobilePhone } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(referredById !== undefined ? { referredById } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** TOUCH-UP 4.5 — POST /api/people/assign. `ownerUserId: null` unassigns. */
  assignPerson: ({ personId, ownerUserId = null }, idempotencyKey) =>
    request("/api/people/assign", {
      method: "POST", body: { personId, ownerUserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** TOUCH-UP 4.5 — POST /api/people/lead-next-step. Free text, staff-set. */
  setLeadNextStep: ({ personId, nextStep }, idempotencyKey) =>
    request("/api/people/lead-next-step", {
      method: "POST", body: { personId, nextStep },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** ★ TOUCH-UP ROUND 2 — POST /api/people/consent-status (`setConsentStatus`,
   *  `src/people/writes.mjs`). The server field is `status`; the client name stays
   *  `consentStatus` to match PersonForm's own field name. Adolescent only, enforced server-side. */
  setConsentStatus: ({ personId, consentStatus }, idempotencyKey) =>
    request("/api/people/consent-status", {
      method: "POST", body: { personId, status: consentStatus },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** ★ TOUCH-UP · WORKSTREAM 7.3 — POST /api/people/guardian (`linkGuardian`,
   *  `src/people/guardians.mjs`). ★ the maintainer, 29 Sep 2026: the guardian named must already hold the
   *  `adult_client` role (not a `parent` role — that stopped existing) and the child must be
   *  `adolescent_client` — both enforced server-side, not re-checked here. */
  linkGuardian: ({ childUserId, guardianUserId, relationship = "parent" }, idempotencyKey) =>
    request("/api/people/guardian", {
      method: "POST", body: { childUserId, guardianUserId, relationship },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // MERGE DUPLICATES — Preview, Apply, and Undo. Owner/Admin only.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /** POST /api/people/merge/preview — Returns field-by-field comparison and counts of what moves.
   *  `{ fields: [{field, survivorValue, loserValue, winner, reason}], counts: {...}, survivorName, loserName }` */
  previewMerge: (survivorId, loserId) =>
    request("/api/people/merge/preview", {
      method: "POST",
      body: { survivorId, loserId },
      idempotencyKey: crypto.randomUUID(),
    }),

  /** POST /api/people/merge — Performs the merge. Returns `{ survivorId, loserId }`.
   *  `overrides` is optional `{field: value}` to pick the loser's value for specific fields. */
  applyMerge: (survivorId, loserId, overrides, idempotencyKey) =>
    request("/api/people/merge", {
      method: "POST",
      body: { survivorId, loserId, ...(overrides ? { overrides } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/merge/undo — Reverses a merge within the 30-day undo window.
   *  Returns `{ survivorId, loserId }`. */
  undoMergePeople: (survivorId, loserId, idempotencyKey) =>
    request("/api/people/merge/undo", {
      method: "POST",
      body: { survivorId, loserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // TOUCH-UP GROUP A, WORKSTREAM 4.2 — THE LIST WORKSPACE'S BULK ACTIONS.
  // Each returns `{ changed: N, failed: [{id, reason}] }` (export additionally returns `rows`) —
  // never throws for a per-row failure, only for a malformed call (empty selection, >100 rows).
  // See `src/people/bulk.mjs` for the full reasoning, including why these are Owner/Admin only.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  bulkArchivePeople: (ids, idempotencyKey) =>
    request("/api/people/bulk/archive", {
      method: "POST", body: { ids },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  bulkAssignPeople: (ids, ownerUserId, idempotencyKey) =>
    request("/api/people/bulk/assign", {
      method: "POST", body: { ids, ownerUserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  bulkChangeStagePeople: (ids, status, idempotencyKey) =>
    request("/api/people/bulk/stage", {
      method: "POST", body: { ids, status },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  bulkExportPeople: (ids, idempotencyKey) =>
    request("/api/people/bulk/export", {
      method: "POST", body: { ids },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST the Firebase id token. The server sets the HttpOnly cookie; nothing is returned to JS. */
  // ★★ P5.1 — `tenantSlug` is OPTIONAL and is a NARROWING, not a grant. The server computes the
  //    set of practices this uid belongs to from its OWN table and only then picks from it
  //    (`src/auth/login.mjs`), so a slug naming a practice the identity has no row in resolves to
  //    nothing rather than to access. Omitted on a normal sign-in.
  // ★ 5F-22 — a trailing optional `idempotencyKey`, exactly the shape of the methods around it. The CALLER
  //   owns the per-submit variable (one key per user action, the same key on a retry of it); the
  //   `?? newIdempotencyKey()` fallback only exists so no call can accidentally send nothing.
  login: (idToken, tenantSlug = null, idempotencyKey) =>
    request("/api/auth/login", {
      method: "POST",
      body: tenantSlug ? { idToken, tenantSlug } : { idToken },
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    }),

  /** P5.1 — the practices this SIGNED-IN identity belongs to. Authenticated: answering it for an
   *  anonymous caller would be an oracle about who exists. */
  practices: () => request("/api/auth/practices"),

  /** P5.5 — your own notifications, newest first, with the unread count alongside. */
  notifications: () => request("/api/notifications"),
  /** P5.11 — GLOBAL SEARCH. ★★★ The server filters per object type, per rank and per scope on
   *  EVERY request — this helper sends a string and nothing else. ★ A 403 arrives as an ApiError
   *  and must NEVER be rendered as "no results": zero results, a refusal and a not-found are three
   *  different facts (api.js's own rule, at the top of this file). */
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),

  /** P5.9 — the STAFF-side slot read. ★ It did not exist until P5.9: `generateSlots()` had one
   *  caller and it refused every staff session, so a coach could create a booking and could not
   *  ask when anyone was free. */
  slots: ({ hostId, date, serviceId = null }) => {
    const p = new URLSearchParams({ hostId, date });
    if (serviceId) p.set("serviceId", serviceId);
    return request(`/api/engagements/slots?${p}`);
  },

  /** P5.9 — put a session on the calendar. ★ 201 on success; the screen REFETCHES rather than
   *  patching its own copy, so what it shows is what the server stored. */
  /**
   * ★★★ THE IDEMPOTENCY KEY WAS MISSING HERE AND NOWHERE ELSE. `createPerson`, `updatePerson` and
   *     `signup` all generate one; this route — the one that books a session — did not.
   *   ★★ A double-submit therefore ran the booking TWICE, and the only thing that caught it was the
   *      slot EXCLUDE constraint. So the second attempt surfaced as a `SlotTakenError` 409 telling
   *      the coach the slot is taken **by the booking they had just made** — a correct refusal with
   *      an unusable explanation. This file's own rule: *"EVERY MUTATING VERB CARRIES an
   *      Idempotency-Key … A retry that runs the operation twice is a duplicate charge or a
   *      duplicate document."*
   */
  /**
   * POST /api/people/invite — create a person who cannot sign in yet, and mint+send their invite
   * in the same call. ★ the maintainer, 29 Sep 2026 — this docstring used to say "does NOT send an email:
   * there is no invite table" — that was true before task 8.6/8.10/8.12 built one; it does now
   * (`inviteWithRoleCheck` → `createInvite` → `sendInviteEmail`, real Resend send). `role`/
   * `childUserId` join the payload — TeamInviteDrawer.jsx's staff-only use is unchanged (it never
   * sets either), but the route itself has taken any of the three client roles since 8.6.
   */
  // ★ TASK 12.14 (OQ-12.8) — `message` joins the invite payload, optional ("a line from you"),
  //   same "send only what is present" idiom `createPerson`/`updatePerson` already use below.
  //   Server-side: `inviteWithRoleCheck` (`src/routes/writes.mjs`), ≤500 chars after trim.
  invitePerson: ({ email, displayName, phone, staffRole, role, childUserId, message }, idempotencyKey) =>
    request("/api/people/invite", {
      method: "POST",
      body: {
        email, displayName, staffRole,
        // ★ [TY, RULED 2 Oct 2026] email and phone are both required for every person —
        //   inviteWithRoleCheck (src/routes/writes.mjs) now enforces phone the same way it
        //   already does email; this was silently dropped from the body before (not in this
        //   destructured param list at all), which would have made every real invite 400.
        ...(phone !== undefined ? { phone } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(childUserId !== undefined ? { childUserId } : {}),
        ...(message !== undefined ? { message } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/people/invite — F632 fix (task 8.14b): the SAME route as `invitePerson`, told which
   * PERSON to resend to instead of who to create. The server tells the two apart by body shape
   * (`personId` vs `email`/`displayName`) — `inviteWithRoleCheck`, `src/routes/writes.mjs`.
   * ★ the maintainer, 29 Sep 2026 — also the "first send" for a client's own portal invite (PersonForm.jsx's
   *   tick box, PersonActions.jsx's "Send portal invite"): the server does not distinguish first
   *   send from resend — a person always has at most one open invite. For an adolescent, the
   *   server itself redirects the send to their linked parent (spec: "teens → the invite goes to
   *   their linked parent") — nothing here needs to know that.
   */
  resendInvitePerson: ({ personId }, idempotencyKey) =>
    request("/api/people/invite", {
      method: "POST", body: { personId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/people/portal-link — the maintainer, 29 Sep 2026: the third state of the record-page invite
   * button, for somebody who has already signed in before. No token, no expiry — just a reminder
   * email naming where to sign in. Same guardian-redirect as the invite routes for an adolescent.
   */
  sendPortalLink: ({ personId }, idempotencyKey) =>
    request("/api/people/portal-link", {
      method: "POST", body: { personId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/people/stage — move a person through lead → active → paused → former.
   * ★★★ A3.2 — THIS ROUTE HAD NO CLIENT METHOD AT ALL, so the one write that moves a person along
   *     the pipeline was unreachable from the browser. `setLifecycleStatus` has been live and
   *     callerless.
   * ★★ THE REASON TRAVELS AND IS OPTIONAL. `people.person.stage_changed` carries BOTH ends —
   *    `{from, to, reason}` — because *"they became former" answers less than half of what anybody
   *    asks of this log; "they went from paused to former" is the fact.* The reason is a free note
   *    about a moment, so it is sent only when there is one rather than as an empty string.
   */
  /**
   * GET /api/engagements/attendance-policy — `{ percent, source }`.
   * ★★★ A4.1 — THE NUMBER ON THE NO-SHOW BUTTON. It comes from `resolveNoShowCharge`, the SAME
   *     function `recordAttendance` calls, so the figure a coach reads before pressing and the
   *     figure that part-charges the client cannot disagree. ★ Hardcoding 50 in the component would
   *     show a practice that has set 25% the wrong number and then charge them the right one.
   */
  attendancePolicy: () => request("/api/engagements/attendance-policy"),

  setPersonStage: ({ personId, status, reason }, idempotencyKey) =>
    request("/api/people/stage", {
      method: "POST",
      body: { personId, status, ...(reason ? { reason } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/staff-role — change somebody's rank. Server-side `minRank: "admin"`. */
  setStaffRole: ({ personId, staffRole }, idempotencyKey) =>
    request("/api/people/staff-role", {
      method: "POST", body: { personId, staffRole },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * TASK 1.2 (spec 01 §11) — `POST /api/people/invite/cancel`, the missing wire for
   * `revokeInvite` (`src/auth/invite.mjs:262-283`). TeamList's "Cancel invite" row action.
   */
  cancelInvite: ({ inviteId }, idempotencyKey) =>
    request("/api/people/invite/cancel", {
      method: "POST", body: { inviteId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * TASK 1.2 (spec 01 §2, §3) — GET /api/people/team/two-step-status.
   * `{ twoStepByAppUserId: { [personId]: boolean } }` — TeamList's "Sign-in" column, for the
   * whole roster in one round trip (0251's `confirmed_totp_uids`, read through the new route).
   */
  teamTwoStepStatus: () => request("/api/people/team/two-step-status"),

  /**
   * TASK 1.2 (spec 01 §2) — GET /api/people/team/seats.
   * `{ used, limit, planKey }` — `limit` is `null` for a plan with no seat cap (0334's
   * `seat_limit` is nullable); TeamList's header and TeamInvite's seat-usage banner both read it.
   */
  teamSeats: () => request("/api/people/team/seats"),

  /**
   * TASK 1.2 (spec 01 §2, §3) — the DEDICATED SCREEN's one composed fetch. §3's own words:
   * "TeamList's own bespoke screen" makes a SEPARATE call for each of these four, keyed by what
   * comes back — the roster (`/api/list/people/team`), the pending invites (`/api/list/people/team/invites`,
   * "existing route, unchanged"), the two-step map and the seat usage, above. One `Promise.all` so
   * the screen renders once, not four times as each round trip lands.
   */
  teamRoster: async () => {
    const [roster, invites, twoStep, seats] = await Promise.all([
      request("/api/list/people/team"),
      request("/api/list/people/team/invites"),
      request("/api/people/team/two-step-status"),
      request("/api/people/team/seats"),
    ]);
    return { roster, invites, twoStep, seats };
  },

  /**
   * TASK 1.4 (01-team-and-roles.md §2, CT-112) — TeamSeeAs, same-tenant half.
   * `POST /api/people/team/see-as` → `{viewingAs: {id, displayName, staffRole}, expiresAt}`;
   * 403 not staff / 403 is-the-caller / 409 already previewing.
   */
  teamSeeAs: ({ personId }, idempotencyKey) =>
    request("/api/people/team/see-as", {
      method: "POST", body: { personId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** TASK 1.4 — `POST /api/people/team/see-as/exit` → `{ok: true}`, idempotent (spec §2). */
  teamSeeAsExit: (idempotencyKey) =>
    request("/api/people/team/see-as/exit", {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * TASK 1.5 (01-team-and-roles.md §2) — TeamRemove's page-load read.
   * `GET /api/people/team/:personId/offboard-preview` →
   * `{person, clients: [{id, displayName, openItemCount}], futureSessions: [{id, clientName, startsAt}],
   *   pendingCountersignatures: [{documentId, title, clientName}], hasConnectedCalendar}`.
   */
  offboardPreview: (personId) =>
    request(`/api/people/team/${encodeURIComponent(personId)}/offboard-preview`),

  /**
   * TASK 1.5 — the one write, one transaction.
   * `POST /api/people/team/:personId/offboard`
   * sends `{reassignments: [{clientId, newOwnerUserId}], futureSessions: {mode:"reassign", newHostUserId} | {mode:"cancel_no_charge"}}`
   * → `{ok, reassignedClients, movedSessions, cancelledSessions, sessionsRequiringManualClash}`.
   */
  offboardTeamMember: ({ personId, reassignments, futureSessions }, idempotencyKey) =>
    request(`/api/people/team/${encodeURIComponent(personId)}/offboard`, {
      method: "POST", body: { reassignments, futureSessions },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** the maintainer's brief, 1 Oct 2026 — suspend/reactivate: a reversible pause, not a departure. */
  suspendTeamMember: ({ personId, reason }, idempotencyKey) =>
    request(`/api/people/team/${encodeURIComponent(personId)}/suspend`, {
      method: "POST", body: { reason: reason ?? null },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  reactivateTeamMember: ({ personId, reason }, idempotencyKey) =>
    request(`/api/people/team/${encodeURIComponent(personId)}/reactivate`, {
      method: "POST", body: { reason: reason ?? null },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── ITEMS AND SERVICES — CREATE AND PRICE (P6.31–P6.33 · P7.11–P7.15) ────
  // ★★★ ALL FIVE ARE ADMIN-ONLY ON THE SERVER (routes/writes.mjs:81-87) and that is the boundary.
  //     The screens hide the controls below `admin` so the product stops promising a coach
  //     something that answers 403 — U16: hiding a control is NOT a permission.
  // ★★ PRICE BODIES CARRY `amountMinor`, AN INTEGER COUNT OF MINOR UNITS. src/items/writes.mjs:47
  //    refuses anything else, and web/src/screens/items/money.js is the only thing that produces it.

  /** POST /api/items/services — the service AND its first price row, one transaction. */
  createService: ({ name, durationMinutes, amountMinor, currency, bookable }, idempotencyKey) =>
    request("/api/items/services", {
      method: "POST",
      body: { name, durationMinutes, amountMinor, currency, bookable },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/items/packages — `lines` is [{ serviceId, quantity }] and may not be empty.
   * ★ `validityDays` retired — MOCKUPS §0:35 (C2), migration 0264: packages never expire.
   * ★ `installmentsAllowed` — migration 0268 (B0/CT-110 wave), `package.installments_allowed`.
   */
  createPackage: ({ name, amountMinor, currency, installmentsAllowed, lines }, idempotencyKey) =>
    request("/api/items/packages", {
      method: "POST",
      body: { name, amountMinor, currency, installmentsAllowed, lines },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/items/plans — `interval` is one of week · month · quarter · year.
   * ★★★ M2 (F805) — a plan's sessions live in `plan_line` only. `lines` is
   *   `[{ serviceId, quantityPerCycle }]`; `rolloverMode`/`rolloverCap` are the plan-rollover
   *   extension (TASK 2.5, migration 0267). `rolloverMode` defaults to "none" so every existing
   *   caller keeps working unchanged — `specs/mockups/ItemsPlanNew.frame.html`'s "Sessions included
   *   each month" box.
   */
  createPlan: (
    { name, interval, amountMinor, currency, lines, rolloverMode, rolloverCap },
    idempotencyKey,
  ) =>
    request("/api/items/plans", {
      method: "POST",
      body: {
        name, interval, amountMinor, currency,
        lines: lines ?? [],
        rolloverMode: rolloverMode ?? "none",
        rolloverCap: rolloverCap ?? null,
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/items/active — TASK 2.5 (02-items.md §1 point 3, §2). "Stop selling" sends
   * `active:false`; "Sell again" sends `active:true` — see `src/items/writes.mjs`'s `setItemActive`
   * for why the body names `active` explicitly rather than the route being a same-body toggle.
   */
  setItemActive: ({ itemType, itemId, active }) =>
    request("/api/items/active", { method: "POST", body: { itemType, itemId, active } }),

  /**
   * POST /api/items/prices — ★★★ A NEW PRICE IS A NEW ROW. The open row is CLOSED and a new one
   * inserted, both stamped from the DATABASE's now() so the windows abut exactly. Nothing edits a
   * price that has been used: every instrument already quoted at the old figure computed from that
   * row. `keystone.price_is_append_only` (0024) enforces it below this.
   */
  // ★★ `effectiveFrom` IS OPTIONAL AND IS OMITTED WHEN BLANK, NOT SENT AS NULL-ISH. `createPrice`
  //    branches on it: absent means the DATABASE's `now()` stamps both the closing row's
  //    `effective_to` and the new row's `effective_from`, so the two windows abut EXACTLY. Sending
  //    an empty string would take the other branch and hand `$1::timestamptz` a value Postgres
  //    refuses — a 500 quoting a cast, for a field the person left blank on purpose.
  //  ★ A12-era note: this parameter existed on the server from the start and had no way through the
  //    client at all, which is why the ruled "Effective from" field had nowhere to go.
  createPrice: ({ subjectType, subjectId, amountMinor, currency, effectiveFrom }, idempotencyKey) =>
    request("/api/items/prices", {
      method: "POST",
      body: {
        subjectType, subjectId, amountMinor, currency,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/items/contracted-prices — ★★★ EXACTLY ONE PARTY. Send `appUserId` OR `accountId`,
   * never both and never neither: both is ambiguous, neither is just a price. The caller builds
   * the body from the CHOICE, so there is no path on which both are populated.
   */
  setContractedPrice: ({ subjectType, subjectId, amountMinor, currency, appUserId, accountId }, idempotencyKey) =>
    request("/api/items/contracted-prices", {
      method: "POST",
      body: {
        subjectType, subjectId, amountMinor, currency,
        ...(appUserId ? { appUserId } : {}),
        ...(accountId ? { accountId } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── MONEY — INVOICES, SUBSCRIPTIONS, CREDITS, METHODS (P6.45–P6.47 · P7.39–P7.44) ──
  // ★★★ ALL SIX ARE ADMIN-ONLY ON THE SERVER (routes/writes.mjs:132-138) and that is the boundary.
  // ★★★ THE IDEMPOTENCY KEY IS NOT HYGIENE HERE. This file's own rule — "a retry that runs the
  //     operation twice is a DUPLICATE CHARGE" — is literal in this section: a double-clicked
  //     "Raise invoice" without a key is a second invoice with a second permanent number.
  // ★★ MONEY IS AN INTEGER COUNT OF MINOR UNITS. The server refuses anything else; the only thing
  //    that produces it from what a person typed is `toMinorUnits` (see §3).

  /** POST /api/money/invoices — raise an invoice. The NUMBER and the DUE DATE are server-side. */
  // ★★★ `paymentTermsDays` IS OMITTED unless the operator chose one. `createInvoice` reads
  //     `undefined` as "use the practice's terms" and an explicit `null` as "no deadline". Sending
  //     null for an untouched field strips the due date off every invoice — the P2.6 defect again.
  createInvoice: ({ payerUserId, amountMinor, currency, memo, paymentTermsDays }, idempotencyKey) =>
    request("/api/money/invoices", {
      method: "POST",
      body: {
        payerUserId, amountMinor, currency,
        ...(memo ? { memo } : {}),
        ...(paymentTermsDays === undefined ? {} : { paymentTermsDays }),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/line-items — §Z3.15: exactly one parent, never shared. */
  createLineItem: (body, idempotencyKey) =>
    request("/api/money/line-items", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/start — Stripe is the engine; `contractId` required. */
  startSubscription: ({ planId, appUserId, contractId, priceMinorOverride = null,
                        staffNote = null }, idempotencyKey) =>
    request("/api/money/subscriptions/start", {
      method: "POST",
      body: {
        planId, appUserId, contractId,
        ...(priceMinorOverride !== null ? { priceMinorOverride } : {}),
        ...(staffNote ? { staffNote } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/stop — cancels in Stripe; `when` says now or period_end. */
  stopSubscription: ({ subscriptionId, when = "period_end", reason = null }, idempotencyKey) =>
    request("/api/money/subscriptions/stop", {
      method: "POST",
      body: { subscriptionId, when, ...(reason ? { reason } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/entitlements — grants the entitlement AND its N credit ROWS. */
  createEntitlement: ({ ownerUserId, serviceId, totalCredits, expiresAt }, idempotencyKey) =>
    request("/api/money/entitlements", {
      method: "POST",
      body: { ownerUserId, serviceId, totalCredits, ...(expiresAt ? { expiresAt } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/payment-methods — ★★★ a HANDLE and four digits. Never cardholder data. */
  createPaymentMethod: ({ appUserId, providerPaymentMethodId, brand, lastFour, isDefault },
                        idempotencyKey) =>
    request("/api/money/payment-methods", {
      method: "POST",
      body: {
        appUserId, providerPaymentMethodId,
        ...(brand ? { brand } : {}),
        ...(lastFour ? { lastFour } : {}),
        ...(isDefault ? { isDefault } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions — ★★★ `contractId` is required, for every row. */
  createSubscription: ({ planId, appUserId, contractId, snapshotAmountMinor,
                         paymentMethodId, currentPeriodEnd }, idempotencyKey) =>
    request("/api/money/subscriptions", {
      method: "POST",
      body: {
        planId, appUserId, contractId, snapshotAmountMinor,
        ...(paymentMethodId ? { paymentMethodId } : {}),
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/cancel — ★★ TWO different writes; the caller must say which. */
  cancelSubscription: ({ subscriptionId, atPeriodEnd = false, onDate = null }, idempotencyKey) =>
    request("/api/money/subscriptions/cancel", {
      method: "POST",
      body: { subscriptionId, atPeriodEnd, ...(onDate ? { onDate } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── MONEY — READS (Stage 15 screens) ────────────────────────────────────────────────────────
  // ★★★ List reads for money screens: invoices, estimates, subscriptions, payments, payouts,
  //     disputes, credits, balances, devices (readers), and connect.
  moneyInvoicesSummary: () => request("/api/money/invoices/summary"),
  moneyInvoiceRecord: (id) => request(`/api/money/invoices/${encodeURIComponent(id)}`),
  moneyEstimates: () => request("/api/money/estimates"),
  moneySubscriptions: () => request("/api/money/subscriptions/summary"),
  moneySubscriptionRecord: (id) => request(`/api/money/subscriptions/${encodeURIComponent(id)}`),
  moneyPayments: () => request("/api/money/payments"),
  moneyPaymentRecord: (id) => request(`/api/money/payments/${encodeURIComponent(id)}`),
  moneyCredits: () => request("/api/money/credits"),
  moneyPayouts: () => request("/api/money/payouts"),
  moneyPayoutRecord: (id) => request(`/api/money/payouts/${encodeURIComponent(id)}`),
  moneyDisputes: () => request("/api/money/disputes"),
  moneyDisputeRecord: (id) => request(`/api/money/disputes/${encodeURIComponent(id)}`),
  moneyBalances: () => request("/api/money/balances"),
  /** Statements: Stripe Reporting API report runs (GET list, POST {month, kind}); the CSV downloads from /api/money/statements/:id/download. */
  moneyStatements: () => request("/api/money/statements"),
  requestMoneyStatement: ({ month, kind }) => request("/api/money/statements", { method: "POST", body: { month, kind }, idempotencyKey: crypto.randomUUID() }),
  moneyDevices: () => request("/api/money/devices"),
  moneyConnect: () => request("/api/settings/money/connect"),
  

  // ── invoice editor · 20.68 ──────────────────────────────────────────────────────────────────
  /** GET /api/money/invoices/:id/editor — load invoice editor with rendering templates */
  moneyInvoiceEditor: (id) => request(`/api/money/invoices/${encodeURIComponent(id)}/editor`),

  /** POST /api/money/invoices/update — update invoice draft (title, message, dueAt, footer, rendering, reminders) */
  updateInvoiceDraft: (body, idempotencyKey) =>
    request("/api/money/invoices/update", {
      method: "POST", body,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/invoices/send — send an invoice (create Stripe invoice, email) */
  sendInvoice: ({ invoiceId }, idempotencyKey) =>
    request("/api/money/invoices/send", {
      method: "POST", body: { invoiceId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/invoices/:id/reminders/toggle — enable/disable reminders (soft-delete/restore) */
  toggleInvoiceReminders: ({ invoiceId, enabled }, idempotencyKey) =>
    request("/api/money/invoices/reminders/toggle", {
      method: "POST", body: { invoiceId, enabled },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/invoices/templates — list available rendering templates */
  listInvoiceTemplates: () => request("/api/money/invoices/templates"),

  // ── STRIPE TERMINAL READER ACTIONS · Task 20.70 ──────────────────────────────────────────────
  /** POST /api/money/terminal/process — process a payment on a reader (takes money) */
  processPaymentIntent: ({ tenantId, readerId, paymentIntentId, amountMinor }, idempotencyKey) =>
    request("/api/money/terminal/process", {
      method: "POST",
      body: { tenantId, readerId, paymentIntentId, ...(amountMinor ? { amountMinor } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/refund — refund a charge taken on a reader (takes money) */
  refundPayment: ({ tenantId, chargeId, amountMinor, reason }, idempotencyKey) =>
    request("/api/money/terminal/refund", {
      method: "POST",
      body: { tenantId, chargeId, ...(amountMinor ? { amountMinor } : {}), ...(reason ? { reason } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/cancel — cancel a pending reader action */
  cancelAction: ({ tenantId, readerId }, idempotencyKey) =>
    request("/api/money/terminal/cancel", {
      method: "POST",
      body: { tenantId, readerId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/display — set the reader's display */
  setReaderDisplay: ({ tenantId, readerId, displayType, displayText }, idempotencyKey) =>
    request("/api/money/terminal/display", {
      method: "POST",
      body: { tenantId, readerId, ...(displayType ? { displayType } : {}), ...(displayText ? { displayText } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── platform · provisioning (P6.79) ──────────────────────────────────────────────────────────
  // ★★★ THE FIRST CLIENT PATH TO `executeStep`/`reconcileRunState`, which had zero callers for the
  //     whole build. Both routes are `super_admin_1` AND platform-tenant on the server
  //     (`routes/writes.mjs`); the screen only stops the product promising what it cannot do.

  /**
   * POST /api/platform/provisioning/advance — attempt every actionable step of one run.
   * ★★ THE RESPONSE IS A LIST OF REASONS, NOT A BOOLEAN. Most steps come back `attempted:false`
   *    with a sentence naming what blocks them; a caller that reduced this to ok/not-ok would throw
   *    away the only part an operator can act on.
   */
  // ★ S2 TASK 3 — `completeProvisioningHandoff` is deleted with `documenso_team` (01 default 9:
  //   Documenso retired). It posted to `/api/platform/provisioning/handoff`, which no longer exists
  //   server-side — that route existed for exactly one purpose, recording a hand-made Documenso
  //   team, and there is no other human-only provisioning step to close.
  advanceProvisioningRun: ({ runId }, idempotencyKey) =>
    request("/api/platform/provisioning/advance", {
      method: "POST", body: { runId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ STAGE 4 TASK 10 — THE TWO THINGS A PERSON MAY DO TO A GIVE-UP ON PLATFORM JOBS (07 §4
  //     rule 8, MOCKUPS §20). Before these, an unacknowledged give-up could be READ on that screen
  //     and never acted on — the same shape of defect as the provisioning run above.
  // ★★★ `repeatCount` AND `lastSeenAt` ARE NOT OPTIONAL AND ARE NOT DECORATION. They are the
  //     VERSION of the row the person had on screen, sent back so the server can refuse a write
  //     against a row that moved in the meantime (progress.md M-3): a give-up can repeat between
  //     the load and the click, and the reason typed for the smaller problem must not silently
  //     close the bigger one. The list supplies both columns for exactly this.
  // ★ These are TENANT routes, not `/api/platform/*`, because a give-up is acknowledged BY a named
  //   person and the platform console namespace carries none. See `src/routes/writes.mjs`.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  retryJobNow: ({ failureId, repeatCount, lastSeenAt }, idempotencyKey) =>
    request("/api/jobs/retry", {
      method: "POST", body: { failureId, repeatCount, lastSeenAt },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  giveUpJobFailure: ({ failureId, reason, repeatCount, lastSeenAt }, idempotencyKey) =>
    request("/api/jobs/give-up", {
      method: "POST", body: { failureId, reason, repeatCount, lastSeenAt },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── engagements — SESSIONS, ATTENDANCE, AVAILABILITY, POLICY (P6.25–P6.29 · P7.22–P7.28) ─────
  // ★★★ ADOPTED FROM `web/src/screens/engagements/engagementWrites.js`, WHICH IS NOW DELETED. It was
  //     a deliberate, documented, temporary second copy of `request()` — written because this file
  //     was held open by three other batches. The three properties it preserved travel with the move
  //     and are this module's own: `credentials: "same-origin"`, ONE shared `ApiError`, and an
  //     `Idempotency-Key` on every mutating verb.

  // ★★★ `book()` WAS HERE AND IS DELETED. It posted to `/api/engagements/bookings` — THE SAME ROUTE
  //     AS `createBooking` BELOW — so adopting the engagements wrapper wholesale would have left
  //     TWO client methods for one write. [MEASURED] `createBooking` has a caller
  //     (`shell/BookSessionDialog.jsx:84`); `book` had NONE, not even inside the wrapper it came
  //     from, whose own screens call `addParticipant`, `recordAttendance` and the availability
  //     writes but never it. ★★ `DUPLICATE-TRUTH`, and the dangerous half is always the one nobody
  //     runs: it drifts silently and the next caller picks the stale one. The `p7_every_write_is_
  //     reachable` gate named it as an orphan the moment it landed, which is what the gate is for.

  /**
   * P6.25 — add a participant.
   * ★★★ `party` HAS NO DEFAULT AND THE CALLER MUST NOT INVENT ONE. The server refuses a body
   *     without it, in those words, because the recorded live defect is a tech client rendered
   *     under a recovery-side badge on an executed instrument: name the party you mean, never
   *     borrow another's. Passing it through untouched is the whole point.
   */
  addParticipant: ({ bookingId, party, displayName, appUserId, email }, idempotencyKey) =>
    request("/api/engagements/participants", {
      method: "POST", body: { bookingId, party, displayName, appUserId, email },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * P6.26 — record attendance for a WHOLE booking, which is what emits `booking.booking.completed`.
   * ★ `outcome` is the discriminator the route branches on; a body without it is the older
   *   single-participant shape and does NOT close the session.
   */
  recordAttendance: ({ bookingId, outcome, participants }, idempotencyKey) =>
    request("/api/engagements/attendance", {
      method: "POST", body: { bookingId, outcome, participants },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * ★ BOOKING OVERHAUL, 29 Sep 2026 — what the Held/No-show confirmation modal shows before a click
   *   charges anything: the amount, whether a package credit already covers it or could cover it.
   *   Computed by the SAME function `settleBooking` itself uses for the real amount (previewSettlement,
   *   src/booking/settleBooking.mjs) — the number shown and the number charged cannot drift.
   */
  settlePreview: ({ bookingId, outcome }) =>
    request(`/api/engagements/settle-preview?bookingId=${encodeURIComponent(bookingId)}&outcome=${encodeURIComponent(outcome)}`),

  /**
   * ★ BOOKING OVERHAUL, 29 Sep 2026 — records attendance exactly as `recordAttendance` above, then
   *   (only when no package credit already covers it) charges the card on file, sends an invoice, or
   *   spends a credit found at settle time, per the staff member's confirmed `paymentMethod`.
   *   `paymentMethod`: "card" | "invoice" | "credit" | "none".
   */
  settleBooking: ({ bookingId, outcome, participants, paymentMethod }, idempotencyKey) =>
    request("/api/engagements/attendance/settle", {
      method: "POST", body: { bookingId, outcome, participants, paymentMethod },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/engagements/date-overrides — one day, for one host, that differs from the weekly rule.
   * ★★★ A4.2 — `upsertDateOverride` HAD NO CLIENT METHOD. A practice could set a weekly pattern and
   *     had no way to say "closed on the 24th" — the single most ordinary exception there is.
   * ★★ `isAvailable` IS A BOOLEAN AND THE SERVER REFUSES ANYTHING ELSE: *"an override with no
   *    direction says nothing."* It is sent explicitly, never inferred from whether times were
   *    given — a closed day and a shortened day are different facts.
   * ★ `startMinute`/`endMinute` are LOCAL wall-clock minutes after midnight, the same units the
   *   weekly rules use. A second unit here would be a second chance to be an hour out.
   */
  setDateOverride: ({ hostId, onDate, isAvailable, startMinute, endMinute, reason }, idempotencyKey) =>
    request("/api/engagements/date-overrides", {
      method: "POST",
      body: {
        hostId, onDate, isAvailable,
        ...(startMinute !== undefined ? { startMinute } : {}),
        ...(endMinute !== undefined ? { endMinute } : {}),
        ...(reason ? { reason } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/engagements/booking-policy — the rules for booking ONE service. Admin-only server-side.
   * ★★★ `serviceId` IS MANDATORY and the server now says so by name — a body without it used to
   *     reach Postgres as a NOT NULL violation and surface as a **500** a caller might retry.
   * ★★ ONLY WHAT WAS SUPPLIED IS SENT. `setBookingPolicy` leaves unmentioned columns ALONE on
   *    update, so omitting a field means "do not change it" — and sending `undefined` as `null`
   *    would silently reset a policy value the person never touched.
   */
  setBookingPolicy: (
    { serviceId, bufferBeforeMinutes, bufferAfterMinutes, minimumNoticeMinutes,
      bookingWindowDays, cancellationNoticeMinutes }, idempotencyKey,
  ) =>
    request("/api/engagements/booking-policy", {
      method: "POST",
      body: {
        serviceId,
        ...(bufferBeforeMinutes !== undefined ? { bufferBeforeMinutes } : {}),
        ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
        ...(minimumNoticeMinutes !== undefined ? { minimumNoticeMinutes } : {}),
        ...(bookingWindowDays !== undefined ? { bookingWindowDays } : {}),
        ...(cancellationNoticeMinutes !== undefined ? { cancellationNoticeMinutes } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** P6.28 — a weekly availability rule. Minutes are LOCAL wall-clock minutes after midnight. */
  addAvailability: ({ hostId, dayOfWeek, startMinute, endMinute, effectiveFrom }, idempotencyKey) =>
    request("/api/engagements/availability", {
      method: "POST", body: { hostId, dayOfWeek, startMinute, endMinute, effectiveFrom },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** P6.28 — END a rule rather than deleting it: a deleted rule makes past bookings inexplicable. */
  endAvailability: ({ ruleId, onDate }, idempotencyKey) =>
    request("/api/engagements/availability/end", {
      method: "POST", body: { ruleId, onDate },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** P6.28 — a single-date override: a closure, or different hours for one day. */
  setOverride: ({ hostId, onDate, isAvailable, startMinute, endMinute, reason }, idempotencyKey) =>
    request("/api/engagements/date-overrides", {
      method: "POST",
      body: {
        hostId, onDate, isAvailable,
        // ★ An UNAVAILABLE override is refused if it carries minutes — the server says so
        //   explicitly — so this sends `null` rather than whatever was last typed into a
        //   disabled field.
        startMinute: isAvailable ? startMinute : null,
        endMinute: isAvailable ? endMinute : null,
        reason: reason || null,
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** P6.29 — the booking policy for one service. `admin` or higher; the server decides. */
  setPolicy: ({ serviceId, ...p }, idempotencyKey) =>
    request("/api/engagements/booking-policy", {
      method: "POST", body: { serviceId, ...p },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── SETTINGS — READS (P6.60–P6.76) ──────────────────────────────────────
  // ★★ EIGHT ROWS WHOSE RESPONSE IS A FORM, NOT A LIST: the server describes the fields, their
  //    labels, their help text and their vocabularies, so no screen holds a copy of SETTING_KEYS.
  practiceSettings:    () => request("/api/settings/practice"),
  brandingSettings:    () => request("/api/settings/branding"),
  moneySettings:       () => request("/api/settings/money"),
  terminologySettings: () => request("/api/settings/terminology"),
  clientAppSettings:   () => request("/api/settings/client-app"),
  // ★ PART 4.6 [TY, RULED 23 Sep 2026] — the ONE shape control (crm/run/both).
  shapeSettings:       () => request("/api/settings/practice/shape"),
  billingSettings:     () => request("/api/settings/billing"),
  sandboxSettings:     () => request("/api/settings/developer/sandbox"),
  roleSettings:        () => request("/api/settings/roles"),
  /** GET /api/settings/roles/presets — TeamRoles's own dedicated read path (Task 1.3); same
   *  shape as `roleSettings` above (server-side `loadRolesView`, one shared function, two routes). */
  teamRolesSettings:   () => request("/api/settings/roles/presets"),

  // ── SETTINGS — BILLING / PLANS (Task 6.5, spec 06 §2.7, the A11 rebuild) ───────────────
  /** GET /api/settings/plans — the 5-row plan table (MOCKUPS §16:481-486). */
  plansSettings: () => request("/api/settings/plans"),

  /** POST /api/settings/billing/portal-session — a Stripe-hosted Billing Portal session URL. */
  billingPortalSession: (idempotencyKey) =>
    request("/api/settings/billing/portal-session", {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/billing/close — { confirmPracticeName } → { closed: true }. Owner only. */
  closeBilling: ({ confirmPracticeName }, idempotencyKey) =>
    request("/api/settings/billing/close", {
      method: "POST", body: { confirmPracticeName },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/plans/checkout-session — { planKey, interval } → Stripe Checkout URL. */
  planCheckoutSession: ({ planKey, interval }, idempotencyKey) =>
    request("/api/settings/plans/checkout-session", {
      method: "POST", body: { planKey, interval },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── SETTINGS — SetImport + SetData (Task 6.4, spec 06 §2.5/§2.6) ───────────────────────
  /** GET /api/settings/import — the field-mapping vocabulary and the row hard limit. */
  importSettings: () => request("/api/settings/import"),

  /** POST /api/settings/import — { filename, dataBase64 } → { importRunId, columns, sampleRows }. */
  startImport: ({ filename, dataBase64 }, idempotencyKey) =>
    request("/api/settings/import", {
      method: "POST", body: { filename, dataBase64 },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/import/:id/mapping — { mapping, duplicatePolicy, marketingConsentConfirmed, sourceKey }.
   *  ★ `sourceKey` added 25 Sep 2026: Stage 12 task 12.16 gave the route an optional `sourceKey` and
   *    tags mappings with `__source`, and 12.31's screen sends it — but this wrapper destructured it
   *    away, so it never reached the server and the whole preset feature was inert over the wire.
   *    12.31's builder measured that and reported it rather than editing another task's file. */
  setImportMapping: (importRunId, { mapping, duplicatePolicy, marketingConsentConfirmed, sourceKey },
                     idempotencyKey) =>
    request(`/api/settings/import/${importRunId}/mapping`, {
      method: "POST", body: { mapping, duplicatePolicy, marketingConsentConfirmed, sourceKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/import/:id/check — a dry run, nothing written. */
  checkImport: (importRunId, idempotencyKey) =>
    request(`/api/settings/import/${importRunId}/check`, {
      method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/import/:id/run — creates the imported records. */
  runImport: (importRunId, idempotencyKey) =>
    request(`/api/settings/import/${importRunId}/run`, {
      method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/settings/import/:id — the progress poll. */
  importStatus: (importRunId) => request(`/api/settings/import/${importRunId}`),

  /** POST /api/settings/import/:id/undo — reverses a completed import. */
  undoImport: (importRunId, idempotencyKey) =>
    request(`/api/settings/import/${importRunId}/undo`, {
      method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/settings/data — SetData's own screen load: exports list + a 3-row audit preview. */
  dataSettings: () => request("/api/settings/data"),

  /** POST /api/settings/data/export — { scope, personId? } → { exportId, status }. Owner only. */
  requestDataExport: ({ scope, personId }, idempotencyKey) =>
    request("/api/settings/data/export", {
      method: "POST", body: { scope, personId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/settings/data/exports — the export list, polled while one is processing. */
  dataExports: () => request("/api/settings/data/exports"),

  /**
   * GET /api/tasks/automations — A11.2 / F428.
   * ★★★ Returns `{settings, platform}` and **they are not the same fact**: `settings` is what this
   * practice chose, `platform` is n8n's own `active` flag which no practice controls. ★ `platform:
   * null` means the automation service could not be reached — NOT that everything is off.
   */
  automations: () => request("/api/tasks/automations"),

  /** GET /api/settings/email — A11.2 / F428. `{mailbox, routing}`; `mailbox: null` = none connected. */
  emailSettings: () => request("/api/settings/email"),

  /** GET /api/settings/email/health — Task 17.23 (CT-F43). Health of the practice's sending domain and mailbox. */
  emailHealth: () => request("/api/settings/email/health"),

  /**
   * POST /api/settings/email/routing — A11.2 / **F427**.
   * ★★★ THIS METHOD DID NOT EXIST AND `EmailSettingsPage.svelte:82` CALLED IT ANYWAY, so choosing
   * an address for a purpose threw `api.setSenderRouting is not a function`. One route per purpose
   * (UNIQUE on tenant+purpose), so the server upserts — and `auth` is refused by name, because a
   * sign-in link is a credential that must never leave a tenant-controlled mailbox.
   */
  setSenderRouting: ({ purpose, email }, idempotencyKey) =>
    request("/api/settings/email/routing", {
      method: "POST", body: { purpose, email },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── Task 6.6 (06-settings.md §2.8) — the mailbox OAuth round trip. `GET …/connect/start` is a
  //    302 redirect to Google's consent screen, same non-fetch reasoning as calendar connect below
  //    — `EmailSettingsPage.svelte` renders it as a plain `<a href>`, never a `request()` call.
  /** POST /api/settings/email/disconnect {} → {disconnected:true}. Idempotent (§2.8's own table). */
  disconnectMailbox: (_args, idempotencyKey) =>
    request("/api/settings/email/disconnect", {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── EMAIL TEMPLATE OPERATIONS — preview, list, and test-send.
  /** GET /api/settings/email/templates — {templates:[{key, subject, text, requiredVars}]}. */
  listEmailTemplates: () =>
    request("/api/settings/email/templates"),

  /** POST /api/settings/email/templates/:key/preview — render with sample data, send nothing. */
  previewEmailTemplate: (key, idempotencyKey) =>
    request(`/api/settings/email/templates/${encodeURIComponent(key)}/preview`, {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/email/templates/:key/test-send — send to caller's email address. */
  testSendEmail: (key, idempotencyKey) =>
    request(`/api/settings/email/templates/${encodeURIComponent(key)}/test-send`, {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── Task 3a.2 (03a-calendar-and-sync.md §2) — `/settings/calendar` (CalendarSettings). The two
  //    Connect links are NOT fetch-driven — `GET .../connect/google|microsoft` is a 302 redirect
  //    to the provider's consent screen, so `CalendarSettingsScreen.svelte` renders them as plain
  //    `<a href>` full-page navigations, never a `request()` call (see that file's own note).
  /** GET /api/engagements/calendar/connections — `{connections: […], subscribeLink}`. */
  calendarSettings: () => request("/api/engagements/calendar/connections"),
  /** POST …/watched-calendars — {connectionId, watched:[{externalCalendarId, countsAsBusy}]}. */
  setCalendarWatchedCalendars: ({ connectionId, watched }, idempotencyKey) =>
    request("/api/engagements/calendar/watched-calendars", {
      method: "POST", body: { connectionId, watched },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** POST …/refresh-calendars — fetch the connected accounts' calendar lists again. */
  refreshCalendarLists: (idempotencyKey) =>
    request("/api/engagements/calendar/refresh-calendars", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  /** POST …/push-target — {connectionId, pushCalendarId}. */
  setCalendarPushTarget: ({ connectionId, pushCalendarId }, idempotencyKey) =>
    request("/api/engagements/calendar/push-target", {
      method: "POST", body: { connectionId, pushCalendarId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** POST …/event-title-mode — {connectionId, mode: "session_only"|"client_first_name"}. */
  setCalendarEventTitleMode: ({ connectionId, mode }, idempotencyKey) =>
    request("/api/engagements/calendar/event-title-mode", {
      method: "POST", body: { connectionId, mode },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** POST …/disconnect — {connectionId} → {disconnected:true}. */
  disconnectCalendarConnection: ({ connectionId }, idempotencyKey) =>
    request("/api/engagements/calendar/disconnect", {
      method: "POST", body: { connectionId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── Task 3a.6 (03a-calendar-and-sync.md §2, F686) — the remote-changes conflict queue, read by
  //    `CalendarSettingsScreen.svelte`'s own list section (self-fetched, same `onMount` reasoning as
  //    `TwoStepPanel.svelte`'s `loadStatus` — the screen's single `view` loader maps one path to one
  //    call, `src/lib/app/Screen.svelte`, out of this task's own file list).
  /** GET …/remote-changes → `[{bookingId, externalEventId, provider, proposedStartsAt, proposedEndsAt, flaggedAt}]`. */
  calendarRemoteChanges: () => request("/api/engagements/calendar/remote-changes"),
  /** POST …/remote-changes/accept — {bookingId, externalEventId}. The outside calendar's time wins. */
  acceptCalendarRemoteChange: ({ bookingId, externalEventId }, idempotencyKey) =>
    request("/api/engagements/calendar/remote-changes/accept", {
      method: "POST", body: { bookingId, externalEventId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** POST …/remote-changes/reject — {bookingId, externalEventId} → {accepted:false}. the platform's time wins. */
  rejectCalendarRemoteChange: ({ bookingId, externalEventId }, idempotencyKey) =>
    request("/api/engagements/calendar/remote-changes/reject", {
      method: "POST", body: { bookingId, externalEventId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── Task 3b.7 (03b-booking-and-engagements.md §2.3) — `/settings/booking-link` (EngMyLink), a
  //    coach's own persistent booking link. Not nav-gated (`src/routes/bookingLinks.mjs`'s header).
  /** GET /api/engagements/my-link — `{slug, url, acceptingNewBookings, taggedLinks:[{tag,bookingsCount}]}`. */
  /** POST /api/engagements/my-link — {slug?, acceptingNewBookings?} → {slug, url, acceptingNewBookings, taggedLinks}. */
  updateMyLink: ({ slug, acceptingNewBookings }, idempotencyKey) =>
    request("/api/engagements/my-link", {
      method: "POST", body: { slug, acceptingNewBookings },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── THE DEVELOPER READS. Live since P19.11 and api.js has never had a method for either.
  apiKeys:  () => request("/api/developer/api-keys"),
  auditLog: () => request("/api/developer/audit-log"),
  /** GET /api/settings/developer — F688, the `/settings/developer` landing row's own read. */
  developerSettings: () => request("/api/settings/developer"),

  // ── 8.19 — "WHERE AM I SIGNED IN." `/account/security` (SecurityScreen.svelte), reachable by
  //    EVERY role from the avatar menu — distinct from 6.13's staff-only `/settings/sign-in` above,
  //    which reads a different, earlier session-list route. This reads 8.14's `GET
  //    /api/auth/sessions`. The two revoke posts go straight through the exported `request()`
  //    helper from inside SecurityScreen.svelte, not a named method here — this is the only line
  //    8.19 adds to this file.
  accountSecurity: () => request("/api/auth/sessions"),

  // ── 6.13 — SIGN-IN AND DEVICES. Both POSTs pass their OWN Idempotency-Key, literally, in the
  //    argument text — the gate at db/gates/p21c_idempotency_all_routes.mjs:279-295 reads SOURCE
  //    TEXT, not runtime behaviour, so request()'s own fallback (6.0b) is invisible to it.

  // ── SETTINGS — WRITES ───────────────────────────────────────────────────
  /**
   * POST /api/settings — set ONE tenant setting. ★★★ This is the tap `setSetting()` never had:
   * ten catalogued keys, ten validators, and until P6.B12 not one of them settable from the
   * product. ★ The SERVER validates; sending a second validator from here would be a second
   * answer to "is this a setting", and the browser's copy is the one that drifts.
   */
  /** ★ TY, 2026-09-16 — is this acronym free? / change it. */
  checkSlug: (slug) => request(`/api/settings/practice/slug-available?slug=${encodeURIComponent(slug)}`),
  setSlug: ({ slug }, idempotencyKey) =>
    request("/api/settings/practice/slug", {
      method: "POST", body: { slug }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** ★ PART 4.6, 23 Sep 2026 — set the practice's shape (crm/run/both). */
  setShape: ({ shape }, idempotencyKey) =>
    request("/api/settings/practice/shape", {
      method: "POST", body: { shape }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  /** ★ TY, 2026-09-16 — upload a logo. `kind` is "sidebar" or "login"; the image is base64. */
  uploadLogo: ({ kind, dataBase64 }, idempotencyKey) =>
    request("/api/settings/branding/logo", {
      method: "POST", body: { kind, dataBase64 },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  setSetting: ({ key, value }, idempotencyKey) =>
    request("/api/settings", {
      method: "POST", body: { key, value },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** ★★★ Task 11.23 (CT-F44) — batch save: POST /api/settings with changes array. Atomic — all land or none do. */
  setSettings: ({ changes, confirm }, idempotencyKey) =>
    request("/api/settings", {
      method: "POST", body: { changes, confirm },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── TASK 17.32 — NEW API METHODS FOR CLIENT REGISTRATION AND SETTINGS
  /** GET /api/settings/usage — read the current usage for a tenant. */
  settingsUsage: () => request("/api/settings/usage"),

  /** GET /api/settings/mine — read the current user's own settings. */
  settingsMine: () => request("/api/settings/mine"),

  /** GET /api/settings/fields-required — read required fields configuration. */
  requiredFields: () => request("/api/settings/fields-required"),

  

  

  

  /** GET /api/home/prompts — read prompts for home screen with optional filter. */
  promptFeed: ({ filter } = {}) =>
    request(`/api/home/prompts${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`),

  

  

  /** POST /api/settings/terminology/lint — check terminology overrides for layout risks. */
  lintTerminology: ({ overrides }, idempotencyKey) =>
    request("/api/settings/terminology/lint", {
      method: "POST", body: { overrides },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/roles/permission — change one grant. Scope is required, never inferred. */
  setRolePermission: ({ roleId, object, verb, scope }, idempotencyKey) =>
    request("/api/settings/roles/permission", {
      method: "POST", body: { roleId, object, verb, scope },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/roles/action — grant or revoke one named action for a role. */
  setRoleAction: ({ roleId, action, granted }, idempotencyKey) =>
    request("/api/settings/roles/action", {
      method: "POST", body: { roleId, action, granted },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/roles/reset — TeamRolesAdvanced's "Reset to presets" button. */
  resetRoleToPreset: ({ roleId }, idempotencyKey) =>
    request("/api/settings/roles/reset", {
      method: "POST", body: { roleId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/roles/create — a new custom role, starting from a built-in's grants. */
  createCustomRole: ({ label, basedOn }, idempotencyKey) =>
    request("/api/settings/roles/create", {
      method: "POST", body: { label, basedOn },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/developer/api-keys — mint a key. ★★★ The response carries `key` and it is the ONLY
   * place it will ever exist: there is no route that can produce it again (P19.4). Do not log it,
   * do not store it, do not put it in an idempotency record.
   */
  createApiKey: ({ name, scopes, environment, class: cls }, idempotencyKey) =>
    request("/api/developer/api-keys", {
      method: "POST",
      body: { name, scopes, environment: environment ?? "test", class: cls ?? "secret" },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/developer/api-keys/:id/revoke — idempotent by predicate; a replay returns changed:false. */
  revokeApiKey: (id, idempotencyKey) =>
    request(`/api/developer/api-keys/${encodeURIComponent(id)}/revoke`, {
      method: "POST", body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── ★★★ OUTBOUND WEBHOOK ENDPOINTS (A12.1) ───────────────────────────────────────────────────
  // ★★★ THESE TWO METHODS ARE THE ENTIRE GAP. `POST /api/developer/webhook-endpoints` has existed
  //     since P8.5 — admin-guarded, validating topics against `ALL_TOPICS`, minting a `whsec_…`,
  //     returning it once, storing a fingerprint, emitting an audit event — and it had **ZERO
  //     references in `web/src` and ZERO in `webui/src`. No client of either generation had ever
  //     called it.** The screen at `/settings/developer/webhooks` LISTS endpoints and its empty
  //     state says "Add endpoint" over a `?new=1` href that opens nothing (F401): the screen tells
  //     you to do the one thing the product cannot do.
  //
  // ★★★ AND THE PIPELINE BEHIND IT IS ALREADY FINISHED. The drain's webhook fan-out is UNIVERSAL —
  //     `hasSubscribers → addJob("deliver_webhooks")` runs for every topic, handled or not,
  //     including `booking.booking.completed`. So n8n owning any of the 79 handler-less topics
  //     requires NO pipeline work at all: only a `webhook_endpoint` row that nothing could create.
  //     **These two methods are that.**
  webhookEndpoints: () => request("/api/developer/webhook-endpoints"),
  webhookDeliveries: (endpointId) => request(`/api/developer/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries`),
  replayWebhookDelivery: ({ deliveryId }) => request("/api/developer/webhook-deliveries/replay", { method: "POST", body: { deliveryId }, idempotencyKey: crypto.randomUUID() }),

  /**
   * POST /api/developer/webhook-endpoints — register a subscriber.
   * ★★★ THE RESPONSE CARRIES `secret` AND `shown_once: true`, AND IT IS THE ONLY PLACE THE SECRET
   *     WILL EVER EXIST. The row stores a sealed envelope and a FINGERPRINT; there is no route in
   *     this product that can return the plaintext again. The same law as the API key above: do not
   *     log it, do not store it, do not put it in an idempotency record.
   * ★★ `event_types` is snake_case because that is what the ROUTE reads (`body?.event_types`).
   *    Renaming it here to match the camelCase of the neighbours would send a field the server
   *    ignores, and the endpoint would be created subscribed to NOTHING — configured-looking and
   *    silent, which is the exact failure this surface exists to end.
   */
  createWebhookEndpoint: ({ url, name, eventTypes }, idempotencyKey) =>
    request("/api/developer/webhook-endpoints", {
      method: "POST",
      body: { url, name, event_types: eventTypes },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── ARCHIVE AND RESTORE (P2.9 · P7 cross-cutting) ────────────────────────────────────────────
  // ★★★ THESE BELONG TO NO SECTION, AND THAT IS WHY THEY WERE LAST. Nine object types are
  //     archivable (`src/records/archive.mjs` ARCHIVABLE), so the control lives on the RECORD PAGE —
  //     the one surface all nine share — rather than being built nine times in nine sections.
  // ★★ BOTH ARE `minRank: "admin"` ON THE SERVER (`routes/writes.mjs:162-163`). The screen hides
  //    them below that so the product stops promising a coach something that answers 403; the
  //    server refuses regardless.

  /**
   * POST /api/records/archive — ARCHIVE, NEVER DELETE, AND WITH A REASON.
   * ★★★ `reason` IS THE POINT OF P2.9, not a nicety: archiving is a DECISION, and a row that cannot
   *     say why it was taken out of circulation is indistinguishable from data loss six months on.
   *     It travels into the emitted event's payload, not onto the record — one archiving is one
   *     decision, and putting it on the row invites a second reason overwriting the first.
   * ★★ Archiving a PERSON also ends their live sessions; that is the server's job and is not
   *    something this tap can or should reproduce.
   */
  archiveRecord: ({ object, id, reason }, idempotencyKey) =>
    request("/api/records/archive", {
      method: "POST", body: { object, id, ...(reason ? { reason } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/records/delete — THE SHARED DELETE (migration 0581, src/records/delete.mjs). `confirm:false` returns the
   *  PLAN (what else goes, what blocks it) and changes nothing; `confirm:true` deletes. Owner/Admin only. */
  deleteRecord: ({ object, id, confirm = false, reason, options }, idempotencyKey) =>
    request("/api/records/delete", {
      method: "POST", body: { object, id, confirm, ...(reason ? { reason } : {}), ...(options ? { options } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/records/bulk — §13.3: Delete / Archive / Restore many records of ONE type in one request; each id is independent and the
   *  result lists successes AND refusals ({changed, failed:[{id,reason}]}). Delete with confirm:false returns the aggregated PLAN. */
  bulkRecords: ({ action, object, ids, confirm = false, reason, options }, idempotencyKey) =>
    request("/api/records/bulk", {
      method: "POST", body: { action, object, ids, confirm, ...(reason ? { reason } : {}), ...(options ? { options } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/records/restore — put it back. ★ The server refuses if the row is not archived, so a
   *  double-press cannot invent a restore that did not happen. */
  restoreRecord: ({ object, id }, idempotencyKey) =>
    request("/api/records/restore", {
      method: "POST", body: { object, id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/records/custom-field-value — set a custom field value on a record. */
  updateCustomFieldValue: ({ fieldId, recordId, value }, idempotencyKey) =>
    request("/api/records/custom-field-value", {
      method: "POST", body: { fieldId, recordId, value },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── ATTACHMENTS — LIST, CREATE, DELETE ────────────────────────────────────
  /** GET /api/people/:id/attachments — list files attached to a person record. */
  listAttachments: (personId) =>
    request(`/api/people/${encodeURIComponent(personId)}/attachments`),

  /** POST /api/people/:id/attachments — upload a file to a person record.
   *  Body: {filename, fileData (base64), contentType (optional)}.
   *  Returns {id, filename, contentType, sizeBytes, uploadedBy, createdAt}. */
  uploadAttachment: (personId, { filename, fileData, contentType }, idempotencyKey) =>
    request(`/api/people/${encodeURIComponent(personId)}/attachments`, {
      method: "POST",
      body: { filename, fileData, ...(contentType ? { contentType } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/:id/attachments/:attachmentId/delete — soft-delete an attachment. */
  deleteAttachment: (personId, attachmentId, idempotencyKey) =>
    request(`/api/people/${encodeURIComponent(personId)}/attachments/${encodeURIComponent(attachmentId)}/delete`, {
      method: "POST",
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── ACCOUNTS — CREATE, CHANGE, AND THE THREE PIPELINES (P7.8–P7.11) ──────
  // ★★★ NONE OF THESE FOUR ROUTES CARRIES A `minRank` (routes/writes.mjs:72-75), so the floor is
  //     /accounts' own `minRole: 'staff'` (nav/sections.mjs:40) — **a coach may write accounts.**
  //     [EXECUTED 2026-09-15] a coach principal's POST /api/accounts answered 2xx. Do not copy the
  //     items section's `admin` floor onto this family; it would hide the feature from every coach.
  // ★★ `customerTenantId` is the GLT case where the customer is itself a Keystone tenant. It is
  //    nullable, stays null for an ordinary account, and makes the two tenants related in NO RLS
  //    sense — it is a reference for a human (src/accounts/writes.mjs:28-31).

  /** POST /api/accounts — create an account. Accepts all 28 account fields. */
  createAccount: ({
    name,
    status,
    customerTenantId,
    accountNumber,
    parentAccountId,
    accountType,
    industry,
    primaryContactId,
    phone,
    email,
    website,
    billingLine1,
    billingLine2,
    billingCity,
    billingStateRegion,
    billingPostcode,
    billingCountry,
    employeeCount,
    description,
    source,
    tags,
    ownerUserId,
  }, idempotencyKey) =>
    request("/api/accounts", {
      method: "POST",
      body: {
        name,
        ...(status !== undefined ? { status } : {}),
        ...(customerTenantId ? { customerTenantId } : {}),
        ...(accountNumber !== undefined ? { accountNumber } : {}),
        ...(parentAccountId !== undefined ? { parentAccountId } : {}),
        ...(accountType !== undefined ? { accountType } : {}),
        ...(industry !== undefined ? { industry } : {}),
        ...(primaryContactId !== undefined ? { primaryContactId } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(website !== undefined ? { website } : {}),
        ...(billingLine1 !== undefined ? { billingLine1 } : {}),
        ...(billingLine2 !== undefined ? { billingLine2 } : {}),
        ...(billingCity !== undefined ? { billingCity } : {}),
        ...(billingStateRegion !== undefined ? { billingStateRegion } : {}),
        ...(billingPostcode !== undefined ? { billingPostcode } : {}),
        ...(billingCountry !== undefined ? { billingCountry } : {}),
        ...(employeeCount !== undefined ? { employeeCount } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/accounts/update — change an account's name and/or status.
   * ★ Only the fields actually being changed are sent. `updateAccount` builds its SET clause from
   *   what is PRESENT and emits `accounts.account.updated` with `payload.fields` naming what moved,
   *   so sending an unchanged field would record a status change nobody made.
   */
  updateAccount: ({ accountId, name, status }, idempotencyKey) =>
    request("/api/accounts/update", {
      method: "POST",
      body: {
        accountId,
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/accounts/pipeline — start one of the three pipelines.
   * ★★★ §A3: BUILD / PROVISION / RUN must not collapse into one, and `pipeline_shape`
   *     (0006_accounts_and_network.sql:77-81) makes the illegal shapes UNREPRESENTABLE — a build
   *     with a cadence and a run with a stage cannot be stored at all. So the forbidden field is
   *     OMITTED from the body rather than sent as null: a body naming `cadence` on a build is a
   *     caller asserting a shape the constraint forbids.
   */
  createAccountPipeline: ({ accountId, kind, stage, cadence, state }, idempotencyKey) =>
    request("/api/accounts/pipeline", {
      method: "POST",
      body: {
        accountId, kind,
        ...(stage !== undefined ? { stage } : {}),
        ...(cadence !== undefined ? { cadence } : {}),
        ...(state !== undefined ? { state } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/accounts/pipeline/advance — move a BUILD pipeline to its next stage.
   * ★ Build only, and the server's predicate says so (`kind = 'build' AND state = 'active'` in the
   *   WHERE clause, src/accounts/writes.mjs:173-178). A run pipeline has no stage to advance and
   *   comes back 404 with one message for four conditions — that refusal is the most informative
   *   text in the feature and must reach the screen unaltered.
   */
  advanceAccountStage: ({ pipelineId, stage }, idempotencyKey) =>
    request("/api/accounts/pipeline/advance", {
      method: "POST",
      body: { pipelineId, stage },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/accounts/run/pause — HOLD an account's run schedule.
   *
   * ★★★ ADDED AT THE P10 CLOSE, AND THE REASON IS THE DEFECT IT CLOSES. P8.9 built
   *     `pauseScheduleItems`/`resumeScheduleItems` as the FIRST AND ONLY writers of
   *     `run_schedule_item.state = 'paused'` — before them the value appeared twice in the source
   *     and nothing could ever set it. Then the run shipped with **no tap for either**, so the only
   *     way in was still shut. `db/gates/p7_accounts_writes.mjs` caught it by comparing the tap
   *     registry against the router in both directions.
   *   ★★ That is the ORPHAN class one step along: not "built and wired to nothing" but "wired to a
   *      route no person can reach", which reads as finished from either end on its own.
   *
   * ★★ A PAUSE IS NOT A NOT-DELIVERABLE, and the server keeps them apart on purpose: not-deliverable
   *    means *we cannot*, paused means *we chose not to*. Neither this method nor the control says
   *    otherwise, and `rearmBlockedItems` deliberately cannot un-pause.
   *
   * ★ `accountId` and `service` are both optional ON THE SERVER — absent means "every matching item
   *   in this tenant". They are passed through as given rather than defaulted here, because a client
   *   inventing a narrower scope than the caller asked for is a lie in the safer direction and still
   *   a lie. The control above is what decides that a person must choose an account.
   */
  pauseAccountRun: ({ accountId = null, service = null } = {}, idempotencyKey) =>
    request("/api/accounts/run/pause", {
      method: "POST",
      body: { accountId, service },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/accounts/run/resume — release a hold.
   * ★★★ IT RESUMES ONLY WHAT WAS PAUSED. `state = 'paused'` is in the server's WHERE clause, so this
   *     can never become a general "turn everything back on" that also re-arms the not-deliverable
   *     items whose reason nobody has addressed. ★ Resumed items go to `pending` and are due NOW —
   *     an operator who has just switched something back on cannot otherwise tell "waiting for the
   *     next slot" from "still broken".
   */
  resumeAccountRun: ({ accountId = null, service = null } = {}, idempotencyKey) =>
    request("/api/accounts/run/resume", {
      method: "POST",
      body: { accountId, service },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  

  /**
   * POST /api/network — record an organisation this practice works with. ★ `kind` is REQUIRED and
   * has no default: `createNetworkParty` in `src/network/writes.mjs` refuses a missing one rather
   * than storing "I do not know what this is" as a claim that it is nothing in particular.
   *
   * ★★★ WIDENED 25 Sep 2026 — THIS WRAPPER WAS DROPPING THREE FIELDS ON THE FLOOR. It forwarded
   *     `{name, kind}` only, while the server's `createNetworkParty` has accepted `whatTheyDo`,
   *     `email`, `primaryContactId` and `city` since migrations 0081/0082, validates two of them,
   *     and INSERTs all four. The "Add a practice" sheet collects them and every one was discarded
   *     here, one layer above the route — the person filled the field, saw it save, and the value
   *     never left the browser. Found by the task that built the sheet, from the other end of the
   *     wire. ★★ This is CLAUDE.md failure #1 (BUILT AND WIRED TO NOTHING) in its quietest form:
   *     both ends existed and worked; the join between them silently narrowed.
   *
   * ★ Optional fields are spread conditionally so an omitted one stays omitted rather than being
   *   sent as an explicit `null` — the server already defaults each to null, and a caller that
   *   never asked about `city` must not be able to assert the party has none.
   */
  createNetworkParty: ({ name, kind, whatTheyDo, email, primaryContactId, city }, idempotencyKey) =>
    request("/api/network", {
      method: "POST",
      body: {
        name, kind,
        ...(whatTheyDo !== undefined ? { whatTheyDo } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(primaryContactId !== undefined ? { primaryContactId } : {}),
        ...(city !== undefined ? { city } : {}),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * POST /api/network/update — ★★ SEND ONLY THE FIELDS THAT CHANGED. The server emits
   * `network.party.updated` with `payload.fields` listing what moved, and a body carrying every
   * field puts a name change nobody made into the audit trail. `NetworkPartyForm` already diffs.
   */
  updateNetworkParty: ({ partyId, name, kind }, idempotencyKey) =>
    request("/api/network/update", {
      method: "POST",
      body: { partyId, ...(name !== undefined ? { name } : {}), ...(kind !== undefined ? { kind } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * GET /api/list/network — fetch the list of network parties for the NetworkListScreen.
   */
  networkParties: () =>
    request("/api/list/network"),

  /**
   * GET /api/notifications/my-preferences — fetch the caller's own explicit personal overrides
   * from the notification_preference table. Returns only ROWS that exist (tier 1 of the
   * three-tier fallback); the UI handles displaying "using practice default" when no row exists.
   */
  getNotificationPreferences: () =>
    request("/api/notifications/my-preferences"),

  /**
   * POST /api/notifications/preferences — upsert ONE person-topic-channel preference.
   * ★★★ `enabled:false` WRITES A ROW; it does not delete one. "I turned this off" and "I have
   * never been asked" are different facts and the delivery path reads them differently
   * (`src/notifications/writes.mjs:88-94`). The response carries `{ id, enabled, replaced }` and
   * the screen renders `enabled` FROM IT, never the value the click intended.
   */
  setNotificationPreference: ({ appUserId, topic, channel, enabled }, idempotencyKey) =>
    request("/api/notifications/preferences", {
      method: "POST", body: { appUserId, topic, channel, enabled },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * TASK 6.3 — `POST /api/settings/notifications/rule`. Sets ONE cell of the practice's OWN default
   * channel matrix (topic × role × channel), never a single person's own preference — that is
   * `setNotificationPreference` above, a different route, a different table.
   * ★★★ Admin-only server-side (06-settings.md §2.3); refuses `forbidden` for any `alwaysOn` topic
   *     — the four rows the screen renders as static "Always on" text, never this control.
   */
  setNotificationRule: ({ topic, role, channel, enabled }, idempotencyKey) =>
    request("/api/settings/notifications/rule", {
      method: "POST", body: { topic, role, channel, enabled },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  createBooking: (body, idempotencyKey) =>
    request("/api/engagements/bookings", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Task 3b.3 (CT-117) — THE PUBLIC BOOKING DOOR. Unauthenticated, tenant resolved server-side
  // from the Host header alone (`src/routes/public.mjs`) — nothing here sends a tenant id or a
  // practice slug as an authorisation input; `credentials: "same-origin"` (this file's own
  // `request()`) carries no session either, because there is none on this door.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  /** GET /api/public/book/practice — `EngPublicPractice`'s data. */
  publicBookPractice: () => request("/api/public/book/practice"),
  /** GET /api/public/book/coach?coachSlug= — `EngPublicCoach`'s data. */
  publicBookCoach: (coachSlug) => request(`/api/public/book/coach?coachSlug=${encodeURIComponent(coachSlug)}`),
  /** POST /api/public/book — the booking-form submit. */
  publicBookSubmit: (body, idempotencyKey) =>
    request("/api/public/book", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    }),

  /** P5.7 — how to reach a human. ★ NEVER permission-gated: every signed-in person gets an answer,
   *  and an absent number is reported as `configured:false` rather than as an empty menu. */
  help: () => request("/api/help"),

  /** P5.5 — just the badge number. The query the partial index was built for. */
  unreadCount: () => request("/api/notifications/unread-count"),
  /** P5.5 — mark one read. ★ Idempotent BY PREDICATE (`read_at IS NULL`): a second call returns
   *  `{changed:false}`, which is an honest answer and not an error. */
  // ★ 5F-22 — was keyless, and the server requires a key on this route (src/http/app.mjs `requireIdempotencyKey`
  //   for every mutating verb under runTenantScoped): every "mark read" answered 400.
  markRead: (id, idempotencyKey) =>
    request("/api/notifications/read", {
      method: "POST",
      // ★ K12 (27 Sep): the handler reads `notificationId` (markNotificationRead) — `{ id }` marked nothing, ever.
      body: { notificationId: id },
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    }),

  /** Mark all unread notifications read for the caller. */
  markAllRead: (idempotencyKey) =>
    request("/api/notifications/read-all", {
      method: "POST",
      body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** Send a test notification for the given topic (respects caller's preferences). */
  sendTestNotification: ({ topic }, idempotencyKey) =>
    request("/api/notifications/test", {
      method: "POST",
      body: { topic },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /**
   * P17.9 — create an organisation and its first staff user. ★ The EMAIL is not sent: the server
   * takes it from the verified token, because identity is not the caller's to state.
   * ★★ The bootstrap token travels as a HEADER, not in the body. A secret in a JSON body is a
   *    secret in every request log that records bodies; a header is at least conventionally
   *    redactable — and it keeps the body a description of the ORGANISATION only.
   */
  // ★ 5F-22 — the key was minted afresh on EVERY call, so a retry of one submit ran the operation twice.
  //   The caller now passes the key it holds for this submit; the fallback is only for a caller that has none.
  signup: ({ idToken, tenant, admin, bootstrap }, idempotencyKey) =>
    request("/api/signup", {
      method: "POST",
      body: { idToken, tenant, admin },
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      extraHeaders: bootstrap ? { "x-keystone-bootstrap": bootstrap } : undefined,
    }),
  logout: (idempotencyKey) =>
    request("/api/auth/logout", { method: "POST", idempotencyKey: idempotencyKey ?? newIdempotencyKey() }),

  /** GET /api/signup/find?q= — search for a business by name using Google Places. */
  findBusinesses: ({ q }) =>
    request(`/api/signup/find?q=${encodeURIComponent(q)}`),

  /**
   * ★ TELEMETRY — screen views and flow steps, for evidence-based analysis.
   * FIRE-AND-FORGET: failures are logged but never thrown, so telemetry never interrupts user work.
   */
  recordTelemetry: (kind, path, detail = null) => {
    request("/api/telemetry", {
      method: "POST",
      body: { kind, path, ...(detail ? { detail } : {}) },
    }).catch((err) => {
      if (import.meta.env?.DEBUG_TELEMETRY) console.error("[telemetry]", err.message);
      // Never throw — telemetry is optional, not essential.
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // STAGE 12 — PEOPLE, ACCOUNTS, NETWORK (task 12.19). Every browser call Stage 12's screens
  // make, so no screen task edits this file. ★ CT-F51 `WRITE_STATUS = 201`: only a route
  // registered in `src/routes/writes.mjs`'s `ROUTES` table answers 201 on success — that is
  // `dismissMergePair` below, and nothing else in this block. Every other route here (locations,
  // scheduling, payer groups, network, goals, tasks, prompts, see-as-summary) is guarded and
  // answered directly by its own file with `c.json(r)`, which defaults to 200 — MEASURED against
  // `src/routes/locations.mjs`, `scheduling.mjs`, `payerGroups.mjs`, `network.mjs`,
  // `peopleRecord.mjs`, `prompts.mjs` and `tasks.mjs`'s own header comments, each stating so
  // explicitly. `request()` itself never branches on the exact 2xx code, so this only matters to
  // a caller or a test that asserts one.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  // ── LOCATIONS (12.2, CT-F22) ─────────────────────────────────────────────────────────────────
  /** GET /api/locations — staff with access to the /people section. `{ locations }`. */
  locations: () => request("/api/locations"),

  /** POST /api/locations — Owner/Admin only (`setting` object, edit). `body` is sent as-is —
   *  `{name, timezone, address_line1?, address_line2?, city?, state_region?, postcode?, country?}`,
   *  matching `createLocation`'s own snake_case field names (`src/settings/locations.mjs`). */
  createLocation: (body, idempotencyKey) =>
    request("/api/locations", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── SCHEDULING (12.3, CT-F23) ────────────────────────────────────────────────────────────────
  // ★ Every route here answers 403 `unknown_path` until 12.35 adds the `/people/scheduling` nav
  //   row — described in `src/routes/scheduling.mjs`'s own header, not a defect here.
  /** GET /api/people/scheduling?week=YYYY-MM-DD — the week read. */
  schedule: (weekStart) =>
    request(`/api/people/scheduling?week=${encodeURIComponent(weekStart)}`),

  /** POST /api/people/scheduling/shifts — create. `body` is sent as-is —
   *  `{appUserId, onDate, startMinute, endMinute, locationId?, videoOnly?, label?}`. */
  createShift: (body, idempotencyKey) =>
    request("/api/people/scheduling/shifts", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/shifts/:id — update. Every field in `body` optional. */
  updateShift: (id, body, idempotencyKey) =>
    request(`/api/people/scheduling/shifts/${encodeURIComponent(id)}`, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/shifts/:id/delete */
  deleteShift: (id, idempotencyKey) =>
    request(`/api/people/scheduling/shifts/${encodeURIComponent(id)}/delete`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/copy-last-week {weekStart} */
  copyLastWeek: (weekStart, idempotencyKey) =>
    request("/api/people/scheduling/copy-last-week", {
      method: "POST", body: { weekStart }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/time-off — add. `body` is sent as-is —
   *  `{appUserId, startsOn, endsOn, reason?}`. */
  addTimeOff: (body, idempotencyKey) =>
    request("/api/people/scheduling/time-off", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/time-off/:id/delete */
  removeTimeOff: (id, idempotencyKey) =>
    request(`/api/people/scheduling/time-off/${encodeURIComponent(id)}/delete`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── PAYER GROUPS / ACCOUNTS (12.5, CT-F27) ───────────────────────────────────────────────────
  /** GET /api/staff/payer-groups — `{ groups }`. */
  payerGroups: () => request("/api/staff/payer-groups"),

  /** GET /api/staff/payer-groups/:id — `readPayerGroup`'s `history[].method` is deliberately
   *  `null`; this method surfaces it unchanged, never substituting a plausible value. */
  payerGroup: (id) => request(`/api/staff/payer-groups/${encodeURIComponent(id)}`),

  /** POST /api/staff/payer-groups — `body` sent as-is — `{name, kind, contactUserId?,
   *  billingNote?, memberPersonIds?}`. */
  createPayerGroup: (body, idempotencyKey) =>
    request("/api/staff/payer-groups", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/staff/payer-groups/:id — `body` sent as-is — `{name?, kind?, contactUserId?,
   *  billingNote?}`. */
  updatePayerGroup: (id, body, idempotencyKey) =>
    request(`/api/staff/payer-groups/${encodeURIComponent(id)}`, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/staff/payer-groups/:id/archive */
  archivePayerGroup: (id, idempotencyKey) =>
    request(`/api/staff/payer-groups/${encodeURIComponent(id)}/archive`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/staff/payer-groups/:id/members — `{person_id}`, matching `addMember`'s own
   *  snake_case body shape (`src/routes/payerGroups.mjs`). */
  addPayerGroupMember: (id, { person_id }, idempotencyKey) =>
    request(`/api/staff/payer-groups/${encodeURIComponent(id)}/members`, {
      method: "POST", body: { person_id }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/staff/payer-groups/:id/members/move — `{personId}`, moves that person INTO group `id`. */
  movePayerGroupMember: (id, { personId }, idempotencyKey) =>
    request(`/api/staff/payer-groups/${encodeURIComponent(id)}/members/move`, {
      method: "POST", body: { personId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** DELETE /api/staff/payer-groups/:id/members/:memberId */
  removePayerGroupMember: (id, memberId, idempotencyKey) =>
    request(`/api/staff/payer-groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
      method: "DELETE", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── NETWORK (12.6/12.7, CT-F24) ──────────────────────────────────────────────────────────────
  /** GET /api/network/parties/:id — a partner record. */
  networkPartner: (id) => request(`/api/network/parties/${encodeURIComponent(id)}`),

  /** POST /api/network/referrals — refer a client out. `body` sent as-is — `{personId, partyId,
   *  reason, copyPerson?, toldPerson?}`. Any other key (e.g. `notes`) is refused server-side. */
  referOut: (body, idempotencyKey) =>
    request("/api/network/referrals", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/network/referrals/inbound — record an inbound referral. `body` sent as-is —
   *  `{personId, partyId, reason}`. */
  recordInboundReferral: (body, idempotencyKey) =>
    request("/api/network/referrals/inbound", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/network/referrals/:id/outcome — `body` sent as-is — `{outcome, note?}`, matching
   *  `setReferralOutcome`'s own field names (`src/routes/network.mjs`). */
  setReferralOutcome: (id, body, idempotencyKey) =>
    request(`/api/network/referrals/${encodeURIComponent(id)}/outcome`, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── GOALS (12.10) ─────────────────────────────────────────────────────────────────────────────
  /** GET /api/people/:personId/goals — `{ rightNow, parked, done }`. */
  personGoals: (personId) => request(`/api/people/${encodeURIComponent(personId)}/goals`),

  /** POST /api/people/:personId/goals — `body` sent as-is — `{title, detail?}` → `{id}`. */
  createGoal: (personId, body, idempotencyKey) =>
    request(`/api/people/${encodeURIComponent(personId)}/goals`, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/goals/:goalId — `body` sent as-is — `{title?, detail?, state?}`. */
  updateGoal: (goalId, body, idempotencyKey) =>
    request(`/api/people/goals/${encodeURIComponent(goalId)}`, {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── MERGE — DISMISS (12.12) ──────────────────────────────────────────────────────────────────
  /** POST /api/people/merge/dismiss — a `src/routes/writes.mjs` `ROUTES` row, so CT-F51 applies:
   *  this ONE answers 201, unlike every other route in this Stage-12 block. */
  dismissMergePair: ({ personAId, personBId }, idempotencyKey) =>
    request("/api/people/merge/dismiss", {
      method: "POST", body: { personAId, personBId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── TEAM SEE-AS SUMMARY (12.29) ──────────────────────────────────────────────────────────────
  /** GET /api/people/team/:personId/see-as-summary — `{ person, can, cannot }`, fetched BEFORE
   *  entering see-as, with the real identity. */
  seeAsSummary: (personId) =>
    request(`/api/people/team/${encodeURIComponent(personId)}/see-as-summary`),

  // ── TASKS (P20.3) ─────────────────────────────────────────────────────────────────────────────
  /** POST /api/tasks — create a manual task. `body` sent as-is — `{topic, subjectType, subjectId,
   *  title, assigneeId?, dueAt?}` → `{id}`. Not a `ROUTES` row (`status: 200` explicitly at
   *  `src/routes/tasks.mjs`) — 200, not 201. */
  createTask: (body, idempotencyKey) =>
    request("/api/tasks", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── PROMPTS (CT-F01, surfaced for Stage 12's four surfaces) ─────────────────────────────────
  /** GET /api/prompts?surface=&personId= — `surface` is one of the eleven frozen CT-F01 members;
   *  Stage 12 uses `team`, `scheduling`, `network`, `person`. `personId` is optional. */
  prompts: (surface, personId) =>
    request(`/api/prompts?surface=${encodeURIComponent(surface)}` +
      (personId !== undefined && personId !== null ? `&personId=${encodeURIComponent(personId)}` : "")),

  /** POST /api/prompts/dismiss — { kind, subjectId } → 201. Route built by Stage 11 task 11.5.
   *  ★★ ADDED 25 Sep 2026, and it closes a real hole. Migration 0369 creates the dismissal table,
   *  11.2 catalogues `people.prompt.dismissed`, 11.4's engine filters on it and 11.5 serves the
   *  route — and NOTHING in the client called it. 12.30's builder found the consequence from the
   *  other end: PromptCard's dismiss was local to the mount, so a prompt a person dismissed came
   *  straight back on reload. A whole feature, migration included, wired to nothing.
   *  ★ `kind` is the UNDERSCORED form (`team_invite_stale`, not `team.invite_stale`) — the CHECK at
   *  `0369:15` forbids a dot, whatever CT-F01's prose table spells. */
  dismissPrompt: (kind, subjectId, idempotencyKey) =>
    request("/api/prompts/dismiss", {
      method: "POST", body: { kind, subjectId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── STAGE 16 — tasks, automations, growth, reports ──────────────────────
  taskList: (view) => request(`/api/list/tasks/${view}`),
  snoozeTask: (body, idempotencyKey) =>
    request("/api/tasks/snooze", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  completeTask: ({ taskId }, idempotencyKey) =>
    request("/api/tasks/complete", {
      method: "POST", body: { taskId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  reassignTask: ({ taskId, assigneeId }, idempotencyKey) =>
    request("/api/tasks/reassign", {
      method: "POST", body: { taskId, assigneeId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  setLeadStage: ({ personId, stage }, idempotencyKey) =>
    request("/api/people/lead-stage", {
      method: "POST", body: { personId, stage }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  leadBoard: () => request("/api/people/lead-board"),
  automation: (key) => request(`/api/tasks/automations/${encodeURIComponent(key)}`),
  saveAutomation: (key, { enabled, config }, idempotencyKey) =>
    request(`/api/tasks/automations/${encodeURIComponent(key)}`, {
      method: "POST", body: { enabled, config }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  segments: () => request("/api/list/growth/lists"),
  createSegment: (body, idempotencyKey) =>
    request("/api/growth/segments", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  campaigns: () => request("/api/list/growth/campaigns"),
  campaign: (id) => request(`/api/growth/campaigns/${id}`),
  saveCampaign: (body, idempotencyKey) =>
    request("/api/growth/campaigns", {
      method: "POST", body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  sendCampaign: ({ campaignId }, idempotencyKey) =>
    request("/api/growth/campaigns/send", {
      method: "POST", body: { campaignId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  scheduleCampaign: ({ campaignId, sendAt }, idempotencyKey) =>
    request("/api/growth/campaigns/schedule", {
      method: "POST", body: { campaignId, sendAt }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  testCampaign: ({ campaignId }, idempotencyKey) =>
    request("/api/growth/campaigns/test", {
      method: "POST", body: { campaignId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  campaignAudience: ({ segmentId, leaveOutSegmentId }) =>
    request(`/api/growth/audience?segmentId=${segmentId}&leaveOutSegmentId=${leaveOutSegmentId ?? ''}`),
  report: (name, { from, to, compareFrom, compareTo }) =>
    request(`/api/reports/${name}?from=${from}&to=${to}&compareFrom=${compareFrom}&compareTo=${compareTo}`),
  reportReceipt: (month) =>
    request(`/api/reports/receipt?month=${month}`),
  reportsHub: () => request("/api/reports/hub"),
  getEmailDomainHealth: () => request("/api/growth/email-domain-health"),
  reportExportUrl: (name, q) =>
    `/api/reports/${name}/export.csv?${new URLSearchParams(q).toString()}`,
  gtm: () => request("/api/run/gtm"),

  platformOverview: () => request("/api/platform/overview"),
  platformPractices: ({ view = "all", q = "" } = {}) => request(`/api/platform/practices?view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`),
  platformPractice: (tenantId) => request(`/api/platform/practices/${encodeURIComponent(tenantId)}`),
  askForAccess: ({ tenantId, why, durationMinutes }, idempotencyKey) => request(`/api/platform/practices/${encodeURIComponent(tenantId)}/access-requests`, { method: "POST", body: { why, durationMinutes }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  endMyAccess: ({ tenantId }, idempotencyKey) => request(`/api/platform/practices/${encodeURIComponent(tenantId)}/access/end`, { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  supportView: ({ tenantId, section }) => request(`/api/platform/practices/${encodeURIComponent(tenantId)}/look?section=${encodeURIComponent(section)}`),
  platformPrompts: () => request("/api/platform/prompts"),
  dismissPlatformPrompt: ({ key, subjectTenantId }, idempotencyKey) => request("/api/platform/prompts/dismiss", { method: "POST", body: { key, subjectTenantId }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
  platformUsage: () => request("/api/platform/usage"),
  // ── TASK 20.34 — PLATFORM SCREENS ───────────────────────────────────────────────────────────────
  /** GET /api/platform/usage — cross-practice usage metrics. */
  platformUsageList: () => request("/api/platform/usage"),
  /** POST /api/platform/usage/tell — notify practice owner about usage. */
  platformUsageTell: (tenantId, metric, message, idempotencyKey) =>
    request("/api/platform/usage/tell", {
      method: "POST",
      body: { tenantId, metric, message },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/platform/automations — adoption counts and incidents. */
  platformAutomationsAdoption: () => request("/api/platform/automations"),
  /** POST /api/platform/automations/kill-switch — toggle workflow active state. */
  platformAutomationsKillSwitch: (workflowId, active, idempotencyKey) =>
    request("/api/platform/automations/kill-switch", {
      method: "POST",
      body: { workflowId, active },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/platform/branding — push states and failure reasons. */
  platformBrandingPushStates: () => request("/api/platform/branding"),

  platformJobs: () => request("/api/platform/jobs"),
  runJobNow: ({ task }, idempotencyKey) => request("/api/platform/jobs/run-now", { method: "POST", body: { task }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),

  // ── TASK 20.39 — TIERS & CAPABILITIES ──────────────────────────────────────────────────────────
  /** GET /api/platform/tiers/capabilities — tier capability grid. */
  platformTiersCapabilities: () => request("/api/platform/tiers/capabilities"),
  /** PUT /api/platform/tiers/capabilities — update one cell. */
  platformUpdateTierCapability: (tierId, capKey, allowed, idempotencyKey) =>
    request("/api/platform/tiers/capabilities", {
      method: "PUT",
      body: { updates: { [tierId]: { [capKey]: allowed } } },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  provisioningSteps: (runId) => request(`/api/platform/provisioning/${encodeURIComponent(runId)}/steps`),

  // ◆ 18.6 SUPPORT ACCESS API
  // (staff app uses existing methods — 18.23)
  registerDevice: ({ platform, token }, idempotencyKey) =>
    request("/api/me/devices", {
      method: "POST", body: { platform, token }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  forgetDevice: ({ token }, idempotencyKey) =>
    request("/api/me/devices/forget", {
      method: "POST", body: { token }, idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),
  pushConfig: () => request("/api/me/push-config"),

  // ── CLIENT APP — TASK 18.33 ────────────────────────────────────────────────────────────────────
  /** GET /api/app/home — the client app's home surface. Role-specific data returned by the route. */
  appHome: () => request("/api/app/home"),

  

  /**
   * POST /api/app/payments/pay — charge the client for one or more invoices.
   * ★ `invoiceIds` is the list of invoice IDs to pay.
   */
  appPay: ({ invoiceIds }, idempotencyKey) =>
    request("/api/app/payments/pay", {
      method: "POST",
      body: { invoiceIds },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/app/services — the list of bookable services available to this client. */
  appServices: () => request("/api/app/services"),

  /** GET /api/app/booking/policy?serviceId={id} — the booking policy for a specific service. */
  appBookingPolicy: (serviceId) =>
    request(`/api/app/booking/policy?serviceId=${encodeURIComponent(serviceId)}`),

  // ── S20 TASK 20.42 — GROWTH TEMPLATES ──────────────────────────────────────────────────────
  /** GET /api/growth/templates?family=&q=&page= — list templates, grouped by family, searchable,
   *  20 per page. Response: {rows, total, page, pageSize}. */
  listTemplates: (family = "", q = "", page = 1) => {
    const params = new URLSearchParams();
    if (family) params.append("family", family);
    if (q) params.append("q", q);
    if (page > 1) params.append("page", String(page));
    return request(`/api/growth/templates?${params}`);
  },

  /** GET /api/growth/templates/:key — fetch one template with all versions + variables. */
  getTemplate: (key) => request(`/api/growth/templates/${encodeURIComponent(key)}`),

  /** POST /api/growth/templates — create a new version of a template. */
  createTemplateVersion: ({ key, subject, htmlBody, textBody }, idempotencyKey) =>
    request("/api/growth/templates", {
      method: "POST",
      body: { key, subject, htmlBody, textBody },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/templates/:key/activate — activate a version atomically. */
  activateTemplate: (key, version, idempotencyKey) =>
    request(`/api/growth/templates/${encodeURIComponent(key)}/activate`, {
      method: "POST",
      body: { version },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/templates/:key/preview — render the current (possibly unsaved) draft with
   *  sample data, through the one renderer. No send, no stored row required. */
  previewTemplateDraft: (key, subject, textBody, idempotencyKey) =>
    request(`/api/growth/templates/${encodeURIComponent(key)}/preview`, {
      method: "POST",
      body: { subject, textBody },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/templates/:key/reset — deactivate the active override; shipped default takes over. */
  resetTemplateToDefault: (key, idempotencyKey) =>
    request(`/api/growth/templates/${encodeURIComponent(key)}/reset`, {
      method: "POST",
      body: {},
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/templates/:key/test-send — send test to caller. */
  testSendTemplate: (key, version, idempotencyKey) =>
    request(`/api/growth/templates/${encodeURIComponent(key)}/test-send`, {
      method: "POST",
      body: { version },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  

  

  /** GET /api/growth/campaign-groups/:id/results — get results rollup for a group. */
  getCampaignGroupResults: (id) =>
    request(`/api/growth/campaign-groups/${encodeURIComponent(id)}/results`),

  

  

  

  

  /** POST /api/growth/campaign-groups — create a new campaign group. */
  createCampaignGroup: ({ name, status = "planning", goal = null, startsOn = null, endsOn = null }, idempotencyKey) =>
    request("/api/growth/campaign-groups", {
      method: "POST",
      body: { name, status, goal, startsOn, endsOn },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/campaign-groups/update — update a campaign group. */
  updateCampaignGroup: ({ groupId, name, status, goal, startsOn, endsOn }, idempotencyKey) =>
    request("/api/growth/campaign-groups/update", {
      method: "POST",
      body: { groupId, name, status, goal, startsOn, endsOn },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  

  

  

  

  // ── S20 TASK 20.47 — FORM TEMPLATES (MARKETING FORM BUILDER PERSISTENCE) ─────────────────────
  /** GET /api/growth/forms — list all form templates for the tenant. */
  listFormTemplates: () => request("/api/growth/forms"),

  /** GET /api/growth/forms/:formId — fetch a single form template. */
  getFormTemplate: (formId) => request(`/api/growth/forms/${encodeURIComponent(formId)}`),

  /** POST /api/growth/forms — create a new form template. */
  createGrowthForm: ({ title, slug, fields, consentRequired }, idempotencyKey) =>
    request("/api/growth/forms", {
      method: "POST",
      body: { title, slug, fields, consentRequired },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/forms/:formId — update a form template. */
  updateFormTemplate: (formId, { title, slug, fields, consentRequired }, idempotencyKey) =>
    request(`/api/growth/forms/${encodeURIComponent(formId)}`, {
      method: "POST",
      body: { title, slug, fields, consentRequired },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── S20 TASK 20.31 — STRIPE PAYMENT SURFACES (OPINION BAND + COMPONENT SESSIONS) ─────────────
  /** POST /api/money/stripe/component-session — create session for embedded Stripe component. */
  stripeComponentSession: ({ surface }, idempotencyKey) =>
    request("/api/money/stripe/component-session", {
      method: "POST",
      body: { surface },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  

  

  

  

  

  /** POST /api/money/stripe/component-session?surface=tax_registrations — tax registrations component. */
  taxComponentSessions: () =>
    Promise.all([
      request("/api/money/stripe/component-session", {
        method: "POST",
        body: { surface: "tax_registrations" },
        idempotencyKey: crypto.randomUUID(),
      }).catch(() => null),
      request("/api/money/stripe/component-session", {
        method: "POST",
        body: { surface: "tax_settings" },
        idempotencyKey: crypto.randomUUID(),
      }).catch(() => null),
      request("/api/money/stripe/component-session", {
        method: "POST",
        body: { surface: "tax_threshold_monitoring" },
        idempotencyKey: crypto.randomUUID(),
      }).catch(() => null),
    ]).then(([registrations, settings, monitoring]) => ({
      tax_registrations: registrations,
      tax_settings: settings,
      tax_threshold_monitoring: monitoring,
    })),

  /** GET /api/settings/usage — usage metrics from Stripe Meters. */
  usageSettings: () => request("/api/settings/usage"),

  

  

  

  /** POST /api/automations/:key/toggle — toggle an automation on/off. */
  setAutomation: (key, { enabled }, idempotencyKey) =>
    request(`/api/tasks/automations/${encodeURIComponent(key)}`, {
      method: "POST",
      body: { enabled },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  

  

  

  // ── S20 · ITEMS — COUPONS AND PROMOTION CODES ──────────────────────────────────────────────────
  /** GET /api/items/coupons/:id/editor — coupon editor payload with rule, codes, sync state. */
  couponEditor: (couponId) => request(`/api/items/coupons/${encodeURIComponent(couponId)}/editor`),

  /** POST /api/items/coupons — create coupon with initial code. */
  createCoupon: (body, idempotencyKey) =>
    request("/api/items/coupons", {
      method: "POST",
      body,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/coupons/update — update coupon rule fields. */
  updateCoupon: (body, idempotencyKey) =>
    request("/api/items/coupons/update", {
      method: "POST",
      body,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/coupons/active — toggle coupon active state. */
  setCouponActive: (couponId, active, idempotencyKey) =>
    request("/api/items/coupons/active", {
      method: "POST",
      // ★ K12 (27 Sep): the handler reads `discountId` (setDiscountActive) — `couponId` toggled nothing.
      body: { discountId: couponId, active },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/promotion-codes — add a promotion code to a coupon. */
  addPromotionCode: (couponId, code, idempotencyKey) =>
    request("/api/items/promotion-codes", {
      method: "POST",
      body: { couponId, code },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/promotion-codes/deactivate — deactivate a promotion code. */
  deactivatePromotionCode: (promotionCodeId, idempotencyKey) =>
    request("/api/items/promotion-codes/deactivate", {
      method: "POST",
      body: { promotionCodeId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/coupons/:couponId/apply-to-person — apply coupon to a person. */
  applyPersonCoupon: (couponId, userId, idempotencyKey) =>
    request(`/api/money/coupons/${encodeURIComponent(couponId)}/apply-to-person`, {
      method: "POST",
      body: { userId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/coupons/:couponId/remove-from-person — remove coupon from a person. */
  removePersonCoupon: (couponId, userId, idempotencyKey) =>
    request(`/api/money/coupons/${encodeURIComponent(couponId)}/remove-from-person`, {
      method: "POST",
      body: { userId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // P3.A — CONTRACTS §10: every new method phases 1–3 need (money invoices/credit notes/
  // subscriptions/estimates/terminal/refunds/disputes/payment plans/fraud, settings money,
  // growth campaigns/campaign groups, documents/custom-fields/stripe keys) plus the S-task
  // "first api.js method" paragraph's names, where those differ from an existing method already
  // hitting the same route (e.g. `assignPerson`/`linkGuardian`/`reassignTask` stay untouched;
  // `assignPeople`/`addGuardian`/`reassignTasks` are the CONTRACTS §10 names `useWrite` takes).
  // Skipped — route not built (T1.23 / P3.U4): `paymentLinks`, `campaignGroups`, `campaignGroup`,
  // `campaignMonthlyResults`. Skipped — no path in CONTRACTS §4/§10: `toggleInvoiceReminders`
  // (the live route is `POST /api/money/invoices/reminders/toggle`, `src/routes/writes.mjs:710`,
  // but CONTRACTS never spells out a path for this method name — never improvise one).
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  // ── MONEY · INVOICES / CREDIT NOTES ──────────────────────────────────────────────────────────
  /** POST /api/money/invoices/delete-draft — `{invoiceId}` → `{deleted: true}`. */
  deleteDraftInvoice: ({ invoiceId }, idempotencyKey) =>
    request("/api/money/invoices/delete-draft", {
      method: "POST", body: { invoiceId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/credit-notes/update — `{creditNoteId, memo}` → `{creditNote}`. */
  updateCreditNote: ({ creditNoteId, memo }, idempotencyKey) =>
    request("/api/money/credit-notes/update", {
      method: "POST", body: { creditNoteId, memo },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/credit-notes/preview?invoiceId&lines — `{total, tax, lines}` (`lines` is JSON). */
  previewCreditNote: ({ invoiceId, lines }) =>
    request(`/api/money/credit-notes/preview?invoiceId=${encodeURIComponent(invoiceId)}` +
      `&lines=${encodeURIComponent(JSON.stringify(lines ?? []))}`),

  /** GET /api/money/invoices/:id/credit-notes — `{creditNotes: []}`. */
  listInvoiceCreditNotes: (invoiceId) =>
    request(`/api/money/invoices/${encodeURIComponent(invoiceId)}/credit-notes`),

  /** POST /api/money/invoices/void — `{invoiceId, reason}`. */
  voidInvoice: ({ invoiceId, reason }, idempotencyKey) =>
    request("/api/money/invoices/void", {
      method: "POST", body: { invoiceId, reason },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/invoices/mark-paid — `{invoiceId, method, note}` (markPaidInvoice). */
  markInvoicePaid: ({ invoiceId, method, note }, idempotencyKey) =>
    request("/api/money/invoices/mark-paid", {
      method: "POST", body: { invoiceId, method, note },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/invoices/mark-uncollectible — `{invoiceId, reason}` (markUncollectibleInvoice). */
  markInvoiceUncollectible: ({ invoiceId, reason }, idempotencyKey) =>
    request("/api/money/invoices/mark-uncollectible", {
      method: "POST", body: { invoiceId, reason },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/payments/attach — `{invoiceId, stripePaymentIntentId}`. */
  attachPaymentToInvoice: ({ invoiceId, stripePaymentIntentId }, idempotencyKey) =>
    request("/api/money/payments/attach", {
      method: "POST", body: { invoiceId, stripePaymentIntentId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/credit-notes/issue — `{invoiceId, lines, reason, destination, memo}`. */
  issueCreditNote: ({ invoiceId, lines, reason, destination, memo = null }, idempotencyKey) =>
    request("/api/money/credit-notes/issue", {
      method: "POST", body: { invoiceId, lines, reason, destination, memo },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/credit-notes/void — `{creditNoteId}`. */
  voidCreditNote: ({ creditNoteId }, idempotencyKey) =>
    request("/api/money/credit-notes/void", {
      method: "POST", body: { creditNoteId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/invoices/duplicate — `{invoiceId}`. */
  duplicateInvoice: ({ invoiceId }, idempotencyKey) =>
    request("/api/money/invoices/duplicate", {
      method: "POST", body: { invoiceId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── MONEY · SUBSCRIPTIONS ─────────────────────────────────────────────────────────────────────
  /** POST /api/money/subscriptions/pause — `{subscriptionId}`. */
  pauseSubscription: ({ subscriptionId }, idempotencyKey) =>
    request("/api/money/subscriptions/pause", {
      method: "POST", body: { subscriptionId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/resume — `{subscriptionId}`. */
  resumeSubscription: ({ subscriptionId }, idempotencyKey) =>
    request("/api/money/subscriptions/resume", {
      method: "POST", body: { subscriptionId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/update-card — `{subscriptionId}` (requestCardUpdate). */
  updateSubscriptionCard: ({ subscriptionId }, idempotencyKey) =>
    request("/api/money/subscriptions/update-card", {
      method: "POST", body: { subscriptionId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/subscriptions/remove-discount — `{subscriptionId}`. */
  removeSubscriptionDiscount: ({ subscriptionId }, idempotencyKey) =>
    request("/api/money/subscriptions/remove-discount", {
      method: "POST", body: { subscriptionId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/subscriptions/preview?subscriptionId — `{lines, total, date}`. */
  previewSubscriptionInvoice: (subscriptionId) =>
    request(`/api/money/subscriptions/preview?subscriptionId=${encodeURIComponent(subscriptionId)}`),

  // ── MONEY · CREDIT / COUPONS / TAX IDS / PAYMENT METHODS (person-level) ─────────────────────────
  /** POST /api/money/credits/adjust — `{subjectType, subjectId, amountMinor, note}`. */
  adjustCredit: ({ subjectType, subjectId, amountMinor, note }, idempotencyKey) =>
    request("/api/money/credits/adjust", {
      method: "POST", body: { subjectType, subjectId, amountMinor, note },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/coupons/:couponId/apply-to-person — `{userId}` (couponId in path; applyPersonCoupon
   *  already hits this route under a different name — this is the CONTRACTS §10 name). */
  applyCouponToPerson: ({ couponId, userId }, idempotencyKey) =>
    request(`/api/money/coupons/${encodeURIComponent(couponId)}/apply-to-person`, {
      method: "POST", body: { userId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/coupons/:couponId/remove-from-person — `{userId}` (couponId in path; see
   *  `applyCouponToPerson`'s note — `removePersonCoupon` already hits this route by another name). */
  removeCouponFromPerson: ({ couponId, userId }, idempotencyKey) =>
    request(`/api/money/coupons/${encodeURIComponent(couponId)}/remove-from-person`, {
      method: "POST", body: { userId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/tax-ids — `{subjectType, subjectId, type, value}` (createTaxId). */
  addTaxId: ({ subjectType, subjectId, type, value }, idempotencyKey) =>
    request("/api/tax-ids", {
      method: "POST", body: { subjectType, subjectId, type, value },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/tax-ids/delete — `{taxIdId}` (deleteTaxId). */
  removeTaxId: ({ taxIdId }, idempotencyKey) =>
    request("/api/tax-ids/delete", {
      method: "POST", body: { taxIdId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/payment-methods/detach — `{paymentMethodId}`. */
  detachPaymentMethod: ({ paymentMethodId }, idempotencyKey) =>
    request("/api/money/payment-methods/detach", {
      method: "POST", body: { paymentMethodId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/people/:id/credit-ledger — `{entries}`. */
  personCreditLedger: (personId) =>
    request(`/api/people/${encodeURIComponent(personId)}/credit-ledger`),

  /** GET /api/people/:id/payment-methods — `{methods}`. */
  personPaymentMethods: (personId) =>
    request(`/api/people/${encodeURIComponent(personId)}/payment-methods`),

  /** GET /api/people/:id/tax-ids — `{taxIds}`. */
  personTaxIds: (personId) =>
    request(`/api/people/${encodeURIComponent(personId)}/tax-ids`),

  // ── MONEY · ESTIMATES ─────────────────────────────────────────────────────────────────────────
  /** POST /api/money/estimates — `{recipientUserId, title, message, goodForDays, onAcceptInvoice,
   *  onAcceptRecord, documentTemplateId}` (createEstimate). */
  createEstimate: ({
    recipientUserId, title, message, goodForDays = 30,
    onAcceptInvoice = true, onAcceptRecord = false, documentTemplateId = null,
  }, idempotencyKey) =>
    request("/api/money/estimates", {
      method: "POST",
      body: { recipientUserId, title, message, goodForDays, onAcceptInvoice, onAcceptRecord, documentTemplateId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/estimates/cancel — `{estimateId}`. */
  cancelEstimate: ({ estimateId }, idempotencyKey) =>
    request("/api/money/estimates/cancel", {
      method: "POST", body: { estimateId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/estimates/:id/editor — the estimate editor payload. */
  estimateEditor: (estimateId) =>
    request(`/api/money/estimates/${encodeURIComponent(estimateId)}/editor`),

  // ── MONEY · STRIPE TERMINAL READER ACTIONS ───────────────────────────────────────────────────
  /** POST /api/money/terminal/process — `{readerId, paymentIntentId, amountMinor, requestKey}`
   *  (processPaymentIntent; `requestKey` is a UUID minted once per action by the caller — the
   *  handler throws without one, `src/money/terminal.mjs:111`). */
  readerCharge: ({ readerId, paymentIntentId, amountMinor = null, requestKey }, idempotencyKey) =>
    request("/api/money/terminal/process", {
      method: "POST", body: { readerId, paymentIntentId, amountMinor, requestKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/display — `{readerId, displayType, displayText, requestKey}`
   *  (setReaderDisplay). */
  readerDisplay: ({ readerId, displayType = null, displayText = null, requestKey }, idempotencyKey) =>
    request("/api/money/terminal/display", {
      method: "POST", body: { readerId, displayType, displayText, requestKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/cancel — `{readerId, requestKey}` (cancelAction). */
  readerCancel: ({ readerId, requestKey }, idempotencyKey) =>
    request("/api/money/terminal/cancel", {
      method: "POST", body: { readerId, requestKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/terminal/refund — `{chargeId, amountMinor, reason, requestKey}` (refundPayment). */
  readerRefund: ({ chargeId, amountMinor = null, reason = null, requestKey }, idempotencyKey) =>
    request("/api/money/terminal/refund", {
      method: "POST", body: { chargeId, amountMinor, reason, requestKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/devices/rename — `{deviceId, name}`. */
  renameDevice: ({ deviceId, name }, idempotencyKey) =>
    request("/api/money/devices/rename", {
      method: "POST", body: { deviceId, name },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/devices/:id/status — `{status, lastSeenAt}`. */
  deviceStatus: (deviceId) =>
    request(`/api/money/devices/${encodeURIComponent(deviceId)}/status`),

  // ── MONEY · REFUNDS / DISPUTES / PAYMENT PLANS / FRAUD ───────────────────────────────────────
  /** POST /api/money/refund/approve — `{requestId}`. */
  approveRefundRequest: ({ requestId }, idempotencyKey) =>
    request("/api/money/refund/approve", {
      method: "POST", body: { requestId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/refund/decline — `{requestId}`. */
  declineRefundRequest: ({ requestId }, idempotencyKey) =>
    request("/api/money/refund/decline", {
      method: "POST", body: { requestId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/refunds/cancel — `{refundId}`. */
  cancelRefund: ({ refundId }, idempotencyKey) =>
    request("/api/money/refunds/cancel", {
      method: "POST", body: { refundId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/disputes/close — `{disputeId, confirmationText}` (closeDispute — this is the
   *  CONTRACTS §10 path for `acceptDispute`; a SEPARATE `/api/money/disputes/accept` route also
   *  exists bound to a function of this same name, but CONTRACTS §4's "Changed" list names
   *  `/disputes/close`, not `/disputes/accept`, for this method). */
  acceptDispute: ({ disputeId, confirmationText }, idempotencyKey) =>
    request("/api/money/disputes/close", {
      method: "POST", body: { disputeId, confirmationText },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/payment-plans/offer — `{invoiceId, installments, frequency, firstDueOn}`. */
  offerPaymentPlan: ({ invoiceId, installments, frequency, firstDueOn }, idempotencyKey) =>
    request("/api/money/payment-plans/offer", {
      method: "POST", body: { invoiceId, installments, frequency, firstDueOn },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/payment-plans/cancel — `{planId}`. */
  cancelPaymentPlan: ({ planId }, idempotencyKey) =>
    request("/api/money/payment-plans/cancel", {
      method: "POST", body: { planId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/money/fraud/approve — `{reviewId}`. */
  approveFraudReview: ({ reviewId }, idempotencyKey) =>
    request("/api/money/fraud/approve", {
      method: "POST", body: { reviewId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/fraud/reviews — `{reviews}`. */
  fraudReviews: () => request("/api/money/fraud/reviews"),

  // ── SETTINGS · MONEY ──────────────────────────────────────────────────────────────────────────
  /** GET /api/settings/invoice-layouts — `{layouts}`. */
  invoiceLayouts: () => request("/api/settings/invoice-layouts"),

  /** POST /api/settings/invoice-layouts/archive — `{templateId}`. */
  archiveInvoiceLayout: ({ templateId }, idempotencyKey) =>
    request("/api/settings/invoice-layouts/archive", {
      method: "POST", body: { templateId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/invoice-layouts/unarchive — `{templateId}`. */
  unarchiveInvoiceLayout: ({ templateId }, idempotencyKey) =>
    request("/api/settings/invoice-layouts/unarchive", {
      method: "POST", body: { templateId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/settings/payment-methods — `{enabled, available}`. */
  paymentMethodSettings: () => request("/api/settings/payment-methods"),

  /** POST /api/settings/payment-methods — `{enabled: []}`. */
  setPaymentMethodSettings: ({ enabled }, idempotencyKey) =>
    request("/api/settings/payment-methods", {
      method: "POST", body: { enabled },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/settings/wallet-domains — `{domains: [{domain, status}]}`. */
  walletDomains: () => request("/api/settings/wallet-domains"),

  // ── GROWTH · CAMPAIGNS / CAMPAIGN GROUPS ─────────────────────────────────────────────────────
  /** POST /api/growth/campaigns/update — `{campaignId, name, segmentId, subject, body,
   *  leaveOutSegmentId, neverMoreThanDays, templateKey}` (updateCampaign; only a draft can be
   *  edited — the server enforces this, not re-checked here). */
  updateCampaign: ({
    campaignId, name, segmentId, subject, body, leaveOutSegmentId, neverMoreThanDays, templateKey,
  }, idempotencyKey) =>
    request("/api/growth/campaigns/update", {
      method: "POST",
      body: { campaignId, name, segmentId, subject, body, leaveOutSegmentId, neverMoreThanDays, templateKey },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/campaign-groups/delete — `{groupId}` (deleteCampaignGroup). */
  deleteCampaignGroup: ({ groupId }, idempotencyKey) =>
    request("/api/growth/campaign-groups/delete", {
      method: "POST", body: { groupId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/campaign-groups/attach — `{groupId, kind, id}` (attachToCampaignGroup;
   *  `kind` is `'send' | 'page' | 'segment'`, `id` the object's own id). */
  attachCampaignGroup: ({ groupId, kind, id }, idempotencyKey) =>
    request("/api/growth/campaign-groups/attach", {
      method: "POST", body: { groupId, kind, id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/growth/campaign-groups/detach — `{groupId, kind, id}` (detachFromCampaignGroup). */
  detachCampaignGroup: ({ groupId, kind, id }, idempotencyKey) =>
    request("/api/growth/campaign-groups/detach", {
      method: "POST", body: { groupId, kind, id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  // ── DOCUMENTS / CUSTOM FIELDS / STRIPE KEYS ──────────────────────────────────────────────────
  /** GET /api/custom-fields — wraps records/custom-field reads. */
  customFields: () => request("/api/custom-fields"),

  /** POST /api/custom-fields — `{recordType, key, label, kind}` (createCustomField). */
  createCustomField: ({ recordType, key, label, kind }, idempotencyKey) =>
    request("/api/custom-fields", {
      method: "POST", body: { recordType, key, label, kind },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/money/stripe/keys — the Stripe publishable key only. */
  stripePublishableKey: () => request("/api/money/stripe/keys"),

  // ── EXISTING ROUTES THAT GAIN THEIR FIRST api.js METHOD (CONTRACTS §10 S-tasks) ──────────────
  /** POST /api/money/bank-verify-session — `{personId}` (createFinancialConnectionsSession). */
  createFinancialConnectionsSession: ({ personId }, idempotencyKey) =>
    request("/api/money/bank-verify-session", {
      method: "POST", body: { personId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/engagements/blocks/stop — `{blockId, fromDate}` (stopBlock; `fromDate` YYYY-MM-DD). */
  stopBlock: ({ blockId, fromDate }, idempotencyKey) =>
    request("/api/engagements/blocks/stop", {
      method: "POST", body: { blockId, fromDate },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/engagements/blocks/skip — `{blockId, date}` (skipBlockDay; `date` YYYY-MM-DD). */
  skipBlock: ({ blockId, date }, idempotencyKey) =>
    request("/api/engagements/blocks/skip", {
      method: "POST", body: { blockId, date },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/scheduling/time-off/:id/delete — no body (id in path; `removeTimeOff`
   *  already hits this route by another name — this is the CONTRACTS §10 name). */
  deleteTimeOff: (timeOffId, idempotencyKey) =>
    request(`/api/people/scheduling/time-off/${encodeURIComponent(timeOffId)}/delete`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/assign — `{personId, ownerUserId}` (assignPerson already hits this route by
   *  another name — this is the CONTRACTS §10 name; `ownerUserId: null` unassigns). */
  assignPeople: ({ personId, ownerUserId = null }, idempotencyKey) =>
    request("/api/people/assign", {
      method: "POST", body: { personId, ownerUserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/guardian — `{childUserId, guardianUserId, relationship}` (linkGuardian
   *  already hits this route by another name — this is the CONTRACTS §10 name). */
  addGuardian: ({ childUserId, guardianUserId, relationship = "parent" }, idempotencyKey) =>
    request("/api/people/guardian", {
      method: "POST", body: { childUserId, guardianUserId, relationship },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/guardian/remove — `{childUserId, guardianUserId}` (unlinkGuardian). */
  removeGuardian: ({ childUserId, guardianUserId }, idempotencyKey) =>
    request("/api/people/guardian/remove", {
      method: "POST", body: { childUserId, guardianUserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/:id/attachments — `{filename, fileData, contentType}` (id in path;
   *  `uploadAttachment` already hits this route by another name — this is the CONTRACTS §10 name). */
  addPersonAttachment: (personId, { filename, fileData, contentType }, idempotencyKey) =>
    request(`/api/people/${encodeURIComponent(personId)}/attachments`, {
      method: "POST",
      body: { filename, fileData, ...(contentType !== undefined ? { contentType } : {}) },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/samples/remove — no body (archives every sample record in this tenant). */
  removeSamples: (idempotencyKey) =>
    request("/api/people/samples/remove", {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/locations/:id — patch; only the keys present in `body` are changed (id in path). */
  updateLocation: (locationId, body, idempotencyKey) =>
    request(`/api/locations/${encodeURIComponent(locationId)}`, {
      method: "POST", body,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/settings/locations/assignments — `{kind, id, locationIds}`, replace-all for one
   *  subject (`kind: 'service' | 'staff'`; an empty `locationIds` clears the restriction). */
  setLocationAssignments: ({ kind, id, locationIds }, idempotencyKey) =>
    request("/api/settings/locations/assignments", {
      method: "POST", body: { kind, id, locationIds },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/gift-cards — `{amountMinor, currency, holderEmail, buyerUserId}` (issueGiftCard). */
  issueGiftCard: ({ amountMinor, currency, holderEmail = null, buyerUserId = null }, idempotencyKey) =>
    request("/api/items/gift-cards", {
      method: "POST", body: { amountMinor, currency, holderEmail, buyerUserId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/gift-cards/resend — `{id}` (resendGiftCard — mints a new code). */
  resendGiftCard: ({ id }, idempotencyKey) =>
    request("/api/items/gift-cards/resend", {
      method: "POST", body: { id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/gift-cards/nudge — `{id}` (nudgeGiftCard). */
  nudgeGiftCard: ({ id }, idempotencyKey) =>
    request("/api/items/gift-cards/nudge", {
      method: "POST", body: { id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/items/gift-cards/void — `{id}` (voidGiftCard). */
  voidGiftCard: ({ id }, idempotencyKey) =>
    request("/api/items/gift-cards/void", {
      method: "POST", body: { id },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/notes/:id/share — no body (id in path; §0.4 B's own two-POST note-share pair). */
  shareNote: (noteId, idempotencyKey) =>
    request(`/api/notes/${encodeURIComponent(noteId)}/share`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/notes/:id/unshare — no body (id in path). */
  unshareNote: (noteId, idempotencyKey) =>
    request(`/api/notes/${encodeURIComponent(noteId)}/unshare`, {
      method: "POST", idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/tasks/reassign — `{taskId, assigneeId}` (reassignTask already hits this route by
   *  another name — this is the CONTRACTS §10 name). */
  reassignTasks: ({ taskId, assigneeId }, idempotencyKey) =>
    request("/api/tasks/reassign", {
      method: "POST", body: { taskId, assigneeId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/developer/api-keys/:id/scopes — `{scopes}` (id in path; an empty `scopes` is
   *  refused server-side — revoke the key instead of editing it down to nothing). */
  setApiKeyScopes: (keyId, { scopes }, idempotencyKey) =>
    request(`/api/developer/api-keys/${encodeURIComponent(keyId)}/scopes`, {
      method: "POST", body: { scopes },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** POST /api/people/programs — `{personId, programIds}`; SET semantics (the list replaces what the person had). */
  setPersonPrograms: ({ personId, programIds }, idempotencyKey) =>
    request("/api/people/programs", {
      method: "POST", body: { personId, programIds: programIds ?? [] },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    }),

  /** GET /api/people/programs?personId= → `{data:[{id,name,colour}]}`. */
  getPersonPrograms: (personId) =>
    request(`/api/people/programs?personId=${encodeURIComponent(personId)}`),

  /** GET /api/reports/by-program?from&to — admin only. `{from,to,rows:[{programId,name,colour,invoicedMinor,paidMinor,invoices,sessions,people}],totals:{invoicedMinor,paidMinor}}`. */
  reportByProgram: (from, to) =>
    request(`/api/reports/by-program?${new URLSearchParams({ from, to })}`),
};
