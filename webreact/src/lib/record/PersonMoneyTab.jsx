// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.028 — PERSONMONEYTAB. Ported from `lib/record/PersonMoneyTab.svelte`.
// Renders: Owing / Paid / "What's owed in work" (left column) + "How they pay" (right column).
//
// ★★★ MOUNTED BY PARENT ONLY WHEN `money` EXISTS. Parent strips the `money` key at the QUERY
//     for a viewer without `invoice:view` — this component never re-derives that boundary and
//     takes `money` as a trusted prop. Defensively, an absent `money` still renders the tab's
//     own empty state rather than throwing.
//
// ★ REMIND — /api/money/invoices/*/remind DOES NOT EXIST (F804). The button always renders
//   and stays permanently DISABLED until the parent supplies `onRemindInvoice`, which lets the
//   parent wire it the moment the route exists, without another edit to this file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Progress } from "@/lib/components/ui/progress.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function PersonMoneyTab({ money = null, error = null, onRemindInvoice = null, testId = "person-money-tab" }) {
  const owing = money?.owing ?? [];
  const paidRows = money?.paidRows ?? [];
  const credits = money?.credits ?? [];
  const howPays = money?.howPays ?? null;

  const hasAnyMoney = owing.length > 0 || paidRows.length > 0 || credits.length > 0 ||
    Boolean(howPays?.card) || Boolean(howPays?.viaGroupName);

  // ★ `en-GB` day-then-month, matching every date the frame family already prints
  function fmtDayMonth(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  // ★ `amountMinor` is cents. Whole-dollar amounts print without cents; fractional amounts
  //   print two decimal places.
  function fmtMoney(amountMinor, currency) {
    if (amountMinor == null || !currency) return null;
    const n = amountMinor / 100;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency, currencyDisplay: "narrowSymbol",
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${currency} ${n}`;
    }
  }

  return (
    <div className="block" data-testid={testId}>
      {error ? (
        <ErrorPanel error={error} subject="Money" variant="band" />
      ) : !hasAnyMoney ? (
        <EmptyState
          kind="first-run"
          icon="IconCreditCard"
          headline="No money"
          line="Nothing owed, nothing paid yet."
          testId={`${testId}-empty`}
        />
      ) : (
        <div className="flex gap-6 items-start">
          {/* Main column */}
          <div className="flex-1 min-w-0">
            {owing.length > 0 && (
              <div
                className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] mb-[18px]"
                data-testid={`${testId}-owing`}
              >
                <div className="flex items-center gap-[var(--gap)] px-[var(--pad-card)] py-[14px] border-b border-[var(--line-soft)]">
                  <b className="text-[15px]">Owing</b>
                </div>
                <div className="px-[var(--pad-cell)] py-[6px_0_10px]">
                  {owing.map((row) => (
                    <div
                      key={row.invoiceId}
                      className="flex items-center gap-[var(--gap)] min-h-[var(--row-h)] py-2 border-b border-[var(--line-soft)] last:border-b-0"
                      data-testid="money-owing-row"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--ink)]">
                          {fmtMoney(row.amountMinor, row.currency)} — invoice {row.invoiceNumber}
                        </span>
                        <span className="block text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                          {row.memo ? `${row.memo}, ` : ""}due {fmtDayMonth(row.dueAt) ?? "—"}.
                        </span>
                      </span>
                      <Badge className="bg-[var(--warn-soft)] text-[var(--warn)]">Open</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!onRemindInvoice}
                        title={!onRemindInvoice ? "Reminders arrive with Money" : undefined}
                        aria-describedby={!onRemindInvoice ? `money-remind-${row.invoiceId}-reason` : undefined}
                        onClick={() => onRemindInvoice?.(row.invoiceId)}
                        data-testid={`money-remind-btn-${row.invoiceId}`}
                      >
                        Remind
                      </Button>
                      {!onRemindInvoice && (
                        <span id={`money-remind-${row.invoiceId}-reason`} className="sr-only">
                          Reminders arrive with Money
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {paidRows.length > 0 && (
              <div
                className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] mb-[18px]"
                data-testid={`${testId}-paid`}
              >
                <div className="flex items-center gap-[var(--gap)] px-[var(--pad-card)] py-[14px] border-b border-[var(--line-soft)]">
                  <b className="text-[15px]">Paid</b>
                </div>
                <div className="px-[var(--pad-cell)] py-[6px_0_10px]">
                  {paidRows.map((row) => (
                    <div
                      key={row.invoiceId}
                      className="flex items-center gap-[var(--gap)] min-h-[var(--row-h)] py-2 border-b border-[var(--line-soft)] last:border-b-0"
                      data-testid="money-paid-row"
                    >
                      <span className="w-[74px] flex-shrink-0 text-[var(--ink-muted)] text-[13px]">
                        {fmtDayMonth(row.paidAt) ?? "—"}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--ink)]">Invoice {row.invoiceNumber}</span>
                      </span>
                      <span>
                        {fmtMoney(row.amountMinor, row.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {credits.length > 0 && (
              <div
                className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] mb-[18px]"
                data-testid={`${testId}-credits`}
              >
                <div className="flex items-center gap-[var(--gap)] px-[var(--pad-card)] py-[14px] border-b border-[var(--line-soft)]">
                  <b className="text-[15px]">What's owed in work</b>
                </div>
                <div className="px-[var(--pad-cell)] py-[6px_0_10px]">
                  {credits.map((c) => {
                    const left = Math.max(0, (c.total ?? 0) - (c.used ?? 0));
                    return (
                      <div
                        key={c.entitlementId}
                        className="flex flex-col gap-[var(--gap)] py-2 border-b border-[var(--line-soft)] last:border-b-0"
                        data-testid="money-credit-row"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-[var(--ink)]">
                            {left} session{left === 1 ? "" : "s"} left
                          </span>
                          <span className="block text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                            Of {c.total}, expiring {fmtDayMonth(c.expiresAt) ?? "—"}.
                          </span>
                          <Progress value={c.used ?? 0} max={c.total ?? 1} className="max-w-[220px] mt-1.5" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Side column */}
          {(howPays?.card || howPays?.viaGroupName) && (
            <div className="w-80 flex-shrink-0">
              <div
                className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]"
                data-testid={`${testId}-howpays`}
              >
                <div className="flex items-center gap-[var(--gap)] px-[var(--pad-card)] py-[14px] border-b border-[var(--line-soft)]">
                  <b className="text-[15px]">How they pay</b>
                </div>
                <div className="px-[var(--pad-cell)] py-[6px_0_10px]">
                  {howPays.card && (
                    <div
                      className="flex items-center gap-[var(--gap)] py-2 border-b border-[var(--line-soft)]"
                      data-testid="money-card-row"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--ink)]">
                          {howPays.card.brand} ending {howPays.card.last4}
                        </span>
                        {howPays.card.expMonth && howPays.card.expYear && (
                          <span className="block text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                            Expires {String(howPays.card.expMonth).padStart(2, "0")}/{String(howPays.card.expYear).slice(-2)}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {howPays.viaGroupName && (
                    <div
                      className="flex items-center gap-[var(--gap)] py-2 border-b border-[var(--line-soft)] last:border-b-0"
                      data-testid="money-via-group-row"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--ink)]">Via {howPays.viaGroupName}</span>
                        {howPays.invoicesGoToName && (
                          <span className="block text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                            {howPays.invoicesGoToName} gets the invoices
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
