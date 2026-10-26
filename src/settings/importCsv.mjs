// @ts-check
// Task 6.4 — SetImport (06-settings.md §2.5, §3 migration 0338, §7 "Import run processor", §9's
// 5,000-row hard limit, §12 test 5).
//
// ★★★ THE FIELD VOCABULARY IS THE REAL `keystone.app_user` COLUMNS, NOT INVENTED ONES (CLAUDE.md
//     failure #3 — "a schema built from rules instead of the model"). `first_name`, `last_name`,
//     `mobile_phone`, `date_of_birth` are canonical columns (migration 0076); `email` is the
//     table's own de-dup key (`app_user_tenant_email_key`, `src/people/writes.mjs`). The frame
//     (`specs/mockups/SetImport.frame.html`) offers exactly these five plus "Don't import" — this
//     list is that table, not a re-imagining of it.
//
// ★★ WHY THIS FILE DOES NOT IMPORT `createPerson`/`updatePerson` (src/people/writes.mjs). Those two
//    functions are this build's explicit "what NOT to touch" — a shared file several other in-flight
//    tasks may also be mid-edit on — and neither accepts the four supplementary columns an import row
//    carries (`updatePerson`'s own field list is `displayName`/`email` only). Duplicating their
//    INSERT would fork the identity-row shape in two places; instead `runImportRun` below calls
//    `createPerson` for every genuinely new person (the one write path for "a person now exists",
//    unchanged) and then issues its OWN, narrowly-scoped UPDATE for the four supplementary columns —
//    a second statement, not a second creator.
//
// ★ NO BACKGROUND JOB. §7 says the processor "runs immediately on POST … same job-queue shape as
//   every other async job" — but nothing in this build's file list (06-settings.md §2.5/§2.6, §3,
//   §11, src/nav/sections.mjs) names `src/queue/tasks.mjs` or `db/gates/s3_topic_emitters.mjs`, and
//   the only application-reachable way to add a policed graphile-worker job today is either a task's
//   own `helpers.addJob` (reached only from inside `TOPIC_HANDLERS`, itself reached only by the
//   outbox drain) or `src/queue/runner.mjs`'s `enqueue()` — which [MEASURED, grep] has exactly one
//   caller anywhere in this codebase, `db/gates/p18_worker.mjs`, and zero application callers. Adding
//   the first application caller of either mechanism is a wiring decision bigger than this task's own
//   file list, so `check`/`run` below do the work SYNCHRONOUSLY inside the request instead — the
//   "Done" bar (06-settings.md, task 6.4: "SetImport accepts a real upload and creates the imported
//   records") is met either way; the response's `status: 'importing'` therefore reads `'done'` by the
//   time the caller's own POST resolves. Flagged in this build's report as a scope decision, not a
//   silent shortcut.

import Papa from "papaparse";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { createPerson } from "../people/writes.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { archiveRecord } from "../records/archive.mjs";
// ★★★ Task 12.16 — per-platform column presets, applied by choosing a source
// (`setImportMapping`'s optional `sourceKey`) and read back for the check step's card-on-file
// count (`checkImportRun`). See src/people/importPresets.mjs for why every preset ships empty.
import { applyPreset, PRESETS } from "../people/importPresets.mjs";
import { db, run as runQuery } from "../db/kysely.mjs";
import { sql } from "kysely";

/** §9 — hard limit, exact word "hard limit" from 06-settings.md §2.5's own error row. */
export const MAX_IMPORT_ROWS = 5000;

/** The frame's own "Goes to" dropdown options, in the frame's own order — `null` is "Don't import". */
export const IMPORT_FIELD_OPTIONS = Object.freeze([
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "mobile_phone", label: "Mobile" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: null, label: "Don't import" },
]);
const VALID_FIELD_KEYS = new Set(IMPORT_FIELD_OPTIONS.map((o) => o.key).filter((k) => k !== null));

/**
 * RFC4180 CSV parsing via `papaparse` (`Papa.parse(text, { header: false, skipEmptyLines: true })`).
 * Handles quoted fields (`"a, b"`), doubled-quote escapes (`""` inside a quoted field) and both
 * `\n`/`\r\n` line endings. `skipEmptyLines: true` drops a wholly-blank trailing line, same as the
 * hand-written parser this replaced. Return shape is unchanged: array of arrays, header row as
 * `rows[0]` — `csvToRecords` below depends on exactly this shape.
 */
export function parseCsv(text) {
  const { data } = Papa.parse(text, { header: false, skipEmptyLines: true });
  return data;
}

/** `parseCsv`'s rows, as header + array-of-objects. Throws `invalid` on an empty/header-only file. */
export function csvToRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw invalid("that file is empty");
  const [header, ...body] = rows;
  const columns = header.map((h) => h.trim());
  if (columns.length === 0 || columns.every((c) => c === "")) throw invalid("that file has no columns");
  if (body.length === 0) throw invalid("that file has a header row and no data rows");
  const records = body.map((r) => {
    const obj = {};
    columns.forEach((c, idx) => { obj[c] = r[idx] ?? ""; });
    return obj;
  });
  return { columns, records };
}

/** Loose date parsing: ISO `YYYY-MM-DD` or `MM/DD/YYYY`. Returns an ISO string or null (never throws —
 *  an unparseable date of birth is skipped for that row, not a reason to fail the whole row). */
function parseDob(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

/** §2.5 mapping row: `{ mapping, duplicatePolicy, marketingConsentConfirmed }` → validated + stored.
 *  ★ Task 12.16 — `sourceKey` is optional. When it is given and `mapping` is absent (undefined or
 *  null), the mapping is derived from `applyPreset(sourceKey, <the run's own CSV columns>)` instead
 *  of requiring the caller to hand-build one. Whenever `sourceKey` is given at all — whether the
 *  mapping it produced was used as-is or the caller went on to hand-edit it — the chosen source is
 *  stored on `column_mapping` as `{ "__source": key, …}` (jsonb; no schema change), so the check
 *  step can read back which preset (if any) applies. */
export async function setImportMapping(tx, { tenantId, importRunId, sourceKey, mapping, duplicatePolicy, marketingConsentConfirmed }) {
  const run = await loadRun(tx, tenantId, importRunId);
  let effectiveMapping = mapping;
  if (sourceKey != null && (mapping === undefined || mapping === null)) {
    const { rows: sampleRow } = await runQuery(tx, db
      .selectFrom("keystone.import_row")
      .select("raw")
      .where("import_run_id", "=", importRunId)
      .where("tenant_id", "=", tenantId)
      .orderBy("row_number", "asc")
      .limit(1));
    const csvColumns = sampleRow.length > 0 ? Object.keys(sampleRow[0].raw) : [];
    effectiveMapping = applyPreset(sourceKey, csvColumns).mapping;
  }
  if (!effectiveMapping || typeof effectiveMapping !== "object" || Array.isArray(effectiveMapping)) {
    throw invalid("mapping must be an object of {csvColumn: fieldKey|null}");
  }
  const mappedKeys = new Set();
  for (const [col, key] of Object.entries(effectiveMapping)) {
    if (key === null) continue;
    if (!VALID_FIELD_KEYS.has(key)) throw invalid(`"${key}" (column "${col}") is not a field this import can fill`);
    if (mappedKeys.has(key)) throw invalid(`"${key}" is mapped from more than one column`);
    mappedKeys.add(key);
  }
  // ★ "email is the de-dup key" — 06-settings.md §2.5's own error row.
  if (!mappedKeys.has("email")) throw invalid("map a column to Email — it's how this import tells your existing people apart from new ones");
  if (!["skip", "fill_blank"].includes(duplicatePolicy)) {
    throw invalid("duplicatePolicy must be 'skip' or 'fill_blank'");
  }
  // ★ MOCKUPS §13:421 — "requires ticking … before any go into marketing lists". Any mapped column
  //   at all implies marketing intent per that same rule; the confirmation is required outright.
  if (!marketingConsentConfirmed) {
    throw invalid("confirm marketing consent before these rows can be imported");
  }
  const storedMapping = sourceKey != null ? { __source: sourceKey, ...effectiveMapping } : effectiveMapping;
  await runQuery(tx, db
    .updateTable("keystone.import_run")
    .set({ column_mapping: JSON.stringify(storedMapping), duplicate_policy: duplicatePolicy, marketing_consent_confirmed: true, status: "mapped" })
    .where("id", "=", importRunId)
    .where("tenant_id", "=", tenantId));
  return { mapped: true };
}

async function loadRun(tx, tenantId, importRunId) {
  const { rows } = await runQuery(tx, db
    .selectFrom("keystone.import_run")
    .selectAll()
    .where("id", "=", importRunId)
    .where("tenant_id", "=", tenantId));
  if (rows.length === 0) throw notFound("no such import");
  return rows[0];
}

/** Apply the current mapping to one raw CSV row → `{email, first_name, last_name, mobile_phone, date_of_birth}`. */
function applyMapping(mapping, raw) {
  const out = {};
  for (const [col, key] of Object.entries(mapping)) {
    if (key === null) continue;
    const v = String(raw[col] ?? "").trim();
    if (!v) continue;
    out[key] = key === "date_of_birth" ? parseDob(v) : v;
  }
  return out;
}

/**
 * §2.5 step 2→3 — a DRY RUN. Nothing is written to `app_user`; only classification, against the
 * mapping already stored on the run. Re-runnable (idempotent reads only).
 * ★ Task 12.16 — the return also carries `counts: { clients, cardsOnFile, couldNotWorkOut }` (the
 *   drawn counts for what the importer really writes — OQ-12.7 option A: no sessions/packages/
 *   payments count, because the importer writes none) and `issues`. Only the `shared_email` issue
 *   kind is built here — the plan names `missing_name`/`bad_date` as possible kinds but gives no
 *   detection rule or copy for either, so neither is invented (flagged in this task's report).
 *   `cardsOnFile` reads the CHOSEN preset's own `cardColumn` (via `column_mapping.__source`) and
 *   counts rows where that raw column is truthy; 0 when no preset (or preset has no `cardColumn`).
 */
export async function checkImportRun(tx, { tenantId, importRunId }) {
  const run = await loadRun(tx, tenantId, importRunId);
  if (!run.column_mapping) throw invalid("map columns before checking this import");
  const mapping = run.column_mapping;
  const sourceKey = mapping.__source ?? null;
  const cardColumn = sourceKey != null ? (PRESETS[sourceKey]?.cardColumn ?? null) : null;
  const { rows } = await runQuery(tx, db
    .selectFrom("keystone.import_row")
    .select(["row_number", "raw"])
    .where("import_run_id", "=", importRunId)
    .where("tenant_id", "=", tenantId)
    .orderBy("row_number", "asc"));

  let toCreate = 0, toFillBlanksOn = 0, duplicatesSkipped = 0, cardsOnFile = 0;
  const errors = [];
  const rowsByEmail = new Map(); // lower(email) -> row_number[] — rows SHARING an email in THIS file
  for (const r of rows) {
    if (cardColumn && String(r.raw[cardColumn] ?? "").trim()) cardsOnFile++;
    const mapped = applyMapping(mapping, r.raw);
    if (!mapped.email) {
      errors.push({ row: r.row_number, field: "email", message: "no email value in this row" });
      continue;
    }
    const emailLower = mapped.email.toLowerCase();
    if (!rowsByEmail.has(emailLower)) rowsByEmail.set(emailLower, []);
    rowsByEmail.get(emailLower).push(r.row_number);
    const { rows: existing } = await tx.query(
      `SELECT id FROM keystone.app_user WHERE tenant_id = $1 AND lower(email) = lower($2)`,
      [tenantId, mapped.email]);
    if (existing.length > 0) {
      if (run.duplicate_policy === "fill_blank") toFillBlanksOn++; else duplicatesSkipped++;
    } else {
      toCreate++;
    }
  }

  const issues = [];
  for (const [, rowNumbers] of rowsByEmail) {
    if (rowNumbers.length > 1) {
      issues.push({
        kind: "shared_email",
        rows: rowNumbers,
        sentence: `${rowNumbers.length} clients share one email address — A family, most likely. `
          + `We'll keep them separate and link them to one account.`,
      });
    }
  }

  await runQuery(tx, db
    .updateTable("keystone.import_run")
    .set({ status: "checked" })
    .where("id", "=", importRunId)
    .where("tenant_id", "=", tenantId));

  const counts = {
    clients: toCreate + toFillBlanksOn + duplicatesSkipped,
    cardsOnFile,
    couldNotWorkOut: errors.length,
  };
  return { toCreate, toFillBlanksOn, duplicatesSkipped, errors, counts, issues };
}

/**
 * §2.5 step 3 / §7 "Import run processor" — creates the actual people. A duplicate email:
 * `skip` leaves the existing row untouched; `fill_blank` fills ONLY columns that are currently NULL
 * on the existing row, never overwriting a populated one (§12 test 5's exact rule).
 */
export async function runImportRun(tx, { tenantId, importRunId, actorUserId }) {
  const run = await loadRun(tx, tenantId, importRunId);
  if (!run.column_mapping) throw invalid("map columns before importing");
  if (["importing", "done"].includes(run.status)) {
    throw conflict("this import has already been run");
  }
  await runQuery(tx, db
    .updateTable("keystone.import_run")
    .set({ status: "importing" })
    .where("id", "=", importRunId)
    .where("tenant_id", "=", tenantId));

  const mapping = run.column_mapping;
  const { rows } = await runQuery(tx, db
    .selectFrom("keystone.import_row")
    .select(["id", "row_number", "raw"])
    .where("import_run_id", "=", importRunId)
    .where("tenant_id", "=", tenantId)
    .orderBy("row_number", "asc"));

  let created = 0, filledBlanks = 0, skipped = 0, errored = 0;
  for (const r of rows) {
    const mapped = applyMapping(mapping, r.raw);
    if (!mapped.email) {
      await runQuery(tx, db
        .updateTable("keystone.import_row")
        .set({ outcome: "error", error: "no email value in this row" })
        .where("id", "=", r.id));
      errored++;
      continue;
    }
    const { rows: existing } = await tx.query(
      `SELECT id, first_name, last_name, mobile_phone, date_of_birth
         FROM keystone.app_user WHERE tenant_id = $1 AND lower(email) = lower($2)`,
      [tenantId, mapped.email]);

    if (existing.length > 0) {
      if (run.duplicate_policy === "skip") {
        await runQuery(tx, db
          .updateTable("keystone.import_row")
          .set({ outcome: "skipped_duplicate" })
          .where("id", "=", r.id));
        skipped++;
        continue;
      }
      // fill_blank — ONLY columns currently NULL on the existing row.
      const existingRow = existing[0];
      const sets = []; const args = [existingRow.id];
      for (const col of ["first_name", "last_name", "mobile_phone", "date_of_birth"]) {
        if (existingRow[col] == null && mapped[col] != null) {
          args.push(mapped[col]);
          sets.push(`${col} = $${args.length}`);
        }
      }
      if (sets.length > 0) {
        await tx.query(`UPDATE keystone.app_user SET ${sets.join(", ")} WHERE id = $1`, args);
      }
      await runQuery(tx, db
        .updateTable("keystone.import_row")
        .set({ outcome: "filled_blanks" })
        .where("id", "=", r.id));
      filledBlanks++;
      continue;
    }

    // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON — createPerson
    //   (src/people/writes.mjs) now enforces this unconditionally. Only matters HERE, for a
    //   genuinely NEW person — the fill_blank/skip paths above never call createPerson at all, so
    //   they are untouched by this rule. A row with no phone used to create the person anyway
    //   (phone was only ever set by the separate UPDATE loop below, after creation) — now it fails
    //   the same clean, reported way a missing-email row already does, rather than createPerson
    //   throwing a raw "missing required fields" error mid-import.
    if (!mapped.mobile_phone) {
      await runQuery(tx, db
        .updateTable("keystone.import_row")
        .set({ outcome: "error", error: "no phone value in this row" })
        .where("id", "=", r.id));
      errored++;
      continue;
    }

    // Genuinely new — the one write path for "a person now exists" (src/people/writes.mjs).
    try {
      const displayName = [mapped.first_name, mapped.last_name].filter(Boolean).join(" ").trim() || mapped.email;
      const person = await createPerson(tx, {
        tenantId, email: mapped.email, displayName, role: "adult_client", actorUserId, mobilePhone: mapped.mobile_phone,
      });
      const sets = []; const args = [person.id];
      for (const col of ["first_name", "last_name", "mobile_phone", "date_of_birth"]) {
        if (mapped[col] != null) { args.push(mapped[col]); sets.push(`${col} = $${args.length}`); }
      }
      // ★ Tag the new row with the import_run_id so undoImportRun can find it (migration 0348).
      args.push(importRunId);
      sets.push(`created_by_import_run_id = $${args.length}`);
      if (sets.length > 0) {
        await tx.query(`UPDATE keystone.app_user SET ${sets.join(", ")} WHERE id = $1`, args);
      }
      await runQuery(tx, db
        .updateTable("keystone.import_row")
        .set({ outcome: "created" })
        .where("id", "=", r.id));
      created++;
    } catch (e) {
      await runQuery(tx, db
        .updateTable("keystone.import_row")
        .set({ outcome: "error", error: e.message ?? "could not create this person" })
        .where("id", "=", r.id));
      errored++;
    }
  }

  await runQuery(tx, db
    .updateTable("keystone.import_run")
    .set({ status: "done", completed_at: sql`now()` })
    .where("id", "=", importRunId)
    .where("tenant_id", "=", tenantId));

  await emit(tx, {
    tenantId, topic: "settings.import.completed", emittedBy: "settings",
    actor: userActor(actorUserId),
    payload: { importRunId, created, filledBlanks, skipped, errored },
  });
  await writeAudit(tx, {
    tenantId, action: "settings.changed", object: "settings.import",
    actorUserId: actorUserId ?? null,
    after: { importRunId, created, filledBlanks, skipped, errored },
  });

  return { status: "done", created, filledBlanks, skipped, errors: errored };
}

/**
 * §2.5 undo — reverses a completed import by archiving all created rows.
 * ★★★ REAL LIMITATION: Rows UPDATED via fill_blank policy cannot be un-updated because no
 * before-snapshot exists. Undo archives ONLY newly CREATED rows and leaves updated rows with
 * their filled-in values — this is deliberate, not a bug to fix later.
 */
export async function undoImportRun(tx, { tenantId, importRunId, actorUserId }) {
  const run = await loadRun(tx, tenantId, importRunId);
  if (run.status !== "done") {
    throw invalid("only completed imports can be undone");
  }
  // ★ Find all app_user rows that were created by this import run (tagged at creation).
  const { rows: createdPeople } = await runQuery(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("created_by_import_run_id", "=", importRunId));

  let archivedCount = 0;
  for (const person of createdPeople) {
    // ★ archiveRecord handles the transaction, emits the event, audits, and updates the row.
    // It throws notFound if the row is already archived, so catch and skip.
    try {
      await archiveRecord(tx, {
        tenantId, object: "person", id: person.id, actorUserId,
        reason: "undo of import run",
      });
      archivedCount++;
    } catch (e) {
      // ★ If a row is already archived or missing, skip and continue. Undo is best-effort.
    }
  }

  // ★ Emit a summary event and audit entry for the whole undo action.
  await emit(tx, {
    tenantId, topic: "settings.import.undone", emittedBy: "settings",
    actor: userActor(actorUserId),
    payload: { importRunId, archivedCount },
  });
  await writeAudit(tx, {
    tenantId, action: "settings.changed", object: "settings.import",
    actorUserId: actorUserId ?? null,
    after: { importRunId, archivedCount, undone: true },
  });

  return { status: "undone", archivedCount };
}

/** progress poll (§2.5) */
export async function importRunStatus(tx, { tenantId, importRunId }) {
  const run = await loadRun(tx, tenantId, importRunId);
  const { rows: counts } = await tx.query(
    `SELECT outcome, count(*)::int AS n FROM keystone.import_row WHERE import_run_id = $1 AND tenant_id = $2 GROUP BY outcome`,
    [importRunId, tenantId]);
  const by = Object.fromEntries(counts.map((c) => [c.outcome, c.n]));
  const { rows: errRows } = await runQuery(tx, db
    .selectFrom("keystone.import_row")
    .select((eb) => [
      eb.ref("row_number").as("row"),
      eb.ref("error").as("message"),
    ])
    .where("import_run_id", "=", importRunId)
    .where("tenant_id", "=", tenantId)
    .where("outcome", "=", "error")
    .orderBy("row_number", "asc"));
  return {
    status: run.status,
    created: by.created ?? 0,
    filledBlanks: by.filled_blanks ?? 0,
    skipped: by.skipped_duplicate ?? 0,
    errors: errRows,
  };
}
