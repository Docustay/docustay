// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyPayoutsPayoutsTable — The payouts table component. Ported from
// webui/src/lib/screens/money/MoneyPayouts.svelte:73-117 (the LedgerPage element and its contents).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import PayoutRow from "@/lib/money/PayoutRow.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function MoneyPayoutsPayoutsTable({
  payouts = [],
  handleSeeInside = null,
  summaryText = "",
  bulk = null,
}) {
  return (
    <LedgerPage
      title="Payouts"
      summary={summaryText}
    >
      {payouts.length > 0 ? (
        <div className="flex flex-col gap-4.5">
          {bulk?.bulkBar}
          <div className="overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <BulkHeadCell bulk={bulk} rows={payouts} />
                  <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Amount
                  </th>
                  <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Landing
                  </th>
                  <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Payments
                  </th>
                  <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    How it went
                  </th>
                  <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"></th>
                  {bulk?.selectable ? <RowMenuHeadCell bulk={bulk} /> : <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"></th>}
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <PayoutRow
                    key={payout.id}
                    payout={payout}
                    onSeeInside={handleSeeInside}
                    bulk={bulk}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-card border border-line bg-brand-soft px-4 py-2.75 text-ui text-brand">
            <p className="m-0 mb-1 font-medium">
              Every payout matches one line on your bank statement.
            </p>
            <p className="m-0">
              If your bookkeeper ever asks what a deposit was, open the payout
              and it lists every payment inside it.
            </p>
          </div>

        </div>
      ) : null}
    </LedgerPage>
  );
}
