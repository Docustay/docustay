// THE SHARED DOCUMENT ENGINE — validation of a parsed source against what a skin offers. Pure, no imports of the host except the tag grammar and the merge-name rule.
// It answers one question: "would this document print and send?" — with plain, located sentences a person (or the AI job) can act on.
import { parseTag } from "../textTags.mjs";
import { isCustomVariable } from "../variableCatalogue.mjs";
import { inlineNodes } from "./source.mjs";

/**
 * @param source  a parsed source (parseSource().source)
 * @param opts.names        the live catalogue of merge-field names (array of strings) — unknown names are listed, never dropped
 * @param opts.profile      "typeset" | "contract"
 * @param opts.requireSignature  true when the document must have somewhere to sign
 * @returns {{ ok:boolean, errors:string[], warnings:string[], roles:string[] }}
 */
export function validateSource(source, { names = [], profile = "typeset", requireSignature = false } = {}) {
  const errors = [], warnings = [];
  const known = new Set(names);
  const roles = [];
  const addRole = (r) => { if (r && !roles.includes(r)) roles.push(r); };
  let signSlots = 0, text = "";
  source.content.forEach((b, i) => {
    const where = `block ${i + 1}`;
    if (b.type === "signatureBlock") { signSlots += b.attrs.slots.length; for (const s of b.attrs.slots) addRole(s.role ?? s.owner ?? s.label); }
    for (const n of inlineNodes(b)) {
      if (n.type === "text") text += n.text + " ";
      else if (n.type === "variableChip") {
        if (!(known.has(n.attrs.name) || isCustomVariable(n.attrs.name))) errors.push(`${where}: the merge field {{${n.attrs.name}}} is not one this workspace has${known.size ? "" : " (no catalogue was given)"}`);
      } else if (n.type === "fieldTag") {
        if (profile === "contract") { errors.push(`${where}: a field tag (${n.attrs.name}) needs the typeset profile`); continue; }
        const inner = [n.attrs.name, ...Object.entries(n.attrs).filter(([k]) => k !== "name").map(([k, v]) => `${k}=${v}`)].join(";");
        const t = parseTag(inner);
        if (t === null) errors.push(`${where}: “${n.attrs.name}” has no type; a field tag needs at least type=…`);
        else if (t.error) errors.push(/^“/.test(t.error) ? t.error : `${where}: ${t.error}`);   // a sentence that already names the field needs no "block N"
        else { addRole(t.role); if (t.spec.type === "signature") signSlots += 1; warnings.push(...t.warnings.map((w) => `${where}: ${w}`)); }
      }
    }
  });
  if (/\[\[FILL IN:/i.test(text)) errors.push("the text still contains a [[FILL IN: …]] marker");
  if (requireSignature && signSlots === 0) errors.push("nobody can sign: add a signature block or a signature field");
  if (!source.content.some((b) => b.type === "heading" || b.type === "paragraph" || b.type === "bulletList" || b.type === "orderedList")) errors.push("the document has no text");
  return { ok: errors.length === 0, errors, warnings, roles };
}
