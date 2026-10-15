// src/documents/logo.mjs — the practice's logo as bytes, for the letterhead of a signed copy. The BRAND PORT hands the island a logo address; fetching it is the island's job (the host owns no PDF code).
// ★ Never fatal: a logo that cannot be fetched, is not a PNG/JPEG, or is too large is simply left out — a signed copy without a letterhead logo is still a valid signed copy.
// ★ Two address shapes exist in the platform: an https URL the practice typed, and `ks-object:<key>` (an image the practice uploaded to its own object store).
import { callOutside } from "../http/outside.mjs";
import { getObject } from "../storage/s3.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const isPngOrJpeg = (b) => b.length > 8 && ((b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8));

export async function fetchLogoBytes(address, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof address !== "string" || address === "") return null;
    let body = null;
    if (address.startsWith("ks-object:")) {
      const got = await getObject({ key: address.slice("ks-object:".length) }, { env });
      body = got.ok ? got.body : null;
    } else if (/^https:\/\//.test(address)) {
      const r = await callOutside("logo", address, { method: "GET" }, { raw: true, timeoutMs: 8000, fetchImpl });
      body = r.ok ? r.body : null;
    }
    if (!body || body.length > MAX_BYTES || !isPngOrJpeg(body)) return null;
    return Buffer.from(body);
  } catch { return null; }
}
