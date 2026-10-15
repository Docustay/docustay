// @ts-check
// Stage 15 Task 15.25 — CARD-PRESENT DEVICES: Readers and Tap to Pay

import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { getSetting } from "../settings/writes.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, dependency } from "../http/errors.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING columns, same parameterization).
//   `sql` is the escape hatch for what the builder itself does not express — `now()`,
//   `to_timestamp(...)` — per the L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ Same column list/order every SELECT and RETURNING on `keystone.device` used before. */
const DEVICE_COLUMNS = [
  "id", "tenant_id", "name", "kind", "location_id", "state", "stripe_reader_id",
  "model", "serial", "app_user_id", "last_seen", "registered_by", "deactivated_at",
  "created_at", "updated_at",
];

/**
 * Ensure a Terminal Location exists for this connected account.
 * Reuses connect_account.terminal_location_id if already set; otherwise creates one.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<string>} the Stripe Terminal Location ID
 */
export async function ensureTerminalLocation(tx, { tenantId }, deps = {}) {
  // Check if already set
  const { rows } = await run(tx, db
    .selectFrom("keystone.connect_account")
    .select("terminal_location_id")
    .where("tenant_id", "=", tenantId));

  if (rows.length > 0 && rows[0].terminal_location_id) {
    return rows[0].terminal_location_id;
  }

  // Need to create one. Get practice name for display_name.
  const practiceName = await getSetting(tx, "practice.name", null);
  const displayName = practiceName || "Keystone Practice";

  const locationResult = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/terminal/locations",
    sdk: (s, o, form, query) => s.terminal.locations.create(form, o),
    form: {
      display_name: displayName,
      "address[line1]": "123 Main Street",
      "address[city]": "Springfield",
      "address[state]": "IL",
      "address[postal_code]": "62701",
      "address[country]": "US",
    },
    movesMoney: false,
    purpose: "terminal_location",
    actorUserId: null,
  }, deps);

  const locationId = locationResult.body.id;

  // Store the location ID in connect_account
  await run(tx, db
    .updateTable("keystone.connect_account")
    .set({ terminal_location_id: locationId ?? null })
    .where("tenant_id", "=", tenantId));

  return locationId;
}

/**
 * List all devices (readers and phones) for a practice.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<Array>} array of device rows
 */
export async function listDevices(tx, { tenantId }, deps = {}) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.device")
    .select(DEVICE_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc"));
  return rows;
}

/**
 * Register a card reader with Stripe Terminal.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   registrationCode: the reader's registration code from Stripe
 *   name: a friendly name for this reader
 *   locationId: optional terminal location ID; if not provided, ensures one exists
 *   actorUserId: who is registering this (for audit)
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<object>} the created device row
 */
export async function registerReader(tx, { tenantId, registrationCode, name, locationId = null, actorUserId }, deps = {}) {
  // Ensure we have a location
  const location = locationId || (await ensureTerminalLocation(tx, { tenantId }, deps));

  const registerResult = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/terminal/readers",
    sdk: (s, o, form, query) => s.terminal.readers.create(form, o),
    form: {
      registration_code: registrationCode,
      label: name,
      location,
    },
    movesMoney: false,
    purpose: "reader_register",
    actorUserId,
  }, deps);

  const stripeReaderId = registerResult.body.id;
  const model = registerResult.body.device_type;
  const serial = registerResult.body.serial_number;

  // Check if a device with this stripe_reader_id already exists
  const { rows: existing } = await run(tx, db
    .selectFrom("keystone.device")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_reader_id", "=", stripeReaderId));

  if (existing.length > 0) {
    // Return the existing row
    const { rows } = await run(tx, db
      .selectFrom("keystone.device")
      .select(DEVICE_COLUMNS)
      .where("id", "=", existing[0].id));
    return rows[0];
  }

  // Insert new device row
  const { rows: inserted } = await run(tx, db
    .insertInto("keystone.device")
    .values({
      tenant_id: tenantId ?? null,
      name: name ?? null,
      kind: "reader",
      location_id: location ?? null,
      state: "active",
      stripe_reader_id: stripeReaderId ?? null,
      model: model ?? null,
      serial: serial ?? null,
      registered_by: actorUserId ?? null,
    })
    .returning(DEVICE_COLUMNS));

  const device = inserted[0];

  // Emit event
  await emit(tx, {
    tenantId,
    topic: "money.device.registered",
    emittedBy: "money",
    subjectType: "device",
    subjectId: device.id,
    actor: userActor(actorUserId),
    // ★ `name` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`keystone.device.name`, INSERTed above); no consumer of `money.device.registered` reads
    //   `payload.name` (grepped src/, n8n/workflows/) — a listener reads the device's own name from
    //   the current row by `device.id` (subjectId).
    payload: { kind: "reader" },
  });

  return device;
}

/**
 * Deactivate a device (reader or phone).
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   deviceId: the device to deactivate
 *   actorUserId: who is deactivating (for audit)
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<object>} the updated device row
 */
export async function deactivateDevice(tx, { tenantId, deviceId, actorUserId }, deps = {}) {
  // Get the device
  const { rows: devices } = await run(tx, db
    .selectFrom("keystone.device")
    .select(["kind", "stripe_reader_id"])
    .where("id", "=", deviceId)
    .where("tenant_id", "=", tenantId));

  if (devices.length === 0) {
    throw new Error(`Device ${deviceId} not found`);
  }

  const device = devices[0];

  // If it's a reader, call Stripe to deactivate
  if (device.kind === "reader" && device.stripe_reader_id) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "DELETE",
      path: `/terminal/readers/${device.stripe_reader_id}`,
      sdk: (s, o, form, query) => s.terminal.readers.del(device.stripe_reader_id, {}, o),
      movesMoney: false,
      purpose: "reader_deactivate",
      actorUserId,
    }, deps);
  }

  // Update the row
  const { rows: updated } = await run(tx, db
    .updateTable("keystone.device")
    .set({ state: "deactivated", deactivated_at: sql`now()` })
    .where("id", "=", deviceId)
    .returning(DEVICE_COLUMNS));

  return updated[0];
}

/**
 * P3.S12 — Rename a device (reader or phone). A registered reader is renamed on Stripe FIRST
 * (its `label`), then the local row; a device with no `stripe_reader_id` yet (ordered/unregistered)
 * is renamed locally only. Emits `money.device.renamed`.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   deviceId: the device to rename
 *   name: the new name, 1–60 characters
 *   actorUserId: who is renaming (for audit)
 * @param {object} deps optional dependencies for testing (passed through to stripeConnectedRequest)
 * @returns {Promise<object>} the updated device row
 */
export async function renameDevice(tx, { tenantId, deviceId, name, actorUserId }, deps = {}) {
  // ★ Validated BEFORE any Stripe call or query — a bad name never reaches either.
  if (typeof name !== "string" || name.length < 1 || name.length > 60) {
    throw invalid("name must be 1 to 60 characters");
  }

  const { rows: devices } = await run(tx, db
    .selectFrom("keystone.device")
    .select("stripe_reader_id")
    .where("id", "=", deviceId)
    .where("tenant_id", "=", tenantId));

  if (devices.length === 0) {
    throw notFound("device not found");
  }

  const device = devices[0];

  if (device.stripe_reader_id) {
    try {
      await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/terminal/readers/${device.stripe_reader_id}`,
        sdk: (s, o, form, query) => s.terminal.readers.update(device.stripe_reader_id, form, o),
        form: { label: name },
        movesMoney: false,
        purpose: "rename_reader",
        actorUserId,
      }, deps);
    } catch (e) {
      throw dependency(`Stripe refused this: ${e.message}`, e);
    }
  }

  const { rows: updated } = await run(tx, db
    .updateTable("keystone.device")
    .set({ name: name ?? null, updated_at: sql`now()` })
    .where("id", "=", deviceId)
    .returning(DEVICE_COLUMNS));

  const renamed = updated[0];

  await emit(tx, {
    tenantId,
    topic: "money.device.renamed",
    emittedBy: "money",
    subjectType: "device",
    subjectId: renamed.id,
    actor: userActor(actorUserId),
    payload: {},
  });

  return renamed;
}

/**
 * P3.S12 — Read a reader's live status from Stripe (GET /v1/terminal/readers/{id}). A read, never
 * a refused write: any Stripe failure (or a device with no `stripe_reader_id` registered yet, e.g.
 * a phone or an ordered-but-not-registered reader) answers `{ status: "unknown", unavailable: true }`
 * rather than throwing — same posture as `listFraudReviews` (src/money/fraud.mjs).
 *
 * ★ `last_seen_at` from Stripe is in SECONDS (unix epoch) — `to_timestamp(seconds)`, not `/1000`.
 *
 * @param tx a tenant transaction
 * @param {object} options tenantId, deviceId
 * @param {object} deps optional dependencies for testing (passed through to stripeConnectedRequest)
 * @returns {Promise<{status: string, lastSeenAt?: number, unavailable?: true}>}
 */
export async function deviceStatus(tx, { tenantId, deviceId }, deps = {}) {
  const { rows: devices } = await run(tx, db
    .selectFrom("keystone.device")
    .select("stripe_reader_id")
    .where("id", "=", deviceId)
    .where("tenant_id", "=", tenantId));

  if (devices.length === 0) {
    throw notFound("device not found");
  }

  const device = devices[0];

  if (!device.stripe_reader_id) {
    return { status: "unknown", unavailable: true };
  }

  try {
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "GET",
      path: `/terminal/readers/${device.stripe_reader_id}`,
      sdk: (s, o, form, query) => s.terminal.readers.retrieve(device.stripe_reader_id, {}, o),
      movesMoney: false,
      purpose: "reader_status",
      actorUserId: null,
    }, deps);

    // ★ seconds, not ms — see header note. Postgres to_timestamp() takes seconds.
    await run(tx, db
      .updateTable("keystone.device")
      .set({ last_seen: sql`to_timestamp(${sql.val(body.last_seen_at)})` })
      .where("id", "=", deviceId)
      .where("tenant_id", "=", tenantId));

    return { status: body.status, lastSeenAt: body.last_seen_at };
  } catch {
    return { status: "unknown", unavailable: true };
  }
}
