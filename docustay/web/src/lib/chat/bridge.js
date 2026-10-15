// The editor pages tell the assistant what is open and how to apply an accepted suggestion. One bridge, module-level; the assistant reads it each turn.
// register({ getSource, apply, applyValues, getValues, title, documentId, templateId }) → unregister()
let current = null, pageInfo = null;   // pageInfo: what the PAGE knows (the open draft's id), whichever editor is or is not mounted
export const chatBridge = {
  register(b) { const mine = b; current = mine; return () => { if (current === mine) current = null; }; },
  setPage(info) { const mine = info; pageInfo = mine; return () => { if (pageInfo === mine) pageInfo = null; }; },
  get() { return current; },
  context() {
    const b = current ?? {};
    const out = {};
    if (pageInfo?.documentId) out.documentId = pageInfo.documentId; if (pageInfo?.title) out.title = String(pageInfo.title);
    try { const s = b.getSource?.(); if (s) out.source = JSON.parse(JSON.stringify(s)); } catch { /* an editor that is not ready sends nothing */ }
    try { const v = b.getValues?.(); if (v && typeof v === "object") out.values = v; } catch { /* none */ }
    if (b.title) out.title = String(b.title); if (b.documentId) out.documentId = b.documentId; if (b.templateId) out.templateId = b.templateId;
    return out;
  },
};
