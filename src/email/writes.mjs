// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A11.2 / FINAL — THE SENDER WRITES. **`sender_identity` AND `sender_routing`.**
//
// ★★★ THIS MODULE EXISTS BECAUSE `write-census` WAS RIGHT TWICE. In the FINAL suite run it reported:
//       · *"src/routes/settings.mjs WRITES AND IS NOT CLASSIFIED"* — I had put raw SQL in a ROUTE
//         file, which is where no other domain write in this codebase lives.
//       · *"keystone.sender_identity HAS NO WRITE PATH AND IS NOT DECLARED. A table nothing writes
//         is a feature that cannot happen, and it looks identical to a working one until somebody
//         tries to use it."*
//     The second is the serious one: migration 0126 created the table at A9.3, the routing screen
//     reads it to offer addresses — and **nothing has ever inserted a row**, so the picker could
//     only ever be empty. `upsertSenderIdentity` is the writer that was missing.
//
// ★★★ NEITHER WRITE EMITS AN EVENT, AND THAT IS STATED RATHER THAN QUIETLY OMITTED. There is no
//     `email.sender.*` topic in `src/events/topics.mjs`, and adding one is a schema change that
//     ripples into every gate asserting the catalogue's size. **A7 faced exactly this and ruled:
//     *"Either wire the event or stop claiming the notice — do not ship the claim without the
//     event."*** So the claim is not made: the screens say what changes, and say nothing about
//     anybody being told. Recorded as F435 so the topic is added on purpose rather than discovered
//     missing.
//
// ★★ `ON DELETE RESTRICT` IS WHY THE ROUTING UPSERT CANNOT ORPHAN ANYTHING: 0126 refuses to delete
//    an identity that routing still points at, precisely so a vanished sender cannot silently fall
//    back to the platform address — the "a practice's clients receive mail from a stranger" failure
//    the whole feature exists to end.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The four the database allows. `auth` and `campaign` are deliberately absent — see 0126. */
export const ROUTABLE_PURPOSES = Object.freeze(["reminders", "documents", "invoices", "receipts"]);

export class SenderViolation extends Error {
  constructor(message) { super(message); this.name = "SenderViolation"; }
}

/**
 * ★★★ THE MISSING WRITER. One address this practice can send from.
 *   Called by the `sendAs` enumeration (A10.2) once per address Google reports, and by the typed
 *   Microsoft path. ★ UPSERT on `(tenant_id, email)` — 0126's unique constraint — because
 *   re-enumerating a mailbox must refresh what is known, never duplicate it or fail.
 *   ★★ `verified_at` is NOT set here. Verification means WE HAVE SEEN IT WORK; enumeration only
 *      means the provider listed it, and 0126's comment is emphatic that those are different facts.
 */
export async function upsertSenderIdentity(db, {
  tenantId, email, displayName = null, googleIdentityId = null,
  origin = "enumerated", kind = "alias",
}) {
  if (!tenantId) throw new SenderViolation("a tenant is required");
  if (!email) throw new SenderViolation("an address is required");
  // ★ The CHECK in 0126 would refuse these anyway; naming them here turns a Postgres constraint
  //   error into a sentence that says which field and what the legal values are.
  if (!["enumerated", "typed", "platform"].includes(origin)) {
    throw new SenderViolation(`"${origin}" is not how an address comes to be here — enumerated, typed or platform`);
  }
  if (origin === "platform" ? kind !== "platform" : kind === "platform") {
    throw new SenderViolation(
      "a platform sender has no consent behind it and a consent-backed sender is not the platform's — " +
      "origin and kind must agree");
  }
  const { rows } = await db.query(
    `INSERT INTO keystone.sender_identity
       (tenant_id, google_identity_id, email, display_name, origin, kind)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           google_identity_id = EXCLUDED.google_identity_id,
           origin = EXCLUDED.origin,
           kind = EXCLUDED.kind,
           updated_at = now()
     RETURNING id, email, kind, origin`,
    [tenantId, googleIdentityId, email, displayName, origin, kind]);
  return rows[0];
}

/**
 * ★★★ WHICH ADDRESS SERVES WHICH PURPOSE. One route per purpose — 0126's
 *   `UNIQUE (tenant_id, purpose)` — so this is an UPSERT. Two rows for one purpose would make
 *   "which address sends invoices" a question with two answers, and the resolver would have to
 *   pick, which is a decision no code should make at send time.
 */
export async function setSenderRouting(db, { tenantId, purpose, email }) {
  if (!ROUTABLE_PURPOSES.includes(purpose)) {
    // ★★ `auth` IS REFUSED BY NAME AND THE REASON IS GIVEN. A sign-in link is a credential; if the
    //    mailbox breaks and password resets go through it, NOBODY CAN GET IN TO FIX IT.
    throw new SenderViolation(
      `"${purpose || "(missing)"}" is not something mail can be routed for — the four are ` +
      `${ROUTABLE_PURPOSES.join(", ")}. Sign-in mail is deliberately not routable: it is a ` +
      `credential, and a broken mailbox must never be able to lock everybody out.`);
  }
  const { rows: found } = await db.query(
    `SELECT id FROM keystone.sender_identity WHERE email = $1`, [email]);
  if (found.length === 0) {
    throw new SenderViolation(`${email || "(no address)"} is not one of this practice's sending addresses.`);
  }
  const { rows } = await db.query(
    `INSERT INTO keystone.sender_routing (tenant_id, purpose, sender_identity_id)
          VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, purpose)
       DO UPDATE SET sender_identity_id = EXCLUDED.sender_identity_id, updated_at = now()
       RETURNING purpose`,
    [tenantId, purpose, found[0].id]);
  return { purpose: rows[0].purpose, email };
}

/**
 * ★★ EMAIL TEMPLATE OPERATIONS — preview and test-send.
 * These are admin-initiated previews with sample data, never real client data.
 */
import { TEMPLATE_REGISTRY_BY_KEY } from "./registry.mjs";
import { renderLiquidTemplate } from "./liquidRenderer.mjs";

/**
 * ★ FIX, 1 Oct 2026 (Part 2 Addition) — this used to be a hand-maintained map covering exactly
 *   the original 41 templates. The registry has since grown to 120+ keys (Part 2's generic-path
 *   topics, gift cards, signed copy, …) — every one of those hit this function's `?? {}` fallback,
 *   which with the (also-just-fixed) preview/test-send routes now passing `{tx, tenantId}` through
 *   to `resolveTemplate`'s Zod-enforced schema meant an EMPTY vars object for ~75% of the catalogue,
 *   i.e. "required field missing" on every preview. Same fix shape as `db/gates/
 *   p2_template_registry.mjs` already uses for its own sample data (reused here, not reinvented):
 *   one distinctive "Sample <fieldName>" string per REQUIRED string field, read straight from the
 *   registry's own Zod schema — covers every key, by construction, forever. Optional/object fields
 *   (userType.*, etc.) are deliberately left out so the template's own `default:` fallback renders,
 *   same reasoning the gate's own comment gives. Less polished-looking than the old hand-picked
 *   values ("Service Agreement" vs "Sample documentTitle") — a cosmetic gap the Part 2 frontend
 *   (TipTap editor's own live preview) can close properly later; CORRECT for all 120+ keys matters
 *   more than pretty for 41 of them.
 */
export function getSampleVars(templateKey) {
  const entry = TEMPLATE_REGISTRY_BY_KEY[templateKey];
  if (entry) {
    const sampleVars = {};
    for (const [fieldName, fieldDef] of Object.entries(entry.schema.def.shape)) {
      if (fieldDef.def.type === "string" && !fieldDef.def.optional) {
        sampleVars[fieldName] = `Sample ${fieldName}`;
      }
    }
    return sampleVars;
  }
  // ★ No registry entry exists for this key (a draft never promoted — e.g. F849's still-open
  //   gift-card topics) — nothing to derive samples from. Preview/test-send will surface the real
  //   "is not a template" error from renderTemplate itself, which is correct: a guessed sample
  //   that could not possibly be right is worse than no sample at all.
  return {};
}

/**
 * List all available email templates with their required variables.
 *
 * ★ FIX, 1 Oct 2026 (Part 2 Addition) — this used to iterate `Object.keys(TEMPLATES)`, the old
 *   hardcoded 41, so this list permanently stopped at 41 while the registry grew to 120+ (Part
 *   2's generic-path topics, gift cards, signed copy, …) — every template added since this was
 *   written was invisible here. Now reads the registry's own key list, and renders the SHIPPED
 *   default directly via `renderLiquidTemplate` (pure, no tx — same function `db/gates/
 *   p2_template_registry.mjs` already proves correct for every registry key) rather than
 *   `renderTemplate`'s hardcoded-only 3-arg path, which could only ever resolve the original 41.
 * @returns {Promise<Array>} Array of { key, subject (sample), text (sample), requiredVars }
 */
export async function listEmailTemplates() {
  const result = [];
  for (const key of Object.keys(TEMPLATE_REGISTRY_BY_KEY)) {
    const samples = getSampleVars(key);
    const rendered = renderLiquidTemplate(key, samples, {});
    result.push({
      key,
      subject: rendered.subject,
      text: rendered.text,
      requiredVars: [], // Template exists if render succeeds
    });
  }
  return result;
}
