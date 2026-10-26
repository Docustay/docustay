// GENERATED COPY of src/documents/flowPreview.mjs — do not edit here. Run: node scripts/sync-flow-definition.mjs
// The three previews of a document before it goes out, built from the HTML the engine's check already returns (text tags in it are the fields). Pure: no network, no framework.
//   see_it        what the signer sees: each field as an empty box in its person's colour, the chosen person's boxes strong and the others pale
//   as_signed     the same page with every field filled in with sample values (a signature in script, today's date) — what the signed copy looks like
//   after_signing the certificate page: who signed, when, the document's fingerprint
const SEAT_COLOURS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function parseTag(raw) {
  const parts = raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').split(";"); const name = parts.shift().trim(); const a = {};
  for (const p of parts) { const i = p.indexOf("="); if (i > 0) a[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"|"$/g, ""); }
  return { name, type: a.type ?? "text", role: a.role ?? "", label: a.label ?? name };
}
export function previewHtml(html, { view = "see_it", roles = [], asRole = "", title = "Document", hash = "", today = new Date() } = {}) {
  const colour = (role) => SEAT_COLOURS[Math.max(0, roles.indexOf(role)) % SEAT_COLOURS.length];
  const date = today.toISOString().slice(0, 10);
  const body = String(html ?? "").replace(/\{\{([^{}\n]{1,600})\}\}/g, (_, raw) => {
    const f = parseTag(raw); const c = colour(f.role); const mine = !asRole || asRole === f.role; const op = mine ? 1 : 0.35;
    if (view === "as_signed") {
      const v = f.type === "signature" ? `<i class="sg">${esc(f.role || "Signer")}</i>` : f.type === "initials" ? `<i class="sg">${esc((f.role || "S").slice(0, 2))}</i>` : /^date/.test(f.type) ? esc(date) : f.type === "checkbox" ? "&#9745;" : f.type === "email" ? "name@example.com" : f.type === "number" ? "100" : f.type === "payment" ? "Paid" : esc(f.label);
      return `<span class="fv" style="border-bottom:1px solid ${c}">${v}</span>`;
    }
    return `<span class="fb" style="border:1.5px solid ${c};background:${c}${mine ? "22" : "0d"};opacity:${op}" title="${esc(f.role)}">${esc(f.label)}</span>`;
  });
  const css = `body{font:15px/1.5 Georgia,serif;color:#1b1a17;margin:0;padding:28px 34px;background:#fff}h1,h2,h3{font-weight:600}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 8px;vertical-align:top}.fb{display:inline-block;min-width:96px;padding:2px 8px;border-radius:5px;font:12px system-ui;color:#444}.fv{display:inline-block;min-width:96px;padding:0 6px;font:14px system-ui}.sg{font:italic 24px "Snell Roundhand","Segoe Script",cursive}.sig td{border:0}.cert{font:14px system-ui}.cert h1{font:600 22px Georgia}.cert dl{display:grid;grid-template-columns:160px 1fr;gap:6px 12px}.cert dt{color:#666}`;
  if (view === "after_signing") {
    const rows = (roles.length ? roles : ["Signer"]).map((r, i) => `<dt>${esc(r)}</dt><dd>Signed ${esc(date)} 10:00 UTC &middot; <span style="color:${SEAT_COLOURS[i % 8]}">&#9679;</span> sample</dd>`).join("");
    return `<!doctype html><meta charset=utf-8><style>${css}</style><div class="cert"><h1>Certificate of completion</h1><p>${esc(title)}</p><dl>${rows}<dt>Document fingerprint</dt><dd style="word-break:break-all">${esc(hash || "shown here once the document is final")}</dd></dl><p style="color:#666">This is a preview. The real certificate carries each signer's address, device and time.</p></div>`;
  }
  return `<!doctype html><meta charset=utf-8><style>${css}</style>${body}`;
}
