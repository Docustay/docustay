// @ts-check
// No-show/late-cancel merge brief, 1 Oct 2026 — THE ONE GUARD BOTH CHARGE PATHS SHARE.
//
// ★★★ WHY THIS EXISTS: settleBooking.mjs (staff-interactive: credit → card → invoice → none) and
// noShow.mjs::raiseNoShowCharge (automatic, fired by a SEPARATE route that records an outcome with
// no payment decision at all — src/routes/bookingLifecycle.mjs) both react to the same booking
// reaching a chargeable state, with no shared knowledge of each other. Before this, the only
// idempotency check was "does an invoice line item already reference this booking" — which misses
// every CARD or CREDIT settlement, since neither creates a line item. A client settled by card
// through the modal could still be auto-invoiced a second time by the listener.
//
// ★ migration 0552 is the actual mechanism: `UNIQUE (tenant_id, booking_id, fee_type)` on
// `keystone.booking_fee_claim`. Whichever caller's INSERT lands first wins; Postgres's own
// uniqueness check is atomic, so two callers racing on the same commit cannot both succeed.

/**
 * Attempt to claim a (booking, fee type) pair. Returns true if this call is the one that gets to
 * charge — false if someone else (the other path, or a retried request) already claimed it, in
 * which case the caller must do nothing further: no charge, no invoice, no email.
 * @param tx a tenant-scoped transaction handle
 * @param {{tenantId: string, bookingId: string, feeType: "no_show"|"late_cancel", actorUserId?: string|null}} args
 * @returns {Promise<boolean>}
 */
export async function claimBookingFee(tx, { tenantId, bookingId, feeType, actorUserId = null }) {
  if (feeType !== "no_show" && feeType !== "late_cancel") {
    throw new Error(`claimBookingFee: feeType must be "no_show" or "late_cancel" — got ${JSON.stringify(feeType)}`);
  }
  // ★★★ FOUND LIVE, running this against a real test transaction: catching a 23505 from a plain
  //   INSERT is the WRONG pattern inside Postgres — a unique-violation ABORTS THE WHOLE
  //   TRANSACTION, not just the one statement, so every query after it on the same connection
  //   throws "current transaction is aborted" until a ROLLBACK, even though the error was caught
  //   in JavaScript. `ON CONFLICT ... DO NOTHING` never raises at all — the second caller's
  //   statement succeeds and simply inserts nothing, which is the correct, non-poisoning way to
  //   ask "did I win the race" inside a transaction other work still needs to run in.
  try {
    const { rows } = await tx.query(
      `INSERT INTO keystone.booking_fee_claim (tenant_id, booking_id, fee_type, claimed_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, booking_id, fee_type) DO NOTHING
       RETURNING id`,
      [tenantId, bookingId, feeType, actorUserId]
    );
    return rows.length > 0;
  } catch (e) {
    // ★★★ DEPLOY-ORDER SAFETY NET, 1 Oct 2026 — this code and migration 0552 (which creates this
    //   very table) are shipped together, but the HARD RULE for this project is migrations land
    //   through chat, separately, whenever the maintainer is next at his Mac — so this function can run against
    //   a database that does not have the table yet. `42P01` = undefined_table. Failing CLOSED
    //   (refuse to charge) rather than either throwing a 500 at a real staff member settling a real
    //   no-show, or silently falling back to the OLD unguarded behaviour this migration exists to
    //   retire. A charge delayed until the migration lands is recoverable; a double charge is not.
    if (e.code === "42P01") {
      console.error(
        `claimBookingFee: keystone.booking_fee_claim does not exist yet (migration 0552 not applied) — ` +
        `refusing to charge tenant=${tenantId} booking=${bookingId} feeType=${feeType} until it lands`
      );
      return false;
    }
    throw e;
  }
}
