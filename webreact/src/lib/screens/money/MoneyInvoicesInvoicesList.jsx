// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › INVOICES › LIST — R6.043.T1
// Subtask: the invoices list component with table, empty states, and summary stats.
// Built from webui/src/lib/screens/money/MoneyInvoices.svelte:177-305
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ProgramFilter from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import { usePrograms } from "@/lib/programs/programs.js";

export default function MoneyInvoicesInvoicesList({
  onNavigate,
  invoices,
  summary,
  stripeConnected,
  activeView,
  views,
  onView,
  programFilter = "all",
  onProgramFilter = () => {},
  computeSummaryText,
  formatMoney,
  formatMoneyWithCents,
  getStatusClass,
  getStatusText,
  formatDate,
  handleNewInvoice,
  handleConnectStripe,
  handleWriteToPayerMessage,
  filteredInvoices,
}) {
  const { programs } = usePrograms();
  return (
    <LedgerPage
      title="Invoices"
      summary={computeSummaryText()}
      primary={{ label: "New invoice", onClick: handleNewInvoice }}
      views={views}
      activeView={activeView}
      onView={onView}
      controls={invoices.length > 0 && programs.length >= 2
        ? <ProgramFilter value={programFilter} onChange={onProgramFilter} testId="invoices-filter-program" />
        : null}
      testId="invoices-list"
    >
      {invoices.length === 0 ? (
        // Empty states
        stripeConnected ? (
          // EmptyMoney: Stripe connected but no invoices
          <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
            <div className="text-lg font-medium text-ink">You haven't sent an invoice yet</div>
            <p className="mx-auto mt-1.75 max-w-[46ch] text-sm text-mute leading-relaxed">
              An invoice is how money gets asked for and how it gets tracked. It can go out on its
              own, or raise itself when someone books, signs an agreement or accepts an estimate.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-hair pt-5">
              <Button onClick={handleNewInvoice}>Send your first invoice</Button>
              <Button variant="ghost" onClick={() => onNavigate?.("/help/invoices")}>
                See how it works
              </Button>
            </div>
          </div>
        ) : (
          // EmptyMoneyNoStripe: No Stripe, no invoices
          <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
            <div className="text-lg font-medium text-ink">Connect Stripe before you send anything</div>
            <p className="mx-auto mt-1.75 max-w-[46ch] text-sm text-mute leading-relaxed">
              Without it an invoice is a piece of paper — there's no way for anyone to pay it, and
              no way for you to be told when they do. It takes about five minutes and you need your
              bank details.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-hair pt-5">
              <Button onClick={handleConnectStripe}>Connect Stripe</Button>
              <Button variant="ghost" onClick={handleNewInvoice}>
                Write one anyway, and send it later
              </Button>
            </div>
          </div>
        )
      ) : (
        <>
          {/* Figures strip: waiting · late · average days */}
          <div className="mb-5 flex gap-0 overflow-hidden rounded-card border border-line bg-surface">
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <Figure size="lg">${formatMoney(summary.outstandingMinor)}</Figure>
              <div className="mt-1.75 text-sm text-mute">waiting to be paid</div>
              <div className="mt-1.25 text-xs text-ink-2">
                Across {summary.outstandingCount} invoice{summary.outstandingCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <Figure size="lg">${formatMoney(summary.lateMinor)}</Figure>
              <div className="mt-1.75 text-sm text-mute">more than ten days late</div>
              {summary.lateNamed && (
                <div className="mt-1.25 text-xs text-bad">{summary.lateNamed.name}</div>
              )}
            </div>
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <Figure size="lg">{summary.avgDaysToPaid ?? "—"} days</Figure>
              <div className="mt-1.75 text-sm text-mute">average time to get paid</div>
              {summary.termsDays && (
                <div className="mt-1.25 text-xs text-ok">Terms are {summary.termsDays}</div>
              )}
            </div>
          </div>

          {/* Invoices table */}
          <div className="mb-5 overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Number
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Who
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    What for
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Amount
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Due
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    State
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Program
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute" />
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="h-11.5 cursor-pointer border-b border-hair hover:bg-brand-soft last:[&>td]:border-b-0"
                    // ★ the maintainer, 29 Sep 2026 — F818: every row, draft or not, used to go to the read-only
                    //   record page — which has no edit entry point at all. A draft has never been
                    //   sent, so there's nothing there to "record" yet; it goes to the SAME editor
                    //   surface "New invoice" opens, reopened onto this id (routes.js's `editId`).
                    onClick={() =>
                      onNavigate?.(
                        invoice.status === "draft"
                          ? `/money/invoices?new=1&editId=${invoice.id}`
                          : `/money/invoices/${invoice.id}`
                      )
                    }
                  >
                    <td className="border-b border-hair px-4 text-ui text-ink font-tabular">
                      {invoice.invoice_number}
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand text-sm font-medium">
                          {invoice.payer_initials ||
                            (invoice.payer || invoice.payer_name || invoice.payer_email || "?")
                              .split(/\s+/)
                              .map((w) => w[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                        </div>
                        {invoice.payer || invoice.payer_name || invoice.payer_email || "—"}
                      </div>
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink">
                      {invoice.title || "—"}
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink font-tabular">
                      ${formatMoneyWithCents(invoice.amount_minor)}
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink font-tabular">
                      {invoice.due_at ? formatDate(invoice.due_at) : "—"}
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink">
                      <StatusBadge label={getStatusText(invoice)} tone={getStatusClass(invoice.status)} />
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-ink">
                      <ProgramChips ids={invoice.program_ids} />
                    </td>
                    <td className="border-b border-hair px-4 text-ui text-row-action text-right">⋯</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Worth knowing prompt card */}
          {summary.fiveOpens && summary.fiveOpens.length > 0 && (
            <div className="mt-5">
              <div className="mb-3 text-sm font-medium text-ink">Worth knowing</div>
              <PromptCard
                icon="$"
                tone="bad"
                kind="invoice_opened_unpaid"
                headline={`${summary.fiveOpens[0].name} has opened invoice ${summary.fiveOpens[0].number} ${summary.fiveOpens[0].views} times without paying`}
                why="That usually means they intend to and something is in the way. A note asking tends to work better than another reminder."
                action={{
                  label: "Write to them",
                  onClick: () =>
                    handleWriteToPayerMessage(
                      summary.fiveOpens[0].invoiceId,
                      summary.fiveOpens[0].name
                    ),
                }}
              />
            </div>
          )}
        </>
      )}
    </LedgerPage>
  );
}
