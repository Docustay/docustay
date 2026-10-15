// A capability sentence in page data ends with {{F-ID}} (or several). `feat` splits the sentence from its ids so the page can print the text and carry the ids in a data-feature attribute.
// scripts/features-gate.mjs reads the same markers from the page data and fails on an unknown id or on a claim that is not allowed on that page yet.
export const MARK = /\s*\{\{(F-[A-Z0-9]+)\}\}/g;
export const feat = (s) => { const ids = []; const text = String(s).replace(MARK, (_, id) => { ids.push(id); return ""; }).trim(); return { text, ids: ids.join(" ") || undefined }; };
export const plain = (s) => feat(s).text;
