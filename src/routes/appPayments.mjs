// C2.3 — CLIENT-PORTAL MONEY ROUTES
//
// ★★★ MONEY IS WHAT A PARENT SEES, NEVER SESSION CONTENT (R4).
// A parent account reads only what they pay for: invoices, balance, receipts, saved card,
// credits remaining, and plan/next billing date. Session and clinical content is never exposed,
// regardless of what is requested.
//
// ★★★ STRICT PAYER-SCOPED FILTERING. [MEASURED in app.mjs:334-384] The original queries had NO
// owner predicate, so every client in the practice was served every OTHER client's invoices,
// payments and cards. RLS held perfectly (tenant boundary), but the person-scoped boundary
// inside the tenant was missing. These routes filter to `payer_user_id = $1` (the caller's own
// identity), never any id from the body.

import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { creditStanding, standingSentence } from "../money/credits.mjs";
import { createClientPayment, ADOLESCENT_PAYMENT_REFUSAL } from "../money/clientPayments.mjs";
import { flagIsOn } from "../platform/flags.mjs";

/**
 * ★★★ THE CLIENT ROLES. Same vocabulary as app.mjs.
 * Staff IS DELIBERATELY ABSENT — staff use the CRM surfaces, so they get the admin money views,
 * not the client money surface.
 */
const CLIENT_ROLES = Object.freeze(["adult_client", "adolescent_client", "parent"]);

/**
 * ★★ ASSERT CLIENT ROLE, FAIL CLOSED. A staff session reading this surface would be reading it
 * THROUGH THE CLIENT'S OWN FILTERS — which are narrower than a staff member's — and would then
 * believe they can see less than they actually can.
 */
function assertClientRole(principal) {
  const role = principal?.user?.role ?? null;
  if (!CLIENT_ROLES.includes(role)) {
    throw forbidden(
      `the client app is for ${CLIENT_ROLES.join(", ")}. A staff session belongs in the CRM: reading a ` +
      `client's app surfaces as staff would show you what THEY can see, not what you can, and that is ` +
      `a misleading answer rather than a restricted one.`);
  }
  return role;
}

export function registerAppPaymentsRoutes(app, { scoped, get, post }) {
  // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): this used to call `app.get` directly,
  //   which crashed production on boot — `registerAppRoutes`'s nav/route consistency check
  //   (src/routes/app.mjs:~988) only sees routes registered through ITS OWN tracked `get`, so a
  //   route added by a module registered separately (this one, in src/http/app.mjs) was invisible
  //   to it and reported as a declared surface with no route. `get` is now injected from the
  //   caller (registerAppRoutes itself) so this route is tracked like every other surface read.
  //
  // GET /api/app/payments — BALANCE, INVOICES, RECEIPTS, CARD, CREDITS, PLAN
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ INVOICES — scoped to the payer. A parent sees THEIR money, nobody else's.
  // ★★ THE COLUMNS. [MEASURED] `total_minor`, `due_at` do not exist on keystone.invoice.
  //    The real shape is `amount_minor` plus the billing PERIOD (`period_start`/`period_end`)
  //    — which is what a client needs to recognise it: "August", not an internal due date
  //    the schema never had. The `status` column holds open/paid/overdue states.
  get("/api/app/payments", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);

      // ★★★ ADOLESCENT CLIENTS CANNOT ACCESS MONEY ROUTES. This refusal is at the top, before
      //     any invoice read, so the route is inaccessible and the test can distinguish "forbidden"
      //     from "not found" — a teen gets 403, not 404.
      if (role === "adolescent_client") {
        throw forbidden(ADOLESCENT_PAYMENT_REFUSAL);
      }

      // ★★★ INVOICES — PAYER-SCOPED, STRICTLY. `payer_user_id = $1` is the caller themselves.
      const { rows: invoices } = await db.query(
        `SELECT ie.id, ie.status, ie.amount_minor, ie.currency, i.period_start, i.period_end,
                COALESCE(i.created_at, ie.mirror_synced_at) AS created_at
           FROM keystone.invoice_effective ie
           LEFT JOIN keystone.invoice i ON i.id = ie.id
          WHERE ie.payer_user_id = $1
          ORDER BY COALESCE(i.created_at, ie.mirror_synced_at) DESC LIMIT 100`, [principal.appUserId]);

      // ★★★ PAYMENTS / RECEIPTS — PAYER-SCOPED, STRICTLY. Past payments that were recorded.
      const { rows: payments } = await db.query(
        `SELECT id, amount_minor, currency, status, created_at
           FROM keystone.payment_effective WHERE payer_user_id = $1
          ORDER BY created_at DESC LIMIT 100`, [principal.appUserId]);

      // ★★★ PAYMENT METHODS (SAVED CARDS) — USER-SCOPED, STRICTLY.
      // ★★ THE COLUMNS ARE: id, brand, last_four, is_default, created_at.
      //    NOT: provider_payment_method_id (a Stripe handle, not recognised by a person),
      //         card numbers, tokens, expiry dates (liability with no user benefit).
      //    A person needs brand and last_four to recognise their card; anything more is risk.
      // ★ FIX, 1 Oct 2026 (saved-card brief, Part 6) — `detached_at IS NOT NULL` was missing, so a
      //   client who removed a card in the portal (or had it removed via the sync with Stripe)
      //   kept seeing it listed here as still on file.
      const { rows: methods } = await db.query(
        `SELECT id, brand, last_four, is_default, created_at
           FROM keystone.person_card_effective WHERE app_user_id = $1
          ORDER BY is_default DESC, created_at DESC`, [principal.appUserId]);

      // ★★★ CREDITS STANDING (REMAINING CREDITS AND WHAT THEY ARE FOR).
      // P10.4 / KS-16.2 ruling 5 — same composition the booking and confirmation email use.
      // Read from the SAME resolver these other surfaces call, so they all answer the same
      // question the same way.
      const standing = await creditStanding(db, {
        tenantId: principal.user.tenant_id,
        ownerUserId: principal.appUserId,
      });

      // ★★★ BALANCE — TOTAL OWED. Sum of open invoices for this payer.
      const { rows: balanceRows } = await db.query(
        `SELECT COALESCE(SUM(owes_minor), 0)::int AS balance_minor,
                COALESCE(MAX(currency), 'usd') AS currency
           FROM keystone.person_owes
          WHERE person_id = $1`,
        [principal.appUserId]);
      const balanceData = balanceRows[0] ?? { balance_minor: 0, currency: 'usd' };

      // ★★★ PLAN AND NEXT BILLING DATE (SUBSCRIPTION PLAN INFORMATION).
      // A parent may hold a subscription plan for recurring charges. This reads the plan
      // key and the next billing date from the workbench_subscription table.
      // ★ This table holds ONE row per practice — all clients in the practice share the same plan.
      //   A parent account reads it to see "what plan are we on" and "when is the next charge".
      const { rows: planRows } = await db.query(
        `SELECT plan_key FROM keystone.workbench_subscription LIMIT 1`);
      const planData = planRows[0] ?? { plan_key: null };

      return {
        balance: {
          amountMinor: balanceData.balance_minor,
          currency: balanceData.currency,
        },
        invoices,
        payments,
        methods,
        creditsRemaining: standing.remaining,
        creditStanding: standingSentence(standing),
        plan: {
          planKey: planData.plan_key,
          // ★ F2e (24 Sep 2026): keystone.workbench_subscription has no next-billing-date column at
          //   all (checked db/migrations/0334) — was reading a column, current_period_end, that
          //   never existed on this table. Null until this is designed for real.
          nextBillingDate: null,
        },
      };
    }, { bucket: "app" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // POST /api/app/payments/pay — CREATE A PAYMENT INTENT FOR ONE OR MORE INVOICES
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ADOLESCENT CLIENTS CANNOT PAY. The teen refusal is at the top, before any invoice read,
  //     so the route is inaccessible and the test can distinguish "forbidden" from "not found".
  // ★★★ ONE PAYMENT INTENT FOR THE WHOLE SET. The request names 1–10 invoices, and Stripe is
  //     called exactly once with all of them bound by a single group_id in the allocation rows.
  // ★★★ STRIPE IS THE MONEY RECORD. The platform mirrors balances, invoices and delinquency:
  //     never computes them. The allocation rows hold the split (CT-F40 / task 15.65), and the
  //     webhook applies the payment to invoices and the balance (task 15.14).
  post("/api/app/payments/pay", "/api/app/payments", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);

      // ★★★ ADOLESCENT CLIENTS CANNOT PAY. Checked FIRST, before any invoice read or invoice validation.
      if (role === "adolescent_client") {
        throw forbidden(ADOLESCENT_PAYMENT_REFUSAL);
      }

      const { invoiceIds } = await c.req.json();
      if (!invoiceIds || !Array.isArray(invoiceIds)) {
        throw invalid("invoiceIds must be an array");
      }

      // ★ SAMPLE PAYER REFUSAL — same fact `sendNotificationEmail` refuses (src/email/send.mjs):
      //   a sample subject is not a real person, so a payment in their name is not a real intent.
      const { rows: [payer] } = await db.query(
        `SELECT is_sample FROM keystone.app_user WHERE id = $1`, [principal.appUserId]);
      if (payer?.is_sample === true) {
        throw invalid("a sample account cannot make a payment.");
      }

      // ★★★ STRIPE_ENABLED FLAG CHECK. Same sentence as checkout-session route (app.mjs:1149-1151).
      const stripeEnabled = await flagIsOn(db, "stripe_enabled", principal.user.tenant_id);
      if (!stripeEnabled) {
        throw forbidden(
          "stripe_enabled is off for this practice — a platform operator turned it off. No payment " +
          "can be taken until it is switched back on.");
      }

      // ★★★ CREATE THE PAYMENT INTENT. All invoice validation (open, belongs to payer, currencies match,
      //     amount owed) happens inside createClientPayment. It also emits the intent-created event.
      const result = await createClientPayment(db, {
        tenantId: principal.user.tenant_id,
        payerUserId: principal.appUserId,
        invoiceIds,
        idempotencyKey: c.req.header("idempotency-key"),
      });

      return {
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId,
        amountMinor: result.amountMinor,
        currency: result.currency,
        invoiceIds: result.invoiceIds,
      };
    }, { bucket: "app" })
  );
}
