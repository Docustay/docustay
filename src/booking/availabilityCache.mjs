// @ts-check
// src/booking/availabilityCache.mjs — Stage 13 task 13.19 (STAGE-13-PLAN.md §13.19) · CT-F28.
//
// ★★★ THE SLOT LIST FROM A CACHE, WHEN IT IS FRESH; NEVER ON THE WRITE PATH. G10 ruled a sub-second
//     read for the slot routes. `keystone.availability_cache` (migration 0400, `13.5`) is the table;
//     eight invalidation triggers across 0400 and 0401 (`13.6`) — booking · availability_rule ·
//     date_override · booking_policy · tenant_setting · service · staff_shift · time_off — DELETE the
//     covering row the instant anything that could change the answer changes. This module never
//     decides whether a WRITE is allowed: `POST /api/app/booking`'s validation (13.11) keeps calling
//     the uncached `readSlots` directly, on purpose (see that route).
//
// ★★★ SIGNATURE — CT-F28 vs §13.19 DISAGREE, AND BOTH ARE FOLLOWED. CT-F28
//     (`CONTRACTS.md`) gives `readSlotsCached(db, {tenantId, hostId, date, serviceId, now})`; §13.19
//     gives the same shape MINUS `tenantId`. Two callers already landed on the CT-F28 shape:
//     `publicBooking.mjs` passes `tenantId`; `calendarRead.mjs` does not. Both are satisfied here by
//     destructuring `tenantId` (CT-F28's name) but NEVER USING IT FOR ANYTHING — an unlisted or
//     omitted key is simply ignored either way. ★★★ THIS IS NOT A GAP: every query below reads and
//     writes through `tenant_id = keystone.current_tenant_id()` (the SQL text §13.19 itself gives),
//     and `keystone.availability_cache` is FORCE ROW LEVEL SECURITY (0400) — so the boundary is the
//     database session's own tenant context, set once by `withTenant`/`crmScoped`/`scoped` before this
//     module is ever called, not a value a caller could pass wrong. A caller handing in the WRONG
//     `tenantId` cannot read or write another practice's row; RLS refuses it regardless of the
//     argument. ★★ AND `policyFor` (below) is deliberately given the SAME `keystone.current_tenant_id()`
//     resolved from the database, NEVER the caller's `tenantId` argument — `policyFor`'s own query
//     (`src/booking/writes.mjs:551-553`) filters `WHERE tenant_id = $1`, not just RLS, so a caller that
//     omits `tenantId` (as `calendarRead.mjs` does) would otherwise silently match zero
//     `booking_policy` rows and skip a real per-service override. `readSlots` avoids exactly this by
//     resolving its own tenant id with `SELECT keystone.current_tenant_id()` (`read.mjs:172-173`)
//     rather than trusting a caller-supplied one; this module does the same, on the re-filter path.
//
// ★★★ WHAT MAKES A ROW UNUSABLE, AND WHAT HAPPENS ON A MISS. A row is unusable when EITHER:
//     (1) it does not exist for (tenant_id, host_id, service_id, day) — nothing ever cached this
//         combination, or a trigger deleted it since; or
//     (2) `now - computed_at >= CACHE_TTL_MS` (15 minutes) — `now` is the function's own injected
//         clock (defaulting to `new Date()`), the same convention `readSlots`/`generateSlots` use, so
//         a gate or a test can hold time still exactly as they already do for slot generation.
//     Either way, a miss falls straight through to the real, uncached `readSlots` — the identical
//     computation a first-ever read would perform — and the fresh answer is written back with
//     `INSERT … ON CONFLICT … DO UPDATE`, so the NEXT read (real or synthetic `now`, same TTL window)
//     can be served from the row this call just wrote. A miss is never an error and never an empty
//     answer manufactured by this module — it is `readSlots`'s own honest answer, cached afterwards.
//
// ★★★ A STALE HIT IS WORSE THAN A MISS — SO A FRESH HIT IS STILL RE-FILTERED, NOT RETURNED VERBATIM.
//     Two things can make a cached slot wrong even though the ROW is still fresh by the TTL:
//       (a) time has passed since it was computed, and a slot that had notice to spare then may now
//           be inside the practice's minimum-notice window — so every cache HIT re-reads the current
//           `policyFor(...).minimum_notice_minutes` and drops any cached slot whose `startsAt` no
//           longer clears `now + minimumNoticeMinutes`, exactly the cutoff `generateSlots` itself
//           applies (`slots.mjs:170,185`);
//       (b) anything that could change WHICH slots are free changes the ROW ITSELF, via the DB
//           triggers above — the covering row is simply gone, which is case (1) above, a miss.
//     Re-filtering on read is cheap (no query — it is a JS array filter over the cached rows) and is
//     the only correction a fresh row ever needs.
//
// ★★ WHO WRITES, WHO INVALIDATES. Both are the APPLICATION, never a test fixture. This module's own
//    `INSERT … ON CONFLICT` is reached from real routes: `GET /api/engagements/slots`
//    (`src/routes/index.mjs`), `GET /api/app/booking` (`src/routes/app.mjs`), the public booking pages
//    (`src/booking/publicBooking.mjs`, 13.20), and the calendar read (`src/booking/calendarRead.mjs`,
//    13.23) — none of them exist only in a test. Invalidation is the eight DB triggers in 0400/0401,
//    which fire on ANY insert/update/delete to their six/two tables respectively, through whichever
//    real write route touches them (`createBooking`, the availability-rule/date-override writers,
//    `policyFor`'s own settings writers, the service editor, Stage 12's shift/time-off writers) — not
//    a code path only a test can reach. A test may of course also trigger these (as `test/
//    s13_19_availability_cache.test.mjs` does, on purpose, to prove the wiring), but the trigger does
//    not know or care who wrote the row it is reacting to.

import { readSlots } from "./read.mjs";
import { policyFor } from "./writes.mjs";
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";

export const CACHE_TTL_MS = 15 * 60_000;

// ── row <-> slot shape ───────────────────────────────────────────────────────────────────────────
// `keystone.availability_cache.slots` is `jsonb`, so `startsAt`/`endsAt` round-trip as ISO strings;
// `readSlots`'s own return shape (`read.mjs:56-191`, and `generateSlots`'s doc, `slots.mjs:114`) is
// `{startsAt: Date, endsAt: Date, localTime: string}` — no `label` field exists in the real code
// (§13.19's own text says "…and label", but 13.18 landed with `localTime`; this module returns
// EXACTLY what `readSlots` returns, on both the miss and the hit path, so a caller cannot tell which
// one answered).
function toRow(slot) {
  return { startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), localTime: slot.localTime };
}
function fromRow(row) {
  return { startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt), localTime: row.localTime };
}

/**
 * Cached wrapper over `readSlots` (read.mjs). Same call shape and same return shape; a caller cannot
 * tell whether the answer came from the cache or was just computed.
 *
 * @param db        a tenant-scoped connection (RLS supplies the tenant; see the header above)
 * @param tenantId  accepted for CT-F28's signature; NOT used to scope the query — see the header
 * @param hostId    required, same as `readSlots`
 * @param date      'YYYY-MM-DD'
 * @param serviceId REQUIRED to use the cache at all — `null`/omitted always falls straight through
 *                  to the plain, uncached `readSlots` (the cache's primary key needs a real service)
 * @param now       injected so callers and gates can be deterministic, same convention as `readSlots`
 */
export async function readSlotsCached(db, { tenantId, hostId, date, serviceId = null, now = new Date() }) {
  void tenantId; // see header: RLS scopes the query, not this argument
  if (serviceId == null) {
    return readSlots(db, { hostId, date, serviceId, now });
  }

  const { rows } = await db.query(
    `SELECT slots, computed_at FROM keystone.availability_cache
      WHERE tenant_id = keystone.current_tenant_id() AND host_id = $1 AND service_id = $2 AND day = $3::date`,
    [hostId, serviceId, date]);
  const cached = rows[0];
  const fresh = cached && (now.getTime() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS);

  if (!fresh) {
    const result = await readSlots(db, { hostId, date, serviceId, now });
    await db.query(
      `INSERT INTO keystone.availability_cache (tenant_id, host_id, service_id, day, slots, computed_at)
            VALUES (keystone.current_tenant_id(), $1, $2, $3::date, $4::jsonb, now())
       ON CONFLICT (tenant_id, host_id, service_id, day)
       DO UPDATE SET slots = EXCLUDED.slots, computed_at = now()`,
      [hostId, serviceId, date, JSON.stringify(result.slots.map(toRow))]);
    return result;
  }

  // Fresh hit — re-filter for notice (see header ★★★ "A STALE HIT..."), no re-computation.
  const { rows: tz } = await run(db, kdb.selectFrom("keystone.tenant").select(["timezone"]).limit(1));
  const timeZone = tz[0]?.timezone ?? "UTC";
  // ★★ Resolved from the DATABASE, not the caller's `tenantId` argument — see the header note above
  //    `policyFor`'s own `WHERE tenant_id = $1` (writes.mjs:551-553), same as `readSlots` itself does.
  const { rows: tenantRow } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
  const p = await policyFor(db, tenantRow[0]?.t ?? null, serviceId);
  const noticeCutoff = new Date(now.getTime() + (p.minimum_notice_minutes ?? 0) * 60_000);
  const slots = cached.slots.map(fromRow).filter((s) => s.startsAt >= noticeCutoff);

  return {
    date, timeZone, hostId, slots,
    zone_detail: `Slots are local wall-clock times in ${timeZone}, the practice's own zone.`,
  };
}

/**
 * Cached wrapper over `readSlotsForAnyHost` (read.mjs) — same per-host-then-union composition
 * (`read.mjs:210-244`), except each host's own answer comes from `readSlotsCached` above.
 */
export async function readSlotsForAnyHostCached(db, { date, serviceId = null, now = new Date() }) {
  const { rows: hosts } = await db.query(
    `SELECT DISTINCT host_id FROM keystone.availability_rule WHERE effective_to IS NULL`);

  const perHost = [];
  for (const h of hosts) {
    const r = await readSlotsCached(db, { hostId: h.host_id, date, serviceId, now });
    perHost.push({ hostId: h.host_id, slots: r.slots });
  }

  const seen = new Map();
  for (const { slots } of perHost) {
    for (const s of slots) {
      const k = s.startsAt instanceof Date ? s.startsAt.toISOString() : String(s.startsAt);
      if (!seen.has(k)) seen.set(k, s);
    }
  }
  const slots = [...seen.values()].sort((a, b) => a.startsAt - b.startsAt);

  const { rows: tz } = await run(db, kdb.selectFrom("keystone.tenant").select(["timezone"]).limit(1));
  const timeZone = tz[0]?.timezone ?? "UTC";
  return {
    date, timeZone, slots, hosts: perHost,
    zone_detail: `Slots are local wall-clock times in ${timeZone}, the practice's own zone.`,
  };
}
