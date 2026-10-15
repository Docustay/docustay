// Role words in a source: the words fields and signature slots carry for "who". Pure helpers for the written flow.
export function rolesOf(doc) {
  const out = [];
  const visit = (n) => { if (!n) return; if (n.type === "fieldTag" && n.attrs?.role && !out.includes(n.attrs.role)) out.push(n.attrs.role); if (n.type === "signatureBlock") for (const s of n.attrs?.slots ?? []) if (s.role && !out.includes(s.role)) out.push(s.role); for (const c of n.content ?? []) visit(c); };
  visit(doc); return out;
}
/** merge text per person is keyed by the person's role WORD, so it survives the seats being renumbered: custom.p_<word>_name / _email */
export const slugWord = (w) => String(w ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "person";
export const personFacts = (people) => Object.fromEntries(people.flatMap((p) => { const k = slugWord(p.roleWord ?? p.name); return [[`custom.p_${k}_name`, p.name], [`custom.p_${k}_email`, p.email]].filter(([, v]) => v); }));
/** A copy of the document with role words changed: map = Map(old → new). Slot labels follow their role; merge text for a renamed person follows the new word. */
export function rewriteRoles(doc, map) {
  const renamed = new Map([...map].flatMap(([a, b]) => [[`custom.p_${slugWord(a)}_name`, `custom.p_${slugWord(b)}_name`], [`custom.p_${slugWord(a)}_email`, `custom.p_${slugWord(b)}_email`]]));
  const walk = (n) => {
    if (!n || typeof n !== "object") return n;
    const o = { ...n };
    if (o.type === "fieldTag" && o.attrs?.role && map.has(o.attrs.role)) o.attrs = { ...o.attrs, role: map.get(o.attrs.role) };
    if (o.type === "signatureBlock" && Array.isArray(o.attrs?.slots)) o.attrs = { ...o.attrs, slots: o.attrs.slots.map((s) => (s.role && map.has(s.role) ? { ...s, role: map.get(s.role), label: map.get(s.role) } : s)) };
    if (o.type === "variableChip" && renamed.has(o.attrs?.name)) o.attrs = { ...o.attrs, name: renamed.get(o.attrs.name) };
    if (Array.isArray(o.content)) o.content = o.content.map(walk);
    return o;
  };
  return walk(doc);
}
export function uniqueWord(want, taken) { const set = new Set(taken); if (!set.has(want)) return want; let i = 2; while (set.has(`${want} ${i}`)) i++; return `${want} ${i}`; }

/** The questions a template asks the sender: every custom.* merge chip (not the per-person ones) once, with its label, kind and starting value. */
export function variablesOf(doc) {
  const out = new Map();
  const visit = (n) => { if (!n || typeof n !== "object") return; if (n.type === "variableChip" && /^custom\./.test(n.attrs?.name ?? "") && !/^custom\.p_/.test(n.attrs.name)) { const key = n.attrs.name.slice(7); if (!out.has(key)) out.set(key, { key, label: n.attrs.label || key, kind: n.attrs.kind || "text", default: n.attrs.default ?? "", help: n.attrs.help ?? "" }); } if (Array.isArray(n.content)) n.content.forEach(visit); };
  visit(doc); return [...out.values()];
}
