// src/prompts/catalogue.mjs — Stage 11 task 11.3: the prompt catalogue and its shape (CT-F53). This
// is ONE Stage-11-owned file that six stages append entries to over time — 11.3 (the three launch
// kinds: `invoice_late`, `consent_unsigned_today`, `clients_drifting`), then 12.18, 13.26, 16.28,
// 17.18. `surfaces`/`roles`/the second `params` argument are declared here so 11.22 (CT-F01's surface
// enum) never has to open this file again to add them.
//
// ★★★ THE PERMISSION BOUNDARY (CT-F01 CC-2): a query with `money: true` or a non-null `roles` is
//     NEVER RUN for a viewer it excludes — 11.4/11.22 enforce that by not calling this file's SQL at
//     all for such a viewer, not by stripping the composed result afterwards. Nothing here computes
//     that boundary; it only DECLARES it (`money`, `roles`) so the caller can.
// ★★ A PROMPT WITHOUT AN EVIDENCE SENTENCE IS NOT A PROMPT (F01 §2, CT-F53 rule 1). `composeKind`
//    throws rather than returning a candidate whose `why` is empty — a fixture missing a fact the
//    real query guarantees (e.g. `invoice.due_at`, NOT NULL by the query's own WHERE clause) is
//    exactly the case this guard exists to catch, not paper over with a blank or a literal
//    "undefined".
// ★ No backtick may appear inside any SQL comment below (F438/F463) — so none of the `sql` strings
//   carry SQL `--` comments at all; the prose lives here, in the JS comments, instead.

import { scoped } from "../records/lists/_shared.mjs";
import { unsignedInstancesForSubjects } from "../documents/api.mjs";
import { formatMinor, formatDayMonth, numberWord } from "../money/format.mjs";
import { regularAnySql, REGULAR_MIN_ATTENDED, REGULAR_WINDOW_DAYS, DRIFT_DAYS } from "../people/regulars.mjs";
// ★ Stage 12's `person_archived_checkin` needs the viewer-scope predicate WITHOUT `scoped()`'s
//   automatic archived-row exclusion (see that entry's own comment, below) — rebuilt from the same
//   two primitives `scoped()` itself is built from.
import { ownerExpr, permissionObjectFor } from "../permissions/ownership.mjs";
import { createHash } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** The closed set of `?filter=` values `GET /api/prompts` accepts. Frozen — CT-F53. */
export const PROMPT_FILTERS = Object.freeze(["everything", "money", "people", "documents", "found"]);

const weekdayOf = (date, timeZone = "UTC") => format(new TZDate(new Date(date).getTime(), timeZone), "EEEE");

const timeOfDayInTz = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(date));
  const hour = parts.find((p) => p.type === "hour").value;
  const minute = parts.find((p) => p.type === "minute").value;
  const dayPeriod = parts.find((p) => p.type === "dayPeriod").value.toLowerCase();
  return `${hour}:${minute}${dayPeriod}`;
};

const firstWord = (name) => String(name ?? "").split(" ")[0];

const joinNames = (names) => {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// invoice_late — the money kind. Query = HOME_NEEDS_YOU_SQL's own overdue predicate
// (src/records/lists.mjs:258-262, M), widened with the facts the sentence needs.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — status/amount/currency come from `invoice_effective` (Stripe
//   says whether it is open and for how much); `has_card` from `person_card_effective` (the mirrored
//   cards). `keystone.invoice i` is joined only for the platform's own columns (due_at, sent_at, the owner
//   chain `scoped()` reads) — an invoice with no `due_at` can never be "late" here, so Stripe-only
//   invoices (no the platform row, no due date in the view) cannot qualify either way.
const invoiceLateSql = `SELECT ie.id, ie.amount_minor, ie.currency, i.due_at, i.sent_at, u.display_name AS payer_name,
       floor(extract(epoch FROM now() - i.due_at) / 86400)::int AS days_late,
       EXISTS(SELECT 1 FROM keystone.person_card_effective pc WHERE pc.app_user_id = ie.payer_user_id) AS has_card,
       (SELECT min(b.starts_at) FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.booking_id = b.id
         WHERE bp.app_user_id = ie.payer_user_id AND b.state <> 'cancelled' AND b.starts_at > now()) AS next_booking_at
  FROM keystone.invoice_effective ie
  JOIN keystone.invoice i ON i.id = ie.id
  JOIN keystone.app_user u ON u.id = ie.payer_user_id
 WHERE ie.status = 'open' AND i.due_at IS NOT NULL AND i.due_at < now() AND ${scoped("invoice", "i")}
 ORDER BY ie.amount_minor::bigint * greatest(1, floor(extract(epoch FROM now() - i.due_at) / 86400))::bigint DESC
 LIMIT 50`;

function composeInvoiceLate(rows) {
  return rows.map((row) => {
    const facts = [];
    if (row.sent_at) facts.push(`sent ${formatDayMonth(row.sent_at)}`);
    if (!row.has_card) facts.push("no card on file");

    let why = "";
    if (facts.length > 0) {
      why = `${facts.join(", ")}.`;
      if (row.next_booking_at) why += ` Booked in on ${weekdayOf(row.next_booking_at)}.`;
    } else if (row.due_at) {
      why = `due ${formatDayMonth(row.due_at)}.`;
    }

    const n = row.days_late;
    const headline = `${row.payer_name} is ${n} ${n === 1 ? "day" : "days"} late on ${formatMinor(row.amount_minor, row.currency)}`;
    const dueIso = row.due_at instanceof Date ? row.due_at.toISOString() : new Date(row.due_at).toISOString();
    return {
      headline, why,
      action: { label: "Chase it", href: `/record/invoice/${row.id}` },
      subjectId: row.id,
      fingerprint: `${row.id}:${row.amount_minor}:${dueIso}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// consent_unsigned_today — the documents kind. Per S11-OQ-3(b) as RULED: `d.state <> 'executed'`,
// and "linked to a booking" through the subject person, the only link the schema has.
// ★★★ DOCUSTAY WALL FIX (29 Sep 2026) — this used to be ONE SQL string joining
//   document_instance directly against booking_participant/booking/tenant, run raw by
//   prompts/engine.mjs. Documents may never be reached by a query built outside src/documents/
//   (db/gates/documents_wall.mjs) — so this became `fetch`, the one entry (of ~20) that isn't a
//   plain sql string: prompts/engine.mjs's `rowsForEntry` calls it directly instead of
//   db.query(entry.sql, entry.params(...)) when it's present (see that file's own header). It runs
//   the booking-side query itself (booking/tenant/app_user are not walled), then asks
//   documents/api.mjs's `unsignedInstancesForSubjects` for the document side, and joins the two in
//   JS. Same final row shape `composeConsentUnsignedToday` already expects (id, title, state,
//   sent_at, display_name, timezone, session_at), same cardinality (one row per unsigned document
//   per subject with a session today, not deduplicated per subject) and the same LIMIT 50.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function fetchConsentUnsignedToday(db, { viewerId }) {
  const { rows: subjectsToday } = await db.query(
    `SELECT bp.app_user_id AS subject_user_id, u.display_name, t.timezone, min(b.starts_at) AS session_at
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.id = bp.booking_id AND b.state <> 'cancelled'
       JOIN keystone.app_user u ON u.id = bp.app_user_id
       JOIN keystone.tenant t ON t.id = b.tenant_id
      WHERE (b.starts_at AT TIME ZONE t.timezone)::date = (now() AT TIME ZONE t.timezone)::date
        AND b.starts_at > now()
      GROUP BY bp.app_user_id, u.display_name, t.timezone
      ORDER BY session_at`);
  if (subjectsToday.length === 0) return [];

  const unsigned = await unsignedInstancesForSubjects(db, {
    viewerId, subjectUserIds: subjectsToday.map((s) => s.subject_user_id),
  });
  const bySubject = new Map();
  for (const s of subjectsToday) bySubject.set(s.subject_user_id, s);

  const rows = [];
  for (const doc of unsigned) {
    const subject = bySubject.get(doc.subject_user_id);
    if (!subject) continue;
    rows.push({
      id: doc.id, title: doc.title, state: doc.state, sent_at: doc.sent_at,
      display_name: subject.display_name, timezone: subject.timezone, session_at: subject.session_at,
    });
  }
  rows.sort((a, b) => new Date(a.session_at) - new Date(b.session_at));
  return rows.slice(0, 50);
}

function composeConsentUnsignedToday(rows) {
  return rows.map((row) => {
    const timeStr = timeOfDayInTz(row.session_at, row.timezone);
    const why = row.sent_at
      ? `their session is at ${timeStr} today and it went out on ${weekdayOf(row.sent_at, row.timezone)}.`
      : `their session is at ${timeStr} today and it has not gone out yet.`;
    const sessionIso = row.session_at instanceof Date ? row.session_at.toISOString() : new Date(row.session_at).toISOString();
    return {
      headline: `${row.display_name}'s ${row.title} is still unsigned`,
      why,
      action: { label: "Resend it", href: `/record/document/${row.id}` },
      subjectId: row.id,
      fingerprint: `${row.id}:${row.state}:${sessionIso}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// clients_drifting — the people kind. Per S11-OQ-3(a) as RULED: a REGULAR who has drifted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const clientsDriftingSql = `WITH mine AS (
    SELECT bp.app_user_id, b.starts_at, b.state
      FROM keystone.booking b
      JOIN keystone.booking_participant bp ON bp.booking_id = b.id
     WHERE bp.app_user_id IS NOT NULL
  ), last AS (
    SELECT app_user_id, max(starts_at) AS last_at
      FROM mine
     WHERE state <> 'cancelled'
     GROUP BY app_user_id
  )
  SELECT u.id, u.display_name, l.last_at,
         (SELECT count(*) FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.booking_id = b.id
           WHERE bp.app_user_id = u.id AND bp.attended IS TRUE
             AND b.starts_at > now() - make_interval(days => $2::int) AND b.starts_at <= now()) AS attended_count
    FROM keystone.app_user u
    JOIN last l ON l.app_user_id = u.id
   WHERE u.role IN ('adult_client', 'adolescent_client')
     AND l.last_at < now() - make_interval(days => $3::int)
     AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp JOIN keystone.booking b ON b.id = bp.booking_id
                       WHERE bp.app_user_id = u.id AND b.starts_at > now())
     AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp JOIN keystone.booking b ON b.id = bp.booking_id
                       WHERE bp.app_user_id = u.id AND b.state = 'cancelled' AND b.starts_at > l.last_at)
     AND ${regularAnySql("u", "$2", "$4")}
     AND ${scoped("person", "u")}
   ORDER BY l.last_at
   LIMIT 50`;

function composeClientsDrifting(rows, viewer) {
  if (rows.length === 0) return [];

  if (viewer.canSeeMoney) {
    const n = rows.length;
    const nWordCapitalised = numberWord(n).replace(/^./, (c) => c.toUpperCase());
    const headline = `${nWordCapitalised} ${n === 1 ? "client" : "clients"} haven't rebooked in ${numberWord(Math.round(DRIFT_DAYS / 7))} weeks`;
    const names = rows.map((r) => r.display_name);
    let why;
    if (names.length === 1) {
      why = `${names[0]} came regularly, then stopped without cancelling.`;
    } else if (names.length <= 3) {
      why = `${joinNames(names)} all came regularly, then stopped. None of them cancelled.`;
    } else {
      const rest = names.length - 3;
      why = `${names[0]}, ${names[1]}, ${names[2]} and ${rest} others all came regularly, then stopped. None of them cancelled.`;
    }
    const ids = rows.map((r) => r.id).slice().sort();
    return [{
      headline, why,
      action: { label: "See who", href: "/people/clients" },
      subjectId: null,
      fingerprint: createHash("sha1").update(ids.join(",")).digest("hex"),
    }];
  }

  return rows.map((row) => {
    const why = `they came ${row.attended_count} times in the ${numberWord(Math.round(REGULAR_WINDOW_DAYS / 30))} months before, then stopped without cancelling.`;
    const lastIso = row.last_at instanceof Date ? row.last_at.toISOString() : new Date(row.last_at).toISOString();
    return {
      headline: `${row.display_name} hasn't booked since ${formatDayMonth(row.last_at)}`,
      why,
      action: { label: `Message ${firstWord(row.display_name)}`, href: `/record/person/${row.id}` },
      subjectId: row.id,
      fingerprint: `${row.id}:${lastIso}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Stage 12 — people, team, network (task 12.18). Four entries: two `team`/`scheduling` kinds (a
// stale staff invite, staff time off overlapping open bookings), one `network` kind (a referral
// partner that only ever sends people one way, F04 §9) and one `person` kind (an archived person
// checked in on gently rather than campaigned at).
// ★ `kind` is CT-F53's regex, `^[a-z][a-z0-9_]*$` — NO DOT. CONTRACTS.md CT-F01's surface-enum table
//   spells these with a dot for readability (`team.invite_stale` etc); the STORED kind cannot carry
//   one — `keystone.prompt_dismissal.prompt_kind`'s own CHECK (migration 0369:15) is
//   `~ '^[a-z][a-z0-9_]*$'`, so a dotted kind would fail every dismissal at the database. Underscored
//   below; the table's dotted spelling in CONTRACTS.md is prose, never the literal value.
// ★ Two of the four `why`/action strings below use "they/them" where the plan's illustrative copy
//   used "she/her" ("Dana", "her own", "Write to her") — `app_user` has no reliable per-row gender
//   to resolve a pronoun from (only a free-text `pronouns` column, 0076, not parsed anywhere in this
//   product), so a hardcoded "she/her" would misgender most rows. Reported alongside this build.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// team_invite_stale — a staff invite open ≥5 days. Scoped on the INVITER (`i.invited_by`), the same
// predicate `/people/team/invites` already uses (records/lists/people.mjs:393-399) — a Coach never
// runs this query at all (`roles: ["owner","admin"]`), so the boundary is CT-F01's, not a filtered
// response. `keystone.invite` (0202) has no display-name column for the INVITEE — confirmed at
// `src/auth/invite.mjs:30` ("no display-name column… the fallback is the email address itself", the
// same fallback `routes/signup.mjs:136` already uses) — so the email stands in for a name here too.
const teamInviteStaleSql = `SELECT i.id, i.email, i.created_at
  FROM keystone.invite i
  JOIN keystone.app_user u ON u.tenant_id = i.tenant_id AND u.id = i.invited_by
 WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
   AND i.created_at < now() - interval '5 days'
   AND ${scoped("person", "u")}
 ORDER BY i.created_at
 LIMIT 50`;

function composeTeamInviteStale(rows) {
  return rows.map((row) => {
    const createdIso = (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString();
    return {
      headline: `${row.email} hasn't accepted in five days`,
      why: "invitations expire after seven. They may not have seen it.",
      action: { label: "Open the team list", href: "/people/team" },
      subjectId: row.id,
      fingerprint: `${row.id}:${createdIso}`,
    };
  });
}

// team_away_with_bookings — time off overlapping ≥1 open (pending_payment/confirmed) booking hosted
// by that person, nobody has moved. Second surface is `scheduling`, per CT-F01's surface table.
const teamAwayWithBookingsSql = `SELECT t.id, t.app_user_id, u.display_name, t.starts_on, t.ends_on,
       count(b.id) AS n
  FROM keystone.time_off t
  JOIN keystone.app_user u ON u.tenant_id = t.tenant_id AND u.id = t.app_user_id
  JOIN keystone.tenant tt ON tt.id = t.tenant_id
  JOIN keystone.booking b ON b.host_id = t.app_user_id
                          AND b.state IN ('pending_payment', 'confirmed')
                          AND (b.starts_at AT TIME ZONE tt.timezone)::date BETWEEN t.starts_on AND t.ends_on
 WHERE t.ends_on >= current_date
   AND ${scoped("person", "u")}
 GROUP BY t.id, t.app_user_id, u.display_name, t.starts_on, t.ends_on
 ORDER BY t.starts_on
 LIMIT 50`;

function composeTeamAwayWithBookings(rows) {
  return rows.map((row) => {
    const start = row.starts_on instanceof Date ? row.starts_on : new Date(row.starts_on);
    const end = row.ends_on instanceof Date ? row.ends_on : new Date(row.ends_on);
    const n = Number(row.n);
    return {
      headline: `${row.display_name} is away ${formatDayMonth(start)}–${formatDayMonth(end)}`,
      why: `${n} ${n === 1 ? "session is" : "sessions are"} booked with them in that window and nobody has moved them.`,
      action: {
        label: `Sort the ${n}`,
        href: `/engagements/calendar?host=${row.app_user_id}&from=${start.toISOString().slice(0, 10)}`,
      },
      subjectId: row.id,
      fingerprint: `${row.id}:${start.toISOString()}:${end.toISOString()}:${n}`,
    };
  });
}

// network_referral_imbalance — a referral partner with ≥3 out and 0 in over 90 days (F04 §9).
// `network_party` is un-ownable (`ownership.mjs:76`, `ownable: false`), so its scope is
// view/everything for every staff role (`defaults.mjs:125`) — `roles: null` is correct, and
// `scoped()`'s un-ownable branch is what runs, not a role skip.
// ★ Requires a party email — without it the one action is a dead `mailto:` (F401's guard).
const networkReferralImbalanceSql = `SELECT np.id, np.name, np.email,
       (SELECT count(DISTINCT nr.referred_person_id) FROM keystone.network_referral nr
         WHERE nr.receiving_network_party_id = np.id AND nr.direction = 'out'
           AND nr.created_at > now() - interval '90 days') AS out_count
  FROM keystone.network_party np
 WHERE np.email IS NOT NULL AND btrim(np.email) <> ''
   AND (SELECT count(*) FROM keystone.network_referral nr
         WHERE nr.receiving_network_party_id = np.id AND nr.direction = 'out'
           AND nr.created_at > now() - interval '90 days') >= 3
   AND NOT EXISTS (SELECT 1 FROM keystone.network_referral nr
                     WHERE nr.receiving_network_party_id = np.id AND nr.direction = 'in'
                       AND nr.created_at > now() - interval '90 days')
   AND ${scoped("network_party", "np")}
 ORDER BY np.name
 LIMIT 50`;

function composeNetworkReferralImbalance(rows) {
  return rows.map((row) => {
    const n = Number(row.out_count);
    return {
      headline: `You've sent ${row.name} ${n} ${n === 1 ? "person" : "people"} and had none back`,
      why: "referrals usually even out over a year. Worth a conversation rather than a grudge.",
      action: { label: "Write to them", href: `mailto:${row.email}` },
      subjectId: row.id,
      fingerprint: `${row.id}:${n}`,
    };
  });
}

// person_archived_checkin — an archived person, checked in on gently rather than campaigned at.
// ★★ NOT `scoped('person', 'u')` — `scoped()` appends `AND u.archived_at IS NULL` for every
//   archivable object (records/lists/_shared.mjs:73-83, P2.9's archive filter), which is exactly
//   backwards for a prompt whose own fact IS the archived state — using it here would make this
//   query permanently empty. Rebuilt from the same two primitives `scoped()` itself composes from
//   (`ownerExpr`, `permissionObjectFor`) — the identical viewer-scope predicate, minus the
//   archived-row exclusion.
// ★ Requires the person's email, same dead-`mailto:` guard as the entry above.
const personArchivedScopeSql =
  `keystone.user_may($1, '${permissionObjectFor("person")}', 'view', ${ownerExpr("person", "u")})`;
const personArchivedCheckinSql = `SELECT u.id, u.display_name, u.email, u.archived_at, rr.reason AS archive_reason
  FROM keystone.app_user u
  LEFT JOIN keystone.record_reason rr
    ON rr.tenant_id = u.tenant_id AND rr.subject_type = 'person' AND rr.subject_id = u.id AND rr.kind = 'archive'
 WHERE u.id = $2
   AND u.archived_at IS NOT NULL
   AND u.email IS NOT NULL AND btrim(u.email) <> ''
   AND ${personArchivedScopeSql}
 LIMIT 1`;

function composePersonArchivedCheckin(rows) {
  return rows.map((row) => {
    const archivedAt = row.archived_at instanceof Date ? row.archived_at : new Date(row.archived_at);
    const weeks = Math.max(0, Math.floor((Date.now() - archivedAt.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const headline = row.archive_reason
      ? "They said they'd try on their own for a while"
      : `${row.display_name} was archived ${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
    return {
      headline,
      why: "that's not the same as leaving. A note in six months rather than a campaign now.",
      action: { label: "Write to them", href: `mailto:${row.email}` },
      subjectId: row.id,
      fingerprint: `${row.id}:${archivedAt.toISOString()}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Stage 13 — F05 · engagements (task 13.26). Four entries, one per Stage-13 surface: `calendar`,
// `waitlist`, `online_booking`, `booking_settings`. Legal only because task 11.22 widened the
// surface enum past `home|feed` (CT-F01) — landed and confirmed at `src/prompts/engine.mjs:28-31`.
// Each is computed by the engine TODAY (`GET /api/prompts?surface=<one of these four>` 200s once
// this block lands); the screen that RENDERS it — `PromptCard` mounted on Stage 13's own calendar
// (13.31), waitlist (13.34), online-booking (13.36) and booking-settings (13.39) screens — is that
// same stage's own later task, not this one. The entry is real and reachable over the API either
// way; nothing here depends on those screens existing.
// ★ they/them throughout — `app_user` carries no reliable gender column (only free-text
//   `pronouns`, never parsed anywhere in this product), same reasoning the Stage 12 block above
//   already gives.
// ★ `kind` is CT-F53's regex, `^[a-z][a-z0-9_]*$` — NO DOT (migration 0369:15's CHECK). None of the
//   four below carries one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Minutes-from-local-midnight (`availability_rule`'s own unit — already local, no zone conversion
 *  needed) → a 12-hour clock string. `990` (16:30) → `"4:30pm"`. */
function minuteOfDayToClock(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const period = hour24 < 12 ? "am" : "pm";
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, "0")}${period}`;
}

/** A DURATION in minutes (never a clock time) → "24 hours" / "90 minutes", whichever is exact. */
function minutesToDurationLabel(minutes) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

// calendar_no_gap — surface `calendar`. A day this week, for one host, with ≥6 sessions where the
// booked+buffered time fills (or exceeds) that host's own working hours for the day — "zero free
// slots" read as `occupied_minutes >= available_minutes` rather than re-running the full slot
// generator (`src/booking/slots.mjs`, a pure JS function over rules) here in SQL, which would only
// duplicate it. Scoped by `scoped('engagement','b')` — the SAME per-GRANT predicate every other
// booking list in this codebase uses (`src/records/lists/engagements.mjs:64,131`) — so a Coach
// viewer (owned scope) only ever sees THEIR OWN worst day; an Owner/Admin (everything scope) sees
// the practice's worst day, any host. Only the single worst (day, host) is surfaced — the same
// one-aggregate-candidate shape `clients_drifting`'s money-visible branch already uses, above.
const calendarNoGapSql = `WITH week AS (
    SELECT t.timezone, date_trunc('week', now() AT TIME ZONE t.timezone)::date AS week_start
      FROM keystone.tenant t WHERE t.id = keystone.current_tenant_id()
  ), days AS (
    SELECT gs::date AS day, extract(dow FROM gs)::smallint AS dow, week.timezone
      FROM week, generate_series(week.week_start, week.week_start + 6, interval '1 day') gs
  ), busy AS (
    SELECT d.day, b.host_id, u.display_name AS host_name,
           count(*) AS n,
           sum(extract(epoch FROM (b.ends_at - b.starts_at)) / 60
               + b.buffer_before_minutes + b.buffer_after_minutes)::int AS occupied_minutes,
           round(avg(b.buffer_before_minutes + b.buffer_after_minutes))::int AS buffer_minutes
      FROM days d
      JOIN keystone.booking b
        ON b.state <> 'cancelled' AND (b.starts_at AT TIME ZONE d.timezone)::date = d.day
      JOIN keystone.app_user u ON u.id = b.host_id
     WHERE ${scoped("engagement", "b")}
     GROUP BY d.day, b.host_id, u.display_name
  ), hours AS (
    SELECT d.day, ar.host_id, sum(ar.end_minute - ar.start_minute) AS available_minutes
      FROM days d
      JOIN keystone.availability_rule ar
        ON ar.day_of_week = d.dow
       AND ar.effective_from <= d.day AND (ar.effective_to IS NULL OR ar.effective_to >= d.day)
     GROUP BY d.day, ar.host_id
  )
  SELECT busy.day AS the_day, busy.host_id, busy.host_name, busy.n, busy.buffer_minutes
    FROM busy
    JOIN hours ON hours.day = busy.day AND hours.host_id = busy.host_id
   WHERE busy.n >= 6 AND busy.occupied_minutes >= hours.available_minutes
   ORDER BY (busy.occupied_minutes - hours.available_minutes) DESC, busy.day
   LIMIT 1`;

function composeCalendarNoGap(rows) {
  return rows.map((row) => {
    const n = Number(row.n);
    const b = Number(row.buffer_minutes);
    const dayIso = (row.the_day instanceof Date ? row.the_day : new Date(row.the_day)).toISOString().slice(0, 10);
    return {
      headline: `There isn't a single gap on ${weekdayOf(row.the_day, row.timezone)}`,
      why: `${n} back to back with ${b}-minute buffers. If one runs over, everything after it does too.`,
      action: { label: "Add a longer break", href: "/engagements/booking/settings/calendar" },
      subjectId: row.host_id,
      fingerprint: `${row.host_id}:${dayIso}:${n}:${b}`,
    };
  });
}

// waitlist_evenings — surface `waitlist`. ≥3 people waiting (`status='waiting'`) whose stated
// `preference` (0398) is `'evenings'`, while nothing the practice offers, any host, runs past
// 16:30 local. Both action AND the calendar entry above point at the SAME
// `/engagements/booking/settings/calendar` route — `BookingSettingsCalendar.frame.html`'s own
// "Your working hours … Edit" row is where `DialogHours` opens from; there is no second route for
// it. Scoped through the entry's own service (`scoped('item','s')`) — the waitlist queue has no
// owner of its own (0314 has no `OWNERSHIP` entry), and `item`/`service` is practice-wide
// un-ownable, the same shape `network_referral_imbalance` above already uses for the same reason —
// `$1` is still consumed (P1.7) even though nothing here is coach-owned.
const waitlistEveningsSql = `WITH waiting AS (
    SELECT w.preference
      FROM keystone.booking_waitlist_entry w
      JOIN keystone.service s ON s.id = w.service_id
     WHERE w.status = 'waiting'
       AND ${scoped("item", "s")}
  ), latest_hours AS (
    SELECT max(ar.end_minute) AS max_end_minute
      FROM keystone.availability_rule ar
     WHERE ar.effective_from <= current_date
       AND (ar.effective_to IS NULL OR ar.effective_to >= current_date)
  )
  SELECT count(*) FILTER (WHERE waiting.preference = 'evenings') AS evening_count,
         count(*) AS total_count,
         latest_hours.max_end_minute
    FROM waiting, latest_hours
   GROUP BY latest_hours.max_end_minute
  HAVING count(*) FILTER (WHERE waiting.preference = 'evenings') >= 3
     AND latest_hours.max_end_minute <= 990`;

function composeWaitlistEvenings(rows) {
  return rows.map((row) => {
    const k = Number(row.evening_count);
    const n = Number(row.total_count);
    return {
      headline: `${k} of ${n} are waiting for an evening`,
      why: `you don't offer anything after ${minuteOfDayToClock(Number(row.max_end_minute))}. Two evening slots a week would clear this list.`,
      action: { label: "Open some evenings", href: "/engagements/booking/settings/calendar" },
      subjectId: null,
      fingerprint: `${k}:${n}:${row.max_end_minute}`,
    };
  });
}

// personal_link_skew — surface `online_booking`. ≥80% of the last 90 days' PUBLIC bookings
// (`created_by IS NULL` — the exact mark `src/booking/publicBooking.mjs:353-360` writes; the
// schema has no separate "arrived via a coach's own slug page" column, so this reads the
// concentration itself, which is the underlying fact the prompt is about) went to one host.
// Scoped by `scoped('engagement','b')`, same as calendar_no_gap above.
const personalLinkSkewSql = `WITH pub AS (
    SELECT b.host_id
      FROM keystone.booking b
     WHERE b.created_by IS NULL
       AND b.state <> 'cancelled'
       AND b.created_at > now() - interval '90 days'
       AND ${scoped("engagement", "b")}
  ), by_host AS (
    SELECT host_id, count(*) AS n FROM pub GROUP BY host_id
  ), total AS (
    SELECT count(*) AS n FROM pub
  ), top AS (
    SELECT by_host.host_id, by_host.n
      FROM by_host, total
     WHERE total.n > 0 AND by_host.n::numeric / total.n::numeric >= 0.8
     ORDER BY by_host.n DESC
     LIMIT 1
  )
  SELECT top.host_id, u.display_name AS host_name, top.n AS host_count, total.n AS total_count,
         (SELECT array_agg(au.display_name ORDER BY au.display_name)
            FROM keystone.app_user au
           WHERE au.role = 'staff' AND au.accepting_new_bookings = true
             AND au.archived_at IS NULL AND au.id <> top.host_id) AS other_names
    FROM top
    JOIN keystone.app_user u ON u.id = top.host_id
    CROSS JOIN total`;

function composePersonalLinkSkew(rows) {
  return rows.map((row) => {
    const a = Number(row.host_count);
    const b = Number(row.total_count);
    const otherCount = Array.isArray(row.other_names) ? row.other_names.length : 0;
    const others = otherCount > 0 ? joinNames(row.other_names) : "everyone else";
    const verb = otherCount === 1 ? "gets" : "get";
    return {
      headline: `${a} of ${b} bookings came through ${row.host_name}'s personal link`,
      why: `it skips the choose-a-person step, so ${others} never ${verb} offered. Sharing the practice link instead would spread the work.`,
      action: { label: "Share the practice link", href: "/engagements/booking" },
      subjectId: row.host_id,
      fingerprint: `${row.host_id}:${a}:${b}`,
    };
  });
}

// service_overrides — surface `booking_settings`. ≥1 service whose OWN `booking_policy` row
// carries a `cancellation_notice_minutes` different from 1440 (24 hours) — the same hard-coded
// practice-default constant `policyFor()` itself falls back to
// (`src/booking/writes.mjs:436`, `serviceOverrides.cancellation_notice_minutes ?? 1440`), not a
// second copy of that number invented here.
const serviceOverridesSql = `SELECT bp.service_id, s.name AS service_name, bp.cancellation_notice_minutes
    FROM keystone.booking_policy bp
    JOIN keystone.service s ON s.id = bp.service_id
   WHERE bp.cancellation_notice_minutes <> 1440
     AND ${scoped("item", "s")}
   ORDER BY s.name
   LIMIT 50`;

function composeServiceOverrides(rows) {
  if (rows.length === 0) return [];
  const n = rows.length;
  const nWordCapitalised = numberWord(n).replace(/^./, (c) => c.toUpperCase());
  const names = rows.map((r) => r.service_name);
  const usual = minutesToDurationLabel(1440);
  const why = n === 1
    ? `${names[0]} asks for ${minutesToDurationLabel(Number(rows[0].cancellation_notice_minutes))}' notice instead of the usual ${usual}.`
    : `${joinNames(names)} each ask for something different than the usual ${usual} notice.`;
  const ids = rows.map((r) => r.service_id).slice().sort();
  return [{
    headline: `${nWordCapitalised} ${n === 1 ? "service overrides" : "services override"} your cancellation window`,
    why,
    action: { label: "See which", href: "/engagements/booking/rules" },
    subjectId: null,
    fingerprint: createHash("sha1").update(ids.join(",")).digest("hex"),
  }];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Stage 16 — G25 (task 16.28). Two entries: `competitor_ads_on_name` (platform: recorded
// competitor watch observation within 90 days), `analytics_snippet_missing` (platform: Google Tag
// Manager not yet configured). Neither scoped() the entries per the observations:
// `run_competitor_watch` is a new table (16.13) whose `scoped()` permission type is not yet known,
// and GTM configuration is a tenant setting (not row-level ownership); both use `current_tenant_id()`
// directly with zero params.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// usage_pace — surface `settings_usage`. Usage on pace to exceed allowance.
// Query over workbench_usage_counter for the current month; $1 is the viewer's app_user id.
// Qualifies when projected usage (used / daysElapsed × daysInPeriod) exceeds the per-metric allowance.
// Only the three charged metrics (ai_draft, text, esign) qualify; staff is not metered.
const usagePaceSql = `SELECT
  uc.metric,
  uc.count AS used,
  EXTRACT(DAY FROM now()::date)::int AS days_elapsed,
  EXTRACT(DAY FROM DATE_TRUNC('month', now() + INTERVAL '1 month') - INTERVAL '1 day')::int AS days_in_period
FROM keystone.workbench_usage_counter uc
WHERE uc.tenant_id = keystone.current_tenant_id()
  AND uc.period_start = DATE_TRUNC('month', now())::date
  AND uc.metric IN ('ai_draft', 'text', 'esign')
ORDER BY uc.metric`;

function composeUsagePace(rows) {
  const unitMap = {
    ai_draft: 'drafts',
    text: 'texts',
    esign: 'documents',
  };

  const ALLOWANCES = {
    ai_draft: 500,
    text: 400,
    esign: 100,
  };

  return rows
    .map((row) => {
      const allowance = ALLOWANCES[row.metric];
      if (!allowance) return null;

      const projected = Math.round((row.used / row.days_elapsed) * row.days_in_period);

      if (projected <= allowance) return null;

      const unit = unitMap[row.metric];
      const why = `${row.used} in ${row.days_elapsed} ${row.days_elapsed === 1 ? 'day' : 'days'}.`;

      return {
        headline: `You're on pace to use ${projected} ${unit}`,
        why,
        action: { label: "See who reads what", href: "/settings/notifications" },
        subjectId: null,
        fingerprint: `${row.metric}:${row.used}:${row.days_elapsed}:${projected}`,
      };
    })
    .filter((r) => r !== null);
}

const competitorAdsOnNameSql = `SELECT rcw.id, rcw.competitor_name, rcw.observed_at
  FROM keystone.run_competitor_watch rcw
 WHERE rcw.tenant_id = keystone.current_tenant_id()
   AND rcw.observed_at > now() - interval '90 days'
 ORDER BY rcw.observed_at DESC
 LIMIT 50`;

function composeCompetitorAdsOnName(rows) {
  return rows.map((row) => {
    const observedIso = row.observed_at instanceof Date
      ? row.observed_at.toISOString()
      : new Date(row.observed_at).toISOString();
    return {
      headline: `${row.competitor_name} runs ads on your name`,
      why: `Recorded by hand on ${formatDayMonth(row.observed_at)} — we don't scan for this automatically yet.`,
      action: { label: "Make it a task", href: "/tasks/mine" },
      subjectId: row.id,
      fingerprint: `${row.id}:${observedIso}`,
    };
  });
}

const analyticsSnippetMissingSql = `SELECT 1 AS dummy
 WHERE NOT EXISTS (
   SELECT 1 FROM keystone.tenant_setting
    WHERE tenant_id = keystone.current_tenant_id()
      AND key = 'run.gtm_container_id'
      AND value IS NOT NULL AND value NOT IN ('null'::jsonb, '""'::jsonb)
 )`;

function composeAnalyticsSnippetMissing(rows) {
  if (rows.length === 0) return [];
  return [{
    headline: "See where your traffic comes from",
    why: "Google Tag Manager shows you traffic sources and customer details when you paste the snippet.",
    action: { label: "Set up Google Tag Manager", href: "/settings/integrations" },
    subjectId: null,
    fingerprint: "analytics_snippet_missing",
  }];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOGUE — CT-F53's frozen shape. `surfaces`/`roles`/the two-argument `params` are declared
// on every entry now so 11.22 (which READS them) never has to reopen this file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const PROMPT_KINDS = Object.freeze({
  invoice_late: Object.freeze({
    kind: "invoice_late", icon: "$", tone: "bad", filter: "money",
    surfaces: ["home", "feed"], priority: 1, money: true, roles: null, upgrade: false,
    sql: invoiceLateSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  consent_unsigned_today: Object.freeze({
    kind: "consent_unsigned_today", icon: "▣", tone: "warn", filter: "documents",
    surfaces: ["home", "feed"], priority: 2, money: false, roles: null, upgrade: false,
    // ★ `fetch`, not `sql`/`params` — see fetchConsentUnsignedToday's own header.
    fetch: (db, { viewerId }) => fetchConsentUnsignedToday(db, { viewerId }),
  }),
  clients_drifting: Object.freeze({
    kind: "clients_drifting", icon: "◎", tone: "ok", filter: "people",
    surfaces: ["home", "feed"], priority: 3, money: false, roles: null, upgrade: false,
    sql: clientsDriftingSql,
    params: (viewerId, _personId) => [viewerId, REGULAR_WINDOW_DAYS, DRIFT_DAYS, REGULAR_MIN_ATTENDED],
  }),

  // ── Stage 12 — people, team, network (task 12.18) ─────────────────────────────────────────────
  team_invite_stale: Object.freeze({
    kind: "team_invite_stale", icon: "✉", tone: "warn", filter: "people",
    surfaces: ["team", "feed"], priority: 4, money: false, roles: ["owner", "admin"], upgrade: false,
    sql: teamInviteStaleSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  team_away_with_bookings: Object.freeze({
    kind: "team_away_with_bookings", icon: "⏸", tone: "warn", filter: "people",
    surfaces: ["team", "scheduling", "feed"], priority: 5, money: false, roles: ["owner", "admin"], upgrade: false,
    sql: teamAwayWithBookingsSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  network_referral_imbalance: Object.freeze({
    kind: "network_referral_imbalance", icon: "⇄", tone: "warn", filter: "people",
    surfaces: ["network", "feed"], priority: 6, money: false, roles: null, upgrade: false,
    sql: networkReferralImbalanceSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  person_archived_checkin: Object.freeze({
    kind: "person_archived_checkin", icon: "○", tone: "ok", filter: "people",
    surfaces: ["person", "feed"], priority: 7, money: false, roles: null, upgrade: false,
    sql: personArchivedCheckinSql,
    params: (viewerId, personId) => [viewerId, personId],
  }),

  // ── Stage 13 — F05 · engagements (task 13.26) ─────────────────────────────────────────────────
  calendar_no_gap: Object.freeze({
    kind: "calendar_no_gap", icon: "▦", tone: "warn", filter: "everything",
    surfaces: ["calendar"], priority: 8, money: false, roles: null, upgrade: false,
    sql: calendarNoGapSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  waitlist_evenings: Object.freeze({
    kind: "waitlist_evenings", icon: "☾", tone: "warn", filter: "everything",
    surfaces: ["waitlist"], priority: 9, money: false, roles: null, upgrade: false,
    sql: waitlistEveningsSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  personal_link_skew: Object.freeze({
    kind: "personal_link_skew", icon: "⚖", tone: "ok", filter: "everything",
    surfaces: ["online_booking"], priority: 10, money: false, roles: null, upgrade: false,
    sql: personalLinkSkewSql,
    params: (viewerId, _personId) => [viewerId],
  }),
  service_overrides: Object.freeze({
    kind: "service_overrides", icon: "≠", tone: "ok", filter: "everything",
    surfaces: ["booking_settings"], priority: 11, money: false, roles: null, upgrade: false,
    sql: serviceOverridesSql,
    params: (viewerId, _personId) => [viewerId],
  }),

  // ── Stage 16 — G25 (task 16.28) ───────────────────────────────────────────────────────────────
  competitor_ads_on_name: Object.freeze({
    kind: "competitor_ads_on_name", icon: "◉", tone: "warn", filter: "everything",
    surfaces: ["home", "feed"], priority: 12, money: false, roles: null, upgrade: false,
    sql: competitorAdsOnNameSql,
    params: () => [],
  }),
  analytics_snippet_missing: Object.freeze({
    kind: "analytics_snippet_missing", icon: "▢", tone: "warn", filter: "everything",
    surfaces: ["home", "feed"], priority: 13, money: false, roles: null, upgrade: false,
    sql: analyticsSnippetMissingSql,
    params: () => [],
  }),

  // ── Stage 17 — usage (task 17.18) ───────────────────────────────────────────────────────────────
  usage_pace: Object.freeze({
    kind: "usage_pace", icon: "⏱", tone: "warn", filter: "everything",
    surfaces: ["settings_usage"], priority: 60, money: false, roles: null, upgrade: false,
    sql: usagePaceSql,
    params: () => [],
  }),

  // ── Stage 20 — growth / lead scoring (task 20.50) ────────────────────────────────────────────
  // ★★★ HOT LEADS: people who crossed the lead score threshold in the past 7 days.
  //     A count prompt (not per-row): "N hot leads this week — Why: <summary of top reasons>".
  //     The prompt's `why` field composes from the reasons stored in app_user.score_reasons.
  //     This is a SUMMARY prompt, not a detail prompt — no action link to a person, just a
  //     dashboard headline and why-sentence, surfaced on Home to the Owner.
  lead_score_crossed: Object.freeze({
    kind: "lead_score_crossed", icon: "🔥", tone: "good", filter: "found",
    surfaces: ["home", "feed"], priority: 14, money: false, roles: ["owner"], upgrade: false,
    sql: `SELECT count(DISTINCT u.id)::text as count,
             array_agg(DISTINCT r ->> 'fact' ORDER BY r ->> 'fact')::text[] as reason_facts
        FROM keystone.app_user u,
             jsonb_array_elements(u.score_reasons) AS r
       WHERE u.tenant_id = keystone.current_tenant_id() AND u.scored_at > now() - interval '7 days'
         AND u.score_cache ->> 'score' IS NOT NULL
         AND (u.score_cache -> 'score')::numeric >= coalesce((SELECT value::numeric FROM keystone.tenant_setting
               WHERE tenant_id = keystone.current_tenant_id() AND key = 'growth.lead_score_threshold'), 30)`,
    params: () => [],
  }),
});

// ★★★ Stage 20 task 20.50 — compose the lead score prompt. A COUNT prompt: "N hot leads this week".
//     The `why` field summarizes the top reasons from score_reasons across all crossed leads.
function composeLeadScoreCrossed(rows) {
  if (!rows || rows.length === 0) return [];
  const row = rows[0];
  const count = parseInt(row.count, 10) || 0;
  if (count === 0) return [];

  // ★ Summarize the top 3 unique facts from the reasons array
  const facts = (row.reason_facts || []).slice(0, 3);
  const reasonSummary = facts.join(', ') || 'engaged with your content';

  return [{
    headline: `${count} hot ${count === 1 ? 'lead' : 'leads'} this week`,
    why: `Why: ${reasonSummary}.`,
    action: { label: "See all leads", href: "/records/people?filter=hot_leads" },
    subjectId: null, // This is a summary prompt, not per-person
    fingerprint: `lead_score_crossed:${count}:${facts.join('|')}`,
  }];
}

const COMPOSERS = {
  invoice_late: (rows) => composeInvoiceLate(rows),
  consent_unsigned_today: (rows) => composeConsentUnsignedToday(rows),
  clients_drifting: (rows, viewer) => composeClientsDrifting(rows, viewer),

  // ── Stage 12 — people, team, network (task 12.18) ─────────────────────────────────────────────
  team_invite_stale: (rows) => composeTeamInviteStale(rows),
  team_away_with_bookings: (rows) => composeTeamAwayWithBookings(rows),
  network_referral_imbalance: (rows) => composeNetworkReferralImbalance(rows),
  person_archived_checkin: (rows) => composePersonArchivedCheckin(rows),

  // ── Stage 13 — F05 · engagements (task 13.26) ─────────────────────────────────────────────────
  calendar_no_gap: (rows) => composeCalendarNoGap(rows),
  waitlist_evenings: (rows) => composeWaitlistEvenings(rows),
  personal_link_skew: (rows) => composePersonalLinkSkew(rows),
  service_overrides: (rows) => composeServiceOverrides(rows),

  // ── Stage 16 — G25 (task 16.28) ───────────────────────────────────────────────────────────────
  competitor_ads_on_name: (rows) => composeCompetitorAdsOnName(rows),
  analytics_snippet_missing: (rows) => composeAnalyticsSnippetMissing(rows),

  // ── Stage 17 — usage (task 17.18) ───────────────────────────────────────────────────────────────
  usage_pace: (rows) => composeUsagePace(rows),

  // ── Stage 20 — growth / lead scoring (task 20.50) ────────────────────────────────────────────
  lead_score_crossed: (rows) => composeLeadScoreCrossed(rows),
};

/** `composeKind(kind, rows, viewer) → candidate[]` — CT-F53. Every returned candidate is EXACTLY
 *  `{kind, icon, tone, headline, why, action, subjectId, fingerprint, priority}`. Throws
 *  `"<kind>: a prompt without an evidence sentence is not a prompt"` if any composed `why` is empty
 *  (CT-F53 rule 1, F01 §2). */
export function composeKind(kind, rows, viewer) {
  const entry = PROMPT_KINDS[kind];
  if (!entry) throw new Error(`${kind}: not a known prompt kind`);
  const composer = COMPOSERS[kind];
  const partials = composer(rows, viewer);
  return partials.map((p) => {
    if (!p.why) throw new Error(`${kind}: a prompt without an evidence sentence is not a prompt`);
    return {
      kind: entry.kind, icon: entry.icon, tone: entry.tone,
      headline: p.headline, why: p.why, action: p.action,
      subjectId: p.subjectId, fingerprint: p.fingerprint, priority: entry.priority,
    };
  });
}
