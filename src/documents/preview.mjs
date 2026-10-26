// P15C.9 — PREVIEW. A TEMPLATE IS RENDERABLE BEFORE IT IS SENT, FOR BOTH BUILDERS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PREVIEW USES THE SAME RENDERER AS SIGNING, AND THAT IS THE ONLY VERSION WORTH HAVING.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A "preview" drawn by a second, simpler renderer answers the wrong question: it shows what the preview
// code thinks the template says, not what a client will actually see. The legacy system's whole failure
// class is two readers of one record.
//   ★★ But the renderers read a SNAPSHOT and refuse to fetch a template — deliberately (P15C.12). So
//      preview WRAPS the live body in a snapshot-shaped object and hands it to the same component.
//   ★★★ AND THE WRAPPER IS MARKED. `preview: true` and `law3_version: null` — because a preview is NOT
//        an instrument: nothing is frozen, no price is in force, and no disclosure has been accepted.
//        A preview that was indistinguishable from an executed snapshot could be stored as one, and then
//        an instrument would exist that nobody signed.
//
// ★ WHY `law3_version: null` RATHER THAN 1: `snapshot_is_readable` (0035) REQUIRES `law3_version = '1'`,
//   so a preview object physically cannot be written into `template_snapshot`. The marker is enforced by
//   the database rather than by everyone remembering what a preview is.

import { invalid, notFound } from "../http/errors.mjs";
import { parseTemplateBody } from "./body.mjs";
import { VARIABLES, buildFacts, resolveFields } from "./variables.mjs";
import { db, run } from "../db/kysely.mjs";
import { chromeInputsFor } from "./chromeInputs.mjs";
import { sampleSignedCopy } from "./signedCopySample.mjs";
import { buildDocumentView } from "./documentView.mjs";

/**
 * Wrap a live template body so the SIGNING renderer can draw it, without pretending it is an instrument.
 *
 * @param builder "contract" | "form" — from the template row, never from the body.
 * @param body    the live template body. VALIDATED here: a preview of an invalid body would show an
 *                author a document that could never be sent, which is worse than an error.
 * @param variables optional sample values. ★ ABSENT BY DEFAULT ON PURPOSE — see below.
 */
export function previewSnapshot(builder, body, { title = null, variables = null } = {}) {
  const parsed = parseTemplateBody(builder, body);
  if (title !== null && (typeof title !== "string" || !title.trim())) {
    throw invalid("a preview title must be a non-blank string when given");
  }
  return {
    // ★★★ NOT AN INSTRUMENT. Both markers, and the second one is enforced by 0035's CHECK.
    preview: true,
    law3_version: null,
    builder,
    title: title?.trim() || (builder === "contract" ? "Untitled agreement" : "Untitled form"),
    template_id: null,
    template: parsed,
    // ★★ VARIABLES ARE EMPTY BY DEFAULT, AND THAT IS THE POINT OF THE PREVIEW. P15C.9's red-first is
    //    that an unresolved variable shows its UNRESOLVED MARKER — so the DEFAULT preview shows the
    //    author exactly which values a real instrument will need. Filling them with plausible samples
    //    would hide the one thing the author needs to see.
    //  ★ A caller may pass samples deliberately (to check layout with long names), and then it is a
    //    choice rather than a default that conceals.
    variables: variables ?? {},
    terms: null,
    // ★★ NO PRICE AND NO DISCLOSURE. Neither exists yet: a price is frozen at execution from the
    //    time-windowed authority, and a disclosure is a fact about a SIGNER. Showing a price on a
    //    preview would show a number nobody has agreed to.
    price: null,
    disclosure: {
      status: "NO_CONSUMER_SIGNER",
      version: null,
      text: null,
      detail:
        "This is a PREVIEW of a template, not an instrument. No signer exists yet, so no " +
        "electronic-records disclosure has been accepted and none was owed.",
    },
  };
}

/**
 * ★ Is this object a preview rather than a real instrument? Exported so a surface can refuse to treat
 *   one as the other — e.g. a signing page must never accept a preview.
 */
export function isPreview(snapshot) {
  return Boolean(snapshot && snapshot.preview === true);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P9.5 — THE SNAPSHOT THE RENDERER WANTS, BUILT FROM THE INSTRUMENT AS STORED.
//
//     `previewSnapshot` above wraps a LIVE template so the signing renderer can draw it. This is the
//     other half: wrapping a SENT INSTRUMENT, so the same renderer draws that too. One renderer, two
//     wrappers, and neither is a second drawing — which is KS-8.3's ruling ("Preview is the real
//     renderer — never a second, simpler drawing") applied in both directions.
//
// ★★★ AND IT EXISTS BECAUSE THE STORAGE SHAPE AND THE RENDERER'S SHAPE GENUINELY DIFFER, which is a
//     fact worth naming rather than papering over. [MEASURED 2026-09-15]
//       · the INSTRUMENT stores `template_body_snapshot` = the body, with `values` INSIDE it (P9.1);
//       · `ContractRenderer` reads `snapshot.template` for the body and `snapshot.variables` for the
//         values (`renderContract.jsx:67-69`);
//       · and `pdf.mjs:213` reads `frozenBody.values`.
//     **Three readers, two conventions.** Handing the stored body straight to the renderer would draw
//     every variable as unresolved — a document that looks finished and says "[Client name — not
//     provided]" to the client holding it.
//   ★ So the translation happens ONCE, here, where both conventions are written down together.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Wrap a sent instrument's frozen body for the signing renderer.
 *
 * ★★ A MISSING FROZEN BODY RETURNS `null`, NOT AN EMPTY SNAPSHOT. The renderer's own refusal
 *    ("its frozen wording is missing, so there is nothing here that could be signed") is the correct
 *    behaviour, and it can only fire if it is handed nothing. A `{ template: null }` wrapper would
 *    render an article with a title and no terms — which is the exact instrument `renderExecutedPdf`
 *    already refuses to produce.
 *
 * @param row a `document_instance` row carrying at least id, title, builder, template_body_snapshot
 * @returns the renderer's snapshot shape, or null when there are no frozen words
 */
export function instrumentSnapshot(row) {
  const frozen = row?.template_body_snapshot ?? null;
  if (!frozen || typeof frozen !== "object") return null;

  // ★ `values` is destructured OFF the body: the renderer takes it as `variables`, and leaving a
  //   duplicate inside `template` would be two copies of one fact travelling together.
  const { values, ...body } = frozen;
  return {
    preview: false,
    // ★★ `law3_version: 1` because this IS an instrument — unlike a preview, which is marked null
    //    precisely so the database refuses to store it as one.
    law3_version: 1,
    builder: row.builder,
    title: row.title,
    template_id: row.template_id ?? null,
    template: body,
    variables: values ?? {},
    terms: null,
    price: null,
    disclosure: { status: "NO_CONSUMER_SIGNER", version: null, text: null,
                  detail: "the disclosure is a fact about a SIGNER and is recorded when they sign" },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FIX, 30 Sep 2026 (documents preview brief) — THE STAFF PREVIEW ROUTE `DocPreview.jsx`'S OWN
//     SUBTITLE SAID DID NOT EXIST. `previewSnapshot` (above) already builds the wrapper; nothing
//     called it with a REAL template body — the screen showed the smart-field catalogue's hardcoded
//     samples instead ("Dana Whitfield", "Sarah", "Bright Path" — the same on every template).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** ★ "Filled in for" — SAMPLE mode uses the variable catalogue's own `.sample` (what DocPreview.jsx
 *   showed before, now actually applied to the real document instead of standing in for it). */
function sampleVariables() {
  return Object.fromEntries(VARIABLES.map((v) => [v.name, v.sample]));
}

/** ★ "Filled in for" — a REAL person's actual resolved values, the same facts a real send would
 *   freeze (`resolveVariables`'s own `buildFacts`/`resolveFields` pair, just without an instance). */
async function realPersonVariables(tx, { tenantId, personId }) {
  const facts = await buildFacts(tx, { tenantId, personId, audience: "admin" });
  return resolveFields(VARIABLES, facts).values;
}

/**
 * Fetch a live template and wrap it for the SAME renderer signing/the PDF use — `personId` picks a
 * real person's resolved values, its absence picks the catalogue's sample values. Never both: a
 * preview is either "here is what a real value looks like in general" or "here is what THIS person's
 * document says", and conflating them would show a stranger's data next to another's placeholder.
 * @returns {Promise<{snapshot:object, body:object, builder:string, title:string}>}
 */
export async function fetchTemplatePreview(tx, { tenantId, templateId, personId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "builder", "name", "body"])
    .where("id", "=", templateId)
    .where("tenant_id", "=", tenantId));
  const row = rows[0];
  if (!row) throw notFound("That template is not in this workspace.");

  const body = parseTemplateBody(row.builder, row.body);
  const variables = personId
    ? await realPersonVariables(tx, { tenantId, personId })
    : sampleVariables();

  const snapshot = previewSnapshot(row.builder, body, { title: row.name, variables });
  return { snapshot, body, builder: row.builder, title: row.name };
}

/**
 * ★ QUEUE §23.3.1 — THE TWO PREVIEWS, FROM THE ONE DOCUMENT VIEW. `signing` is "as the client sees it" (every signature slot pending); `signed` is "as the signed copy" (each slot shown signed by a made-up person of
 *   that party, with a made-up certificate), drawn with the practice's current settings AND this template's own override. Both come from the SAME `buildDocumentView` the real signing page and the real
 *   signed PDF use, with the same settings, so what is previewed is exactly what will be sent and signed.
 * @returns {Promise<{view:object}>}
 */
export async function templateViewFor(tx, { tenantId, templateId, personId = null, mode = "signing" }) {
  if (mode !== "signing" && mode !== "signed") throw invalid('mode must be "signing" (as the client sees it) or "signed" (as the signed copy)');
  const { snapshot, body, builder, title } = await fetchTemplatePreview(tx, { tenantId, templateId, personId });
  const chrome = await chromeInputsFor(tx, { tenantId, templateId });
  const documents = [{ title, builder, body, values: snapshot.variables }];
  const input = { mode, title, documents, settings: chrome.settings, brand: chrome.brand, zone: chrome.zone, sample: mode === "signed" };
  if (mode === "signed") {
    const sample = sampleSignedCopy();
    const owners = [...new Set((body.sections ?? []).flatMap((sec) => (sec.blocks ?? []).filter((b) => b.type === "signature").map((b) => b.owner ?? sec.owner)))];
    const when = ["2026-01-15T17:30:00.000Z", "2026-01-15T18:05:00.000Z", "2026-01-15T18:40:00.000Z", "2026-01-15T19:10:00.000Z"];
    const signatures = (owners.length ? owners : ["client"]).map((role, i) => ({ role, signerName: `Sample ${role === "pir" || role === "client" ? "Client" : role}`, signedAt: when[i % when.length], signerTimezone: chrome.zone, signedLocalDate: "2026-01-15", markImage: null }));
    input.signatures = signatures;
    input.documentId = "SAMPLE-0000";
    input.executedAt = when[(signatures.length - 1) % when.length];
    input.certificate = { ...sample.certificate, parties: signatures.map((sg, i) => ({ ...sample.certificate.parties[i % 2], name: sg.signerName, role: sg.role, signedAt: sg.signedAt })) };
    input.verifyUrl = "https://example.com/verify";
  }
  return { view: buildDocumentView(input) };
}

/**
 * ★ F130 (23 Oct 2026) — ONE SENT DOCUMENT, AS IT READS NOW, for the staff record page (/record/document/<id>). Drawn from the SAME `buildDocumentView`
 *   the signing page and the signed PDF use, from the words frozen at send (`template_snapshot` once executed, else `template_body_snapshot`), with every
 *   signature recorded so far. `signed` mode once executed (the certificate rides in the PDF download, not here); `signing` before that.
 * @returns {Promise<{view:object|null, state:string, builder:string, signed:boolean}>}
 */
export async function instanceViewFor(tx, { tenantId, instanceId }) {
  const { rows: [i] } = await tx.query(
    `SELECT id, title, state, builder, template_id, executed_at, template_snapshot, template_body_snapshot
       FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!i) throw notFound("That document is not in this workspace.");
  const out = { view: null, state: i.state, builder: i.builder, signed: i.state === "executed" };
  if (i.builder !== "contract") return out;
  const parse = (v) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
  const snap = parse(i.template_snapshot);
  const frozen = snap?.template ?? parse(i.template_body_snapshot);
  if (!frozen || typeof frozen !== "object") return out;
  const { values, ...body } = frozen;
  const { rows: sigs } = await tx.query(
    `SELECT role, signer_name, signed_at, signed_local_date, signer_timezone, mark_image
       FROM keystone.signature_record WHERE instance_id = $1 ORDER BY signer_order, signed_at`, [instanceId]);
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
  const chrome = await chromeInputsFor(tx, { tenantId, templateId: i.template_id });
  const mode = i.state === "executed" ? "signed" : "signing";
  out.view = buildDocumentView({
    mode, title: i.title ?? "Document", documentId: i.id,
    documents: [{ title: i.title ?? "Document", builder: "contract", body, values: values ?? {} }],
    signatures: sigs.map((s) => ({ role: s.role, signerName: s.signer_name, signedAt: iso(s.signed_at), signedLocalDate: s.signed_local_date, signerTimezone: s.signer_timezone, markImage: s.mark_image ?? null })),
    settings: chrome.settings, brand: chrome.brand, zone: chrome.zone, executedAt: iso(i.executed_at),
  });
  return out;
}
