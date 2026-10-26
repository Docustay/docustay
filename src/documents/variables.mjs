// @ts-check
// P9.1 — WHAT A VARIABLE RESOLVES TO, AND WHEN.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ BOTH RENDERERS READ `values` AND NOTHING HAS EVER WRITTEN IT. [MEASURED 2026-09-15]
//     `src/documents/pdf.mjs:213` reads `section.values?.[block.name] ?? frozenBody.values?.[block.name]`
//     and `web/src/esign/renderContract.jsx:103` resolves the same way — both carefully, both with a
//     designed unresolved state. **There is no `values:` assignment anywhere in `src/`.** So every
//     variable block in the system renders `[Label — not provided]`, permanently, and always has.
//   ★★ The read side is finished and the write side does not exist. That is why P9.1's own
//      instruction is *"a variable picker that inserts `{{client.name}}` AND SHOWS WHAT IT RESOLVES
//      TO"* — a picker without this module would insert tokens that can never resolve, and
//      `ContractTemplateForm`'s header already refuses to draw one for exactly that reason.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ VALUES FREEZE AT **SEND**, WITH THE WORDS. THIS IS THE LOAD-BEARING DECISION.
//
//     §M0 LAW 3 freezes the template BODY at send, because a signer agrees to the words they were
//     shown. The VALUES are part of what they were shown. If a variable resolved at RENDER instead:
//       · a client who changes their surname next year would silently rewrite an agreement they
//         already signed, and
//       · reprinting an executed instrument would produce a different document from the one in the
//         file — with no record that it had changed.
//   ★★ So `resolveVariables` runs ONCE, inside `sendInstance`'s transaction, and the result is
//      written into `template_body_snapshot.values` beside the frozen body. After that the renderers
//      are pure: they read the snapshot and nothing else, which is what makes reprinting safe.
//   ★ A variable that could not be resolved at send is left ABSENT rather than written as an empty
//     string, so the renderers' `[Label — not provided]` branch still fires. An empty string looks
//     like a deliberate blank; absence looks like what it is.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE CATALOGUE IS CLOSED, AND THAT IS THE WHOLE SAFETY PROPERTY.
//     A picker that offered free text would let an author type `{{clint.name}}` and ship an
//     agreement with a permanent hole in it — discovered by the client, not by us. Every entry here
//     names the query that produces it, so the builder can only offer variables that resolve and the
//     server can REFUSE a body naming one it does not know (`assertVariablesResolvable`).
//   ★★ AND EVERY ENTRY CARRIES A `sample` — the builder shows the author what this will look like on
//      a real instrument. "Shows what it resolves to" is not decoration: an author who cannot see
//      the difference between `client.name` and `client.first_name` will pick wrong, and the first
//      time anyone finds out is on a signed document.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★ ONE ROW PER VARIABLE. `read` receives the facts gathered once below, so adding a variable never
 *    adds a query — and a variable whose fact is not gathered cannot be added by accident.
 */
// ★★★ THE CATALOGUE LIVES IN `variableCatalogue.mjs` AND IS RE-EXPORTED HERE — A MOVE, NOT A FORK.
//     Split at A5.1 so the builder's variable picker can import it in a BROWSER; this file cannot
//     be loaded there (`invalid` reaches `node:crypto`). Every existing importer resolves unchanged.
export { VARIABLES } from "./variableCatalogue.mjs";
import { VARIABLES, isCustomVariable, readCustomVariable } from "./variableCatalogue.mjs";
import { getDocumentSetting } from "./settings.mjs";
import { ports } from "./ports.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

export const VARIABLE_NAMES = Object.freeze(VARIABLES.map((v) => v.name));

/** ★ What the builder shows: name, label and what it will actually look like. */
// ★ The CONTRACTS §SF role-filtered projection for the builders' variables payload.
export function variableCatalogue(role = 'admin') {
  return VARIABLES.map(({ name, label, sample, why, domain: catalogueDomain }) => ({
    name, label, sample, why,
    // ★ FIELD_DOMAINS maps domain names; this adds them to the builder's payload.
    // The field's read() function determines its domain via its key structure (person.*, booking.*, etc).
    domain: catalogueDomain,
  }));
}

/**
 * ★★★ REFUSE A BODY NAMING A VARIABLE NOTHING CAN RESOLVE — at authoring time, not at send.
 *     The cost of catching it late is the whole point: by send, the instrument is in front of a
 *     client with a hole in it, and the author is not in the room.
 * @returns {string[]} the unknown names, empty when the body is fine
 */
export function unknownVariables(body) {
  const seen = new Set();
  for (const section of body?.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block?.type === "variable" && !VARIABLE_NAMES.includes(block.name) && !isCustomVariable(block.name)) seen.add(block.name);
    }
  }
  return [...seen];
}

/** ★ The same check as a refusal, for the write path. */
export function assertVariablesResolvable(body) {
  const bad = unknownVariables(body);
  if (bad.length === 0) return;
  throw new Error(
    `this contract names ${bad.length} variable(s) nothing can resolve: ${bad.join(", ")}. ` +
    `The resolvable ones are ${VARIABLE_NAMES.join(", ")}. ★ A variable with no resolver prints ` +
    `"[label — not provided]" on a signed agreement, and the client is who finds out.`);
}

/**
 * ★★ Build facts for one person/document/invoice in ≤7 queries.
 * Compute the needed-domain set from VARIABLES first, then query only those domains.
 * Money domain is SKIPPED unless audience permits it — F18 §3.2 rule.
 *
 * ★ AUDIENCE REDACTION AT THE PAYLOAD CHOKEPOINT: A staff-audience render issues ZERO
 * money-domain queries and carries ZERO money keys in its facts.
 *
 * @param {object} args - {tenantId, personId?, instanceId?, invoiceId?, bookingId?, audience}
 * @returns {Promise<object>} facts object ready for resolveFields
 */
export async function buildFacts(tx, { tenantId, personId, instanceId, invoiceId, bookingId, audience = 'admin' }) {
  const facts = {};

  // Start with essential queries
  if (instanceId) {
    const { rows: [instance] } = await tx.query(
      // ★ version is the TEMPLATE's; the signer names come from signature_record. There is no
      //   certificate reference column anywhere yet (F-R2-5) — it resolves to nothing, honestly.
      //   Camel-quoted: the catalogue reads f.instance.signerName / .certificateRef.
      `SELECT i.id, i.title, t.version, i.subject_user_id,
              (SELECT string_agg(sr.signer_name, ', ' ORDER BY sr.signer_order)
                 FROM keystone.signature_record sr
                WHERE sr.instance_id = i.id AND sr.signed_at IS NOT NULL) AS "signerName",
              NULL::text AS "certificateRef"
         FROM keystone.document_instance i
         LEFT JOIN keystone.document_template t ON t.id = i.template_id
        WHERE i.id = $1 AND i.tenant_id = $2`,
      [instanceId, tenantId]);
    facts.instance = instance;
  }

  // ★ everything that is NOT the document itself — the practice, its settings, the person, the booking, the invoice, the subscription — comes from the
  //   host through the FACTS PORT (src/documents/ports.mjs). Money facts are never gathered for a staff audience (the port is told the audience).
  const P = await ports();
  Object.assign(facts, await P.facts.gather(tx, {
    tenantId, personId, subjectId: facts.instance?.subject_user_id, bookingId, invoiceId, audience,
  }));

  // ★ QUEUE §23.3.3 — the ISLAND's own facts: the signer, the sender, the organisation, and this send's custom values. The people come from the people port (never a host table), the org from the brand port.
  {
    const subjectId = facts.instance?.subject_user_id ?? personId ?? null;
    const row = instanceId ? (await tx.query(`SELECT created_by, custom_values FROM keystone.document_instance WHERE id = $1`, [instanceId])).rows[0] : null;
    const ids = [subjectId, row?.created_by].filter(Boolean);
    const people = new Map((ids.length ? await P.people.byIds(tx, ids) : []).map((p) => [p.id, p]));
    const signer = subjectId ? people.get(subjectId) : null;
    const sender = row?.created_by ? people.get(row.created_by) : null;
    facts.signer = signer ? { name: signer.display_name ?? null, email: signer.email ?? null } : null;
    facts.sender = sender ? { name: sender.display_name ?? null, email: sender.email ?? null } : null;
    const brand = await P.brand.get(tx, { tenantId });
    facts.org = { name: brand.practiceName || brand.tenantName || null, logo: brand.logoUrl ?? null, address: (await getDocumentSetting(tx, "signed_copy.address_line")) || null };
    facts.custom = row?.custom_values ?? {};
  }

  // Set sentOn for document date
  if (facts.tenant?.sent_on) {
    facts.sentOn = facts.tenant.sent_on;
  }

  return facts;
}

/**
 * Build facts for multiple people in a batch — same query optimization as buildFacts.
 * Returns a Map<personId, facts>.
 *
 * @param {object} tx - transaction
 * @param {string} scope - 'tenant' or other scope identifier
 * @param {string[]} personIds - array of person IDs to build facts for
 * @returns {Promise<Map<string, object>>} personId → facts
 */
export async function buildFactsBatch(tx, scope, personIds) {
  if (!personIds.length) return new Map();

  const tenantId = scope; // For now, scope is the tenantId
  const result = new Map();

  // The people, the practice and its settings, from the host through the facts port
  const { tenant, settings, people: personMap } = await (await ports()).facts.gatherBatch(tx, tenantId, personIds);

  // Build facts for each person
  for (const personId of personIds) {
    const facts = {
      person: personMap.get(personId),
      tenant,
      settings,
    };
    result.set(personId, facts);
  }

  return result;
}

/**
 * ★★ Resolve a field list against facts: pure function, no queries.
 * Returns values for resolvable fields and identifies missing required facts.
 *
 * ★ A variable that resolves to null or an empty string is OMITTED.
 *
 * @param {object[]} fields - field objects with `name` property
 * @param {object} facts - pre-built facts from buildFacts
 * @returns {object} {values: Record<string,string>, missingRequired: string[]}
 */
export function resolveFields(fields, facts) {
  const values = {};
  const missingRequired = [];

  for (const field of fields) {
    // ★ `custom.<key>` — a value the sender supplied for this send (API / CSV); free names, no catalogue entry
    if (isCustomVariable(field.name)) {
      const raw = readCustomVariable(facts, field.name);
      if (raw === null || raw === undefined || raw === "") missingRequired.push(field.name);
      else values[field.name] = String(raw);
      continue;
    }
    // Find the variable definition
    const variable = VARIABLES.find(v => v.name === field.name);
    if (!variable) {
      missingRequired.push(field.name);
      continue;
    }

    // Read the value from facts
    const raw = variable.read(facts);

    // Check if required
    if ((raw === null || raw === undefined || raw === "") && variable.fallback === null) {
      missingRequired.push(field.name);
      continue;
    }

    // Use fallback if needed
    const value = raw ?? variable.fallback;
    if (value !== null && value !== undefined && value !== "") {
      values[field.name] = String(value);
    }
  }

  return { values, missingRequired };
}

/**
 * Resolve every variable for one instrument, ONCE, at send.
 * ★★ SIGNATURE UNCHANGED — reimplemented on buildFacts/resolveFields.
 *
 * ★★ ONE QUERY PER FACT, NOT ONE PER VARIABLE. Six variables reading four facts should be four
 *    reads; a per-variable resolver would issue six and grow with the catalogue.
 * ★ A variable that resolves to null or an empty string is OMITTED from the result — see the header.
 *
 * @returns {Promise<Record<string,string>>} name → value, for the names that resolved
 */
export async function resolveVariables(tx, { tenantId, instanceId }) {
  const facts = await buildFacts(tx, { tenantId, instanceId, audience: 'admin' });

  if (!facts.instance) {
    throw new Error(`cannot resolve variables for instrument ${instanceId} — it is not visible here`);
  }

  // Resolve all variables using the pure resolver
  const { values } = resolveFields(VARIABLES, facts);
  // this send's own `custom.<key>` values (supplied by the API or a CSV) ride along, resolved once, frozen with the words
  for (const [k, v] of Object.entries(facts.custom ?? {})) if (v !== null && v !== undefined && v !== "") values[`custom.${k}`] = String(v);
  return values;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FIX, 30 Sep 2026 (documents "smart fields in the Message" brief) — THE MESSAGE HAD NO PICKER
//     AND WAS SENT WORD FOR WORD. the maintainer wants `{{person.first_name}}` in the Message box, resolved to
//     EACH recipient's own value — "Good afternoon Example…" per person, not one shared sentence.
// ★ TOKEN SYNTAX IS `{{name}}`, THE SAME `name` THE CLOSED CATALOGUE ALREADY USES — never a second
//   vocabulary next to the one `assertVariablesResolvable` already enforces for the document body.
// ★ RESOLVED ONCE, AT SEND, THE SAME MOMENT THE BODY'S `values` ARE FROZEN (§P9.1) — never at
//   render, for the identical reason: a client's name changing next year must not rewrite an email
//   already sent, and reprinting is not this module's problem to begin with (an email is not stored).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const MESSAGE_TOKEN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g;

/** ★ Every `{{name}}` token actually present in a message/description template — used to warn an
 *  author about a token naming a variable outside the catalogue, the same posture
 *  `assertVariablesResolvable` already takes for the document body. */
export function messageTemplateTokens(template) {
  if (!template) return [];
  return [...new Set([...template.matchAll(MESSAGE_TOKEN)].map((m) => m[1]))];
}

/**
 * Substitute every `{{name}}` token in a message/description template with ONE recipient's own
 * resolved value. A token naming a variable outside the catalogue, or one that did not resolve for
 * THIS person, falls back to that variable's own declared fallback text, or an empty string when it
 * has none — never the raw `{{token}}` left showing in an email a client reads.
 * @param {string|null} template
 * @param {Record<string,string>} values from `resolveFields`/`resolveVariables`
 * @returns {string|null}
 */
export function resolveMessageTemplate(template, values) {
  if (!template) return template;
  return template.replace(MESSAGE_TOKEN, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
    const variable = VARIABLES.find((v) => v.name === name);
    return variable?.fallback ?? "";
  });
}
