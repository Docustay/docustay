// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE MONEY SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B8 — THE MONEY BATCH ADDED THREE COLUMNS, AND EACH ONE EXISTS TO MAKE A LIE VISIBLE.
//
//   1 · /money/invoices gains LINES — how many line items the invoice actually has. An invoice
//       charging 125.00 with ZERO lines explains nothing to the person who receives it, and until
//       now the only way to discover that was to open the record page one invoice at a time.
//       P2.8's own note: line_item "was visible NOWHERE in the product". A count on the list is
//       where "this invoice charges for nothing" becomes noticeable rather than discoverable.
//   2 · /money/subscriptions gains ACCESS — the mirror's own verdict on whether this row entitles
//       anybody to anything RIGHT NOW. STATE alone cannot answer it: an ACTIVE subscription whose
//       period ended last month is not access, and a row whose period end was never mirrored is
//       not a yes either. See the column's own note.
//   3 · /money/payments gains CARD ON FILE, and it is deliberately NOT called "Method" — the
//       payment table has no payment_method reference at all, so nothing in this schema can say
//       which instrument took a given payment. The column says what it can honestly say.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ Only scoped() is imported. The shared COLUMN GROUPS belong to the person-shaped lists; money
//   has no list over app_user, and importing names this file does not use is how a reader comes to
//   believe a connection exists that does not.
import { scoped, emptyOf,
} from "./_shared.mjs";

export const MONEY_LISTS = Object.freeze({
  '/money/invoices': {
    // ★ Same connection for invoices — and it matters more here, because the invoice page is the
    //   only place line items are readable at all (P2.7/P2.8).
    title: 'Invoices', recordType: 'invoice',
    // \u2605\u2605\u2605 P2.6 \u2014 THIS COLUMN USED TO READ `{ field: 'period_end', label: 'Due' }`, AND THE LIST
    //     WAS ORDERED BY IT. `period_end` is the end of a SERVICE PERIOD; it has never meant "when
    //     money is owed". **A screen was presenting a billing boundary as an obligation date**, and
    //     there was no due-date column to correct it with until 0086.
    //   \u2605\u2605 It was wrong in the direction that hides: on a monthly subscription invoice covering
    //      the month and payable at its end, the two dates COINCIDE and the column reads correctly.
    //      It is the invoice with fourteen days' terms that lies, and nothing on the screen said
    //      which kind you were looking at.
    //   \u2605 The invoice NUMBER leads now, because that is what a person telephoning about an invoice
    //     is holding \u2014 not a uuid and not Stripe's id.
    columns: [
      { field: 'invoice_number', label: 'Number', format: 'text' },
      { field: 'payer',          label: 'Payer',  format: 'text' },
      { field: 'amount_minor',   label: 'Amount', format: 'money', currency: 'currency' },
      { field: 'status',         label: 'Status', format: 'enum' },
      { field: 'due_at',         label: 'Due',    format: 'date' },
      { field: 'paid_minor',     label: 'Paid',   format: 'money', currency: 'currency' },
      // ★★★ P6.45 — HOW MANY THINGS THIS INVOICE SAYS IT IS CHARGING FOR. Zero is a real and
      //     COMMON answer: createInvoice takes an amount directly and lines are added afterwards,
      //     so every invoice is momentarily a number with no explanation, and one nobody finished
      //     stays that way. A total with no lines is the invoice a client telephones about.
      //   ★ `number`, not `money` — it is a count, and formatValue would divide it by 100.
      { field: 'lines',          label: 'Lines',  format: 'number' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconFileInvoice',
      headline: 'No invoices yet',
      line: 'Raised against a service or a completed session.',
      action: { label: 'Raise invoice', href: '/money/invoices?new=1' },
      blockedAction: { label: 'Add service', href: '/items/services?new=1' },
      blockedLine: 'An invoice is raised from a priced service, and none of yours has an active price yet.',
    }),
    totalColumn: 'amount_minor',
    // ★★★ specs/STRIPE-MIRROR.md §4 stage (e) — STRIPE IS THE TRUTH FOR status/amount/paid, READ
    //     THROUGH `keystone.invoice_effective` (migration 0574), THE ONE VIEW EVERY READER SHARES.
    //     The list STARTS FROM THE VIEW and LEFT JOINs keystone.invoice for the platform's OWN columns
    //     (due_at, created_at, archived_at): a Stripe-only invoice of a known person exists only in
    //     the view (origin = 'stripe', no base row) and must still be listed. For those rows `i` is
    //     NULL, so the viewer/archive predicate is `(i.id IS NULL OR <scoped on i>)` — the VIEW is
    //     security_invoker and re-states tenant + viewer scope on its own Stripe-only branch, so
    //     that branch needs no second predicate here and is not widened by it.
sql: `
      SELECT ie.id,
             ie.amount_minor,
             ie.currency,
             ie.status,
             i.due_at, ie.invoice_number,
             (SELECT u.display_name FROM keystone.app_user u WHERE u.id = ie.payer_user_id) AS payer,
             ie.paid_minor,
             -- ★★ COUNTED, NOT JOINED. A join to line_item would multiply the invoice row once per
             --    line and every aggregate above it would silently overstate. The subquery keeps
             --    one row per invoice, which is what this list is a list of.
             -- ★ No viewer predicate of its own, for the reason invoice.lines gives in
             --   queries.mjs: a line item carries no person, and its visibility is entirely its
             --   parent's — which the WHERE clause below has already decided.
             (SELECT count(*)::int FROM keystone.line_item li WHERE li.invoice_id = ie.id) AS lines,
             -- ★ QUEUE §4: programs are DERIVED from the lines (service/package/plan), never stored on the invoice.
             coalesce((SELECT array_agg(DISTINCT lp.program_id) FROM keystone.line_item_program lp WHERE lp.invoice_id = ie.id AND lp.program_id IS NOT NULL), '{}') AS program_ids
        FROM keystone.invoice_effective ie
        LEFT JOIN keystone.invoice i ON i.id = ie.id
         WHERE (i.id IS NULL OR ${scoped('invoice', 'i')})
       -- \u2605\u2605 SOONEST DUE FIRST, and NULLS LAST. An invoice with no deadline set is not overdue and
       --    must not sort as though it were \u2014 that would invent the obligation this item is about.
       ORDER BY i.due_at ASC NULLS LAST, i.created_at DESC NULLS LAST, ie.id`,
  },
  '/money/subscriptions': {
    title: 'Subscriptions', recordType: 'subscription',
    columns: [
      { field: 'client_name', label: 'Client', format: 'text' },
      { field: 'plan_name',   label: 'Plan',   format: 'text' },
      { field: 'state',       label: 'State',  format: 'enum' },
      { field: 'snapshot_amount_minor', label: 'Agreed price', format: 'money', currency: 'currency' },
      { field: 'current_period_end',    label: 'Renews',       format: 'date' },
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ P6.46 — DOES THIS ROW ENTITLE ANYBODY TO ANYTHING, RIGHT NOW? STATE CANNOT ANSWER IT.
      //
      //   The money rule is that an access check reads OUR database and never a live provider
      //   call, and the mirror holds exactly four facts for that purpose: status, period end,
      //   plan and the provider ids. So the verdict is computable here — and until this column
      //   it was computed NOWHERE. [MEASURED 2026-09-15] `current_period_end` is WRITTEN by
      //   createSubscription, RENDERED by this list and by the record page, and READ BY NO
      //   DECISION IN THE PRODUCT: grep finds it in exactly four files, all of them a write or a
      //   display. There is no entitlement function, so nothing in Keystone has ever asked
      //   whether a subscription still entitles.
      //
      //   ★★ AND "ACTIVE" IS THE ANSWER THAT LIES. A subscription whose period ended last month
      //      still reads `state = 'active'` — nothing moves that column but an explicit cancel —
      //      so a screen showing STATE alone shows access that expired and says nothing about it.
      //   ★★ A NULL PERIOD END IS NOT A YES EITHER. It means the mirror was never told when this
      //      renews. Calling that "entitled" would be inventing a fact from an absent one, so it
      //      gets its own value and a person can go and find out.
      //   ★ It is a DERIVED READING, not a permission. Nothing is gated on it today — saying so
      //     here because a column that looks like enforcement and is not is worse than no column.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      { field: 'access',                label: 'Access',       format: 'enum' },
      { field: 'program_id', label: 'Program', format: 'program' },
    ],
    // ★★★ P15.2c — NEITHER plan_id NOR app_user_id APPEARS HERE. Both are resolved to names in
    //     SQL. The descriptor layer additionally REFUSES to declare a field ending in `_id`, so
    //     the raw-UUID defect is unrepresentable rather than merely absent.
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconRepeat',
      headline: 'No subscriptions yet',
      line: 'Bills a client on a repeating interval.',
      action: { label: 'Start subscription', href: '/money/subscriptions?new=1' },
      blockedAction: { label: 'Add plan', href: '/items/plans?new=1' },
      blockedLine: 'A subscription puts a client on a plan, and you have no plans yet.',
    }),
    // ★★★ STRIPE-MIRROR §4 stage (e) — READ THROUGH `keystone.subscription_effective`: state,
    //     agreed price and period come from Stripe's subscription; a Stripe-only subscription has
    //     plan_id NULL, so the plan name/currency are subqueries (never an inner join) and the
    //     currency falls back to the view's own.
    sql: `
      SELECT sub.id, sub.state, sub.snapshot_amount_minor, sub.current_period_end,
             (SELECT pl.name     FROM keystone.plan pl     WHERE pl.id = sub.plan_id)     AS plan_name,
             COALESCE((SELECT pl.currency FROM keystone.plan pl WHERE pl.id = sub.plan_id), sub.currency) AS currency,
             (SELECT au.display_name FROM keystone.app_user au WHERE au.id = sub.app_user_id) AS client_name,
             -- ★★★ THE MIRROR'S VERDICT. Six values, and the order of the branches IS the rule:
             --    anything that is not active loses first, so a cancelled row can never reach the
             --    date comparison and be rescued by a period end still in the future.
             --  ★ cancel_at_period_end is deliberately NOT folded in here. It is a subscription
             --    that is still ACTIVE and still billing until the period closes — the writer says
             --    so in those words — so it entitles, and collapsing it into "cancelled" would
             --    withdraw access somebody has paid for.
             CASE
               WHEN sub.state <> 'active'             THEN sub.state
               WHEN sub.current_period_end IS NULL    THEN 'period_unknown'
               WHEN sub.current_period_end < now()    THEN 'period_ended'
               ELSE 'entitled'
             END AS access,
             (SELECT sp.program_id FROM keystone.subscription_program sp WHERE sp.subscription_id::text = sub.id::text) AS program_id
        FROM keystone.subscription_effective sub
         WHERE ${scoped('subscription', 'sub')}
       ORDER BY client_name, sub.id`,
  },
  '/money/payments': {
    title: 'Payments',
    columns: [
      { field: 'payer',        label: 'Payer',    format: 'text' },
      { field: 'amount_minor', label: 'Amount',   format: 'money', currency: 'currency' },
      { field: 'status',       label: 'Status',   format: 'enum' },
      { field: 'created_at',   label: 'Taken',    format: 'datetime' },
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ P6.47 — "CARD ON FILE", AND IT IS **NOT** CALLED "METHOD" ON PURPOSE.
      //     [MEASURED 2026-09-15 from information_schema] `keystone.payment` has ten columns and
      //     NOT ONE of them references `payment_method`. So the schema cannot say which instrument
      //     took a given payment, and a column headed "Method" over this value would be a
      //     confident answer to a question nothing in the database can answer — the exact class
      //     the invoices list was already corrected for once (a service boundary printed as a due
      //     date). The honest reading is the payer's DEFAULT stored card, and that is the heading.
      //   ★ It answers the question P6.47 actually needs answered on this screen: does this payer
      //     have an instrument stored at all, or is every future charge going to need a new one?
      // ═══════════════════════════════════════════════════════════════════════════════════════
      { field: 'card_on_file',   label: 'Card on file', format: 'text' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
    ],
    // ★ §P5: money going backwards is its own fact. A payment list that hides refunds overstates
    //   revenue on the busiest screen in the section.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconCreditCard',
      headline: 'No payments yet',
      line: 'Everything taken, with its status. A payment appears here automatically once an invoice is paid.',
      action: null,
    }),
    totalColumn: 'amount_minor',
sql: `
      SELECT p.id, p.amount_minor, p.currency, p.status, p.created_at,
             (SELECT u.display_name FROM keystone.app_user u WHERE u.id = p.payer_user_id) AS payer,
             -- ★ STRIPE-MIRROR §4 stage (e): the refunded amount is Stripe's own charge.amount_refunded,
             --   carried by keystone.payment_effective — no longer uncomputable (F2d).
             p.refunded_minor::bigint AS refunded_minor,
             -- ★★ THE BRAND AND FOUR DIGITS, NEVER THE PROVIDER HANDLE. createPaymentMethod's own
             --    rule is that the table holds "a handle and enough to recognise it on a screen";
             --    the handle is the part that must not reach a screen, so it is not selected.
             --  ★ DEFAULT FIRST, then most recently added. A payer with no stored card yields NULL
             --    and the renderer prints the dash it prints for every other absent value — it does
             --    NOT print "None", which would read as a fact somebody established.
             -- FIX, 1 Oct 2026 (saved-card brief, Part 6) — detached_at IS NULL was missing; a
             -- removed card kept showing here as "the card on file". Same class of bug fixed
             -- across every other reader of this table this same session.
             (SELECT pm.brand || ' ' || pm.last_four
                FROM keystone.person_card_effective pm
               WHERE pm.app_user_id = p.payer_user_id
                 AND pm.brand IS NOT NULL AND pm.last_four IS NOT NULL
               ORDER BY pm.is_default DESC, pm.created_at DESC
               LIMIT 1) AS card_on_file,
             coalesce((SELECT array_agg(DISTINCT lp.program_id) FROM keystone.line_item_program lp WHERE lp.invoice_id = p.invoice_id AND lp.program_id IS NOT NULL), '{}') AS program_ids
        FROM keystone.payment_effective p
         WHERE ${scoped('payment', 'p')}
       ORDER BY p.created_at DESC, p.id`,
  },
  '/money/credits': {
    title: 'Credits', recordType: 'entitlement',
    columns: [
      { field: 'client_name',  label: 'Client',  format: 'text' },
      { field: 'service_name', label: 'Service', format: 'text' },
      { field: 'status',       label: 'Status',  format: 'enum' },
      { field: 'expires_at',   label: 'Expires', format: 'date' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconTicket',
      headline: 'No credits yet',
      line: 'A credit is granted when a client buys a package or subscribes to a plan.',
      action: null,
      blockedAction: { label: 'Add package', href: '/items/packages?new=1' },
      blockedLine: 'A credit comes from a package or plan, and you have not built one yet.',
    }),
    sql: `
      SELECT ec.id, ec.status, e.expires_at,
             (SELECT au.display_name FROM keystone.app_user au WHERE au.id = e.owner_user_id) AS client_name,
             (SELECT s.name FROM keystone.service s WHERE s.id = e.service_id) AS service_name
        FROM keystone.entitlement_credit ec
        JOIN keystone.entitlement e ON e.id = ec.entitlement_id
       WHERE ${scoped('entitlement', 'e')}
     ORDER BY e.expires_at ASC NULLS LAST, ec.id`,
  },

  // ══ PLATFORM ═══════════════════════════════════════════════════════════════
  // ★ /platform/tenants and /platform/provisioning already have routes (P12.12) through their
  //   gated SECURITY DEFINER listers. The job queue did not.
});
