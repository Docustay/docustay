// @ts-check
// Stage 14 task 14.19 — THE IMAGE LIBRARY. Upload (browser-resized base64), list with usage, delete
// when unused.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SCHEMA, MEASURED, NOT ASSUMED — `db/migrations/0408_image_library.sql` (task 14.1, unapplied).
//     `keystone.image`: `content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg',
//     'image/webp'))`, `bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 716800)` (700 KiB
//     decoded — the browser resizes first; a larger binary goes through the presigned door instead,
//     R-14.12/14.77), `width`/`height integer CHECK (… > 0)`, `s3_key text NOT NULL`,
//     `UNIQUE (tenant_id, s3_key)`. Delete of a row is a REAL DELETE — allowed only while
//     unreferenced (F06 §3.5); the referencing FKs (`service.image_id`, `package.image_id`,
//     migration 0410) are `ON DELETE SET NULL`, so it is THIS module's `deleteImage` that must
//     refuse while referenced — the database itself would happily null the reference out instead.
//
// ★★ UPLOAD SAFETY — the content-type allowlist and the byte ceiling are enforced HERE, from the
//    migration's own CHECK values, never trusted from the caller. This mirrors every other
//    `assert*Shape` helper in `src/items/writes.mjs` (e.g. `assertMoney`, `assertDiscountShape`):
//    an application-layer check that names the field beats a raw constraint violation reaching the
//    caller, with the database CHECK as the backstop if this drifts.
//
// ★ `subjectType`/`subjectId` on the `items.image.uploaded` emit are `null`/`null`, NOT `"image"` —
//   [MEASURED, `src/events/topics.mjs:415-446`] `"image"` is not a member of `SUBJECT_TYPES`, and
//   task 14.15 (the sole owner of `topics.mjs`, this task's own field 2) is scoped to the
//   `documents`/`items` TOPIC arrays only (`:45-79`, `:214-236`) — not `SUBJECT_TYPES`. `emit()`
//   (`src/events/outbox.mjs:401`) throws `TopicViolation` on an unknown subject type, and both
//   `subjectType`/`subjectId` must be given together or omitted together (`:407-411`) — `null`/`null`
//   is the only legal choice available to this file today. The image id still travels, in
//   `payload.image_id`. Reported in the build summary as a gap for 14.15 (or a later task) to close
//   by adding `"image"` to `SUBJECT_TYPES`, the same way task 2.4 added `"discount"` there.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict, dependency } from "../http/errors.mjs";
import { putObject, deleteObject, getObject, objectKey, storageIsConfigured } from "../storage/s3.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "items";

const CHECK_VIOLATION = "23514";   // Postgres SQLSTATE — a CHECK constraint refused the row.

/** ★ The migration's own allowlist (0408:17), mirrored so a bad type is a 422 naming the field. */
export const IMAGE_CONTENT_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
/** ★ The migration's own ceiling (0408:18) — 700 KiB decoded. */
export const IMAGE_MAX_BYTES = 716800;

/**
 * ★★★ UPLOAD. `opts.putObject` is the module's own dependency-injection seam — a test may pass a
 *     stub in place of the real `putObject` so the not-configured branch (the application's own
 *     condition, asserted by `storageIsConfigured`) and the configured/succeeds branch can both be
 *     proven in the same test without a real object store.
 * @returns { id, name, contentType, bytes, width, height }
 */
export async function uploadImage(
  tx,
  { tenantId, name, dataBase64, contentType, width = null, height = null, actorUserId = null },
  { env = process.env, putObject: putObjectFn = putObject } = {}
) {
  if (typeof name !== "string" || !name.trim()) throw invalid("an image needs a name");
  if (!IMAGE_CONTENT_TYPES.includes(contentType)) {
    throw invalid(
      `contentType must be one of ${IMAGE_CONTENT_TYPES.join(", ")} — got ${JSON.stringify(contentType)}`,
      { field: "contentType" });
  }
  if (typeof dataBase64 !== "string" || !dataBase64) throw invalid("no image data was sent");
  if (width !== null && width !== undefined && (!Number.isInteger(width) || width <= 0)) {
    throw invalid(`width must be a positive integer, or absent — got ${JSON.stringify(width)}`);
  }
  if (height !== null && height !== undefined && (!Number.isInteger(height) || height <= 0)) {
    throw invalid(`height must be a positive integer, or absent — got ${JSON.stringify(height)}`);
  }

  // ★★ DECODE, THEN CEILING — the decoded byte count is what the migration's CHECK caps, not the
  //    base64 string length.
  const buf = Buffer.from(dataBase64, "base64");
  if (buf.length === 0) throw invalid("the image was empty");
  // ★ 700 KiB (716800 bytes) is the real ceiling (0408:18); this exact sentence is field 4's own
  //   text, verbatim — the browser already resized before this call, so this is the backstop.
  if (buf.length > IMAGE_MAX_BYTES) {
    throw invalid("That one's over 10 MB — resize it and try again.");
  }

  // ★★★ FAIL LOUD, NOT SILENTLY SKIP — same posture as `src/documents/archive.mjs:103-108` and
  //     `src/records/attachments.mjs:62-68`, both of which use this exact `dependency(...)` call for
  //     the identical "storage is not configured" condition.
  if (!storageIsConfigured(env)) {
    throw dependency("Image storage isn't set up on this deployment.");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const key = objectKey({ tenantId, kind: "image", id });

  // ★★★ `putObject` DOES NOT THROW — it returns a described outcome, and the result MUST be checked
  //     (the `archive.mjs:179-183` rule): an unchecked call is a silent success on every failure, and
  //     the `image` row would then be written for bytes that never arrived.
  const put = await putObjectFn({ key, body: buf, contentType }, { env });
  if (!put.ok) {
    throw dependency(`the object store refused this image, so NO row was written: ${put.error}`);
  }

  const trimmedName = name.trim();
  try {
    await run(tx, db
      .insertInto("keystone.image")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: trimmedName ?? null,
        s3_key: key ?? null,
        content_type: contentType ?? null,
        bytes: buf.length ?? null,
        width: width ?? null,
        height: height ?? null,
        created_by: actorUserId ?? null,
      }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this image: ${e.constraint ?? e.message}`);
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "items.image.uploaded", emittedBy: SECTION,
    // ★ See the file header — "image" is not yet a member of SUBJECT_TYPES.
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { image_id: id, content_type: contentType, bytes: buf.length },
  });

  return { id, name: trimmedName, contentType, bytes: buf.length, width, height };
}

/**
 * ★★ LIST, WITH USAGE. Usage is the count of `service.image_id`/`package.image_id` rows pointing at
 *    this image (migration 0410) — landing pages and social images do not exist yet, so their share
 *    of the count is always 0 until those features are built. `usedLabel` reads "Not used" at 0,
 *    per field 4's own words.
 * @returns [{ id, name, contentType, bytes, width, height, createdAt, usedCount, usedLabel }]
 */
export async function listImages(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT i.id, i.name, i.content_type, i.bytes, i.width, i.height, i.created_at,
            COALESCE(svc.n, 0) + COALESCE(pkg.n, 0) AS used_count
       FROM keystone.image i
       LEFT JOIN (SELECT image_id, count(*) AS n FROM keystone.service
                   WHERE tenant_id = $1 AND image_id IS NOT NULL GROUP BY image_id) svc
         ON svc.image_id = i.id
       LEFT JOIN (SELECT image_id, count(*) AS n FROM keystone.package
                   WHERE tenant_id = $1 AND image_id IS NOT NULL GROUP BY image_id) pkg
         ON pkg.image_id = i.id
      WHERE i.tenant_id = $1
      ORDER BY i.created_at DESC`,
    [tenantId]);
  return rows.map((r) => {
    const usedCount = Number(r.used_count) || 0;
    return {
      id: r.id, name: r.name, contentType: r.content_type, bytes: r.bytes,
      width: r.width, height: r.height, createdAt: r.created_at,
      usedCount,
      usedLabel: usedCount === 0 ? "Not used" : `On ${usedCount} item${usedCount === 1 ? "" : "s"}`,
    };
  });
}

/**
 * ★★★ DELETE — A REAL DELETE, ALLOWED ONLY WHILE UNREFERENCED (F06 §3.5; 0408's own header). The
 *     referencing FKs are `ON DELETE SET NULL`, so nothing at the database layer would refuse this —
 *     THIS is the refusal.
 * ★ Order: verify the row exists → count references → refuse (409) if any → delete the object →
 *   delete the row. `opts.deleteObject` is the same DI seam `uploadImage` gives `putObject`.
 */
export async function deleteImage(
  tx, { tenantId, id, actorUserId = null },
  { env = process.env, deleteObject: deleteObjectFn = deleteObject } = {}
) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.image")
    .select(["s3_key"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (!rows[0]) throw notFound(`no image ${id} in this practice's library`);

  const { rows: usage } = await tx.query(
    `SELECT
        (SELECT count(*) FROM keystone.service WHERE tenant_id = $1 AND image_id = $2) +
        (SELECT count(*) FROM keystone.package WHERE tenant_id = $1 AND image_id = $2) AS n`,
    [tenantId, id]);
  const n = Number(usage[0]?.n) || 0;
  if (n > 0) {
    throw conflict(`It's on ${n} service${n === 1 ? "" : "s"} — swap it there first.`);
  }

  const del = await deleteObjectFn({ key: rows[0].s3_key }, { env });
  if (!del.ok) {
    throw dependency(`the object store refused to delete this image, so the row was kept: ${del.error}`);
  }

  await run(tx, db
    .deleteFrom("keystone.image")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));

  // ★ No `emit()` here, deliberately — task 14.15's closed topic list (this task's own field 10
  //   dependency) names `items.image.uploaded` only; there is no `items.image.deleted` topic to
  //   emit, and `topics.mjs` is 14.15's file, not this task's. Field 4 names an emit for the upload
  //   path only; none is named for delete.
  return { id, deleted: true };
}

/**
 * ★ THE RAW BYTES, for `GET /api/items/images/:id/raw`. Verify the row exists in this tenant, then
 *   stream via `getObject` — the same "verify in the tenant, then reach the object store" order
 *   `src/documents/archive.mjs`'s read side and `src/routes/index.mjs`'s `/api/documents/:id/pdf`
 *   both already use.
 * @returns { body: Buffer, contentType }
 */
export async function fetchImageBytes(tx, { tenantId, id }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.image")
    .select(["s3_key", "content_type"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (!rows[0]) throw notFound(`no image ${id} in this practice's library`);

  const got = await getObject({ key: rows[0].s3_key });
  if (!got.ok) throw dependency(`the object store could not serve this image: ${got.error}`);

  return { body: got.body, contentType: rows[0].content_type };
}
