// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE NETWORK SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { scoped, emptyOf,
} from "./_shared.mjs";

export const NETWORK_LISTS = Object.freeze({
  '/network': {
    title: 'Who you refer to and from', recordType: 'network_party',
    columns: [
      { field: 'name',         label: 'Practice',      format: 'text' },
      { field: 'what_they_do', label: 'What they do',  format: 'text' },
      // ★★★ P6.23 / 12.8 — THE REFERRAL EDGE, WHICH IS THE WHOLE POINT OF THE SECTION.
      //     §"THE 83 ITEMS" PROVES: *"A referrer links to the person they referred."* Without it
      //     this list is an address book: it records that a school exists and never that the
      //     school sent anyone, or that it sends both ways.
      { field: 'sent_to_you',  label: 'Sent to you',   format: 'number' },
      { field: 'you_sent',     label: 'You sent them', format: 'number' },
      { field: 'last_one',     label: 'Last one',      format: 'date' },
      { field: 'state',        label: 'State',         format: 'enum' },
    ],
    // ★ §A1: Network is referral partners, vendors, schools and providers — NOT billed, and not
    //   the same thing as an Account. The empty state says so, because the distinction is the
    //   entire reason both sections exist. Copy verbatim from F04 §2.1:37-38.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconAffiliate',
      headline: 'Nobody in your network yet',
      line: 'The practices you refer to and from live here — a therapist you trust, a trainer, a ' +
        'programme. Referrals carry a name and a reason, never a record.',
      action: { label: 'Add a practice', href: '/network?new=1' },
    }),
    // ★ `sent_to_you` unions the `network_referral` 'in' rows with the older
    //   `app_user.referred_by_party_id` edge (0081), same as the count this list carried before
    //   `network_referral` existed — neither source alone is the whole story. `you_sent` is the
    //   'out' rows only: there is no legacy edge for outbound.
    // ★★★ `n.email` IS SELECTED BUT IS NOT A COLUMN, AND THAT IS DELIBERATE (25 Sep 2026).
    //     The list screen's row-level "Message" action needs an address to open; without this it
    //     rendered, enabled, and toasted "No email on file" on EVERY row, for every party, for
    //     ever — the partner record page's own Message button worked, because `partnerRecord.mjs`
    //     returns `email`. A control that is drawn and can never succeed is the same lie as a dead
    //     link (P21 defect 3). Found from the other end of the wire by the task that built the
    //     screen. ★★ This is an ORGANISATION's address, not a person's: `network_party` is a
    //     register of practices and `primary_contact_id` POINTS AT a person rather than copying
    //     their details here (this module's own header). It carries no person's contact data, and
    //     the row is already scoped by `scoped('network_party', 'n')`.
    sql: `SELECT n.id, n.name, n.what_they_do, n.email,
                 counts.sent_to_you, counts.you_sent, counts.last_one,
                 CASE WHEN counts.sent_to_you > 0 AND counts.you_sent > 0 THEN 'both_ways'
                      WHEN counts.sent_to_you > 0 THEN 'they_send'
                      WHEN counts.you_sent > 0 THEN 'you_send'
                      ELSE 'none' END AS state
            FROM keystone.network_party n
            CROSS JOIN LATERAL (
              SELECT
                (SELECT count(DISTINCT person_id) FROM (
                   SELECT referred_person_id AS person_id FROM keystone.network_referral
                    WHERE receiving_network_party_id = n.id AND direction = 'in'
                   UNION
                   SELECT id AS person_id FROM keystone.app_user WHERE referred_by_party_id = n.id
                 ) sent_in)::int AS sent_to_you,
                (SELECT count(DISTINCT referred_person_id) FROM keystone.network_referral
                  WHERE receiving_network_party_id = n.id AND direction = 'out')::int AS you_sent,
                (SELECT max(created_at) FROM keystone.network_referral
                  WHERE receiving_network_party_id = n.id) AS last_one
            ) counts
           WHERE ${scoped('network_party', 'n')}
           ORDER BY n.name, n.id`,
    // ★ 12.17 reads this key for the list route's summary strip.
    summarySql: `SELECT count(*)::int AS parties,
                        (SELECT count(DISTINCT referred_person_id) FROM keystone.network_referral
                          WHERE direction = 'in' AND created_at >= date_trunc('year', now()))::int
                          AS sent_this_year
                   FROM keystone.network_party n
                  WHERE ${scoped('network_party', 'n')}`,
  },

  // ★★★ 12.8 — EVERY REFERRAL, EITHER DIRECTION, ACROSS THE WHOLE NETWORK. `recordType: null`
  //     because a row here is a REFERRAL, not a party — opening one at `network_party`'s record
  //     route would land on the wrong record (same discipline as `/growth/campaigns`).
  '/network/referrals': {
    title: 'Referrals', recordType: null,
    columns: [
      { field: 'date',      label: 'Date',      format: 'date' },
      { field: 'person',    label: 'Person',    format: 'text' },
      { field: 'practice',  label: 'Practice',  format: 'text' },
      { field: 'direction', label: 'Direction', format: 'enum' },
      { field: 'outcome',   label: 'Outcome',   format: 'enum' },
    ],
    ...emptyOf({
      headline: 'No referrals yet',
      line: 'When you refer someone, or a practice sends someone to you, it shows here.',
      action: null,
    }),
    // ★ F150 shape — `person` is null unless the viewer may see that person, never the name of
    //   somebody outside their scope. Counts, never names, across a tenant boundary.
    // ★★ `r.reason` ADDED 25 Sep 2026, BEHIND THE SAME GATE AS THE NAME. The screen's "Recently
    //    referred" band renders a reason excerpt and this SQL selected no reason, so that segment
    //    was simply always absent — built and wired to nothing, from the reading end.
    //  ★★★ IT IS GATED BY THE IDENTICAL `user_may` CHECK `person` USES, NOT LEFT OPEN. A reason is
    //      written ABOUT a referred person ("moving away, needs someone closer to home"); leaking it
    //      to a viewer who may not see that person would hand over the substance while withholding
    //      only the name, which is the same disclosure with an extra step. F150: counts, never
    //      names — and never the sentence the name was in.
    sql: `SELECT r.id, r.created_at AS date,
                 CASE WHEN keystone.user_may($1,'person','view',p.owner_user_id)
                      THEN p.display_name END AS person,
                 CASE WHEN keystone.user_may($1,'person','view',p.owner_user_id)
                      THEN r.reason END AS reason,
                 n.name AS practice, r.direction, r.outcome
            FROM keystone.network_referral r
            JOIN keystone.app_user p ON p.id = r.referred_person_id
            JOIN keystone.network_party n ON n.id = r.receiving_network_party_id
           WHERE ${scoped('referral', 'r')}
           ORDER BY r.created_at DESC, r.id`,
  },

});
