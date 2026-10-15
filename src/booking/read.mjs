// @ts-check
import { generateSlots, explainStart, zonedLocalToUtc } from "./slots.mjs";
import { expandBlock, addDaysISO } from "./blocks.mjs";
import { policyFor } from "./writes.mjs";
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P5.9 — ONE SLOT READ, SHARED. "WHEN IS THIS HOST FREE" HAS EXACTLY ONE ANSWER.
//
// ★★★ THE WRITE EXISTED AND THE READ DID NOT. [MEASURED] `generateSlots()` had ONE caller —
//     `GET /api/app/booking`, which calls `assertClientRole()` and therefore REFUSES EVERY STAFF
//     SESSION. **A coach could create a booking and could not ask the server when anyone was free.**
//
// ★★★ AND THAT ONE CALLER WAS STILL WRONG IN TWO WAYS, BOTH PROVEN BY EXECUTION 2026-09-15. Its
//     column names were fixed after a deployed 500, but the two defects below are SILENT — they do
//     not raise, they just quietly stop excluding things:
//
//   1 · **`busy` WAS PASSED IN snake_case AND `generateSlots` READS camelCase.**
//       `slots.mjs:152` is `busy.some((b) => occStart < b.endsAt && b.startsAt < occEnd)`, and the
//       route selected `starts_at, ends_at` and passed the rows straight through. `b.endsAt` is
//       `undefined`, `x < undefined` is **false**, so **NO booking ever blocked a slot.**
//       [EXECUTED] snake_case busy → slots "09:00, 10:00"; camelCase busy → "10:00".
//
//   2 · **`state IN ('confirmed','pending')` — THERE IS NO `'pending'` STATE.** The CHECK
//       constraint allows `pending_payment · confirmed · cancelled · completed · no_show`. So a
//       booking awaiting payment was not counted as busy even after (1) was fixed.
//
//   ★★ EITHER ONE ALONE OFFERS A SLOT THAT IS ALREADY TAKEN. The database's EXCLUDE constraint
//      would refuse the second write — so the visible failure is not a double booking but a person
//      picking a time, being refused, and having no idea why.
//
// ★★★ AND IT IS PER-HOST. `generateSlots` is host-agnostic by design: it answers for ONE person,
//     from that person's rules and that person's bookings. The old caller passed EVERY rule and
//     EVERY booking in the tenant, so one coach`s day off closed the practice and one coach`s
//     booking blocked all of them. The host is now a required argument.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The states that OCCUPY time. Named here once, from the CHECK constraint, so the next reader
 *  does not have to guess. `cancelled` frees the slot; `completed` and `no_show` are in the past
 *  and still occupied it.
 *  ★★★ 13.18 — `pending_consent` ADDED. [MEASURED] the CHECK constraint (0309) allows six states,
 *  and this list had only four — a held adolescent booking awaiting guardian consent is genuinely
 *  occupying the host's calendar (the EXCLUDE constraint already refuses the double-write; without
 *  this the product still OFFERED the slot as free and then failed the booking at the end, with no
 *  explanation to the person who picked it). */
export const BUSY_STATES = Object.freeze(
  ["pending_payment", "pending_consent", "confirmed", "completed", "no_show"]);

/**
 * Read one host's bookable slots for one LOCAL calendar day.
 *
 * @param db        a tenant-scoped connection (RLS supplies the tenant; no tenantId is passed)
 * @param hostId    the person whose calendar this is — REQUIRED
 * @param date      'YYYY-MM-DD', a local calendar day
 * @param serviceId optional: picks that service's booking policy
 * @param now       injected so callers and gates can be deterministic
 */
export async function readSlots(db, { hostId, date, serviceId = null, now = new Date() }) {
  const input = await gatherDayInput(db, { hostId, date, serviceId, now });
  const slots = generateSlots(input);
  const timeZone = input.timeZone;
  return {
    date, timeZone, hostId, slots,
    // ★ The zone is RETURNED, not assumed. A client rendering "10:00" without knowing whose 10:00
    //   it is will eventually render somebody else's.
    zone_detail: `Slots are local wall-clock times in ${timeZone}, the practice's own zone.`,
  };
}

/**
 * ★★★ STAGE 20 — "WHY ISN'T 2PM SHOWING?" One host, one LOCAL date, one LOCAL time (HH:MM), one
 *     optional service. Built on `gatherDayInput` + `explainStart` — the SAME inputs and the SAME
 *     rules `readSlots` uses, so the explanation cannot disagree with what is offered.
 */
export async function explainSlot(db, { hostId, date, time, serviceId = null, now = new Date() }) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ""));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`explainSlot requires an HH:MM time, got ${JSON.stringify(time)}`);
  }
  const minute = Number(m[1]) * 60 + Number(m[2]);
  const input = await gatherDayInput(db, { hostId, date, serviceId, now });
  const verdict = explainStart(input, minute);
  // The next offered start after the asked-for one — the answer's natural follow-up.
  const next = generateSlots(input).find((s) => {
    const [h, mm] = s.localTime.split(":").map(Number);
    return h * 60 + mm > minute;
  });
  return {
    date, time, hostId, serviceId, timeZone: input.timeZone, ...verdict,
    nextOffered: next ? next.localTime : null,
    limits: {
      durationMinutes: input.policy.durationMinutes,
      startIntervalMinutes: input.policy.startIntervalMinutes,
      minimumNoticeMinutes: input.policy.minimumNoticeMinutes,
      maxPerDay: input.policy.maxPerDay,
      bookedCount: input.policy.bookedCount,
    },
  };
}

/** ★ Every input `generateSlots`/`explainStart` need for one host's LOCAL day, read once. */
async function gatherDayInput(db, { hostId, date, serviceId = null, now = new Date() }) {
  // ★★ A MISSING HOST IS A THROW, NOT AN EMPTY LIST. "Nobody is free" and "you did not say whose
  //    calendar" are different answers, and returning [] for the second is how a booking screen
  //    silently shows no availability forever.
  if (!hostId) throw new Error("readSlots requires a hostId — slots are always for one person");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) {
    throw new Error(`readSlots requires a YYYY-MM-DD date, got ${JSON.stringify(date)}`);
  }

  const { rows: tz } = await run(db, kdb.selectFrom("keystone.tenant").select("timezone").limit(1));
  const timeZone = tz[0]?.timezone ?? "UTC";

  const { rows: rules } = await run(db, kdb.selectFrom("keystone.availability_rule").select(["day_of_week", "start_minute", "end_minute", "effective_from", "effective_to"]).where("host_id", "=", hostId).where("effective_to", "is", null));

  const { rows: overrides } = await db.query(
    `SELECT on_date, is_available, start_minute, end_minute, reason
       FROM keystone.date_override
      WHERE host_id = $1 AND on_date = $2::date`, [hostId, date]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE TWO FIXES ARE BOTH IN THIS ONE QUERY.
  //   · `state = ANY($3)` from BUSY_STATES — `'pending'` was never a state and matched nothing.
  //   · `AS "startsAt"` / `AS "endsAt"` — quoted, because unquoted identifiers fold to lower case
  //     in Postgres and `startsat` would leave `generateSlots` reading `undefined` all over again.
  //     ★ The alias is the fix; mapping in JS afterwards would work too, and would be one more
  //       place for the next person to forget.
  // ★★ A DAY IS READ AS A RANGE OVER `starts_at`, not `starts_at::date = $2`: a booking that begins
  //    at 23:30 the night before still occupies this morning, and casting the column also throws
  //    away any index on it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: bookingBusy } = await db.query(
    `SELECT id, 'booking' AS kind, starts_at AS "startsAt", ends_at AS "endsAt"
       FROM keystone.booking
      WHERE host_id = $1
        AND state = ANY($3)
        AND ends_at   > ($2::date - interval '1 day')
        AND starts_at < ($2::date + interval '2 days')`,
    [hostId, date, BUSY_STATES]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 13.18 — BLOCKS. `expandBlock` (13.17, src/booking/blocks.mjs) is the ONLY place a block ever
  //     keeps a slot from being offered — 13.17's own header: "this function's correctness is the
  //     whole refusal." Nothing in the schema stops a booking being written into a blocked time (no
  //     FK, no exclusion constraint, no trigger); a block that still shows as a free slot here is
  //     worse than no block at all, because the calendar looks protected and is not.
  //   · SQL bound is COARSE (±1 day for a one-off block, `repeat_until` in the future or NULL for a
  //     repeating one) — the same ± bound as the booking query above. `expandBlock` does the exact,
  //     zoned expansion; this query only needs to not miss a row.
  //   · Each row is expanded over [date-1, date+1] in the PRACTICE's own zone, so an occurrence whose
  //     local time crosses midnight (or whose real UTC instant moves under a DST transition) is still
  //     caught, exactly as 13.17 proved for `expandBlock` alone.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: blockRows } = await db.query(
    `SELECT starts_at, ends_at, repeat, repeat_until, skipped_dates
       FROM keystone.booking_block
      WHERE host_id = $1
        AND (
          (repeat = 'none' AND ends_at > ($2::date - interval '1 day')
                            AND starts_at < ($2::date + interval '2 days'))
          OR (repeat <> 'none' AND (repeat_until IS NULL OR repeat_until >= ($2::date - interval '1 day')))
        )`,
    [hostId, date]);

  const blockFromDate = addDaysISO(date, -1);
  const blockToDate = addDaysISO(date, 1);
  const busy = [...bookingBusy];
  for (const block of blockRows) {
    for (const occ of expandBlock(block, blockFromDate, blockToDate, timeZone)) {
      busy.push({ ...occ, kind: "block" });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ TIME OFF — Stage 12's `keystone.time_off` (0382), day-granular (`starts_on`/`ends_on`), never
  //    an instant. Fetched as the covering row(s) for this LOCAL date and handed to `generateSlots`
  //    itself (not folded into `busy`): `generateSlots` already empties the WHOLE day for a covering
  //    time_off row, beating both shifts and rules — composing it twice would be a second place this
  //    could drift from what the generator actually does.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: timeOff } = await db.query(
    `SELECT starts_on, ends_on
       FROM keystone.time_off
      WHERE app_user_id = $1
        AND starts_on <= $2::date AND ends_on >= $2::date`,
    [hostId, date]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ SHIFTS — Stage 12's `keystone.staff_shift` (0382). `generateSlots` NARROWS, NEVER WIDENS, on
  //    a non-null `shifts` array: a person with ANY shift row at all (any date, ever) is
  //    shift-tracked, so a day with no shift row for THEM offers nothing, even though the weekly
  //    rule alone would have offered something. A person with NO shift rows at all is the solo
  //    host — the rule governs alone (`shifts: null`). The two queries below answer exactly those
  //    two questions, in that order: "is this host shift-tracked at all" (unbounded by date,
  //    deliberately — one shift row on any day is enough), then "what does today's shift say".
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: shiftCount } = await db.query(
    `SELECT count(*)::int AS n FROM keystone.staff_shift WHERE app_user_id = $1`, [hostId]);
  let shifts = null;
  if (shiftCount[0].n > 0) {
    const { rows: shiftRows } = await db.query(
      `SELECT on_date, start_minute, end_minute
         FROM keystone.staff_shift
        WHERE app_user_id = $1 AND on_date = $2::date`,
      [hostId, date]);
    shifts = shiftRows;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE POLICY COMES FROM `policyFor` (13.8, src/booking/writes.mjs), NOT A SECOND READ OF
  //     SETTINGS. `policyFor` sums the service's own buffer with the practice-wide gap and resolves
  //     the window/notice defaults — reading tenant_setting again here would be a second source of
  //     truth for the same numbers, free to drift from what the write-side routes actually enforce.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: tenantRow } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
  const tenantId = tenantRow[0]?.t ?? null;
  const p = await policyFor(db, tenantId, serviceId);

  // ★★ STAGE 20 (0498) — the three inputs `readSlots` never passed: the service's own DURATION
  //    (before this every service was offered as 60-minute slots — `generateSlots`' default), the
  //    START-TIME INTERVAL, and the DAILY CAP with this host's occupying count for the LOCAL day.
  let durationMinutes = 60;
  if (serviceId) {
    const { rows: svc } = await run(db, kdb.selectFrom("keystone.service").select("duration_minutes").where("id", "=", serviceId));
    if (svc[0]?.duration_minutes) durationMinutes = svc[0].duration_minutes;
  }
  const { rows: limitRows } = await run(db, kdb.selectFrom("keystone.host_booking_limit").select("max_per_day").where("host_id", "=", hostId));
  const maxPerDay = limitRows[0]?.max_per_day ?? null;
  let bookedCount = 0;
  if (maxPerDay != null) {
    // ★ The LOCAL day's real bounds, measured in the practice zone — 23 or 25 hours on a DST day.
    const [y, mo, d] = date.split("-").map(Number);
    const dayStart = zonedLocalToUtc(y, mo, d, 0, timeZone);
    const nx = new Date(Date.UTC(y, mo - 1, d + 1));
    const dayEnd = zonedLocalToUtc(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate(), 0, timeZone);
    const { rows: cnt } = await db.query(
      `SELECT count(*)::int AS n FROM keystone.booking
        WHERE host_id = $1 AND state = ANY($2) AND starts_at >= $3 AND starts_at < $4`,
      [hostId, BUSY_STATES, dayStart, dayEnd]);
    bookedCount = cnt[0].n;
  }

  return {
    date, timeZone, rules, overrides, busy, now, shifts, timeOff,
    policy: {
      durationMinutes,
      startIntervalMinutes: p.start_interval_minutes ?? 30,
      bufferBeforeMinutes: p.buffer_before_minutes ?? 0,
      bufferAfterMinutes: p.buffer_after_minutes ?? 0,
      minimumNoticeMinutes: p.minimum_notice_minutes ?? 0,
      maxPerDay, bookedCount,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P5.9 — "WHEN IS **ANYONE** FREE" — THE CLIENT'S QUESTION, ANSWERED HONESTLY.
//
// ★★★ THIS IS NOT THE SAME QUESTION AS `readSlots`, AND CONFLATING THEM IS WHAT WAS BROKEN.
//     The old client route merged every host's RULES, every host's OVERRIDES and every host's
//     BOOKINGS into one call — so one coach`s booking blocked all of them and one coach`s day off
//     closed the practice. That is not a union of answers; it is a union of INPUTS, which answers
//     nobody's question.
//
// ★★ THE CORRECT SHAPE IS: compute each host's availability SEPARATELY — correctly, with their own
//    rules and their own bookings — and then UNION the resulting times. A client who has not picked
//    a coach genuinely wants "any time somebody can see me", and that is what this returns.
//
// ★ A CLIENT ROUTE CAN ASK IT; THE STAFF ROUTE CANNOT. `readSlots` still REQUIRES a host, because a
//   coach opening the booking dialog is asking about one person's diary and a merged answer there
//   would let them book a colleague's time.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export async function readSlotsForAnyHost(db, { date, serviceId = null, now = new Date() }) {
  // ★ Only hosts who have a CURRENT availability rule. Somebody with no rules has no bookable day,
  //   and including them would mean one query per staff member for a guaranteed empty result.
  const { rows: hosts } = await run(db, kdb.selectFrom("keystone.availability_rule").select("host_id").distinct().where("effective_to", "is", null));

  const perHost = [];
  for (const h of hosts) {
    // ★★ ONE CALL PER HOST, THROUGH THE SAME FUNCTION THE STAFF ROUTE USES. The per-host answer is
    //    never recomputed here, so a fix to `readSlots` reaches both questions.
    const r = await readSlots(db, { hostId: h.host_id, date, serviceId, now });
    perHost.push({ hostId: h.host_id, slots: r.slots });
  }

  // ★★★ UNION BY INSTANT, DEDUPED AND SORTED. Two coaches free at 10:00 is ONE offerable 10:00 —
  //     showing it twice would suggest the practice has two different ten o'clocks.
  const seen = new Map();
  for (const { slots } of perHost) {
    for (const s of slots) {
      const k = s.startsAt instanceof Date ? s.startsAt.toISOString() : String(s.startsAt);
      if (!seen.has(k)) seen.set(k, s);
    }
  }
  const slots = [...seen.values()].sort((a, b) => a.startsAt - b.startsAt);

  const { rows: tz } = await run(db, kdb.selectFrom("keystone.tenant").select("timezone").limit(1));
  const timeZone = tz[0]?.timezone ?? "UTC";
  return {
    date, timeZone, slots,
    // ★ WHICH host each time belongs to is returned alongside, so a screen that later asks the
    //   person to choose a coach does not have to ask the server a second time.
    hosts: perHost,
    zone_detail: `Slots are local wall-clock times in ${timeZone}, the practice's own zone.`,
  };
}
