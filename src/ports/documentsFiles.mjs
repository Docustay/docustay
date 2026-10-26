// src/ports/documentsFiles.mjs — PLATFORM'S side of the Documents island's `files` and `converter` ports (QUEUE §23.4). The island asks for "keep these bytes" and "turn this Word file into a PDF";
// the platform answers with its object storage (src/storage/s3.mjs — S3 API only) and, for conversion, a Gotenberg service (KEYSTONE_GOTENBERG_URL, MIT-licensed, run as its own container).
import { callOutside } from "../http/outside.mjs";
import { objectKey, putObject, getObject, deleteObject, storageIsConfigured, s3Config } from "../storage/s3.mjs";
import { sealFile, openFile } from "../storage/fileCrypto.mjs";

// Run 9 Part 4.4 — everything the island keeps is sealed here, with the workspace's own data key (src/storage/fileCrypto.mjs), before it reaches the bucket, and opened here on the way back. The
// island still sees and records the plaintext bytes and their sha256. `kind` is a path word chosen by the island (a stored file, or the sealed copy of an executed document).
export const files = {
  configured: () => storageIsConfigured(),
  bucket: () => s3Config().bucket,
  /** @returns {Promise<{key:string}>} throws when the store refuses — a document whose bytes were not kept must not be recorded as received */
  async put({ tenantId, id, bytes, kind = "document_file" }) {
    const key = objectKey({ tenantId, kind, id });
    const r = await putObject({ key, body: await sealFile({ key, bytes: Buffer.from(bytes) }), contentType: "application/octet-stream" });
    if (!r.ok) throw new Error(`the file could not be stored (${r.error ?? r.status})`);
    return { key };
  },
  async get({ key }) {
    const r = await getObject({ key });
    if (!r.ok || !r.body) throw new Error(`the stored file was not returned (${r.error ?? r.status})`);
    return (await openFile({ key, bytes: Buffer.from(r.body) })).bytes;
  },
  async delete({ key }) { await deleteObject({ key }); },
};

const gotenbergUrl = () => (process.env.KEYSTONE_GOTENBERG_URL || "").replace(/\/+$/, "");

export const converter = {
  /** Is a conversion service configured? Unset means a document written as HTML (a starter, a text document) cannot be printed to a PDF. Uploads are PDF only and never use it. */
  available: () => /^https?:\/\//.test(gotenbergUrl()),
  /** HTML → PDF bytes, through Gotenberg's Chromium route. `paper` is {w, h} in inches. The page has already been cleaned of anything that would make the browser fetch or run something. */
  async htmlToPdf({ html, paper = { w: 8.5, h: 11 }, margins = null, footerHtml = null }) {
    if (!converter.available()) throw new Error("document conversion is not set up");
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("paperWidth", String(paper.w)); form.append("paperHeight", String(paper.h));
    for (const side of ["Top", "Bottom", "Left", "Right"]) form.append(`margin${side}`, String(margins?.[side.toLowerCase()] ?? 0.75));
    if (footerHtml) form.append("files", new Blob([footerHtml], { type: "text/html" }), "footer.html");
    form.append("printBackground", "true"); form.append("skipNetworkIdleEvent", "true");
    const res = await callOutside("gotenberg", `${gotenbergUrl()}/forms/chromium/convert/html`, { method: "POST", body: form }, { timeoutMs: 60_000, raw: true });
    if (!res.ok || !Buffer.isBuffer(res.body)) throw new Error(res.status ? `the converter answered ${res.status}` : "the converter could not be reached");
    return res.body;
  },
};
