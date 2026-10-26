// The role words in a written document (a field's role, a signature slot's role), in order of first appearance, and the slug a role word gets in merge text. Pure. The screens' own copy is docustay/web/src/lib/flow/roles.js.
export function rolesOfSource(doc) {
  const out = [];
  const visit = (n) => { if (!n || typeof n !== "object") return; if (n.type === "fieldTag" && n.attrs?.role && !out.includes(n.attrs.role)) out.push(n.attrs.role); if (n.type === "signatureBlock") for (const s of n.attrs?.slots ?? []) if (s.role && !out.includes(s.role)) out.push(s.role); if (Array.isArray(n.content)) n.content.forEach(visit); };
  visit(doc); return out;
}
export const slugWord = (w) => String(w ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "person";
