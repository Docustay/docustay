// The starter templates (Part 31 item 4). Each is HTML with text tags; `starterFields(slug)` reads the tags with the product's own parser, so the seats and fields a site page promises are the ones the document will have.
import { CONTRACTS } from "./contracts.mjs";
import { CONSENTS } from "./consent.mjs";
import { HR } from "./hr.mjs";
import { MONEY } from "./money.mjs";
import { DRAFTS } from "./drafts.mjs";
import { FORM_STARTERS as FORMS, FORM_CATEGORIES } from "./forms.mjs";
import { findTags, parseTag } from "../textTags.mjs";
import { FILLED_BY_SENDER } from "./filledBy.mjs";

/** Held back from the public site until this is true (site pass 2, specs/final-push/NEW-TEMPLATES-FOR-TY.md). While false, nothing outside this folder can see the three drafts. */
const PUBLISH_DRAFT_STARTERS = false;

/** Writes `filled=sender` (and `from=…`) into the tags the table names (filledBy.mjs), by the box's label or its name. Leaves every other tag as it is. */
const unesc = (x) => x.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’");
function markSender(s) {
  const marks = FILLED_BY_SENDER[s.slug];
  if (!marks) return s;
  const html = s.html.replace(/\{\{([^{}\n]{1,600})\}\}/g, (m, inner) => {
    const p = parseTag(unesc(inner)); if (!p || p.error) return m;
    const from = marks[p.spec.label] ?? marks[p.name];
    if (from === undefined || p.spec.sender) return m;
    return `{{${inner};filled=sender${typeof from === "string" ? `;from=${from}` : ""}}}`;
  });
  return { ...s, html };
}

const NEW = [...CONTRACTS, ...CONSENTS, ...HR, ...MONEY, ...(PUBLISH_DRAFT_STARTERS ? DRAFTS : [])];
const DRAFT_STARTERS = Object.freeze(DRAFTS.map((s) => Object.freeze({ paper: "letter", language: "en", ...s })));   // for the review pack and tests only
export const STARTERS = Object.freeze(NEW.map((s) => Object.freeze(markSender({ paper: "letter", language: "en", ...s }))));
/** The thirty form templates (Run 7 part 3): kept apart from STARTERS so the document gallery is unchanged; `starter()` finds either kind. */
export const FORM_STARTERS = Object.freeze(FORMS.map((s) => Object.freeze(markSender({ ...s }))));
export { FORM_CATEGORIES };
export const starter = (slug) => STARTERS.find((s) => s.slug === slug) ?? FORM_STARTERS.find((s) => s.slug === slug) ?? null;

/** The seats (in order of first appearance, as the converter numbers them) and the fields of a starter, read with the product's own tag parser. `problems` is every tag the parser refuses or warns about: it must be empty. */
export function starterFields(slugOrStarter) {
  const s = typeof slugOrStarter === "string" ? starter(slugOrStarter) : slugOrStarter;
  if (!s) return null;
  const roles = [], fields = [], problems = [];
  const tags = findTags(s.html), signing = new Set(tags.filter((t) => !t.parsed.error && !t.parsed.spec.sender).map((t) => t.parsed.role.toLowerCase()));
  for (const t of tags) {
    const p = t.parsed;
    if (p.error) { problems.push(p.error); continue; }
    for (const w of p.warnings ?? []) problems.push(`${p.name}: ${w}`);
    const k = p.role.toLowerCase();
    if (signing.has(k) && !roles.some((r) => r.toLowerCase() === k)) roles.push(p.role);
    fields.push({ name: p.name, type: p.spec.type, role: p.role, k, sender: p.spec.sender === true, from: p.spec.default?.match(/^\{\{(.+)\}\}$/)?.[1] ?? null, required: p.spec.required !== false, label: p.spec.label, options: p.spec.options ?? null });
  }
  // the seat each box sits on, as the converter gives it (a box the sender fills makes no seat: it sits on its role's seat, or the first)
  for (const f of fields) { const i = roles.findIndex((r) => r.toLowerCase() === f.k); f.seat = `signer_${i >= 0 ? i + 1 : 1}`; delete f.k; }
  return { roles: roles.map((r, i) => ({ role: r, seat: `signer_${i + 1}` })), fields, problems };
}
