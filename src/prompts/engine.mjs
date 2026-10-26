// src/prompts/engine.mjs — Stage 11 task 11.4: the prompt engine. Compute on read, store only
// dismissals (D9 / S11-OQ-2). `computePrompts` returns the viewer's live prompts in priority order
// (≤3 for Home, all for the feed); `dismissPrompt` records a dismissal and emits its event. The
// dismissal table is migration 0369 (task 11.2, written but not yet applied); the catalogue
// (`PROMPT_KINDS`, `PROMPT_FILTERS`, `composeKind`) is task 11.3 — CT-F01, CT-F53.
//
// ★★★ THE PERMISSION BOUNDARY (CT-F01 CC-2, enforced HERE): a `money: true` kind's query is NEVER
//     RUN for a viewer with `canSeeMoney: false` — a coach never receives an `invoice_late` prompt
//     because the SQL never executes for them, not because the response was filtered afterwards.
//     Same discipline for `filter`: a kind whose own `filter` doesn't match a non-"everything"
//     request is skipped before its query runs, not after.
//
// ★★ TASK 11.22 (wave 4, this stage) EDITS FOUR NAMED PARTS OF THIS FILE AND NOTHING ELSE: the
//    `SURFACES` constant below, `computePrompts`'s parameter object, the kind-skip block inside its
//    step 2, and the `entry.params(...)` call inside its step 3. Each is kept small, contiguous and
//    findable for exactly that reason. `dismissPrompt` and everything else here stays 11.4's.

import { PROMPT_KINDS, PROMPT_FILTERS, composeKind } from "./catalogue.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound } from "../http/errors.mjs";

// ★ DOCUSTAY WALL FIX (29 Sep 2026) — `consent_unsigned_today` (catalogue.mjs) correlates a
//   same-day booking (booking-owned) with an unsigned document instance (documents-owned) — a real
//   cross-domain analytical join, unlike every other entry's single-table `sql` string. Documents
//   may never be reached with a raw SQL string built outside src/documents/ (db/gates/
//   documents_wall.mjs), so this ONE entry can't be a plain `sql` string the way the other ~20 are.
//   `entry.fetch`, when present, REPLACES `entry.sql`/`entry.params` entirely: it receives `(db,
//   {viewerId, personId})` and returns rows directly, free to run its OWN separate queries (booking
//   directly; the document side through documents/api.mjs) and merge them in JS. Every existing
//   string-based entry is completely unaffected — this branch is additive, checked first, and falls
//   through to the original single-query path when `entry.fetch` is absent.
async function rowsForEntry(db, entry, { viewerId, personId = null }) {
  if (typeof entry.fetch === "function") return entry.fetch(db, { viewerId, personId });
  const { rows } = await db.query(entry.sql, entry.params(viewerId, personId));
  return rows;
}

/** F01 §6 — "a practice cannot raise its own noise ceiling." Fixed by ruling, not a setting. */
export const PROMPT_COOLDOWN_DAYS = 7;
export const HOME_PROMPT_CEILING = 3;

// ★ THE SURFACE ENUM — CT-F01's full eleven-member enum, widened here by task 11.22. CLOSED: a
//   twelfth member amends CONTRACTS.md first.
const SURFACES = Object.freeze([
  "home", "feed", "team", "scheduling", "network", "person",
  "calendar", "waitlist", "online_booking", "booking_settings", "settings_usage",
]);

/** A uuid string, loosely — the same 8-4-4-4-12 hex shape `outbox.mjs`'s ACTOR_SHAPE checks. */
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * `computePrompts(db, { viewerId, canSeeMoney, surface, filter = "everything", personId = null,
 * viewerStaffRole = null }) → { prompts, total }`
 * `db` is a pg client inside the caller's `withTenant` transaction — the dismissal SELECT and every
 * kind's query run through it, scoped by RLS.
 */
export async function computePrompts(db, { viewerId, canSeeMoney, surface, filter = "everything", personId = null, viewerStaffRole = null }) {
  // `personId`, when given, must be a uuid — validated here (not only at the route) because the
  // engine is also called directly by Stage 17's `/api/home` and Stage 18's Today (CT-F01, 11.22).
  if (personId !== null && personId !== undefined && !isUuid(personId)) {
    throw invalid("personId must be a uuid");
  }
  // `surface === "person"` requires `personId` — an empty list means "nothing to show"; a missing
  // `personId` is a different fact ("I was not told who") and gets its own 400 (CT-F01, 11.22).
  if (surface === "person" && (personId === null || personId === undefined)) {
    throw invalid('surface "person" needs a personId');
  }

  // ── step 1: validate surface and filter ──────────────────────────────────────────────────────
  if (!SURFACES.includes(surface)) {
    throw invalid(`surface must be one of ${SURFACES.join(", ")}`);
  }
  if (!PROMPT_FILTERS.includes(filter)) {
    throw invalid(`filter must be one of ${PROMPT_FILTERS.join(", ")}`);
  }

  // ── step 2: which kinds are even considered — the permission boundary lives here, before any
  //    query runs (CT-F01 CC-2). ─────────────────────────────────────────────────────────────────
  const kindsToQuery = [];
  for (const entry of Object.values(PROMPT_KINDS)) {
    if (!entry.surfaces.includes(surface)) continue;
    // `viewerStaffRole` is optional; when it is `null` an entry with a non-null `roles` is SKIPPED,
    // never admitted — the safe direction (CT-F01, 11.22).
    if (entry.roles !== null && !entry.roles.includes(viewerStaffRole)) continue;
    if (entry.money && !canSeeMoney) continue;
    if (filter !== "everything" && entry.filter !== filter) continue;
    kindsToQuery.push(entry);
  }

  // ── step 3: run each surviving kind's query and compose its candidates ──────────────────────────
  let candidates = [];
  for (const entry of kindsToQuery) {
    const rows = await rowsForEntry(db, entry, { viewerId, personId });
    candidates = candidates.concat(composeKind(entry.kind, rows, { canSeeMoney }));
  }

  // ── step 4: hide dismissed candidates (F01 §2.2) ────────────────────────────────────────────────
  const { rows: dismissals } = await db.query(
    `SELECT prompt_kind, subject_key, fact_fingerprint, dismissed_at
       FROM keystone.prompt_dismissal WHERE app_user_id = $1`,
    [viewerId]);
  const cooldownCutoff = Date.now() - PROMPT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const isHidden = (candidate) => {
    const subjectKey = candidate.subjectId ?? "";
    return dismissals.some((d) =>
      d.prompt_kind === candidate.kind && d.subject_key === subjectKey &&
      (new Date(d.dismissed_at).getTime() > cooldownCutoff || d.fact_fingerprint === candidate.fingerprint));
  };
  candidates = candidates.filter((c) => !isHidden(c));

  // ── step 5: upgrade rule — drop `upgrade: true` candidates if any non-upgrade candidate survives
  const hasNonUpgrade = candidates.some((c) => !PROMPT_KINDS[c.kind].upgrade);
  if (hasNonUpgrade) {
    candidates = candidates.filter((c) => !PROMPT_KINDS[c.kind].upgrade);
  }

  // ── step 6: sort by priority (stable — ties keep the kind's own query order), then cap for Home
  candidates.sort((a, b) => a.priority - b.priority);
  const total = candidates.length;
  const limited = surface === "home" ? candidates.slice(0, HOME_PROMPT_CEILING) : candidates;

  const prompts = limited.map((c) => ({
    kind: c.kind, icon: c.icon, tone: c.tone, headline: c.headline, why: c.why, action: c.action,
    subjectId: c.subjectId, dismissKey: `${c.kind}:${c.subjectId ?? ""}`,
  }));

  return { prompts, total };
}

/**
 * `dismissPrompt(db, { tenantId, viewerId, canSeeMoney, kind, subjectId = null }) →
 * { dismissed: true, kind, subjectId }`. `db` is a pg client inside the caller's `withTenant`
 * transaction — the same one `emit()` requires.
 */
export async function dismissPrompt(db, { tenantId, viewerId, canSeeMoney, kind, subjectId = null }) {
  const entry = PROMPT_KINDS[kind];
  if (!entry || (entry.money && !canSeeMoney)) {
    // No leak of which reason — same 404, same message, whether the kind is unknown or a coach
    // asked to dismiss a money kind that was never run for them.
    throw notFound("that prompt is not showing for you");
  }
  if (subjectId !== null && !isUuid(subjectId)) {
    throw invalid("subjectId must be a uuid");
  }

  // Re-run that ONE kind's query and compose — the fingerprint comes from this server-side
  // recompute, never from the request.
  const rows = await rowsForEntry(db, entry, { viewerId });
  const candidates = composeKind(kind, rows, { canSeeMoney });
  const candidate = candidates.find((c) => (c.subjectId ?? null) === subjectId);
  if (!candidate) {
    throw notFound("that prompt is not showing for you");
  }

  const subjectKey = subjectId ?? "";
  const { rows: upsertRows } = await db.query(
    `WITH old AS (
       SELECT fact_fingerprint FROM keystone.prompt_dismissal
        WHERE app_user_id = $2 AND prompt_kind = $3 AND subject_key = $4
     ), upsert AS (
       INSERT INTO keystone.prompt_dismissal (tenant_id, app_user_id, prompt_kind, subject_key, fact_fingerprint)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ON CONSTRAINT prompt_dismissal_once
         DO UPDATE SET fact_fingerprint = EXCLUDED.fact_fingerprint, dismissed_at = now()
       RETURNING id, fact_fingerprint
     )
     SELECT upsert.id, (SELECT fact_fingerprint FROM old) IS DISTINCT FROM upsert.fact_fingerprint AS changed
       FROM upsert`,
    [tenantId, viewerId, kind, subjectKey, candidate.fingerprint]);

  // Zero rows is a refusal, not a success — same discipline as `settings/writes.mjs:85-89`: under
  // FORCE RLS an insert/update for another tenant returns no row rather than raising.
  if (upsertRows.length === 0) {
    throw new Error("prompt dismissal refused by row-level security");
  }

  if (upsertRows[0].changed) {
    await emit(db, {
      tenantId, topic: "people.prompt.dismissed", emittedBy: "people", actor: userActor(viewerId),
      payload: subjectId ? { kind, subject_id: subjectId } : { kind },
    });
  }

  return { dismissed: true, kind, subjectId };
}
