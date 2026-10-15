import { t, whenText } from "$lib/i18n/index.svelte.js";
// Documents calls for the workspace screens (the same wire the React screens use: /api/documents/*, /api/list/documents).
import { api, newKey, tooManyText } from "./api.js";
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256OfFile = async (file) => hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
export const when = (v) => whenText(v);
export const STATE = { draft: ["Draft", "bg-tint text-mute"], sent: ["Waiting", "bg-info-bg text-info"], partially_signed: ["In progress", "bg-info-bg text-info"], executed: ["Signed", "bg-ok-bg text-ok"], declined: ["Declined", "bg-bad-bg text-bad"], expired: ["Expired", "bg-warn-bg text-warn"], voided: ["Cancelled", "bg-bad-bg text-bad"], void: ["Cancelled", "bg-bad-bg text-bad"] };

/** Upload a file in numbered parts, resumably (≤ 768 KiB each, SHA-256 checked by the server). Returns { instanceId, … }. */
export async function uploadFile(file, { onProgress = () => {}, title = null, signal, attachTo = null } = {}) {
  onProgress({ phase: "hashing", sent: 0, total: file.size });
  const sha256 = await sha256OfFile(file);
  const st = await api("/api/documents/pdf/uploads", { method: "POST", body: { name: file.name, size: file.size, sha256, ...(attachTo ? { attachTo } : {}) } });
  if (!st.ok) throw new Error(st.error ?? t("The upload could not start."));
  const { uploadId, partBytes, partCount } = st.json; let sent = 0;
  for (let n = 1; n <= partCount; n += 1) {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const bytes = await file.slice((n - 1) * partBytes, Math.min(file.size, n * partBytes)).arrayBuffer();
    let ok = false, last = null;
    for (let a = 0; a < 3 && !ok; a += 1) {
      const r = await fetch(`/api/documents/pdf/uploads/${encodeURIComponent(uploadId)}/parts/${n}`, { method: "PUT", body: bytes, credentials: "same-origin", signal, headers: { "content-type": "application/octet-stream", "idempotency-key": `part-${uploadId}-${n}` } });
      if (r.ok) ok = true; else { last = r.status; if (r.status >= 400 && r.status < 500) break; await new Promise((x) => setTimeout(x, 400 * (a + 1))); }
    }
    if (!ok && last === 429) throw new Error(tooManyText(null));
    if (!ok) throw new Error(`Part ${n} of the upload failed (${last}).`);
    sent += bytes.byteLength; onProgress({ phase: "uploading", sent, total: file.size });
  }
  onProgress({ phase: "processing", sent: file.size, total: file.size });
  const done = await api("/api/documents/pdf/uploads/complete", { method: "POST", body: { uploadId, title } });
  if (!done.ok) throw new Error(done.error ?? t("The document could not be read."));
  return done.json;
}

/** A small real PDF built in the browser for "Try with a sample" (nothing is stored until the person goes on). */
export function sampleFile() {
  const text = "SAMPLE SERVICE AGREEMENT\n\nThis sample shows how sending a document works. The two parties agree to try it.\n\nSignature: ______________________\n\nDate: ______________\n\nPrinted name: ______________________";
  const esc = (s) => s.replace(/[\\()]/g, "\\$&"), lines = text.split("\n");
  const stream = `BT /F1 12 Tf 72 720 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([out], "Sample agreement.pdf", { type: "application/pdf" });
}
export { newKey };
