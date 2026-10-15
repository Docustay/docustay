// Stage 14 task 14.77 — THE UPLOAD DOOR: a presigned PUT, so bytes never pass through the
// application (R-14.12).
//
// ★★★ R-14.12, QUOTED VERBATIM (STAGE-14-PLAN.md:190): "RULED: upload DIRECT TO STORAGE; the bytes
//     never travel through the application." The reasoning that follows it, same line: "Raising the
//     body cap to push large binaries through the app looks smaller today and is worse every month
//     afterwards."
//
// §0.4 B: `UPLOAD_WRITES` is a frozen array of ROUTE ROWS, exactly `src/routes/writes.mjs`'s
// `ROUTES` shape — spread into that table and mounted by task 14.41, which is what actually calls
// `registerWriteRoutes` over the combined table.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.77's
//     file list. `UPLOAD_WRITES` is inert — nothing calls `createUploadTicket` over HTTP — until
//     14.41 spreads it into `ROUTES`. Reported here, not silently left unwired.
//
// ★★★ THE BYTES NEVER REACH THIS FUNCTION, SO IT CANNOT VALIDATE THEM ON THE DECODED BUFFER THE WAY
//     `src/items/images.mjs` (14.19) does. What this function CAN and DOES check is the DECLARATION
//     the caller makes before a byte is sent — `kind`, `contentType`, `bytes` — and it signs a PUT
//     that is itself bounded (a computed key, a content-type-bound signature, a 15-minute ceiling).
//     ★ WHAT ACTUALLY ENFORCES SIZE ON THE OBJECT THAT LANDS is NOT this route: the signed policy
//     here does not bind Content-Length (SigV4 query-string presigning has no length clause; only a
//     POST-policy form upload can carry one), so a caller COULD technically PUT more bytes than
//     declared to a key it was handed. What bounds the actual DAMAGE is (1) the key is tenant-scoped
//     and single-use, so an oversize PUT overwrites nothing but its own never-claimed object, and
//     (2) the confirming `headObject` a caller (14.38/14.68) runs afterwards reads the REAL size off
//     the store and refuses to treat the upload as real if what landed doesn't match what was
//     declared — this route does not perform that confirmation itself, because it never sees the
//     object; it only ever mints the ticket. NAMED HERE RATHER THAN QUIETLY OMITTED, per this
//     task's own instruction: **content length is NOT bound by the signature this function
//     produces.**

import { invalid, dependency } from "../http/errors.mjs";
import { presignPut, objectKey, storageIsConfigured } from "../storage/s3.mjs";

const SECTION = "/items/services";

/** ★ The closed set — the key's shape depends on which one, so an open string is not accepted. */
const KIND_CONTENT_TYPES = Object.freeze({
  pdf_import: Object.freeze(["application/pdf"]),
  image: Object.freeze(["image/png", "image/jpeg", "image/webp"]),
});

/** ★ 20 MiB for a PDF import, 10 MiB for an image — field 3's own ceilings. */
const KIND_MAX_BYTES = Object.freeze({
  pdf_import: 20 * 1024 * 1024,
  image: 10 * 1024 * 1024,
});

/**
 * `POST /api/uploads/ticket`'s handler. Mints a presigned PUT for a browser to write DIRECTLY to
 * object storage — `db` is used for nothing but a fresh `uuid_generate_v7()` (this route writes no
 * row: the ticket is not stored, and the import row the caller eventually creates is a different
 * task's own write, e.g. 14.38's).
 * ★★★ THE KEY IS COMPUTED, NEVER ACCEPTED. `kind`/`contentType`/`bytes` are the only fields read
 *     from the body below — any other key a caller sends (including one deliberately named `key`,
 *     trying to name another tenant's prefix) is simply never looked at, because `objectKey` builds
 *     the key from the VERIFIED `tenantId` (the GUC, via `runTenantScoped` — never the caller) and a
 *     server-generated id. The object store has no RLS (`s3.mjs:219` — M): the key IS the tenant
 *     boundary, and a key this function did not compute itself is a key it cannot vouch for.
 * @returns { key, url, method, headers, expiresAt }
 */
export async function createUploadTicket(db, { tenantId, kind, contentType, bytes }, { env = process.env } = {}) {
  if (!Object.hasOwn(KIND_CONTENT_TYPES, kind)) {
    throw invalid(`kind must be one of ${Object.keys(KIND_CONTENT_TYPES).join(", ")} — got ${JSON.stringify(kind)}`,
      { field: "kind" });
  }
  const allowedTypes = KIND_CONTENT_TYPES[kind];
  if (!allowedTypes.includes(contentType)) {
    throw invalid("We can't take that kind of file here.", { field: "contentType" });
  }
  const maxBytes = KIND_MAX_BYTES[kind];
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw invalid(`That one's over ${maxMb} MB — try a smaller file.`, { field: "bytes" });
  }

  // ★★★ FAIL LOUD, NOT SILENTLY SKIP — same posture as `src/items/images.mjs:83-85` for the
  //     identical "storage is not configured" condition; `dependency(...)` maps to 502
  //     (`src/http/errors.mjs:35`, M), never 503.
  if (!storageIsConfigured(env)) {
    throw dependency("Upload storage isn't set up on this deployment.");
  }

  const id = (await db.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const key = objectKey({ tenantId, kind, id });
  const { url, method, headers, expiresAt } = presignPut({ key, contentType }, { env });

  return { key, url, method, headers, expiresAt };
}

/**
 * ★★★ `UPLOAD_WRITES` — `src/routes/writes.mjs:157-...`'s `ROUTES` row shape. `subject: null`: this
 *     is a CREATE with no existing row to inherit an owner from (same reasoning as
 *     `CATALOGUE_WRITES` in `src/routes/itemsCatalogue.mjs`, task 14.16). `object: "item"`,
 *     `action: "edit"` — minting an upload ticket is part of managing the catalogue/documents an
 *     item's assets belong to, the same coarse gate `/api/items/*` already uses.
 */
export const UPLOAD_WRITES = Object.freeze([
  { path: "/api/uploads/ticket", section: SECTION, fn: createUploadTicket,
    object: "item", action: "edit", subject: null },
]);
