// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.053.T2 — PaymentLinks › PaymentLinksPaymentLinksTable2Table: the populated data table
// Ported from webui/src/lib/screens/money/PaymentLinks.svelte:222-336
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function PaymentLinksPaymentLinksTable2Table({
  onNavigate = null,
  links = [],
  createVariant = "plain",
  formatMoney = null,
  formatMoneyLong = null,
  openCreate = null,
  rowActions = null,
  copyToClipboard = null,
}) {
  return (
    <LedgerPage
      title="Payment links"
      summary="A link that takes money. Put it anywhere — a text, a bio, a poster."
      primary={{ label: "New link", onClick: openCreate }}
      onNavigate={onNavigate}
    >
      {/* Table */}
      <div className="mb-7.5 rounded-lg border border-line bg-surface overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-neutral-50">
            <tr>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                What it's for
              </th>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                Amount
              </th>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                Used
              </th>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                Taken
              </th>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                Link
              </th>
              <th className="h-9.5 px-4 py-0 text-left font-medium text-xs text-mute border-b border-line">
                State
              </th>
              <th className="h-9.5 px-4 py-0"></th>
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr
                key={row.id}
                data-testid="payment-link-row"
                data-id={row.id}
                className={row.state === "inactive" ? "opacity-70" : ""}
              >
                <td className="h-11.5 px-4 py-0 border-b border-hair font-medium text-sm">
                  {row.title}
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair tabular-nums text-sm text-ink">
                  {formatMoneyLong?.(row.amountMinor) ?? "—"}
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair tabular-nums text-sm text-ink">
                  {row.uses ?? 0}
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair tabular-nums text-sm text-ink">
                  {formatMoney?.(row.takenMinor) ?? "—"}
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair text-sm">
                  {row.stripeUrl ? (
                    <button
                      type="button"
                      className="text-brand hover:underline cursor-pointer bg-none border-none p-0 text-sm"
                      onClick={() => copyToClipboard?.(row.stripeUrl)}
                      data-testid={`payment-link-copy-${row.id}`}
                      title="Copy link to clipboard"
                    >
                      {row.stripeUrl}
                    </button>
                  ) : (
                    <span className="text-mute text-xs">
                      Can't take payments yet — charges are switched off
                    </span>
                  )}
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair text-sm">
                  <StatusBadge
                    label={row.state === "active" ? "Live" : "Ended"}
                    tone={row.state === "active" ? "ok" : "neutral"}
                  />
                </td>
                <td className="h-11.5 px-4 py-0 border-b border-hair">
                  <RowActions actions={rowActions?.(row) ?? []} row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* What a link can do section */}
      <div className="flex gap-5.5 align-start">
        <div className="flex-1 min-w-0">
          <div className="mb-4.5 rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
              <b className="text-sm font-semibold flex-1">What a link can do</b>
            </div>
            <div className="px-4.25 py-3.5">
              <div className="flex flex-col gap-0 border-b border-hair last:border-b-0">
                <div className="flex items-start gap-3 py-2.75">
                  <span className="flex-1">
                    <div className="text-sm">Ask for a document to be signed first</div>
                    <span className="text-xs text-mute block mt-1">They sign, then they pay, in one go.</span>
                  </span>
                  <DisabledWithReason
                    disabled={true}
                    reason="Feature coming soon"
                    testId="payment-links-capability-sign-first"
                  >
                    {({ disabled }) => (
                      <Button size="sm" variant="outline" disabled={disabled}>
                        Add
                      </Button>
                    )}
                  </DisabledWithReason>
                </div>
              </div>

              <div className="flex flex-col gap-0 border-b border-hair last:border-b-0">
                <div className="flex items-start gap-3 py-2.75">
                  <span className="flex-1">
                    <div className="text-sm">Book a session at the same time</div>
                    <span className="text-xs text-mute block mt-1">Payment and a time in the calendar, together.</span>
                  </span>
                  <DisabledWithReason
                    disabled={true}
                    reason="Feature coming soon"
                    testId="payment-links-capability-book-with"
                  >
                    {({ disabled }) => (
                      <Button size="sm" variant="outline" disabled={disabled}>
                        Add
                      </Button>
                    )}
                  </DisabledWithReason>
                </div>
              </div>

              <div className="flex flex-col gap-0 border-b border-hair last:border-b-0">
                <div className="flex items-start gap-3 py-2.75">
                  <span className="flex-1">
                    <div className="text-sm">Let them pick the amount</div>
                    <span className="text-xs text-mute block mt-1">For a deposit or a top-up.</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      openCreate?.();
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-80 flex-shrink-0">
          <div className="mb-4.5 rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
              <b className="text-sm font-semibold">Where they're being used</b>
            </div>
            <div className="px-4.25 py-3.5">
              <div className="text-sm text-mute">We'll show where people found each link once they've been used.</div>
            </div>
          </div>
        </div>
      </div>
    </LedgerPage>
  );
}
