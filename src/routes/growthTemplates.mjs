// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 20.42 — GROWTH TEMPLATES: LIST, EDIT, VERSIONS, ACTIVATE, TEST-SEND
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, conflict, forbidden, notFound } from "../http/errors.mjs";
import { emit } from "../events/outbox.mjs";
import { deliverAsOrganisation } from "../email/deliver.mjs";
import { sendViaResend, emailIsConfigured } from "../email/resend.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { sendingAddress } from "../email/send.mjs";
import { TEMPLATE_REGISTRY_BY_KEY } from "../email/registry.mjs";
import { renderLiquidTemplate, previewLiquidTemplate } from "../email/liquidRenderer.mjs";


// ★★★ FIX, 1 Oct 2026 (Part 2 Addition) — FOUND LIVE: this whole file still spoke `{name}`
//     single-brace mustache, left over from before Part 1/2's cutover to `{{ name }}` Liquid for
//     every stored/shipped template (src/email/resolveTemplate.mjs's own header). MEASURED:
//     `previewLiquidTemplate("auth.invite", "Join {practiceName}!", "{inviterName} invited you. " +
//     "{{ acceptUrl }}", {...}, {})` rendered the Liquid token correctly and left BOTH single-brace
//     ones as LITERAL TEXT — `strictVariables: false` means LiquidJS silently ignores syntax it does
//     not recognise rather than erroring, so this editor's own save path could write a template
//     whose real send would show a client the literal string "{practiceName}" instead of their
//     practice's name, with nothing anywhere saying so. Zero real incidents only because [production
//     state] zero tenant overrides exist anywhere yet (confirmed earlier this session) — the first
//     person to actually use this editor would have been the first to hit it. `shippedAsText` now
//     reads the registry's own Liquid SOURCE directly (`entry.liquid.subject`/`.body` — the exact
//     string `resolveTemplate.mjs` falls back to) rather than calling the old DEFAULT_TEMPLATES JS
//     function through a placeholder-proxy that only ever produced the old syntax.
function shippedAsText(entry) {
  return { subject: entry.liquid.subject, textBody: entry.liquid.body, htmlBody: "" };
}

// ★ Same fix — `{{ name }}` / `{{ name.sub }}` / `{{ name | filter... }}`, top-level name captured
//   (dots/filters stripped) so "does this template's text reference X" means the same thing it did
//   under the old single-brace regex, just recognising the syntax that is actually stored now.
const VAR_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_.]*)?\s*(?:\|[^}]*)?\}\}/g;
function extractVarNames(text) {
  return Array.from(new Set(Array.from(text.matchAll(VAR_TOKEN_RE), (m) => m[1])));
}

async function mayCampaign(db, principal, action) {
  const { rows } = await db.query(`SELECT keystone.user_may($1, 'campaign', $2, NULL) AS ok`,
    [principal.appUserId, action]);
  if (rows[0]?.ok !== true) throw forbidden("no permission");
}

// ★ the maintainer, 1 Oct 2026 — Part 2's own ask: 20 per page, Previous/Next, page numbers, a real count.
const PAGE_SIZE = 20;

/**
 * GET /api/growth/templates — list all templates, grouped by family, searchable, paginated
 * Query: ?family=booking&q=reminder&page=2 (1-based; optional filters)
 * Response: {rows, total, page, pageSize} — `total` and `page` are POST-filter, pre-page.
 */
async function listTemplates({ db, principal, tenantId, c }) {
  await mayCampaign(db, principal, "view");
  const family = c.req.query("family") || "";
  const q = c.req.query("q") || "";
  const requestedPage = Number.parseInt(c.req.query("page") || "1", 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // ★ Fetch all active+non-active versions for this tenant's email_template rows
  const { rows } = await db.query(
    `SELECT key, family, subject, version, active, origin
     FROM keystone.email_template
     WHERE tenant_id = $1
     ORDER BY family, key, version`,
    [tenantId]
  );

  // ★ Group by key: collect versions, find active, determine origin
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.key]) {
      grouped[row.key] = {
        key: row.key,
        family: row.family,
        versions: [],
        activeVersion: null,
        allOrigins: new Set(),
      };
    }
    grouped[row.key].versions.push(row.version);
    grouped[row.key].allOrigins.add(row.origin);
    if (row.active) {
      grouped[row.key].activeVersion = row.version;
    }
  }

  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — this used to enumerate ONLY `DEFAULT_TEMPLATES` (the
  //   pre-Liquid 48ish), so Run → Templates' own list permanently stopped growing the moment the
  //   registry passed that count — every one of Part 2's 70+ new templates was invisible here,
  //   the exact "no exceptions, nothing partly wired" gap this whole brief exists to close.
  for (const key of Object.keys(TEMPLATE_REGISTRY_BY_KEY)) {
    if (!grouped[key]) {
      // ★ the maintainer, 1 Oct 2026 — `activeVersion: 0`, not `null`. A key with no stored row at all is
      //   sending the shipped default, which `GET /api/growth/templates/:key` (below, :122) already
      //   calls version 0 — the list used a DIFFERENT sentinel (null) for the exact same fact, so
      //   this column rendered blank for every never-edited template while the editor's own
      //   Versions section correctly said "Version 0". One convention, not two.
      grouped[key] = { key, family: TEMPLATE_REGISTRY_BY_KEY[key].family, versions: [], activeVersion: 0, allOrigins: new Set(["shipped"]) };
    }
  }

  // ★ Build response rows with stub name (from subject first 50 chars), usedBy (stub), origin
  const filtered = Object.values(grouped)
    .filter((g) => {
      if (family && g.family !== family) return false;
      if (q && !g.key.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => (a.family === b.family ? a.key.localeCompare(b.key) : a.family.localeCompare(b.family)))
    .map((g) => ({
      key: g.key,
      family: g.family,
      // ★ The registry's own `.name`/`.description` (every entry has one — src/email/registry.mjs)
      //   win when present; `templateDisplayName`/`TEMPLATE_DESCRIPTIONS` are now only the fallback
      //   for a key that somehow has stored rows but no registry entry (should not happen, but a
      //   derived name beats a blank one).
      name: TEMPLATE_REGISTRY_BY_KEY[g.key]?.name ?? templateDisplayName(g.key),
      description: TEMPLATE_REGISTRY_BY_KEY[g.key]?.description ?? TEMPLATE_DESCRIPTIONS[g.key] ?? null,
      // ★ `g.activeVersion` is now meaningfully `0` for a never-edited key (shipped default,
      //   active) — `|| null` would silently turn that back into the blank this fix removes.
      activeVersion: g.activeVersion ?? null,
      versions: g.versions.length,  // stored versions; 0 = the shipped default is in use
      origin: g.allOrigins.has("edited") ? "Edited" : "Shipped",
      usedBy: "Automation", // Stub for screen
    }));

  const total = filtered.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  return { rows: pageRows, total, page, pageSize: PAGE_SIZE };
}

// ★ the maintainer, 1 Oct 2026 — "names are confusing. Give every template a plain-English name and a
//   one-line description." `g.key.replace(/\./g, " ").replace(/_/g, " ")` produced things like
//   "money receipt" or "booking cancelled" — readable, but not a NAME a non-technical admin would
//   recognise as "the email that…". Title-cased, plus a one-line description for the keys this
//   session knows about; an unmapped key (a future addition, or a `custom.*` key) falls back to
//   the title-cased key and a null description rather than rendering blank.
function templateDisplayName(key) {
  return key
    .replace(/\./g, " — ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const TEMPLATE_DESCRIPTIONS = Object.freeze({
  "document.ready_to_sign": "Sent to the client/recipient when a document is sent for signature.",
  "booking.reminder": "A session reminder — sent to the client ahead of a booked session.",
  "money.invoice_issued": "Sent to the client when an invoice is raised.",
  "auth.invite": "Sent to a staff member invited to join the practice.",
  "auth.client_invite": "Sent to a client/parent invited to set up their client-portal account.",
  "auth.client_portal_link": "A reminder of where to sign in, for someone who already has a portal account.",
  "auth.email_code": "The one-time sign-in code, sent during email-code sign-in.",
  "auth.backup_codes_low": "Sent when a person's two-step backup codes are running low.",
  "auth.two_step_changed": "Sent when two-step sign-in is turned on, off, or reconfigured on an account.",
  "booking.confirmed": "Sent to the client when a session is booked.",
  "booking.moved": "Sent to the client when a booked session is rescheduled.",
  "booking.cancelled": "Sent to the client when their session is cancelled.",
  "money.receipt": "A payment confirmation — sent to the client after any successful charge.",
  "money.payment_failed": "Sent to the client when a card charge fails, with a link to update the card.",
  "money.update_card": "Sent to the client asking them to add or refresh a card on file.",
  "money.card_updated": "Sent to the client when their saved card is updated (e.g. a bank auto-update).",
  "money.card_removed": "Sent to the client when a saved card is removed from their account.",
  "money.card_expiring": "Sent to the client when a saved card is expiring soon.",
  "money.plan_started": "Sent to the client when a recurring plan/subscription starts.",
  "money.plan_cancelled": "Sent to the client when a recurring plan/subscription is cancelled.",
  "money.plan_paused": "Sent to the client when a recurring plan/subscription is paused.",
  "money.plan_resumed": "Sent to the client when a paused recurring plan/subscription resumes.",
  // ★ F836, "7 missing emails" brief, 1 Oct 2026.
  "documents.document_expired": "Sent to the staff member who sent a document, when it lapses unsigned.",
  "documents.document_declined": "Sent to the staff member who sent a document, when the signer declines it.",
  "money.credit_note_issued": "Sent to the client when a credit note is issued against their invoice.",
  "money.package_purchased": "Sent to the client when they purchase a package — distinct from the payment receipt.",
});

/**
 * GET /api/growth/templates/:key — fetch one template with all versions + variables
 * Response: {key, family, versions: [{v, subject, textBody, htmlBody, origin, active}], variables: []}
 */
async function getTemplate({ db, principal, tenantId, c }) {
  await mayCampaign(db, principal, "view");
  const key = c.req.param("key");

  // ★ Fetch all versions (active first, then by version desc)
  const { rows: versions } = await db.query(
    `SELECT version, family, subject, text_body, html_body, origin, active
     FROM keystone.email_template
     WHERE tenant_id = $1 AND key = $2
     ORDER BY active DESC, version DESC`,
    [tenantId, key]
  );

  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — `required` used to read DEFAULT_TEMPLATES's own sparse,
  //   mostly-empty `required` array (one real entry, `auth.client_invite`). That narrow "this link
  //   is critical, the save must keep it" check is preserved exactly (createTemplateVersion, below)
  //   — but `entry` (the registry's own record, which EVERY template has, not just the pre-Liquid
  //   48ish) is what makes this key resolvable at all, and is also where the "smart-field chips"
  //   the maintainer's Part 2 frontend ask names come from: every field THIS KEY's own Zod schema declares,
  //   not the generic ~32-field document-variable catalogue FieldPicker showed before (that
  //   catalogue has nothing to do with most templates — see TemplateEditor.jsx's own header note).
  const entry = TEMPLATE_REGISTRY_BY_KEY[key];
  const { DEFAULT_TEMPLATES } = await import("../email/defaultTemplates/index.mjs");
  const shippedForRequired = DEFAULT_TEMPLATES.find((t) => t.key === key);
  const required = shippedForRequired?.required ?? [];
  const schemaFields = entry
    ? Object.entries(entry.schema.def.shape).map(([name, def]) => ({
        name, required: def.def.type === "string" && !def.def.optional,
      }))
    : [];

  if (versions.length === 0) {
    if (!entry) throw notFound("no template with that key");
    const text = shippedAsText(entry);
    return {
      key,
      family: entry.family,
      versions: [{ v: 0, subject: text.subject, textBody: text.textBody, htmlBody: text.htmlBody, origin: "shipped", active: true }],
      variables: extractVarNames(text.subject + text.textBody),
      required,
      schemaFields,
    };
  }

  // ★ Extract variables from the body — `{{ name }}` Liquid syntax (see VAR_TOKEN_RE's own header).
  // ★ FIX, same pass — `subject` was never scanned here (pre-existing, not introduced by this
  //   fix), so a variable declared only in the subject line never appeared in the "detected"
  //   list shown in the editor, even though it renders correctly either way.
  const allText = versions.map((v) => (v.subject || "") + (v.text_body || "") + (v.html_body || "")).join("");
  const variables = extractVarNames(allText);

  return {
    key,
    family: versions[0].family || null,
    versions: versions.map((v) => ({
      v: v.version,
      subject: v.subject,
      textBody: v.text_body,
      htmlBody: v.html_body,
      origin: v.origin,
      active: v.active || false,
    })),
    variables,
    required,
    schemaFields,
  };
}

/**
 * POST /api/growth/templates — create a new version of a template
 * Body: {key, subject, htmlBody, textBody}
 * Response: {version, key} — 409 if key unknown and not custom.*
 * 400 if required variable missing (from renderTemplate rules)
 */
async function createTemplateVersion({ db, principal, tenantId, body }) {
  await mayCampaign(db, principal, "edit");
  const { key, subject, htmlBody, textBody } = body || {};

  if (!key || !subject) {
    throw invalid("key and subject are required");
  }

  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — key-existence used to check ONLY `DEFAULT_TEMPLATES`
  //   (the pre-Liquid 48ish), so none of Part 2's 70+ new registry-only keys could be saved here
  //   at all ("is not a known template key"). `TEMPLATE_REGISTRY_BY_KEY` is the real, complete set.
  const { DEFAULT_TEMPLATES } = await import("../email/defaultTemplates/index.mjs");
  const { rows: [existing] } = await db.query(
    `SELECT family FROM keystone.email_template WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  const entry = TEMPLATE_REGISTRY_BY_KEY[key];
  const shipped = DEFAULT_TEMPLATES.find((t) => t.key === key); // ★ only consulted for `required` below — see its own note.

  if (!existing && !entry && !key.startsWith("custom.")) {
    throw invalid(`"${key}" is not a known template key. Custom keys must start with "custom.".`);
  }

  // ★ Fetch the next version number
  const { rows: [lastVersion] } = await db.query(
    `SELECT MAX(version) as maxv FROM keystone.email_template WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key]
  );
  const nextVersion = (lastVersion?.maxv || 0) + 1;

  // ★ FIX, 1 Oct 2026 — `{{ name }}` Liquid syntax (VAR_TOKEN_RE's own header); was single-brace.
  const bodyText = (subject || "") + (textBody || "") + (htmlBody || "");
  const foundVars = new Set(extractVarNames(bodyText));

  // ★ the maintainer, 29 Sep 2026 — THE CHECK THIS ROUTE'S OWN DOCSTRING PROMISED AND NEVER RAN. `foundVars`
  //   was computed and never read against anything — a template whose `required` list (today only
  //   `auth.client_invite`'s `["acceptUrl"]`) names a placeholder could be saved with that
  //   placeholder missing, which for a sign-in link means an email with no way to sign in. Every
  //   OTHER shipped key declares no `required` list, so this changes nothing for them. ★ Still read
  //   from `DEFAULT_TEMPLATES`, deliberately — this is a narrow, hand-curated "this ONE field is
  //   too critical to let an edit silently drop" list, a different question from the Zod schema's
  //   "what does a render call need to supply" (every field a schema marks required is already
  //   enforced there, at send time, regardless of whether the SAVED TEXT happens to reference it).
  const requiredVars = shipped?.required ?? [];
  const missingRequired = requiredVars.filter((name) => !foundVars.has(name));
  if (missingRequired.length) {
    throw invalid(
      `this template needs {{ ${missingRequired.join(" }}, {{ ")} }} — the send has nowhere to point ` +
      `without it.`,
      { field: "textBody", missingRequired });
  }

  // ★ Insert the new version (origin='edited', not active yet)
  const family = existing?.family ?? entry?.family ?? key.split(".")[0];
  if (!String(textBody ?? "").trim()) throw invalid("the email needs a body");
  const { rows: [result] } = await db.query(
    `INSERT INTO keystone.email_template (tenant_id, key, family, subject, text_body, html_body, version, origin, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'edited', false, $8)
     RETURNING version`,
    [tenantId, key, family, subject, textBody, htmlBody || "", nextVersion, principal.appUserId]
  );

  return { version: result.version, key };
}

/**
 * POST /api/growth/templates/:key/activate — atomically activate a version
 * Body: {version: number}
 * Response: {version, key, active: true}
 * 409 if trying to edit a version that was ever active-at-send
 */
async function activateTemplate({ db, principal, tenantId, body, c }) {
  await mayCampaign(db, principal, "edit");
  const key = c.req.param("key");
  const { version } = body || {};

  if (!version || version < 1) {
    throw invalid("version must be a positive integer");
  }

  // ★ Verify the version exists
  const { rows: [versionRow] } = await db.query(
    `SELECT active FROM keystone.email_template
     WHERE tenant_id = $1 AND key = $2 AND version = $3`,
    [tenantId, key, version]
  );

  if (!versionRow) {
    throw invalid(`Version ${version} not found for key "${key}"`);
  }

  // ★ Database enforces one active per (tenant_id, key) via partial unique index.
  //   Two concurrent activates race on the DB; one wins, one gets UNIQUE violation.
  //   Convert to 409 (conflict) to signal immutability, not duplicate-key.
  try {
    await db.query(
      `UPDATE keystone.email_template SET active = false
       WHERE tenant_id = $1 AND key = $2 AND active = true`,
      [tenantId, key]
    );

    await db.query(
      `UPDATE keystone.email_template SET active = true
       WHERE tenant_id = $1 AND key = $2 AND version = $3
       RETURNING version`,
      [tenantId, key, version]
    );
  } catch (err) {
    if (err.code === "23505") { // UNIQUE violation
      throw conflict("Another activate just succeeded. Retry your activate.");
    }
    throw err;
  }

  // ★ Task 20.48: Emit growth.template.activated event
  const { rows: [row] } = await db.query(
    `SELECT id FROM keystone.email_template WHERE tenant_id = $1 AND key = $2 AND version = $3`,
    [tenantId, key, version]);
  await emit(db, {
    tenantId,
    topic: "growth.template.activated",
    emittedBy: "growth",
    subjectType: "email_template",
    subjectId: row.id,
    payload: { key, version },
  });

  return { version, key, active: true };
}

/**
 * POST /api/growth/templates/:key/reset — deactivate whatever version is active, so the SHIPPED
 * default takes over again (resolveTemplate.mjs: no active row → shipped default). the maintainer's own
 * Part 2 ask ("reset to default") — there was no route for it at all before this. A no-op, not an
 * error, when nothing is active (there is nothing to reset FROM, and "already at default" is a
 * success, not a failure). Stored versions are NOT deleted — they stay as history, same as every
 * other "undo" in this file (activating an old version does not delete the ones after it either).
 */
async function resetToDefault({ db, principal, tenantId, c }) {
  await mayCampaign(db, principal, "edit");
  const key = c.req.param("key");
  const { rows } = await db.query(
    `UPDATE keystone.email_template SET active = false
      WHERE tenant_id = $1 AND key = $2 AND active = true
      RETURNING id, version`,
    [tenantId, key]);
  if (rows.length === 0) return { key, wasActive: null, active: false };

  await emit(db, {
    tenantId,
    topic: "growth.template.activated",
    emittedBy: "growth",
    subjectType: "email_template",
    subjectId: rows[0].id,
    payload: { key, version: 0 },
  });

  return { key, wasActive: rows[0].version, active: false };
}

// ★ the maintainer, 29 Sep 2026 — GENERIC SAMPLE VALUES FOR A PREVIEW SEND. A test send's whole point is "show
//   me what this looks like" — it must never refuse for a variable a real send would require, and
//   it must never mail an unfilled `{name}` to a person's own inbox. Unknown names fall back to a
//   bracketed placeholder rather than guessing a value that could be mistaken for real data.
const TEST_SAMPLE_VALUES = Object.freeze({
  practiceName: "Sample Practice",
  recipientName: "Jordan Client",
  inviterName: "Alex Coach",
  personalLine: "",
  acceptUrl: "https://sample-practice.example.com/invite?token=sample-token",
  portalUrl: "https://sample-practice.example.com/login",
  expiresOn: new Date(Date.now() + 30 * 24 * 3600 * 1000).toDateString(),
  documentTitle: "Sample Agreement",
  link: "https://sample-practice.example.com/sample-link",
  serviceName: "Sample Session",
  whenLocal: "Monday, 1:00 PM",
  timeZone: "America/New_York",
  invoiceNumber: "INV-0001",
  amount: "$120.00",
  dueLocal: "in 7 days",
  code: "123456",
  minutes: "10",
  remaining: "5",
  what: "turned on",
  when: new Date().toDateString(),
});
// ★ PART 2 (worker-failures brief, 1 Oct 2026) — test-send now renders through the SAME one
//   renderer every other caller uses (src/email/liquidRenderer.mjs), replacing a FOURTH,
//   independent rendering path this route had built for itself (a `{name}` single-brace regex
//   filler, plus a direct call to the shipped default's own JS function) — the exact "two [really:
//   four] places decide what a template needs" shape the maintainer's brief named. `sampleValuesFor` fills
//   in any schema field TEST_SAMPLE_VALUES does not already define, from the registry's own Zod
//   schema, so no template with a field this map happened not to anticipate silently sends
//   "[fieldName]" the way the old regex filler did — it gets real sample text instead.
function sampleValuesFor(key) {
  const entry = TEMPLATE_REGISTRY_BY_KEY[key];
  if (!entry) throw notFound(`no template with that key`);
  const vars = {};
  for (const [fieldName, fieldDef] of Object.entries(entry.schema.def.shape)) {
    if (fieldDef.def.type === "string") {
      vars[fieldName] = TEST_SAMPLE_VALUES[fieldName] ?? `Sample ${fieldName}`;
    }
  }
  return vars;
}

/**
 * POST /api/growth/templates/:key/preview — render the CURRENTLY-EDITED (possibly unsaved) text
 * with sample values, through the one renderer, with NO send and no stored row required.
 *
 * ★★★ FIX, 1 Oct 2026 (Part 2 Addition) — the maintainer's own ask ("live preview through the one renderer")
 *     had NO route behind it at all in this file. Before this, the only way to see rendered output
 *     was "Send a test" — a real Resend send, every time, just to check how an edit reads.
 *     `previewLiquidTemplate` (src/email/liquidRenderer.mjs:140) was written FOR exactly this
 *     ("Run → Templates / the invoice editor's Email tab: render arbitrary (possibly unsaved)
 *     Liquid source... without touching any stored override row") but had no caller in this file
 *     until now.
 * Body: {subject, textBody} — the editor's current draft, saved or not.
 * Response: {subject, text}
 */
async function previewTemplate({ db, principal, tenantId, body, c }) {
  await mayCampaign(db, principal, "view");
  const key = c.req.param("key");
  const { subject, textBody } = body || {};
  if (typeof subject !== "string" || typeof textBody !== "string") {
    throw invalid("subject and textBody are required", { field: "textBody" });
  }
  const vars = sampleValuesFor(key);
  const { subject: filledSubject, text: filledText } = previewLiquidTemplate(key, subject, textBody, vars, {});
  return { subject: filledSubject, text: filledText };
}

/**
 * POST /api/growth/templates/:key/test-send — send the NAMED VERSION (stored or shipped) to the
 * caller's own address, filled with sample values. ★ the maintainer, 29 Sep 2026: was refused unconditionally
 * ("not built yet") — the sender it needed (one that can render a STORED, possibly-inactive version
 * rather than only the always-active shipped default) did not exist. This is that sender.
 */
async function testSendTemplate({ db, principal, tenantId, body, c }) {
  await mayCampaign(db, principal, "edit");
  const key = c.req.param("key");
  const { version } = body || {};
  if (version === undefined || version === null) throw invalid("version is required", { field: "version" });

  const vars = sampleValuesFor(key);
  let filledSubject, filledText;
  if (Number(version) > 0) {
    const { rows: [row] } = await db.query(
      `SELECT subject, text_body FROM keystone.email_template
        WHERE tenant_id = $1 AND key = $2 AND version = $3`,
      [tenantId, key, version]);
    if (!row) throw notFound(`version ${version} not found for "${key}"`);
    ({ subject: filledSubject, text: filledText } = previewLiquidTemplate(key, row.subject, row.text_body, vars, {}));
  } else {
    ({ subject: filledSubject, text: filledText } = renderLiquidTemplate(key, vars, {}));
  }

  const { rows: [tenant] } = await db.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const { rows: [me] } = await db.query(
    `SELECT email, display_name FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
    [principal.appUserId, tenantId]);
  if (!me?.email) throw notFound("your own record has no email to send a test to");

  const out = await deliverAsOrganisation(db, { tenantId, to: me.email, subject: `[TEST] ${filledSubject}`, text: filledText, fromNameSuffix: " (test)" });
  if (out.status === "skipped") return { sent: false, to: me.email, error: out.error };
  if (!out.ok) throw conflict(`the test could not be sent: ${out.error}`);

  return { sent: true, to: me.email };
}

/**
 * Register all six routes (list, get, create version, activate, preview, test-send).
 */
export function registerGrowthTemplatesRoutes(app, { runTenantScoped } = {}) {
  // GET /api/growth/templates — list templates
  app.get("/api/growth/templates", (c) =>
    runTenantScoped(c, listTemplates, { bucket: "list" }).then((r) => c.json(r))
  );

  // GET /api/growth/templates/:key — fetch template with versions
  app.get("/api/growth/templates/:key", (c) =>
    runTenantScoped(c, getTemplate, { bucket: "records" }).then((r) => c.json(r))
  );

  // POST /api/growth/templates — create new version
  app.post("/api/growth/templates", (c) =>
    runTenantScoped(c, createTemplateVersion, { bucket: "write", status: 201 }).then((r) => c.json(r, 201))
  );

  // POST /api/growth/templates/:key/activate — activate version
  app.post("/api/growth/templates/:key/activate", (c) =>
    runTenantScoped(c, activateTemplate, { bucket: "write" }).then((r) => c.json(r))
  );

  // POST /api/growth/templates/:key/preview — render the current draft, no send, no stored row
  app.post("/api/growth/templates/:key/preview", (c) =>
    runTenantScoped(c, previewTemplate, { bucket: "records" }).then((r) => c.json(r))
  );

  // POST /api/growth/templates/:key/reset — deactivate the active override, shipped default takes over
  app.post("/api/growth/templates/:key/reset", (c) =>
    runTenantScoped(c, resetToDefault, { bucket: "write" }).then((r) => c.json(r))
  );

  // POST /api/growth/templates/:key/test-send — test send to caller
  app.post("/api/growth/templates/:key/test-send", (c) =>
    runTenantScoped(c, testSendTemplate, { bucket: "write" }).then((r) => c.json(r))
  );
}
