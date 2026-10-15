// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PayoutDetailTable — the table/content as its own component
// Built from webui/src/lib/screens/money/PayoutDetail.svelte:133-319
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

function formatMoney(amountMinor, currency = "USD") {
  if (amountMinor == null) return "—";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amountMinor / 100);
}

export default function PayoutDetailTable({
  payout,
  reconcileRows,
  activeView,
  downloadCSV,
  views,
}) {
  if (!payout) return null;

  return (
    <div className="flex flex-col gap-6">
      {activeView === "detail" && (
        <div className="cols">
          <div className="colL">
            <div className="blk">
              <div className="blkh">
                <b>On your bank statement it reads</b>
              </div>
              <div className="blkb">
                <div className="font-mono text-ui text-ink-2 py-3.5">
                  {payout.statement}
                </div>
                <div className="text-meta text-mute leading-relaxed pb-1.5">
                  That reference is searchable here. Paste it in the search box and this screen comes up.
                </div>
              </div>
            </div>

            <div className="blk">
              <div className="blkh">
                <b>The {payout.payments.length} payments inside it</b>
              </div>
              <div className="blkb">
                {payout.payments.slice(0, 5).map((payment) => (
                  <div key={payment.id} className="li">
                    <span className="flex-1">
                      Payment #{payment.id.slice(-4)}
                      <span className="block text-caption text-mute mt-0.5">
                        Payment
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(payment.amountMinor)}
                    </span>
                  </div>
                ))}
                {payout.payments.length > 5 && (
                  <div className="li">
                    <span className="flex-1">
                      {payout.payments.length - 5} more
                      <span className="block text-caption text-mute mt-0.5">
                        Payments
                      </span>
                    </span>
                    <span className="tabular-nums"></span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="colR">
            <div className="blk">
              <div className="blkh">
                <b>How it added up</b>
              </div>
              <div className="blkb">
                <div className="li">
                  <span className="flex-1">
                    {payout.payments.length} payments
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(payout.reconciliation.grossMinor)}
                  </span>
                </div>
                <div className="li">
                  <span className="flex-1">Stripe fees</span>
                  <span className="tabular-nums">
                    −{formatMoney(payout.reconciliation.feesMinor)}
                  </span>
                </div>
                <div className="li">
                  <span className="flex-1">Workbench</span>
                  <span className="tabular-nums">
                    −$0.00
                  </span>
                </div>
                <div className="li border-t border-line pt-3">
                  <span className="flex-1">
                    <b>Landed</b>
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatMoney(payout.reconciliation.payoutMinor)}
                  </span>
                </div>
              </div>
            </div>

            <div className="blk">
              <div className="blkh">
                <b>Reconciliation</b>
              </div>
              <div className="blkb">
                <div className="li">
                  <span className="flex-1">Balances</span>
                  <span className="tabular-nums">
                    {payout.reconciliation.balances ? "✓" : "✗"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === "reconcile" && (
        <div className="flex flex-col gap-6">
          <div className="mb-4.5 flex gap-2.5 items-center rounded-bulk border border-[#E1DFFA] bg-[#F4F3FE] px-3.5 py-2.75 text-caption text-[#3B3A6B] leading-relaxed">
            <span>◯</span>
            <span>
              <b>This is the screen your accountant actually wants.</b> One deposit in your bank
              statement, and every payment inside it, with the fees. Most software makes them work this
              out themselves.
            </span>
          </div>

          <div className="cols">
            <div className="colL">
              <div className="blk">
                <div className="blkh">
                  <b>What is inside this payout</b>
                </div>
                <div className="blkb">
                  {reconcileRows.map((row) => (
                    <div key={row.paymentId} className="li">
                      <span className="flex-1">
                        Payment #{row.paymentId.slice(-4)}
                        <span className="block text-caption text-mute mt-0.5">
                          Payment
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(row.grossMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="colR">
              <div className="blk">
                <div className="blkh">
                  <b>The arithmetic</b>
                </div>
                <div className="blkb">
                  <div className="li">
                    <span className="flex-1">
                      {reconcileRows.length} payments
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(
                        reconcileRows.reduce((sum, r) => sum + r.grossMinor, 0)
                      )}
                    </span>
                  </div>
                  <div className="li">
                    <span className="flex-1">Stripe fees</span>
                    <span className="tabular-nums">
                      −{formatMoney(
                        reconcileRows.reduce((sum, r) => sum + r.stripeFeeMinor, 0)
                      )}
                    </span>
                  </div>
                  <div className="li">
                    <span className="flex-1">Refunds</span>
                    <span className="tabular-nums">
                      −{formatMoney(
                        reconcileRows.reduce((sum, r) => sum + r.refundedMinor, 0)
                      )}
                    </span>
                  </div>
                  <div className="li border-t border-line pt-3">
                    <span className="flex-1">
                      <b>Lands in your bank</b>
                    </span>
                    <span className="tabular-nums font-medium">
                      {formatMoney(payout.reconciliation.payoutMinor)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="blk">
                <div className="blkh">
                  <b>For your books</b>
                </div>
                <div className="blkb">
                  <div className="li">
                    <span className="flex-1">
                      Matches one line on your statement
                    </span>
                    <span className="tabular-nums"></span>
                  </div>
                  <div className="li">
                    <span className="flex-1">Fees are an expense</span>
                    <span className="tabular-nums">
                      {formatMoney(
                        reconcileRows.reduce((sum, r) => sum + r.stripeFeeMinor, 0)
                      )}
                      on this payout
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Button onClick={downloadCSV}>Download CSV</Button>
            <DisabledWithReason
              disabled={true}
              reason="Accountant email settings not yet configured"
            >
              {({ disabled, describedBy }) => (
                <button
                  type="button"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className="inline-flex items-center justify-center gap-2 h-9.5 px-[17px] rounded-control font-medium text-ui border border-line bg-white text-ink-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send to my accountant
                </button>
              )}
            </DisabledWithReason>
          </div>
        </div>
      )}
    </div>
  );
}
