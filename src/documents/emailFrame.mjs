// src/documents/emailFrame.mjs — the plain frame for the document emails that have no sign button (cancelled, receipt, and the previews of the sender notices). Pure: text in, HTML out, everything escaped.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function plainFrame({ org, subject, body, footer }) {
  return `<!doctype html><html><body style="background:#f4f4f5;margin:0;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"><div style="background:#fff;border-radius:12px;max-width:480px;margin:0 auto;padding:32px">`
    + `<p style="font-size:14px;font-weight:600;color:#71717a;margin:0 0 16px">${esc(org)}</p><h1 style="font-size:20px;font-weight:600;color:#18181b;margin:0 0 16px">${esc(subject)}</h1>`
    + `<p style="font-size:15px;color:#3f3f46;line-height:22px;margin:0;white-space:pre-wrap">${esc(body)}</p>`
    + (footer ? `<p style="font-size:12px;color:#71717a;margin:24px 0 0;white-space:pre-wrap">${esc(footer)}</p>` : "") + `</div></body></html>`;
}
