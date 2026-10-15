// ═══════════════════════════════════════════════════════════════════════════════════════════════
// upload.js — SEND A FILE TO THE SERVER IN NUMBERED PARTS, RESUMABLY (QUEUE §23.4.1).
// The application takes at most 1 MiB per request, so a file of up to 100 MB travels as parts of ≤ 768 KiB:
//   start (name, size, SHA-256 the browser computed) → PUT each missing part (3 tries each) → complete.
// ★ Resuming: pass `resumeUploadId` and only the parts the server does not have are sent.
// ★ The SHA-256 is taken in the browser BEFORE sending and checked by the server at `complete`, so a file damaged in
//   transit is refused, never recorded. Progress is reported per part; `signal` cancels between parts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { api, request, ApiError } from "@/lib/api.js";
import { send } from "@/lib/permissions/write.js";

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256OfFile(file) { return hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())); }

async function putPart(uploadId, n, bytes, signal) {
  const res = await fetch(`/api/documents/pdf/uploads/${encodeURIComponent(uploadId)}/parts/${n}`, { method: "PUT", body: bytes, credentials: "same-origin", signal, headers: { "content-type": "application/octet-stream", "idempotency-key": `part-${uploadId}-${n}` } });
  if (!res.ok) {
    let body = null; try { body = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, body, `parts/${n}`);
  }
}

/** @returns the server's draft summary: { instanceId, title, file, flags, suggestions } */
export async function uploadFile(file, { onProgress = () => {}, signal, resumeUploadId = null, title = null, attachTo = null } = {}) {
  onProgress({ phase: "hashing", sent: 0, total: file.size });
  const sha256 = await sha256OfFile(file);
  let uploadId = resumeUploadId, partBytes, partCount, have = new Set();
  if (uploadId) {
    const st = await api.pdfUploadStatus(uploadId);
    partBytes = st.partBytes; partCount = st.partCount; have = new Set(st.received);
  } else {
    const started = await send("POST /api/documents/pdf/uploads", [{ body: { name: file.name, size: file.size, sha256, ...(attachTo ? { attachTo } : {}) } }]);
    uploadId = started.uploadId; partBytes = started.partBytes; partCount = started.partCount;
  }
  let sent = Math.min(file.size, have.size * partBytes);
  for (let n = 1; n <= partCount; n += 1) {
    if (have.has(n)) continue;
    if (signal?.aborted) throw new DOMException("upload cancelled", "AbortError");
    const bytes = await file.slice((n - 1) * partBytes, Math.min(file.size, n * partBytes)).arrayBuffer();
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { await putPart(uploadId, n, bytes, signal); lastErr = null; break; }
      catch (e) { lastErr = e; if (e.name === "AbortError" || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e; await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
    }
    if (lastErr) { const err = lastErr; err.uploadId = uploadId; throw err; }
    sent += bytes.byteLength;
    onProgress({ phase: "uploading", sent, total: file.size, uploadId });
  }
  onProgress({ phase: "processing", sent: file.size, total: file.size, uploadId });
  return send("POST /api/documents/pdf/uploads/complete", [{ body: { uploadId, title } }]);
}

export { request };
