// What a tool step shows the person, in plain words (never raw JSON): a one-line detail of what was asked and a one-line summary of what came back. Pure.
const clip = (s, n = 90) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What Layout C draws on the page while a document or form is being made: its kind, name and the parts in order (headings, fields, signatures), plain labels only. Null for any other tool. */
export function stepBuild(name, input = {}) {
  if (name !== "docustay.doc.create" && name !== "docustay.template.create") return null;
  const i = input && typeof input === "object" ? input : {};
  const parts = (Array.isArray(i.blocks) ? i.blocks : []).map((b) => {
    if (!b || typeof b !== "object") return null;
    if (b.type === "heading") return { t: "heading", label: clip(b.text, 60) };
    if (b.type === "field") return { t: b.fieldType === "file" ? "file" : "field", label: clip(b.label || b.fieldType || "Field", 40) };
    if (b.type === "signature") return { t: "signature", label: clip(b.label || b.role || "Signature", 40) };
    if (b.type === "payment") return { t: "field", label: clip(b.label || "Payment", 40) };
    if (b.type === "paragraph" || b.type === "bullets" || b.type === "numbered") return { t: "text", label: "" };
    return null;
  }).filter(Boolean).slice(0, 14);
  return { kind: i.kind === "form" ? "form" : "document", title: clip(i.name || i.title || "", 80), parts };
}

export function stepDetail(name, input = {}) {
  const i = input && typeof input === "object" ? input : {};
  if (i.title) return clip(i.title);
  if (i.query) return clip(i.query);
  if (i.topic) return clip(i.topic);
  if (i.summary) return clip(i.summary);
  if (i.waitingOn) return `waiting on ${clip(i.waitingOn, 40)}`;
  if (i.state) return `${clip(i.state, 30)} documents`;
  if (Array.isArray(i.people) && i.people.length) return plural(i.people.length, "person", "people");
  return "";
}

export function stepSummary(name, result = {}) {
  const r = result && typeof result === "object" ? result : {};
  if (r.error) return clip(r.error, 140);
  if (r.created === true) return r.documentId ? "Draft made" : "Made";
  if (r.cardShown) return "Card shown";
  if (r.shown === true) return "Question shown";
  if (r.proposed === true) return "Suggestion ready";
  if (r.proposed === false) return clip(r.note ?? "Nothing to suggest", 120);
  if (Array.isArray(r.screens)) return r.screens.length ? plural(r.screens.length, "screen found", "screens found") : "No screen matched";
  if (Array.isArray(r.documents)) return plural(r.documents.length, "document", "documents");
  if (Array.isArray(r.templates)) return plural(r.templates.length, "template", "templates");
  if (typeof r.sendable === "boolean") return r.sendable ? "Nothing stops it" : plural((r.problems ?? []).length, "problem", "problems");
  if (typeof r.ok === "boolean" && Array.isArray(r.errors)) return r.ok ? "No problems" : plural(r.errors.length, "problem", "problems");
  if (Array.isArray(r.blocks)) return plural(r.blocks.length, "block read", "blocks read");
  if (Array.isArray(r.people)) return plural(r.people.length, "person", "people");
  return "Done";
}
