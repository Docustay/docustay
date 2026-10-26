// @ts-check
// P8.2 — THE INBOUND WEBHOOK ROUTE. EVERYTHING BEHIND IT ALREADY EXISTED; NOTHING COULD REACH IT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT WAS MISSING WAS A DOOR, NOT A BUILDING. [MEASURED 2026-09-15] `handleWebhook`
//     (`src/paths/index.mjs:141`) already verifies-then-resolves, `verifyWebhookSignature`
//     (`src/webhooks/verify.mjs:162`) already implements Stripe AND Svix/Resend, the routing table
//     `keystone_auth.webhook_source` exists with a SECURITY DEFINER resolver
//     (`keystone.resolve_webhook_source`, 0045), that resolver is already installed at
//     `src/auth/install.mjs:24`, and `handlePaymentWebhook` (`src/payments/webhook.mjs:47`) already
//     applies the events. **The 76-route enumeration simply contained no webhook path**, so every
//     one of those parts was unreachable and three money topics could never fire.
//
// ★★★ REGISTERED OUTSIDE `runTenantScoped`, LIKE SIGNUP AND LOGIN — AND FOR A STRONGER REASON.
//     A webhook arrives with no session, no principal and NO TENANT YET; the tenant is the OUTPUT
//     of this path, not an input to it. `paths/index.mjs:118-131` states the rule this route exists
//     to honour: **the signature is verified BEFORE the tenant is resolved**, because `externalRef`
//     arrives in the request BODY — so resolving first would be *tenant selection by the attacker*
//     on the path that carries live payment events.
//
// ★★ THE BODY IS READ AS TEXT, ONCE, AND NEVER PARSED FIRST. `verifyWebhookSignature` REFUSES an
//    object outright (`verify.mjs:174`) because a parsed body means the signed bytes are gone and
//    any MAC computed after that is over OUR serialisation, not the sender's. `c.req.text()` is
//    therefore load-bearing, not a style choice.
//
// ★ NO IDEMPOTENCY KEY HEADER IS REQUIRED HERE, unlike signup: vendors do not send one. Replay
//   safety comes from the handlers themselves — `handlePaymentWebhook` writes payments keyed by
//   `provider_payment_id` and `p8_webhook_idempotency.mjs` already asserts a re-delivered event
//   applies once.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { linkPayoutCharges } from "../money/payoutLinks.mjs";
import { noteEmailDelivery } from "../documents/frontDoor.mjs";
import { recordMailEvent } from "../mail/index.mjs";
import { grantInvoiceCredits } from "../money/creditGrant.mjs";
import { handleWebhook } from "../paths/index.mjs";
import { callOutside } from "../http/outside.mjs";
import { stripeSecretFor } from "../product/stripeFor.mjs";
import { handlePaymentWebhook, HANDLED_EVENTS } from "../payments/webhook.mjs";
// ★★★ Task 6.5 (spec 06 §5, §2.7 row 6) — the platform's OWN subscription mirror, a SECOND applier on
//     the same 'stripe' provider door, chosen by event type below. See `billing/webhook.mjs`'s own
//     header for the scope note on why it reuses this existing dispatch rather than a new one.
import { isSelfhostEvent, applySelfhostEvent } from "../product/docustaySelfhost.mjs";
import { handleSubscriptionWebhook, SUBSCRIPTION_EVENTS, DOCUSTAY_SHARED_EVENTS } from "../billing/webhook.mjs";
import { PROVIDERS, verifyWebhookSignature } from "../webhooks/verify.mjs";
import { asPracticeOwner, practiceOwnerId } from "../money/asPracticeOwner.mjs";
// ★★★ specs/STRIPE-MIRROR.md §3.5 — one route, two consumers, same verified bytes. See the call
//     site below for why this never aborts the platform's own dispatch.
import { recordCheckoutCompleted, recordSubscriptionEvent, recordDisputeEvent, recordPaymentFailed, refreshStripeFees } from "../documents/frontDoor.mjs";
import { onDeauthorized, onAccountUpdated } from "../product/docustayPayments.mjs";
import { processStripeWebhook, upsertRawStripeObject, recordMirrorHealth } from "../money/stripeMirror.mjs";
import { withCredentialLookup } from "../db/index.mjs";
import { notFound } from "../http/errors.mjs";
import { emit } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★ WHICH FIELD NAMES THE VENDOR OBJECT THE ROUTING TABLE IS KEYED ON — PER PROVIDER, EXPLICITLY.
 *    `handleWebhook` defaults to `data.object.customer`, which is right for Stripe and wrong for
 *    everything else. An extractor that silently returns `undefined` produces "no tenant mapped",
 *    a message about configuration, for what is actually a coding mistake — so each provider names
 *    its own field here and an unknown provider never reaches a default.
 */
const EXTERNAL_REF = Object.freeze({
  // Stripe: the customer is the durable per-tenant object. `data.object.customer` is present on
  // payment_intent.*, invoice.* and charge.* — the three families `HANDLED_EVENTS` covers.
  // Account-level events carry an `account` field at the top level (for webhook routing via
  // Stripe Connect account webhooks), which takes precedence for routing purposes.
  stripe: (body) => body?.account ?? body?.data?.object?.customer ?? null,
  // ★ Resend/Svix: the sending DOMAIN is the per-tenant object, not the message. A message id is
  //   unique per email and could not be mapped ahead of time.
  resend: (body) => body?.data?.from?.split("@")[1] ?? null,
});

/**
 * ★★★ FIX (b_money_webhooks) — B1.4's mirror events (`charge.refunded`, `payout.paid`,
 *     `payout.failed`, `charge.dispute.created`, `charge.dispute.closed`) carry no `account` or
 *     `customer` field in every delivery shape, so `EXTERNAL_REF.stripe` above can return nothing
 *     to route by. Used ONLY as a fallback in `handleWebhook` — an existing account/customer
 *     mapping still wins — this reads the object's OWN `metadata.tenantId`, which is data WE
 *     stamped when WE created the object via the Stripe API. Trustworthy specifically because
 *     `handleWebhook` runs this AFTER signature verification (see its own header), never before.
 */
// ★★★ RUN-2 review (26 Sep 2026): NEVER for a Connect event. An event carrying `account` came from a
//     practice's CONNECTED account, whose holder can create objects with ANY metadata in their own
//     dashboard — trusting `metadata.tenantId` there would let one practice write mirror rows into
//     another. A Connect event routes by its account mapping or not at all; only a PLATFORM-account
//     event (no `account` — objects only the platform key creates) may use the stamped tenant id.
const DIRECT_TENANT_ID = Object.freeze({
  // ★ Batch A — Resend: the message id the mail module recorded at send time (every organisation on the platform default sends from the PRODUCT'S domain, so the From-domain cannot say whose message it was).
  resend: async (body) => {
    const id = body?.data?.email_id;
    if (typeof id !== "string" || !id) return null;
    return withCredentialLookup(async (db) => (await db.query(`SELECT keystone.mail_message_tenant($1) AS t`, [id])).rows[0]?.t ?? null).catch(() => null);
  },
  stripe: async (body) => {
    if (body?.account) return null;
    // (an invoice carries its subscription's metadata under subscription_details / parent.subscription_details — Part 29)
    const o = body?.data?.object ?? {};
    const m = { ...(o.metadata ?? {}), ...(o.subscription_details?.metadata ?? {}), ...(o.parent?.subscription_details?.metadata ?? {}) };
    // ★★★ FOUND LIVE in the sandbox browser test, 2 Oct 2026: `metadataFor()` (src/money/metadata.mjs) stamps the practice as `practice_id` — a key NONE of
    //   the three above is. So a paid invoice's `invoice.paid` resolved NO tenant (no `webhook_source` row exists for a Stripe customer either), threw
    //   NoTenantContext, and the platform's own side — the payment row, the invoice marked paid, the credit grant — never ran; only the mirror saw it.
    //   Same trust as the other keys: a platform-account object, after signature verification, carrying the id WE stamped.
    const practice = typeof m.practice_id === "string" && /^[0-9a-f-]{36}$/i.test(m.practice_id) ? m.practice_id : null;
    const direct = m.workbench_tenant_id ?? m.keystone_tenant_id ?? m.tenantId ?? practice ?? null;
    if (direct) return direct;
    // 21 Oct 2026 (pricing integrity): a dispute on a PLATFORM-account payment (a Docustay plan payment) carries only its charge. The charge, or its customer, carries the workspace id WE stamped.
    if (typeof body?.type === "string" && body.type.startsWith("charge.dispute.") && typeof o.charge === "string") return planDisputeTenant(o.charge);
    return null;
  },
});
/** The workspace a platform-account charge belongs to: the id stamped on the charge, else on its customer. Reads Docustay's own Stripe account; null when it cannot be found (another product's charge, an outage): the event is then handled as it always was. */
async function planDisputeTenant(chargeId) {
  try {
    const key = stripeSecretFor("docustay"); if (!key || !/^ch_|^py_/.test(chargeId)) return null;
    const get = async (path) => { const r = await callOutside("stripe", `https://api.stripe.com/v1${path}`, { method: "GET", headers: { Authorization: `Bearer ${key}` } }, { timeoutMs: 10_000 }); return r.ok ? r.body : null; };
    const ch = await get(`/charges/${encodeURIComponent(chargeId)}`); if (!ch) return null;
    const idOf = (m) => m?.workbench_tenant_id ?? m?.keystone_tenant_id ?? null;
    if (idOf(ch.metadata)) return idOf(ch.metadata);
    const cust = typeof ch.customer === "string" ? await get(`/customers/${encodeURIComponent(ch.customer)}`) : null;
    return idOf(cust?.metadata);
  } catch { return null; }
}

/**
 * ★★★ EMAIL DELIVERY EVENTS — THE HALF THAT MAKES `notification_delivery.status` MEAN SOMETHING.
 *     `F73`: `status` reaches `sent` and stops there forever, because the only thing that could
 *     advance it is an inbound Resend event and nothing could deliver one. The column's CHECK
 *     permits `delivered`, and until now **no code path in the project could ever write it**.
 *   ★★ `sent` -> `delivered` is not cosmetic: "we handed it to the provider" and "the provider says
 *      it arrived" are different facts, and only the second answers "did they get my email?".
 *   ★ A bounce is a FAILURE with a reason, which the CHECK at 0042 requires to be non-empty.
 *
 * ★★★ ENGAGEMENT EVENTS (Task 20.45) — OPENS AND CLICKS:
 *     `email.opened` → first open timestamp + increment open_count cache
 *     `email.clicked` → first click timestamp + increment click_count cache + ledger row
 */
const EMAIL_EVENT_STATUS = Object.freeze({
  "email.delivered": { status: "delivered", error: null },
  "email.bounced": { status: "failed", error: "the provider reported a bounce" },
  "email.complained": { status: "failed", error: "the recipient marked it as spam" },
  "email.opened": { status: "engagement", engagement: "opened" },
  "email.clicked": { status: "engagement", engagement: "clicked" },
});

async function handleEmailWebhook(tx, body, { tenantId }) {
  const type = body?.type;
  const mapped = EMAIL_EVENT_STATUS[type];
  if (!mapped) return { applied: false, reason: "unhandled_event_type", type };

  const messageId = body?.data?.email_id ?? null;
  if (!messageId) return { applied: false, reason: "no_provider_message_id", type };

  // ★★ ENGAGEMENT EVENTS (opened/clicked) don't update notification_delivery status.
  //    They record engagement metrics on app_user and (for clicks) in the email_click ledger.
  if (mapped.status === "engagement") {
    const timestamp = body?.data?.created_at ? new Date(body.data.created_at) : new Date();

    // ★ Resolve the app_user from the notification_delivery
    const userRow = await run(tx, db
      .selectFrom("keystone.notification_delivery as nd")
      .innerJoin("keystone.notification as n", "n.id", "nd.notification_id")
      .select("n.recipient_id")
      .where("nd.tenant_id", "=", tenantId)
      .where("nd.provider_message_id", "=", messageId)
      .where("nd.channel", "=", "email")
      .limit(1));

    if (userRow.rowCount === 0) {
      return { applied: false, reason: "no_delivery_row_for_that_message", type };
    }

    const recipientId = userRow.rows[0].recipient_id;

    // ★★★ OPENED ENGAGEMENT: Set opened_at only on first open, increment open_count
    //      Task 20.48: Emit growth.campaign.opened only on first open (sampled, one per delivery)
    if (mapped.engagement === "opened") {
      // Check if this is the first open
      const checkRow = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("opened_at")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", recipientId));

      const isFirstOpen = checkRow.rows.length > 0 && checkRow.rows[0].opened_at === null;

      await tx.query(
        `UPDATE keystone.app_user
            SET opened_at = COALESCE(opened_at, $3),
                open_count = open_count + 1
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, recipientId, timestamp]);

      // Emit sampled event only on first open
      if (isFirstOpen) {
        // Get the campaign id from the notification delivery
        const deliveryRow = await tx.query(
          `SELECT CASE WHEN e.subject_type = 'campaign' THEN e.subject_id END AS campaign_id
             FROM keystone.notification_delivery nd
             JOIN keystone.notification n ON n.id = nd.notification_id
             LEFT JOIN keystone.event e ON e.id = n.event_id
            WHERE nd.tenant_id = $1 AND nd.provider_message_id = $2`,
          [tenantId, messageId]);

        if (deliveryRow.rows.length > 0 && deliveryRow.rows[0].campaign_id) {
          await emit(tx, {
            tenantId,
            topic: "growth.campaign.opened",
            emittedBy: "growth",
            subjectType: "person",
            subjectId: recipientId,
            payload: { person_id: recipientId, campaign_id: deliveryRow.rows[0].campaign_id },
          });
        }
      }

      return { applied: true, type, engagement: "opened" };
    }

    // ★★★ CLICKED ENGAGEMENT: Set first_clicked_at on first click, increment click_count,
    //     and insert one ledger row (idempotent: check for duplicate before inserting)
    //     Task 20.48: Emit growth.campaign.clicked only on first click (sampled, one per delivery)
    if (mapped.engagement === "clicked") {
      const url = body?.data?.click?.url ?? null;
      if (!url) return { applied: false, reason: "no_click_url_in_webhook", type };

      // Check if this is the first click
      const checkRow = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("first_clicked_at")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", recipientId));

      const isFirstClick = checkRow.rows.length > 0 && checkRow.rows[0].first_clicked_at === null;

      // ★ UPDATE app_user first to record the engagement
      await tx.query(
        `UPDATE keystone.app_user
            SET first_clicked_at = COALESCE(first_clicked_at, $3),
                click_count = click_count + 1
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, recipientId, timestamp]);

      // ★ INSERT ledger row. Idempotent: if this exact click already exists (same user, url,
      //   and timestamp within a second), the INSERT will fail silently due to our check below.
      //   The UNIQUE constraint on (tenant_id, app_user_id, url) with clicked_at bucketing
      //   is not used here; instead we check if a recent row exists before inserting.
      const existing = await tx.query(
        `SELECT id FROM keystone.email_click
          WHERE tenant_id = $1 AND app_user_id = $2 AND url = $3
            AND clicked_at > $4::timestamptz - interval '1 second'
            AND clicked_at < $4::timestamptz + interval '1 second'
          LIMIT 1`,
        [tenantId, recipientId, url, timestamp]);

      if (existing.rowCount === 0) {
        await run(tx, db
          .insertInto("keystone.email_click")
          .values({ tenant_id: tenantId, app_user_id: recipientId, url: url, clicked_at: timestamp }));
      }

      // Emit sampled event only on first click
      if (isFirstClick) {
        // Get the campaign id from the notification delivery
        const deliveryRow = await tx.query(
          `SELECT CASE WHEN e.subject_type = 'campaign' THEN e.subject_id END AS campaign_id
             FROM keystone.notification_delivery nd
             JOIN keystone.notification n ON n.id = nd.notification_id
             LEFT JOIN keystone.event e ON e.id = n.event_id
            WHERE nd.tenant_id = $1 AND nd.provider_message_id = $2`,
          [tenantId, messageId]);

        if (deliveryRow.rows.length > 0 && deliveryRow.rows[0].campaign_id) {
          await emit(tx, {
            tenantId,
            topic: "growth.campaign.clicked",
            emittedBy: "growth",
            subjectType: "person",
            subjectId: recipientId,
            payload: { person_id: recipientId, campaign_id: deliveryRow.rows[0].campaign_id },
          });
        }
      }

      return { applied: true, type, engagement: "clicked", ledger_row: existing.rowCount === 0 ? "inserted" : "deduplicated" };
    }

    return { applied: false, reason: "unhandled_engagement_type", type };
  }

  // ★★ DELIVERY EVENTS (delivered/bounced/complained) update notification_delivery status
  // ★★ MATCHED ON `provider_message_id`, WHICH IS WHAT THE SENDER RECORDED. `fanOut` and
  //    `sendNotificationEmail` both store the provider's id on the delivery row precisely so a
  //    later event about that message can find it. ★ Scoped to the tenant as well as the id: RLS
  //    already confines it, and naming the tenant makes the intent legible.
  const r = await tx.query(
    `UPDATE keystone.notification_delivery
        SET status = $3, error = $4, completed_at = now()
      WHERE tenant_id = $1 AND provider_message_id = $2 AND channel = 'email'
      RETURNING id, notification_id`,
    [tenantId, messageId, mapped.status, mapped.error]);

  // ★ Batch A — every delivered / bounced / complained event is also recorded by the MAIL MODULE (by provider message id, once), whoever sent the message; it feeds the Email settings screen's bounce state.
  await recordMailEvent(tx, { tenantId, providerMessageId: messageId, type });

  // ★ A verified event for a message we have no record of is reported, not thrown. It is a real
  //   and permitted state — an email sent before this table existed, or one from another system on
  //   the same domain — and a 500 would make the vendor retry it forever.
  if (r.rowCount === 0) {
    // ★ QUEUE §23.3.4 — not a notification: it may be a Documents invitation. The island records the delivery/bounce on the person and the document's audit trail ("fix the address").
    const doc = await noteEmailDelivery(tx, { tenantId, providerMessageId: messageId, type });
    if (doc.applied) return { applied: true, type, document: doc.kind };
    return { applied: false, reason: "no_delivery_row_for_that_message", type };
  }

  // ★★★ CT-104 / 12-signup-first-run-people.md §3.2 — SAME TRANSACTION, ONE MORE WRITE, NO NEW
  //     EVENT, NO NEW LISTENER. A bounce is a live problem with the address itself, not just this
  //     one message, so it is recorded on the person (`app_user.email_bounced_at`, migration 0230)
  //     for `portalStatus()` (`src/people/portalStatus.mjs`) to read — not just on the delivery row.
  if (type === "email.bounced") {
    await tx.query(
      `UPDATE keystone.app_user
          SET email_bounced_at = now()
        WHERE tenant_id = $1
          AND id = (SELECT recipient_id FROM keystone.notification WHERE id = $2)`,
      [tenantId, r.rows[0].notification_id]);
  }

  return { applied: true, type, status: mapped.status };
}

/**
 * ★★★ THE FIRST DOOR of the one idempotent credit grant (src/money/creditGrant.mjs, specs/CREDITS-PIPELINE.md §3.1): a verified
 *     `invoice.paid` / `invoice.payment_succeeded` grants that invoice's credits — independent of whether the platform recorded a payment row
 *     (the old path granted only from a `keystone.payment` event, so a Stripe-only payment granted nothing). The ledger row makes a replay,
 *     a partial payment or a race with the catch-up harmless. ★ An error here is NOT swallowed: it fails the request (5xx), so Stripe
 *     RETRIES the event — the old handler caught everything, answered 200 and never retried (defect 6).
 */
async function grantCreditsForPaidInvoice(tx, body, tenantId) {
  if (body?.type !== "invoice.paid" && body?.type !== "invoice.payment_succeeded") return null;
  const stripeInvoiceId = body?.data?.object?.id;
  if (!stripeInvoiceId) return null;
  const out = await asPracticeOwner(tx, tenantId, () => grantInvoiceCredits(tx, { tenantId, stripeInvoiceId }));
  return { status: out.status, entitlements: out.entitlementIds.length };
}

export function registerWebhookRoutes(app) {
  app.post("/api/webhooks/:provider", async (c) => {
    const provider = c.req.param("provider");

    // ★★ AN UNKNOWN PROVIDER IS A 404, DECIDED BEFORE ANY BYTES ARE READ. `verifyWebhookSignature`
    //    would also refuse it, but a 404 here says "there is no such door" rather than "your
    //    signature is wrong", and the two need different responses from whoever is debugging.
    if (!PROVIDERS.includes(provider) || !EXTERNAL_REF[provider]) throw notFound();

    // ★★★ RAW BYTES. See the header — parsing first destroys the thing being verified.
    const rawBody = await c.req.text();
    const headers = Object.fromEntries(c.req.raw.headers);

    // ★★★ specs/STRIPE-MIRROR.md §3.5 — THE MIRROR IS UPDATED FOR EVERY VERIFIED STRIPE EVENT, BEFORE
    //     (and independent of) any practice being resolved. the platform's tenant resolution works from
    //     `data.object.customer`/`account`/`metadata.tenantId`; products, prices, payouts, tax ids and
    //     account-level events carry none, and used to die here as a 401 NoTenantContext — so the
    //     mirror never saw them AND Stripe counted the delivery as failed. Signature is verified
    //     first (same verifier, same 401 on a bad one); the mirror call never throws.
    let mirrorResult = null;
    if (provider === "stripe") {
      const verified = verifyWebhookSignature({ provider, rawBody, headers });
      const stripeSignature = headers["stripe-signature"] ?? headers["Stripe-Signature"];
      // an event signed by Docustay's own Stripe account is not the Docustay/the platform mirror's to process (it only knows the Docustay secret); its read-only mirror is a separate step (plan decision 1)
      mirrorResult = verified?.account === "docustay" ? { skipped: "docustay_account_event" } : await processStripeWebhook(rawBody, stripeSignature);
      // The sync engine has no payout support — mirror payouts ourselves, same verified bytes.
      try {
        const ev = JSON.parse(rawBody);
        if (typeof ev?.type === "string" && ev.type.startsWith("payout.") && ev?.data?.object?.id) {
          await upsertRawStripeObject("payouts", ev.data.object);
          mirrorResult = { ...(mirrorResult ?? {}), payoutMirrored: true };
          // which charges are inside it (migration 0579) — a failure here never fails the webhook; the nightly reconcile retries
          try { await linkPayoutCharges(ev.data.object.id); mirrorResult.payoutLinked = true; }
          catch (err) { console.error("stripe mirror: payout charge link failed, continuing:", err?.message ?? err); }
        }
      } catch (err) {
        console.error("stripe mirror: payout upsert failed, continuing:", err?.message ?? err);
        mirrorResult = { ...(mirrorResult ?? {}), mirrored: false, reason: err?.message ?? String(err) };
      }
      await recordMirrorHealth({ webhook: true, failed: mirrorResult?.mirrored === false && !mirrorResult?.benign });
    }

    let result;
    try {
      result = await handleWebhook(
        { provider, rawBody, headers, externalRefFrom: EXTERNAL_REF[provider],
          directTenantIdFrom: DIRECT_TENANT_ID[provider] },
        async (tx, { body, tenantId }) => {
          if (provider !== "stripe") return handleEmailWebhook(tx, body, { tenantId });
          // ★ Stripe is the money record. A VERIFIED Stripe event may update a protected real client's
          //   rows (migration 0500) — his payment must still mark his invoice paid.
          await tx.query(`SELECT set_config('keystone.protected_write_reason', 'stripe_mirror', true)`);
          // ★ Part 29 follow-up (item 5): a self-hosted Docustay purchase (stamped docustay_kind = selfhost) makes / extends / ends a licence key; nothing else about it is a practice's payment
          if (isSelfhostEvent(body)) return { ...(await applySelfhostEvent(tx, body, { tenantId })), stripe_mirror: mirrorResult };
          // ★ Account-level events (body.account present) route via asPracticeOwner to ensure
          //   the practice owner's permissions apply when processing connected account events.
          // ★ Part 30 item 11 — two Connect events belong to a Docustay workspace's own Stripe account: a Checkout Session that completed (a payment field paid — the event is only a prompt; the Session is re-read from Stripe and
          //   recorded once) and account.application.deauthorized (the person disconnected Docustay from their own Stripe dashboard). Anything that is not one of those falls through to the practice payment handler as before.
          if (body?.account && String(body?.type ?? "").startsWith("checkout.session.") && body?.data?.object?.id) {
            if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(body.type)) {
              const d = await asPracticeOwner(tx, tenantId, () => recordCheckoutCompleted(tx, { tenantId, sessionId: body.data.object.id }));
              if (d.reason !== "not_a_document_payment") return { ...d, stripe_mirror: mirrorResult };
            }
            // a Docustay workspace has no bookings or invoices to mirror: any other checkout event (an unknown session, an expired one — the signer's page notices expiry itself) is acknowledged, not handed to the practice payment handler
            const { rows: [tn] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
            if (tn?.product === "docustay") return { applied: false, reason: "not_a_document_payment_event", stripe_mirror: mirrorResult };
          }
          // a repeating payment (installments, a subscription) on a document: Stripe's own invoice and subscription events are prompts to re-read the subscription; anything that is not one of ours falls through as before
          if (/^(invoice\.(paid|payment_failed)|customer\.subscription\.(updated|deleted))$/.test(String(body?.type ?? ""))) {
            const obj = body?.data?.object; const subId = String(body.type).startsWith("invoice.") ? obj?.subscription : obj?.id;
            if (typeof subId === "string" && subId) { const d = await asPracticeOwner(tx, tenantId, () => recordSubscriptionEvent(tx, { tenantId, subscriptionId: subId })); if (d.reason !== "not_a_document_payment") return { ...d, stripe_mirror: mirrorResult }; }
          }
          // 21 Oct 2026 (payments screen): a payout to a Docustay workspace's bank paid or failed. The Activity list records it; a failure emails the Owners.
          if (body?.account && /^payout\.(paid|failed)$/.test(String(body?.type ?? "")) && body?.data?.object?.id) {
            const { rows: [tn] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
            if (tn?.product === "docustay") { const d = await asPracticeOwner(tx, tenantId, async () => (await import("../product/docustayStripeNotices.mjs")).onPayoutEvent(tx, { tenantId, type: body.type, payout: body.data.object })); return { ...d, reason: d.reason ?? "payout_recorded", stripe_mirror: mirrorResult }; }
          }
          // 21 Oct 2026 (pricing integrity, decision 8): a dispute on a payment for a Docustay PLAN (platform account, no `account` field): a LOST one pauses the workspace and tells the Owners
          if (!body?.account && /^charge\.dispute\./.test(String(body?.type ?? "")) && body?.data?.object?.id) {
            const { rows: [tn] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
            if (tn?.product === "docustay") return { ...(await (await import("../product/docustayDisputes.mjs")).onPlanPaymentDispute(tx, { tenantId, type: body.type, dispute: body.data.object })), stripe_mirror: mirrorResult };
          }
          // Run 9 Part 3.7 (Pay3): a dispute on a document payment — re-read from Stripe and shown; disputes are answered in Stripe. Anything not ours falls through to the practice handler as before.
          if (body?.account && /^charge\.dispute\.(created|updated|closed|funds_withdrawn|funds_reinstated)$/.test(String(body?.type ?? "")) && typeof body?.data?.object?.id === "string") {
            const d = await asPracticeOwner(tx, tenantId, () => recordDisputeEvent(tx, { tenantId, disputeId: body.data.object.id, intentHint: typeof body.data.object.payment_intent === "string" ? body.data.object.payment_intent : null }));
            if (d.reason !== "not_a_document_payment" && body.type === "charge.dispute.created") { try { await asPracticeOwner(tx, tenantId, async () => (await import("../product/docustayStripeNotices.mjs")).onDisputeOpened(tx, { tenantId, dispute: body.data.object })); } catch { /* the email never fails the webhook */ } }
            if (d.reason !== "not_a_document_payment") return { ...d, stripe_mirror: mirrorResult };
          }
          // R13-D539: a declined card on a document payment leaves a failed mark on its payment row (the intent metadata names the party)
          if (body?.account && body?.type === "payment_intent.payment_failed" && body?.data?.object?.metadata?.docustay_party) {
            const pi = body.data.object;
            const d = await asPracticeOwner(tx, tenantId, () => recordPaymentFailed(tx, { tenantId, partyId: pi.metadata.docustay_party, instanceId: pi.metadata.instanceId ?? null, message: pi.last_payment_error?.message ?? null }));
            if (d.reason !== "not_a_document_payment") return { ...d, stripe_mirror: mirrorResult };
          }
          // Run 9 Part 3.7: Stripe attaches a charge's balance transaction (its fee) after the payment; charge.updated is the prompt to re-read the Session and record the fee Stripe gives.
          // Only a charge on one of our document payments with its fee still unknown costs a Stripe call; anything else falls through as before.
          if (body?.account && body?.type === "charge.updated" && typeof body?.data?.object?.payment_intent === "string") {
            const n = await asPracticeOwner(tx, tenantId, () => refreshStripeFees(tx, { tenantId, intentId: body.data.object.payment_intent }));
            if (n) return { applied: true, reason: "stripe_fee_recorded", stripe_mirror: mirrorResult };
          }
          // a Docustay workspace's connected account changed (the person finished or left hosted onboarding, Stripe asked for more, or switched charges off): the event is only a prompt — the account is re-read from Stripe and that is recorded
          if (body?.account && body?.type === "account.updated") {
            const { rows: [tn] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
            if (tn?.product === "docustay") {
              const owner = await practiceOwnerId(tx, tenantId);
              const d = await asPracticeOwner(tx, tenantId, () => onAccountUpdated(tx, { tenantId, accountId: body.account, actorUserId: owner }));
              return { ...d, stripe_mirror: mirrorResult };
            }
          }
          if (body?.account && body?.type === "account.application.deauthorized") {
            const owner = await practiceOwnerId(tx, tenantId);
            const d = await asPracticeOwner(tx, tenantId, () => onDeauthorized(tx, { tenantId, accountId: body.account, actorUserId: owner }));
            if (d.reason !== "not_the_connected_account") return { ...d, stripe_mirror: mirrorResult };
          }
          if (body?.account) {
            const r = await asPracticeOwner(tx, tenantId, () => handlePaymentWebhook(tx, body, { tenantId }));
            const credits = await grantCreditsForPaidInvoice(tx, body, tenantId);
            return { ...r, stripe_mirror: mirrorResult, ...(credits ? { credits } : {}) };
          }
          // ★ Task 6.5 — two Stripe event families share this one verified-and-resolved door:
          //   payment events (existing) and the platform's own subscription-lifecycle events (new).
          //   Chosen by `body.type`, never by a second route.
          // ★ Part 29 (A2): three events are ALSO a Docustay workspace's own billing. Ask the subscription mirror first; it answers "not a Docustay workspace" for every practice, and the payment handler runs as before.
          let r = SUBSCRIPTION_EVENTS.includes(body?.type) ? await handleSubscriptionWebhook(tx, body, { tenantId }) : null;
          if (!r && DOCUSTAY_SHARED_EVENTS.includes(body?.type)) {
            const d = await handleSubscriptionWebhook(tx, body, { tenantId });
            r = d.reason === "not_a_docustay_workspace" ? null : d;
          }
          if (!r) r = await asPracticeOwner(tx, tenantId, () => handlePaymentWebhook(tx, body, { tenantId }));
          const credits = await grantCreditsForPaidInvoice(tx, body, tenantId);
          return { ...r, stripe_mirror: mirrorResult, ...(credits ? { credits } : {}) };
        });
    } catch (err) {
      // An event the platform has NO business logic for (it only feeds the mirror) and whose practice
      // cannot be resolved is a success, not a 401: the mirror above already took it.
      if (provider === "stripe" && err?.name === "NoTenantContext") {
        let type = null;
        try { type = JSON.parse(rawBody)?.type ?? null; } catch { /* verified already */ }
        if (!HANDLED_EVENTS.includes(type) && !SUBSCRIPTION_EVENTS.includes(type)) {
          return c.json({ ok: true, provider, applied: false, reason: "mirror_only_no_tenant", type, stripe_mirror: mirrorResult });
        }
      }
      // ★ Stripe (Run 6): ONE Stripe account serves several products and has test customers of its own. A verified event for a customer this app never mapped, that carries none of OUR tenant stamps
      //   (`workbench_tenant_id` / `keystone_tenant_id` in its metadata), is somebody else's: acknowledged (200), because a 401 makes Stripe retry for three days and then switch the endpoint off. An event
      //   that DOES carry our stamp but whose customer is not linked yet (the checkout's own event arriving first) keeps the 401, so Stripe retries it after the link exists.
      if (provider === "stripe" && err?.name === "NoTenantContext" && !/(workbench|keystone)_tenant_id/.test(rawBody)) {
        let type = null;
        try { type = JSON.parse(rawBody)?.type ?? null; } catch { /* verified already */ }
        return c.json({ ok: true, provider, applied: false, reason: "not_a_workspace_customer", type, stripe_mirror: mirrorResult });
      }
      // ★ Resend (7 Oct 2026): ONE Resend account sends for several products (Docustay, the Docustay site, the platform), and Resend delivers every event to every endpoint.
      //   A verified event for a message the platform did not send has no tenant, by design. It is acknowledged (200), not refused: a 401 made Resend retry it for days.
      if (provider === "resend" && err?.name === "NoTenantContext") {
        let type = null;
        try { type = JSON.parse(rawBody)?.type ?? null; } catch { /* verified already */ }
        return c.json({ ok: true, provider, applied: false, reason: "not_a_workbench_message", type });
      }
      throw err;
    }

    // ★ 200 with a body describing what was done. A vendor reads the STATUS to decide whether to
    //   retry, so an event we deliberately ignored must not look like a failure.
    return c.json({ ok: true, provider, ...result });
  });
}
