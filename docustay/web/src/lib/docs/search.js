// Docs search with no server and no AI: a small ranked match over the page sections (title, heading, text). The same index backs the sidebar search and the "Ask a question" bar.
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9_.\/-]+/).filter((w) => w.length > 1);
const STOP = new Set(["the", "and", "how", "can", "does", "do", "is", "to", "of", "for", "in", "on", "my", "a", "an", "it", "with", "what", "i", "you", "your", "are", "be", "or", "from"]);
export function rank(index, query, limit = 6) {
  const ws = words(query).filter((w) => !STOP.has(w)); if (!ws.length) return [];
  const scored = index.map((s) => {
    const t = s.title.toLowerCase(), h = s.heading.toLowerCase(), x = s.text.toLowerCase(); let score = 0;
    for (const w of ws) { if (h.includes(w)) score += 5; if (t.includes(w)) score += 3; const n = x.split(w).length - 1; score += Math.min(n, 4); }
    return { ...s, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const s of scored) { const k = `${s.slug}#${s.id}`; if (seen.has(k)) continue; seen.add(k); out.push(s); if (out.length >= limit) break; }
  return out;
}
