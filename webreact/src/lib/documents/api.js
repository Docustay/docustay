// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DOCUMENTS ISLAND'S OWN API METHODS (ISLAND-PROGRAMS.md §2 "FE"; moved verbatim out of
// webreact/src/lib/api.js, 2 Oct 2026). Every `/api/documents/*`, `/api/app/documents/*` and
// `/api/settings/documents*` call the browser makes lives HERE, so Documents' wire surface is one file.
//
// ★ HOW IT IS WIRED. `lib/api.js` builds `documentsApi` with `createDocumentsApi({ request, ApiError })`
//   and spreads it into `api`, so every existing `api.createDocument(...)` call site keeps working
//   UNCHANGED. The factory takes `request` / `ApiError` as arguments (instead of importing them from
//   `../api.js`) on purpose: an import in both directions is a cycle, and `api.js` spreads this object
//   at module-evaluation time — if this file were ever loaded first, that spread would hit a
//   temporal-dead-zone ReferenceError. Injection removes the cycle altogether.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function createDocumentsApi({ request, ApiError }) {
  return {
    // ★ P15C.6 — the seven axes, WITH the server's own vocabularies, so the screen cannot offer a value
    //   the database would refuse and cannot hold a second copy of the axes.
    documentAxes: () => request("/api/settings/documents"),

    // ★ DOCUSTAY BUILD (29 Sep 2026) — same eight-rows-as-a-form shape as the settings rows.
    // ★★ FOUND LIVE, 29 Sep 2026 — this collided with the seven-axes endpoint at the same path
    //   (see settings.mjs's note at the route); moved to /preferences so both are reachable.
    documentsSettings: () => request("/api/documents/settings"),
    /** GET /api/documents/templates/:id/view — the ONE document view for the two preview tabs: mode "signing" (as the client sees it) or "signed" (as the signed copy). `personId` fills real values. */
    templateView: ({ templateId, mode = "signing", personId = null }) =>
      request(`/api/documents/templates/${encodeURIComponent(templateId)}/view?mode=${mode}${personId ? `&personId=${encodeURIComponent(personId)}` : ""}`),
    // ── uploaded documents (QUEUE §23.4) — reads; the writes go through useWrite / performWrite with their route keys ──
    /** GET /api/documents/pdf/:id — the draft or sent document: body, people, files, send options, checklist, the actions the status allows. */
    pdfDocument: (id) => request(`/api/documents/pdf/${encodeURIComponent(id)}`),
    /** GET /api/documents/pdf/:id/track — status, people with their state, the timeline, per-document progress. */
    pdfTrack: (id) => request(`/api/documents/pdf/${encodeURIComponent(id)}/track`),
    /** GET /api/documents/pdf/templates — uploaded-document templates ({ templates, folders, tags, approvalRequired }); params { q, folder, tag, retired }. */
    pdfTemplates: ({ q = "", folder = "", tag = "", retired = false } = {}) => request(`/api/documents/pdf/templates?q=${encodeURIComponent(q)}&folder=${encodeURIComponent(folder)}&tag=${encodeURIComponent(tag)}${retired ? "&retired=1" : ""}`),
    /** GET /api/documents/pdf/templates/:id — one template: body, defaults, folder, tags, approval, link, versions. */
    pdfTemplate: (id) => request(`/api/documents/pdf/templates/${encodeURIComponent(id)}`),
    /** GET /api/documents/pdf/templates/:id/diff?against= — what changed from the previous (or a chosen) version, as sentences. */
    pdfTemplateDiff: (id, against = "") => request(`/api/documents/pdf/templates/${encodeURIComponent(id)}/diff${against ? `?against=${encodeURIComponent(against)}` : ""}`),
    /** GET /api/documents/pdf/recipients?q= — contacts to pick as recipients (through the people port). */
    pdfRecipients: (q) => request(`/api/documents/pdf/recipients?q=${encodeURIComponent(q ?? "")}`),
    /** GET /api/documents/pdf/uploads/:uploadId — which parts of an upload have arrived (to resume). */
    pdfUploadStatus: (uploadId) => request(`/api/documents/pdf/uploads/${encodeURIComponent(uploadId)}`),

    /** GET /api/documents/email — the sending identity in force, the domain's DNS records and status, whether an SMTP password is set (never the password). */
    documentsEmail: () => request("/api/documents/email"),
    addEmailDomain: ({ domain }, idempotencyKey) => request("/api/documents/email/domain", { method: "POST", body: { domain }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
    verifyEmailDomain: (idempotencyKey) => request("/api/documents/email/domain/verify", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
    removeEmailDomain: (idempotencyKey) => request("/api/documents/email/domain/remove", { method: "POST", body: {}, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
    saveSmtpPassword: ({ password }, idempotencyKey) => request("/api/documents/email/smtp-password", { method: "POST", body: { password }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
    sendTestEmail: ({ to }, idempotencyKey) => request("/api/documents/email/test", { method: "POST", body: { to }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),
    /** POST /api/documents/settings — change ONE Documents setting; value null resets it to the default. */
    saveDocumentSetting: ({ key, value }, idempotencyKey) =>
      request("/api/documents/settings", { method: "POST", body: { key, value }, idempotencyKey: idempotencyKey ?? crypto.randomUUID() }),

    // ── documents · P6.36 ──────────────────────────────────────────────────────────────────────
    /** POST /api/documents/instances — create a DRAFT. Nothing goes to anybody until it is sent. */
    createDocument: ({ builder, title, templateId, subjectUserId, typeId }, idempotencyKey) =>
      request("/api/documents/instances", {
        method: "POST",
        body: { builder, title, templateId, subjectUserId, ...(typeId ? { typeId } : {}) },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/send — put an instrument in front of its parties (draft → sent).
     * ★★★ THIS IS WHERE THE TEMPLATE'S WORDS FREEZE (§M0 LAW 3). A sent instrument never re-picks up
     *     its template, which is also why there is no edit-a-template control in the product.
     * ★★★ A5.2 — `sendMode` COULD NOT BE SENT. The route has accepted `locked | fill | open` all
     *     along and this method omitted it, so **every send in the product silently took the default
     *     (`fill`)** and the three modes were unreachable from any screen. Same shape as
     *     `createPrice`'s `effectiveFrom`: the server offered a decision the client could not make.
     * ★★ `overrideBody` IS ONLY EVER LEGAL UNDER `open`, and the server refuses it otherwise —
     *    *"an instrument that differs from its template without a record is indistinguishable from a
     *    forgery."* It is passed through untouched so that refusal stays the server's to make.
     */
    sendDocument: ({ instanceId, sendMode, overrideBody }, idempotencyKey) =>
      request("/api/documents/send", {
        method: "POST",
        body: {
          instanceId,
          ...(sendMode ? { sendMode } : {}),
          ...(overrideBody ? { overrideBody } : {}),
        },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/sign — record one party's signature.
     * ★★★ `role` HAS NO DEFAULT AND THE CLIENT MUST NOT INVENT ONE. The server refuses a body without
     *     it in those words, because a signature recorded under the wrong party's name is how a tech
     *     client ends up labelled as a person in recovery (§2.7). Pass it through untouched.
     * ★★ `signerUid` is this system's own `app_user` id or null — NEVER a Firebase uid. A Firebase uid
     *    here produced a 500 quoting a Postgres type name; null is legitimate (an in-person signing).
     */
    signDocument: ({ instanceId, role, signerName, signerUid, signedLocalDate, signerTimezone },
                   idempotencyKey) =>
      request("/api/documents/sign", {
        method: "POST",
        body: { instanceId, role, signerName,
                ...(signerUid ? { signerUid } : {}),
                // ★ These two travel together or not at all — the server refuses a wall-clock date
                //   with no zone, because it is the signer's own date that goes on their agreement.
                ...(signedLocalDate && signerTimezone ? { signedLocalDate, signerTimezone } : {}) },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /** POST /api/documents/decline — a terminal state that is NOT execution. `role` may be null. */
    declineDocument: ({ instanceId, role, reason }, idempotencyKey) =>
      request("/api/documents/decline", {
        method: "POST", body: { instanceId, role: role ?? null, reason: reason ?? null },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/execute — §M0 LAW 3. ADMIN ONLY, and the least reversible write in the
     * product: price, terms and the disclosure version all freeze here.
     * ★ `priceRef` is `{ subjectType, subjectId }` naming a CATALOGUE entry. The price in force NOW is
     *   frozen; if none is, execution is REFUSED rather than recorded against nothing. No money is
     *   ever typed — KS-12.0, the catalogue is the source of truth.
     */
    executeDocument: ({ instanceId, terms, priceRef }, idempotencyKey) =>
      request("/api/documents/execute", {
        method: "POST",
        body: { instanceId, terms: terms ?? null, ...(priceRef ? { priceRef } : {}) },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /** POST /api/app/documents/:instanceId/checkout-session — create Stripe embedded checkout. */
    createCheckoutSession: ({ instanceId }, idempotencyKey) =>
      request(`/api/app/documents/${instanceId}/checkout-session`, {
        method: "POST",
        body: {},
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * GET /api/documents/variables — fetch the variable catalogue filtered by caller's role.
     * Returns { fields: [{name, label, sample, why, domain, deprecated?}, ...] }.
     * Server-side redaction: admin sees all fields, staff/coach see staff+client, client sees client only.
     */
    fetchVariableCatalogue: () => request("/api/documents/variables"),

    // ── documents · the two builders · P6.39 / P6.42 ───────────────────────────────────────────
    /**
     * ★★★ TWO ROUTES, NOT ONE WITH A `kind` PARAMETER. §A5: the contract builder and the form builder
     *     are SEPARATE tools with SEPARATE template sets, and `src/routes/writes.mjs` passes the
     *     builder as a LITERAL per route so no caller's field can select the tool. Two methods here
     *     keeps that true on the client too.
     */
    /**
     * POST /api/documents/templates/body — edit a DRAFT template's body.
     * ★★★ A5.1 — THIS HAD NO CLIENT METHOD, so a template could be created and never edited again.
     * ★★ IT REFUSES AN EDIT ONCE AN INSTRUMENT HAS BEEN SENT, and the refusal is the useful part:
     *    *"a sent instrument NEVER re-picks up its template, so an edit here would leave every one of
     *    those saying exactly what it says now while showing you the correction — it would fix
     *    nothing, silently."* It names the version to create instead. Show it verbatim.
     */
    updateTemplateBody: ({ templateId, body }, idempotencyKey) =>
      request("/api/documents/templates/body", {
        method: "POST", body: { templateId, body },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    createContractTemplate: ({ name, body }, idempotencyKey) =>
      request("/api/documents/contracts/templates", {
        method: "POST", body: { name, body },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    createFormTemplate: ({ name, body }, idempotencyKey) =>
      request("/api/documents/forms/templates", {
        method: "POST", body: { name, body },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/templates/version — ★★★ A NEW VERSION IS A NEW ROW. The predecessor is
     * deactivated, never edited and never deleted: instruments sent against it quote it and must keep
     * resolving. The builder comes from the existing row, so it is not a parameter.
     */
    newTemplateVersion: ({ templateId, name, body }, idempotencyKey) =>
      request("/api/documents/templates/version", {
        method: "POST", body: { templateId, ...(name ? { name } : {}), body },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    // ── documents · the electronic-records disclosure · P15C.10 ────────────────────────────────
    /**
     * POST /api/documents/disclosure/accept — the SIGNER's own consent, at the version they were shown.
     * ★★★ NOT A STAFF ACTION. Neither this route nor `withdraw` is rank-laddered, because the person
     *     who accepts is the client on their own signing surface — 15 U.S.C. 7001(c)(1) is about
     *     consent not being something another person performs on your behalf.
     * ★★ `version` and `textShown` are both REQUIRED and the server refuses a bare boolean. A consent
     *    recorded without its wording points at whatever the file says on the day somebody reads it
     *    back, and execution FREEZES this row onto an instrument — so that error is permanent.
     * ★ `acceptedIp` is deliberately NOT sent from the browser. An address supplied by the client is a
     *   claim by the client; evidence a signer can edit is not evidence.
     */
    acceptDisclosure: ({ appUserId, version, textShown, userAgent }, idempotencyKey) =>
      request("/api/documents/disclosure/accept", {
        method: "POST",
        body: { appUserId, version, textShown, userAgent: userAgent ?? null },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/disclosure/withdraw — 15 U.S.C. 7001(c)(1)(b), which makes this a RIGHT.
     * ★★★ A WITHDRAWAL ENDS AN ACCEPTANCE AND DELETES NOTHING. Instruments executed while it was live
     *     quote it and stay valid; the DELETE trigger on the table refuses the other reading outright.
     */
    withdrawDisclosure: ({ appUserId, version }, idempotencyKey) =>
      request("/api/documents/disclosure/withdraw", {
        method: "POST", body: { appUserId, version: version ?? null },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/categories — a new document CATEGORY. `minRank: "admin"`.
     * ★★★ THE LAST TWO WRITE ROUTES IN THE PRODUCT WITH NO CLIENT CALL. [MEASURED] the screen that
     *     drives them — `web/src/screens/settings/DocumentAxesScreen.jsx:74,76` — has existed since
     *     P6.B12 and calls `callTap("createDocumentCategory", …)`, so the CONTROL was built, gated and
     *     correct, and refused to draw because the tap behind it did not exist. Both halves were
     *     right; nothing joined them.
     * ★★ `key` is derived from the label by the screen, not typed: a category key is an identifier and
     *    asking a person for one invites two categories that differ only in punctuation.
     */
    createDocumentCategory: ({ key, label }, idempotencyKey) =>
      request("/api/documents/categories", {
        method: "POST", body: { key, label },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/types — a document TYPE, which is a category plus the seven axes.
     * ★ The body is passed through whole: theseven axes are the screen's subject and re-listing them here
     *   would be a second declaration of what a type is.
     */
    createDocumentType: (body, idempotencyKey) =>
      request("/api/documents/types", {
        method: "POST", body,
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      }),

    /**
     * POST /api/documents/verify — verify a signed PDF without a session.
     * ★ This method sends multipart/form-data with the PDF file under the 'file' field.
     *   The response is `{ signed, valid, byteRange?, reason? }`.
     */
    verifyDocument: async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/documents/verify", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });

      const text = await res.text();
      let parsed = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = { error: { message: text.slice(0, 500) } }; }
      }

      if (!res.ok) throw new ApiError(res.status, parsed, "/api/documents/verify");

      return parsed;
    },

    /** GET /api/documents/starters — wraps starterTemplates.mjs (NEW read; the mounted route today
     *  is a POST at this same path bound to `seedStarterTemplate` — CONTRACTS §4 names this GET as
     *  NEW, built by a separate route task). */
    documentStarters: () => request("/api/documents/starters"),

    /**
     * GET /api/list/documents/contracts/templates — the practice's agreement (contract) templates, as the
     * list view returns them. The ONE call Items / People / Money forms make to pick an agreement; they
     * reach it through the island's front door (`listAgreementTemplates` in `@/lib/documents/index.js`)
     * instead of naming a Documents list path themselves.
     */
    listAgreementTemplates: () => request("/api/list/documents/contracts/templates"),
  };
}
