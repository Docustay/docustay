// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyInvoiceRecord — rebuild from MoneyAfter7.frame.html on the RecordPage archetype.
// Ported from webui/src/lib/screens/money/MoneyInvoiceRecord.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import SplitOfferSheet from "@/lib/money/SplitOfferSheet.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function MoneyInvoiceRecord({ invoiceId, onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState(null);
  const [partPaymentsEnabled, setPartPaymentsEnabled] = useState(false);
  const [showSplitSheet, setShowSplitSheet] = useState(false);
  const [fiveOpensPromptDismissed, setFiveOpensPromptDismissed] = useState(false);

  async function fetchData() {
    try {
      setPhase("loading");
      const res = await request(`/api/money/invoices/${invoiceId}`);
      setInvoice(res);
      setPhase("ready");

      // Check if part payments are enabled
      const settings = await request("/api/settings/money");
      setPartPaymentsEnabled(settings?.part_payments || false);
    } catch (err) {
      console.error("Error fetching invoice:", err);
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else if (err instanceof ApiError && err.status === 404) {
        setPhase("not-found");
      } else {
        setError(err);
        setPhase("error");
      }
    }
  }

  async function voidInvoice() {
    try {
      await request("/api/money/invoices/void", {
        method: "POST",
        body: { invoiceId },
      });
      await fetchData();
    } catch (err) {
      console.error("Error voiding invoice:", err);
      setError(err);
    }
  }

  useEffect(() => {
    if (invoiceId) {
      fetchData();
    }
  }, [invoiceId]);

  function formatDate(date) {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatRelativeDate(date) {
    if (!date) return "";
    const now = new Date();
    const d = new Date(date);
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return diffDays + " days ago";
    if (diffDays < 30) return Math.floor(diffDays / 7) + " weeks ago";
    return formatDate(date);
  }

  function formatMoney(minor, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(minor / 100);
  }

  function getDaysLate(dueAt, now = new Date()) {
    if (!dueAt) return 0;
    const d = new Date(dueAt);
    if (d > now) return 0;
    return Math.floor((now - d) / (1000 * 60 * 60 * 24));
  }

  function getHeaderDescription() {
    if (!invoice) return "";

    const daysLate = getDaysLate(invoice.dueAt);
    const sentDate = formatDate(invoice.createdAt);

    if (daysLate > 0) {
      return `Sent to ${invoice.payer} on ${sentDate}. ${daysLate} day${daysLate !== 1 ? "s" : ""} late.`;
    } else if (invoice.dueAt) {
      const daysUntilDue = Math.floor((new Date(invoice.dueAt) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilDue > 0) {
        return `Sent to ${invoice.payer} on ${sentDate}. Due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}.`;
      }
    }
    return `Sent to ${invoice.payer} on ${sentDate}.`;
  }

  function getFactLine() {
    if (!invoice) return "";

    const openCount = invoice.viewCount || 0;
    let openDesc = "";

    if (openCount === 0) {
      openDesc = "Never opened.";
    } else if (openCount === 1) {
      openDesc = "Opened once.";
    } else if (openCount >= 5) {
      const lastOpen = invoice.timeline?.[0]?.timestamp;
      openDesc = `Opened ${openCount} times, most recently ${formatRelativeDate(lastOpen)}.`;
    } else {
      openDesc = `Opened ${openCount} times.`;
    }

    const cardStatus = invoice.cardOnFile
      ? "Card on file for automatic charges."
      : "No card on file, so nothing can be taken automatically.";

    return openDesc + " " + cardStatus;
  }

  function hasSubscription() {
    // Forward dependency - check if a subscription exists for this payer
    return false;
  }

  const amountOutstanding = invoice ? invoice.amount - (invoice.paidMinor || 0) : 0;

  return (
    <ScreenState phase={phase} error={error} subject="This invoice">
      {/* ★ the maintainer, 29 Sep 2026 — F818: the branch below this one built "Sent to {payer} on {date}." for
          EVERY non-paid, non-void invoice, including a draft that was never sent — `getHeaderDescription()`
          reads `invoice.createdAt`, never `invoice.status` or a real sent date. The invoices list no
          longer routes drafts here (MoneyInvoicesInvoicesList.jsx sends them to the editor instead),
          but this stays honest for a direct link or an old bookmark. */}
      {invoice?.status === "draft" && (
        <section data-testid="money-invoice-record">
          <div className="mb-4.5">
            <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">Invoice {invoice.invoiceNumber}</h1>
          </div>
          <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
            <h2 className="m-0 text-empty-title font-medium text-mute">Draft — nothing sent yet</h2>
            <p className="mt-2 text-ui text-mute">Finish it in the editor to send it to {invoice.payer}.</p>
            <Button className="mt-4" onClick={() => onNavigate?.(`/money/invoices?new=1&editId=${invoiceId}`)}>
              Open the draft
            </Button>
          </div>
        </section>
      )}
      {invoice?.status === "paid" && (
        <section data-testid="money-invoice-record">
          <div className="mb-4.5">
            <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">Invoice {invoice.invoiceNumber}</h1>
          </div>
          <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
            <h2 className="m-0 text-empty-title font-medium text-ok">Paid</h2>
            <p className="mt-2 text-ui text-mute">This invoice has been paid.</p>
          </div>
        </section>
      )}
      {invoice?.status === "void" && (
        <section data-testid="money-invoice-record">
          <div className="mb-4.5">
            <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">Invoice {invoice.invoiceNumber}</h1>
          </div>
          <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
            <h2 className="m-0 text-empty-title font-medium text-mute">Void</h2>
            <p className="mt-2 text-ui text-mute">This invoice has been voided.</p>
          </div>
        </section>
      )}
      {invoice && invoice?.status !== "paid" && invoice?.status !== "void" && invoice?.status !== "draft" && (
        <>
          <section data-testid="money-invoice-record">
            <div className="mb-4.5 flex items-end gap-4">
              <div className="flex-1">
                <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">Invoice {invoice.invoiceNumber}</h1>
                <p className="m-0 mt-1.5 text-control text-mute">{getHeaderDescription()}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">Preview</Button>
                <Button variant="outline">Write to him</Button>
                <Button
                  variant="default"
                  onClick={() =>
                    onNavigate?.("virtual-terminal", {
                      invoiceId,
                      amountMinor: amountOutstanding,
                    })
                  }
                >
                  Take payment now
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-5.5">
              <div className="min-w-0 flex-1">
                <div className="mb-4.5 rounded-card border border-line bg-surface px-11 py-6.5">
                  <div className="flex items-baseline gap-3.5">
                    <span className="text-figure-lg tracking-[-0.02em] text-ink">
                      {formatMoney(amountOutstanding, invoice.currency)}
                    </span>
                    <span className="text-body text-mute">
                      {getDaysLate(invoice.dueAt) > 0
                        ? `${getDaysLate(invoice.dueAt)} day${
                            getDaysLate(invoice.dueAt) !== 1 ? "s" : ""
                          } late`
                        : "pending"}
                    </span>
                  </div>

                  <p className="m-0 mt-3 max-w-[70ch] text-meta text-ink-2">{getFactLine()}</p>
                </div>

                <div className="mb-4.5 rounded-card border border-line bg-surface">
                  <div className="border-b border-hair px-4.25 py-3.5">
                    <b className="text-heading font-medium">What's happened</b>
                  </div>
                  <div className="px-4.25 pt-1.5 pb-3.5">
                    {(invoice.timeline || []).map((event, index) => (
                      <div key={index} className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0">
                        <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                          {formatRelativeDate(event.timestamp)}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2.5">
                          {event.type === "sent" && (
                            <span className="flex flex-col">
                              Sent
                              <span className="text-caption text-mute">
                                By email to {invoice.payer}
                              </span>
                            </span>
                          )}
                          {event.type === "view" && (
                            <span className="flex flex-col">
                              He opened it
                              <span className="text-caption text-mute">
                                First time, within an hour of it being sent.
                              </span>
                            </span>
                          )}
                          {event.type === "reminder" && (
                            <>
                              <span className="flex flex-col">
                                Reminder sent
                                <span className="text-caption text-mute">
                                  Automatic, on the due date.
                                </span>
                              </span>
                              <StatusBadge label="Auto" tone="neutral" testId={`invoice-timeline-auto-${index}`} />
                            </>
                          )}
                          {event.type === "payment" && (
                            <span className="flex flex-col">
                              Payment received
                              <span className="text-caption text-mute">
                                {formatMoney(parseInt(event.detail), invoice.currency)}
                                {/* ★ the maintainer, 1 Oct 2026 — card audit: this showed no card at all.
                                   Stripe's own `card.brand` is lowercase ("visa"); every other
                                   card-brand string this product has ever shown a person
                                   (SettleBookingModal's "Visa •••• 4242") is capitalized. */}
                                {event.cardBrand && event.cardLastFour
                                  ? ` — Paid with ${event.cardBrand[0].toUpperCase()}${event.cardBrand.slice(1)} •••• ${event.cardLastFour}`
                                  : ""}
                              </span>
                            </span>
                          )}
                          {event.type === "refund" && (
                            <span className="flex flex-col">
                              Refund issued
                              <span className="text-caption text-mute">
                                {formatMoney(parseInt(event.detail), invoice.currency)}
                              </span>
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="w-80 flex-shrink-0">
                {invoice.viewCount >= 5 && !fiveOpensPromptDismissed && (
                  <div className="mb-4.5 rounded-card border border-line bg-surface">
                    <div className="border-b border-hair px-4.25 py-3.5">
                      <b className="text-heading font-medium">Worth knowing</b>
                    </div>
                    <div className="px-4.25 pt-1.5 pb-3.5">
                      <PromptCard
                        icon="💬"
                        tone="bad"
                        headline="Five opens and no payment usually means something is in the way"
                        why="People who intend to ignore an invoice stop opening it. A note asking whether something's wrong tends to work better than a fourth reminder."
                        // ★ FOUND LIVE, 28 Sep 2026 — both actions were no-ops (() => {}), drawn dead. "Write
                        //   to him" now matches the exact pattern MoneyInvoices.jsx's handleWriteToPayerMessage
                        //   already uses (invoice.payerId, confirmed used elsewhere in this same file at the
                        //   card-update/virtual-terminal calls). Dismiss is local-only (no persisted
                        //   dismissed-prompts endpoint exists for this screen yet) — real, but resets on
                        //   reload; better than a button that visibly does nothing.
                        action={{ label: "Write to him", onClick: () => onNavigate?.(`/people/${invoice.payerId}/messages`) }}
                        onDismiss={() => setFiveOpensPromptDismissed(true)}
                      />
                    </div>
                  </div>
                )}

                <div className="mb-4.5 rounded-card border border-line bg-surface">
                  <div className="border-b border-hair px-4.25 py-3.5">
                    <b className="text-heading font-medium">What you could do</b>
                  </div>
                  <div className="px-4.25 pt-1.5 pb-3.5">
                    <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">Offer to split it</span>
                        <span className="mt-0.5 text-caption text-mute">
                          Three payments of{" "}
                          {formatMoney(amountOutstanding / 3, invoice.currency)}{" "}
                          over three months
                        </span>
                      </div>
                      {partPaymentsEnabled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowSplitSheet(true)}
                        >
                          Offer
                        </Button>
                      ) : (
                        <DisabledWithReason
                          disabled={true}
                          reason="Part payments are off. Turn them on in Money settings."
                        >
                          {(disabledProps) => (
                            <Button size="sm" variant="outline" {...disabledProps}>
                              Offer
                            </Button>
                          )}
                        </DisabledWithReason>
                      )}
                    </div>

                    <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">Ask for a card on file</span>
                        <span className="mt-0.5 text-caption text-mute">
                          So this doesn't happen again
                        </span>
                      </div>
                      <DisabledWithReason
                        disabled={!hasSubscription()}
                        reason="There's no subscription yet for this payer"
                      >
                        {(disabledProps) => (
                          <Button
                            size="sm"
                            variant="outline"
                            {...disabledProps}
                            onClick={() =>
                              onNavigate?.("card-update", {
                                payerId: invoice.payerId,
                              })
                            }
                          >
                            Ask
                          </Button>
                        )}
                      </DisabledWithReason>
                    </div>

                    <div className="flex items-center gap-3 py-2.75 text-ui last:border-b-0">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">Stop his bookings</span>
                        <span className="mt-0.5 text-caption text-mute">
                          He's in on Tuesday. Only if you mean it.
                        </span>
                      </div>
                      <DisabledWithReason
                        disabled={true}
                        reason="Pausing someone's bookings isn't available yet"
                      >
                        {(disabledProps) => (
                          <Button size="sm" variant="outline" {...disabledProps}>
                            Pause
                          </Button>
                        )}
                      </DisabledWithReason>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4.5 flex justify-end">
              <Button variant="outline" onClick={voidInvoice}>Void</Button>
            </div>
          </section>

          {showSplitSheet && (
            <SplitOfferSheet
              invoice={invoice}
              onClose={() => setShowSplitSheet(false)}
              onSave={() => {
                setShowSplitSheet(false);
                fetchData();
              }}
            />
          )}
        </>
      )}
    </ScreenState>
  );
}
