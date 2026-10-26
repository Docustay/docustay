// Template search ranking (R13-D021): a match at the start of the title, then a word-boundary match in the title, then a match inside a word of the title, then a match only in the description. Order inside a rank is the list's own order (Array.sort is stable).
export function rankOf(title, rest, query) {
  const q = String(query ?? "").trim().toLowerCase(), t = String(title ?? "").toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 0;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc}`, "u").test(t)) return 1;
  if (t.includes(q)) return 2;
  return String(rest ?? "").toLowerCase().includes(q) ? 3 : -1;
}
// Keep the cards that match, best match first. `rest` is the card's description field.
export function searchRank(cards, query, restKey) {
  const q = String(query ?? "").trim(); if (!q) return cards;
  return cards.map((c, i) => [c, rankOf(c.title, c[restKey], q), i]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([c]) => c);
}
