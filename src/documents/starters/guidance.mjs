// Run 9 Part 4R (the maintainer, 12 Oct 2026) — A BUILT-IN TEMPLATE'S SCRIBE GUIDANCE. What the old document and form plays knew — the questions to ask, the facts it needs, the checklist, the notes
// to show the sender, "when not to use" — now belongs to the template itself (./guidance/<name>.md, the play format with `template` and `use` instead of `kind` and `starter`).
// `use: document` guides sending the template; `use: form` guides publishing it as a public form (six document templates, such as the rental application, are also collected as forms).
// Validated once, served from memory; a broken file is a build failure (it throws, naming the file), never a silent skip.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGuidance, renderForModel, brief } from "../plays/play.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "guidance");
let cache = null;

/** → Map template slug → { document: entry | null, form: entry | null }, entry = { guidance, hash, ref }. */
export function templateGuidance() {
  if (cache) return cache;
  const out = new Map();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
    const r = parseGuidance(fs.readFileSync(path.join(DIR, f), "utf8"));
    if (!r.ok) throw new Error(`template guidance ${f} is invalid: ${r.errors.join(" · ")}`);
    if (`${r.guidance.name}.md` !== f) throw new Error(`template guidance ${f}: the name inside (${r.guidance.name}) must match the file name`);
    const g = r.guidance, slot = out.get(g.template) ?? { document: null, form: null };
    if (slot[g.use]) throw new Error(`template guidance ${f}: ${g.template} already has ${g.use} guidance (${slot[g.use].guidance.name})`);
    slot[g.use] = { guidance: g, hash: r.hash, ref: `guidance:${g.name}@${r.hash.slice(0, 8)}` };
    out.set(g.template, slot);
  }
  cache = out; return out;
}
/** The guidance for one template, for sending (`document`) or as a form (`form`); a form template's only guidance is its form guidance. */
export function guidanceFor(slug, use = "document") {
  const slot = templateGuidance().get(String(slug)); if (!slot) return null;
  return slot[use] ?? slot.document ?? slot.form ?? null;
}
/** What the model reads for a template's guidance: the same quoted, rule-bound block a play renders as (renderForModel), naming the template it belongs to. */
export function guidanceForModel(entry, { templateTitle = null } = {}) {
  if (!entry) return null;
  const g = entry.guidance;
  return renderForModel({ ...g, kind: `template guidance${templateTitle ? ` for “${String(templateTitle).replace(/[<>"]/g, "")}”` : ""}` });
}
export const guidanceBrief = (entry) => (entry ? { ...brief({ ...entry.guidance, kind: "guidance", category: null }), use: entry.guidance.use, template: entry.guidance.template, ref: entry.ref } : null);
