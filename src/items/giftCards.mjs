// Stage 14 task 14.25 — GIFT CARDS: issue, list (14.22), resend, nudge, void.
//
// ★★★ THE CODE IS A SECRET, ALWAYS. `keystone.gift_card.code_hash` (0415/14.8) is a peppered
//     HMAC — there is no plaintext column anywhere, in this database or this file. The ONLY two
//     places a code is ever readable in clear are (a) the object this module hands back to the
//     caller the moment it is minted, under the key `secret`, and (b) the outbound email that puts
//     it in front of the person who is meant to spend it. Neither path logs it, and `secret` is
//     already in `src/http/idempotency.mjs`'s frozen `NEVER_REPLAYED` set, so a replayed
//     Idempotency-Key never hands it back a second time — see `issueGiftCard`/`resendGiftCard`
//     below, which both return the code under that exact key and no other.
//
// ★★★ THE BALANCE IS A LEDGER, NOT A COLUMN. `keystone.gift_card` carries no balance/remaining
//     column (0415's own header) — every read of "how much is left" in this file is
//     `SUM(delta_minor)` over `keystone.gift_card_entry`, computed in SQL, never cached. `app_rw`
//     holds SELECT+INSERT only on that table (0415 grants) — nothing here ever UPDATEs or DELETEs
//     an entry; `voidGiftCard` below writes a NEW compensating `void` row, never touches an old one.
//     The overdraw refusal itself lives in the database (`gift_card_never_overdrawn`, 0415) under a
//     per-card `pg_advisory_xact_lock` — this file only turns that trigger's minor-unit message
//     into a person-facing one when a redemption path (Stage 15's 15.67, not this task) calls it.
//
// ★★★ CROSS-TASK GAPS, MEASURED, NOT GUESSED AROUND (same shape `src/items/catalogue.mjs`'s own
//     header already uses for its own topic gap — read that file's header for the precedent this
//     one follows):
//   1. `items.gift_card.sold`/`.voided`/`.nudged` are NOT YET in `src/events/topics.mjs`'s `items`
//      array as of this task [MEASURED: 0 hits for "gift_card" in topics.mjs]. Task 14.15 adds them.
//      Until it lands, every `emit()` call below throws `TopicViolation` ("not a known topic").
//   2. `"gift_card.manage"` is NOT YET in `src/permissions/assertMay.mjs`'s `NAMED_ACTIONS`
//      [MEASURED: 0 hits]. Task 14.15 adds it (alongside `"loyalty.manage"`, migration 0416 already
//      widened the database CHECK for both). Until it lands, `assertMay(db, principal, {object:
//      "item", action: "gift_card.manage"})` — called by every route in
//      `src/routes/itemsGiftCards.mjs` — throws a plain `Error` ("... is neither a NAMED_ACTIONS
//      member nor one of view/edit/delete"), not the 403 field 4/9 describe. Recorded, not
//      silently downgraded to a different action.
//   3. `"gift_card"` is NOT in `src/events/topics.mjs`'s `SUBJECT_TYPES`, and 14.15's own file list
//      (`STAGE-14-PLAN.md:877`) does not touch that export either — nobody's task adds it. Every
//      `emit()` call below therefore uses `subjectType: null, subjectId: null`, the same choice
//      `src/items/catalogue.mjs`'s `createCategory` makes for the identical reason (an ownerless
//      item family with no `SUBJECT_TYPES` entry of its own).
//   4. ★ FIX, 1 Oct 2026 (Part 2 Addition) — `resendGiftCard`'s "items.gift_card_resent" now has a
//      real registry entry (src/email/registry.mjs) and no longer throws. `nudgeGiftCard`'s
//      "items.gift_card.nudged" notification is STILL a real gap — not fixed in this pass, logged
//      as F849 (~/example-rebuild/FINDINGS-OPEN.md): it needs `balanceRemaining`/`link` computed and
//      threaded through TOPIC_TEMPLATE/emailFor(), which is a notification-vars design task, not a
//      "move the sender onto the registry" one. `items.gift_card.sold`/`.voided` (issueGiftCard/
//      voidGiftCard, below) have NO email call at all today — also F849, same reason. The STATE
//      change each function makes (new code stored and returned as `secret`; `nudged_at` set; the
//      409s) is complete and correct today; only the outbound email for those three is not.

// @ts-check
import { randomBytes } from "node:crypto";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { hashSecret } from "../auth/linkToken.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
// ★ P8.1 — THE notification PATH, literally, for `nudgeGiftCard`'s "one email via the notification
//   path" (field 4). `createNotification` requires `recipientId` to be a real `app_user`
//   (`keystone.notification.recipient_id uuid NOT NULL REFERENCES keystone.app_user(id)`,
//   0016:94, M) — so this only reaches a holder/buyer who already has an account. See
//   `nudgeGiftCard`'s own comment for what happens when neither does.
import { createNotification } from "../notifications/writes.mjs";
// ★★ `resendGiftCard` has no topic to hang a notification off (field 3 GAP 1's topic list has no
//    "resent" entry — resend is a credential rotation, not a business fact worth History), and
//    field 4 does not say "notification path" for it as it does for nudge. So it sends directly,
//    the same low-level shape `src/email/authEmail.mjs`'s `sendAuthEmail` uses for the identical
//    reason that function gives in its own header: the recipient "may not have" an app_user account
//    at all — a gift card `holderEmail` is exactly that case (field 9's own acceptance scenario
//    issues a card with `holderEmail` and no `holder_user_id`).
import { renderTemplate } from "../email/templates.mjs";
import { deliverAsOrganisation } from "../email/deliver.mjs";

const SECTION = "items";
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

/** ★ Crockford base32 — no I, L, O or U, the same alphabet `src/auth/linkToken.mjs:90` uses for the
 *   same reason (an operator reading a code aloud must never trip over a look-alike character). Not
 *   imported from there: that file does not export its alphabet (by design — see its own header on
 *   why the presented shape is pinned), so this is a second, independent constant, not a copy of a
 *   shared one. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 16 chars, rejection-free (32 is a power of two — masking 5 bits is uniform), 80 bits of entropy. */
function randomCode(len = 16) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i] & 31];
  return out;
}

function formatNumber(n) {
  return `GC-${String(n).padStart(4, "0")}`;
}

/**
 * ★ THE SAME ADVISORY-LOCK IDIOM `src/money/invoiceNumbers.mjs` uses for invoice numbers
 *   (`lockKeyFor`/`nextInvoiceNumber`, M) — and, closer still, the EXACT SQL expression 0415's own
 *   `gift_card_never_overdrawn` trigger uses to turn a uuid into a lock key
 *   (`db/migrations/0415_gift_card.sql:126-128`), reused here keyed on the TENANT rather than the
 *   card, because allocating `number` is a per-tenant sequence, not a per-card one. Transaction-
 *   scoped: released at COMMIT/ROLLBACK, no unlock call to strand.
 */
async function lockTenantForNumbering(tx, tenantId) {
  await tx.query(
    `SELECT pg_advisory_xact_lock(('x' || substr(replace($1::text, '-', ''), 1, 15))::bit(60)::bigint)`,
    [tenantId]);
}

async function nextGiftCardNumber(tx, tenantId) {
  await lockTenantForNumbering(tx, tenantId);
  const { rows } = await tx.query(
    `SELECT coalesce(max(number), 0) + 1 AS next FROM keystone.gift_card WHERE tenant_id = $1`,
    [tenantId]);
  return rows[0].next;
}

/** ★ G16 — `giftcards.expiry_months` is `writeLocked` (`src/settings/keys.mjs:459-464`) and
 *   therefore always reads back `null` today; this still computes a real expiry the day that lock
 *   lifts, in SQL, never in JS, the same reasoning `invoiceNumbers.mjs`'s header gives for reading
 *   the practice's own year in SQL rather than trusting `new Date()`'s host timezone. */
async function expiryFor(tx, months) {
  if (months === null || months === undefined) return null;
  const { rows } = await tx.query(`SELECT (now() + ($1 || ' months')::interval) AS expires_at`, [months]);
  return rows[0].expires_at;
}

/**
 * ★★★ ISSUE. `issueGiftCard(tx,{tenantId,amountMinor,currency,holderEmail?,buyerUserId?,actorUserId})`
 * → `{id, number: 'GC-0001', secret: <code>}` — the ONLY response that ever carries the code.
 */
export async function issueGiftCard(tx, {
  tenantId, amountMinor, currency, holderEmail = null, buyerUserId = null, actorUserId = null,
}) {
  const enabled = await getSetting(tx, "giftcards.enabled", false);
  if (enabled !== true) throw conflict("Gift cards are off. Turn them on first.");

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw invalid("amountMinor must be a whole number greater than zero");
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    throw invalid("currency must be a 3-letter code");
  }
  if (holderEmail !== null) {
    if (typeof holderEmail !== "string" || !holderEmail.trim().includes("@")) {
      throw invalid("holderEmail must be an email address");
    }
  }
  const currencyCode = currency.toUpperCase();

  const number = await nextGiftCardNumber(tx, tenantId);
  const code = randomCode(16);
  const codeHash = hashSecret(code);
  const expiryMonths = await getSetting(tx, "giftcards.expiry_months", null);
  const expiresAt = await expiryFor(tx, expiryMonths);

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.gift_card")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        number: number ?? null,
        code_hash: codeHash ?? null,
        buyer_user_id: buyerUserId ?? null,
        holder_email: holderEmail?.trim() ?? null,
        issued_minor: amountMinor ?? null,
        currency: currencyCode ?? null,
        expires_at: expiresAt ?? null,
      }));
  } catch (e) {
    if (e.code === FK_VIOLATION) throw notFound("the buyer does not exist in this organisation");
    if (e.code === UNIQUE_VIOLATION) throw new Error("gift card code or number collided — retry the request");
    throw e;
  }

  await tx.query(
    `INSERT INTO keystone.gift_card_entry (tenant_id, gift_card_id, delta_minor, kind, created_by)
     VALUES ($1,$2,$3,'issue',$4)`,
    [tenantId, id, amountMinor, actorUserId]);

  await emit(tx, {
    tenantId, topic: "items.gift_card.sold", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, number, issued_minor: amountMinor, currency: currencyCode },
  });

  return { id, number: formatNumber(number), secret: code };
}

/** Look up a card plus its current running balance and whether it has ever been redeemed from. */
async function loadCardWithBalance(tx, tenantId, id) {
  const { rows } = await tx.query(
    `SELECT gc.id, gc.number, gc.voided_at, gc.holder_email, gc.buyer_user_id, gc.holder_user_id,
            gc.nudged_at,
            coalesce(sum(ge.delta_minor), 0) AS balance,
            count(*) FILTER (WHERE ge.kind = 'redeem') AS redeem_count
       FROM keystone.gift_card gc
       LEFT JOIN keystone.gift_card_entry ge ON ge.tenant_id = gc.tenant_id AND ge.gift_card_id = gc.id
      WHERE gc.tenant_id = $1 AND gc.id = $2
      GROUP BY gc.id, gc.number, gc.voided_at, gc.holder_email, gc.buyer_user_id, gc.holder_user_id, gc.nudged_at`,
    [tenantId, id]);
  if (rows.length === 0) throw notFound("no such gift card in this organisation");
  return rows[0];
}

/**
 * ★★★ VOID. 409 "Half of it's been used — you can't void what's spent." (the frame's sentence,
 * verbatim) when any `redeem` entry exists; else a `void` entry of −remaining and `voided_at`.
 */
export async function voidGiftCard(tx, { tenantId, id, actorUserId = null }) {
  const card = await loadCardWithBalance(tx, tenantId, id);

  // ★ Not in field 4's text, but needed so a second void does not try to insert a $0 entry and hit
  //   `gift_card_entry`'s `CHECK (delta_minor <> 0)` as a raw constraint-violation 500 — the same
  //   "zero rows is 404, not success" discipline `catalogue.mjs`'s `deleteCategory` documents, here
  //   applied to "already voided" instead.
  if (card.voided_at) throw conflict("Already voided.");

  if (Number(card.redeem_count) > 0) {
    throw conflict("Half of it's been used — you can't void what's spent.");
  }

  const remaining = Number(card.balance);
  await tx.query(
    `INSERT INTO keystone.gift_card_entry (tenant_id, gift_card_id, delta_minor, kind, created_by)
     VALUES ($1,$2,$3,'void',$4)`,
    [tenantId, id, -remaining, actorUserId]);

  const { rows } = await run(tx, db
    .updateTable("keystone.gift_card")
    .set({ voided_at: sql`now()`, voided_by: actorUserId ?? null })
    .where("tenant_id", "=", tenantId ?? null)
    .where("id", "=", id)
    .returning(["voided_at"]));

  await emit(tx, {
    tenantId, topic: "items.gift_card.voided", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, number: card.number, voided_minor: remaining },
  });

  return { id, voided_at: rows[0].voided_at };
}

/**
 * ★ Best-effort resolve an email to reach a card's holder: the `holder_email` column, falling back
 *   to the buyer's own account email when only a `buyer_user_id` was given at issue (self-gifting).
 */
async function holderEmailFor(tx, tenantId, card) {
  if (card.holder_email) return card.holder_email;
  if (card.buyer_user_id) {
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["email"])
      .where("tenant_id", "=", tenantId ?? null)
      .where("id", "=", card.buyer_user_id ?? null));
    return rows[0]?.email ?? null;
  }
  return null;
}

/**
 * ★ THE DIRECT SEND. Same shape as `sendAuthEmail` (`src/email/authEmail.mjs:31`) for the same
 *   reason that function gives: the recipient may have no `app_user` row for `sendNotificationEmail`
 *   to hang a `notification_delivery` row off. Never throws on a provider or configuration failure —
 *   resolves a status instead, exactly like `sendAuthEmail` does, so a down provider never blocks the
 *   credential rotation this sits behind. ★★★ `vars` carries the code; nothing here logs `vars`.
 */
async function sendGiftCardEmail({ to, templateKey, vars, tx, tenantId }, { fetchImpl, env = process.env } = {}) {
  if (!to) return { status: "skipped", providerMessageId: null, error: "no email address on file" };

  // ★ PART 2 ADDITION — tx/tenantId forwarded to renderTemplate's `resolve` param when given, same
  //   pattern as sendAuthEmail's own F844 fix, so a tenant's Run → Templates override wins.
  const rendered = await renderTemplate(templateKey, vars, {}, tx && tenantId ? { tx, tenantId } : {});

  const out = await deliverAsOrganisation(tx ?? null, { tenantId: tenantId ?? null, to, subject: rendered.subject, text: rendered.text }, { fetchImpl, env });
  if (out.status === "skipped") console.warn(`sendGiftCardEmail: not sent "${templateKey}" — ${out.error}`);
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}

/**
 * ★★★ RESEND. "Cannot resend a code it does not hold" — `code_hash` is peppered, so the practice
 * never has the original code to resend. It mints a NEW code (the old one becomes unverifiable the
 * instant `code_hash` is overwritten) and emails the new one to the holder. Returns the new code as
 * `secret`, same as `issueGiftCard` — the ONLY two responses that ever carry one.
 */
export async function resendGiftCard(tx, { tenantId, id, actorUserId = null }, { fetchImpl } = {}) {
  const card = await loadCardWithBalance(tx, tenantId, id);

  const code = randomCode(16);
  const codeHash = hashSecret(code);
  await run(tx, db
    .updateTable("keystone.gift_card")
    .set({ code_hash: codeHash ?? null })
    .where("tenant_id", "=", tenantId ?? null)
    .where("id", "=", id));

  const to = await holderEmailFor(tx, tenantId, card);
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — GAP 4 (this file's header) closed: "items.gift_card_resent"
  //   now has a real registry entry (src/email/registry.mjs), so this no longer throws. Also fixed
  //   while touching this call: `card.number` is the raw integer — every other reader of a gift
  //   card number (issueGiftCard's own return, below) goes through `formatNumber` first; this was
  //   the one place that didn't.
  const practiceName = (await getSetting(tx, "practice.name", null)) ||
    (await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId])).rows[0]?.name || "";
  await sendGiftCardEmail(
    { to, templateKey: "items.gift_card_resent",
      vars: { practiceName, number: formatNumber(card.number), code }, tx, tenantId },
    { fetchImpl });

  return { id, secret: code };
}

/**
 * ★★★ NUDGE. "One email via the notification path" (field 4) — `createNotification`, literally.
 * 409 "Already nudged." if `nudged_at` is already set.
 *
 * ★ `createNotification` requires a real `app_user` recipient (`keystone.notification.recipient_id`,
 *   NOT NULL, 0016:94, M). A card issued through `issueGiftCard` above only ever carries
 *   `holder_user_id`/`buyer_user_id` when one was actually linked to an account — a pure
 *   `holderEmail` card (field 9's own acceptance scenario) resolves NEITHER, and there is no
 *   `app_user` this path can reach. That case is recorded here, not silently worked around: the
 *   state change (`nudged_at`, the event) still happens either way, and the notification is skipped,
 *   never thrown, when no recipient resolves — the nudge itself must not fail because nobody could
 *   be told about it.
 */
export async function nudgeGiftCard(tx, { tenantId, id, actorUserId = null }) {
  const card = await loadCardWithBalance(tx, tenantId, id);
  if (card.nudged_at) throw conflict("Already nudged.");

  const { rows } = await run(tx, db
    .updateTable("keystone.gift_card")
    .set({ nudged_at: sql`now()` })
    .where("tenant_id", "=", tenantId ?? null)
    .where("id", "=", id)
    .returning(["nudged_at"]));

  const event = await emit(tx, {
    tenantId, topic: "items.gift_card.nudged", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, number: card.number },
  });

  const recipientId = card.holder_user_id ?? card.buyer_user_id ?? null;
  if (recipientId) {
    // ★ GAP 4 (this file's header) — "items.gift_card_nudge" has no template yet; renderTemplate
    //   (reached inside sendNotificationEmail, the queue job's own path — see this file's header)
    //   throws until one is added. `createNotification` itself only writes the row and fans the
    //   in-app/push channels out in THIS transaction; email is the queue job's separate door
    //   (`src/notifications/writes.mjs:100-102`, M) and is unaffected by that gap at write time.
    await createNotification(tx, {
      tenantId, recipientId, eventId: event.id, topic: "items.gift_card.nudged",
      title: "Your gift card is waiting",
    });
  }

  return { id, nudged_at: rows[0].nudged_at };
}

/**
 * ★★★ READ: `GET /api/items/gift-cards/summary` → `{ enabled, sold_year_minor, sold_year_count,
 * unspent_minor, unspent_holders, never_opened_minor }`.
 */
export async function giftCardSummary(tx, { tenantId }) {
  const enabled = await getSetting(tx, "giftcards.enabled", false);

  const { rows } = await tx.query(
    `WITH balances AS (
       SELECT gc.id, gc.created_at, gc.opened_at, gc.voided_at, gc.issued_minor,
              coalesce(sum(ge.delta_minor), 0) AS balance
         FROM keystone.gift_card gc
         LEFT JOIN keystone.gift_card_entry ge
           ON ge.tenant_id = gc.tenant_id AND ge.gift_card_id = gc.id
        WHERE gc.tenant_id = $1
        GROUP BY gc.id, gc.created_at, gc.opened_at, gc.voided_at, gc.issued_minor
     )
     SELECT
       coalesce(sum(issued_minor) FILTER (
         WHERE created_at >= date_trunc('year', now()) AND created_at < date_trunc('year', now()) + interval '1 year'
       ), 0) AS sold_year_minor,
       count(*) FILTER (
         WHERE created_at >= date_trunc('year', now()) AND created_at < date_trunc('year', now()) + interval '1 year'
       ) AS sold_year_count,
       coalesce(sum(balance) FILTER (WHERE voided_at IS NULL AND balance > 0), 0) AS unspent_minor,
       count(*) FILTER (WHERE voided_at IS NULL AND balance > 0) AS unspent_holders,
       coalesce(sum(balance) FILTER (WHERE voided_at IS NULL AND opened_at IS NULL), 0) AS never_opened_minor
     FROM balances`,
    [tenantId]);

  const r = rows[0];
  return {
    enabled: enabled === true,
    sold_year_minor: Number(r.sold_year_minor),
    sold_year_count: Number(r.sold_year_count),
    unspent_minor: Number(r.unspent_minor),
    unspent_holders: Number(r.unspent_holders),
    never_opened_minor: Number(r.never_opened_minor),
  };
}
