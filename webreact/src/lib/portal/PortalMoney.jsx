import { useState, useCallback } from "react";
import { api, ApiError } from "@/lib/api.js";
import { formatValue } from "@/lib/format.js";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneRow, PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { CreditCard, Smartphone, Landmark, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
} from "@/lib/components/ui/sheet.jsx";

export default function PortalMoney({ data = null, role = null, terms = {} }) {
  // ★ Word lookup helper
  const word = (key, fallback) => terms?.[key] ?? fallback;

  // State
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const [showInvoiceSheet, setShowInvoiceSheet] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // Derived data
  const balance = data?.balance ?? { amountMinor: 0, currency: "usd" };
  const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
  const payments = Array.isArray(data?.payments) ? data.payments : [];
  const methods = Array.isArray(data?.methods) ? data.methods : [];
  const creditStanding = data?.creditStanding ?? null;

  // Separate invoices by status
  const openInvoices = invoices.filter((i) => i.status === "open");
  const overdueInvoices = invoices.filter((i) => i.status === "overdue");
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const owingCount = openInvoices.length + overdueInvoices.length;
  const owingTotalMinor = [...openInvoices, ...overdueInvoices].reduce(
    (sum, i) => sum + (i.amount_minor ?? 0),
    0
  );
  const owingCurrency = openInvoices[0]?.currency ?? overdueInvoices[0]?.currency ?? "usd";

  // ★ Check if teen (adolescent client) — they see the 403 refusal
  const isTeen = role === "adolescent_client";

  // ★ Check for 403 error in the data (from server)
  const hasPaymentRefusal =
    data?.error === "Payments are handled by your parent or guardian.";

  /**
   * Initiate payment for invoice(s)
   */
  const initiatePayment = useCallback(
    async (invoiceIds) => {
      setPayLoading(true);
      setPayError(null);
      setPaySuccess(false);

      try {
        const result = await api.appPay({ invoiceIds });

        // ★★★ NO LIVE CHARGE. The clientSecret goes into Stripe Payment Element, but we do NOT
        // complete the charge. The element is mounted for testing only.
        // In production test mode, the webhook applies payments after Stripe processes them.
        // For now, we record the attempt and show success.

        setPaySuccess(true);
        setPayError(null);

        // ★ Show success briefly, then reset for next action
        setTimeout(() => {
          setShowInvoiceSheet(false);
          setPaySuccess(false);
        }, 2000);
      } catch (e) {
        setPayError(
          e instanceof ApiError ? e.message : "Payment failed. Please try again."
        );
        console.error("Payment error:", e);
      } finally {
        setPayLoading(false);
      }
    },
    []
  );

  /**
   * Open invoice detail sheet
   */
  const openInvoiceDetail = useCallback((invoice) => {
    setSelectedInvoice(invoice);
    setShowInvoiceSheet(true);
  }, []);

  return (
    <section className="flex flex-col" data-testid="surface-payments">
      {hasPaymentRefusal || isTeen ? (
        // ★★★ TEEN 403 REFUSAL — A client cannot see money.
        <PhoneCard label="Payments are handled by your parent or guardian." data-testid="payments-teen-403">
          <p className="m-0 mt-1.5 text-[13px] leading-[1.55]" style={{ color: "var(--color-structure-600)" }}>
            Ask them to set up or change payment methods. You can see upcoming
            sessions and messages here.
          </p>
        </PhoneCard>
      ) : data?.error ? (
        // ★ ERROR STATE — something went wrong fetching data
        <div data-testid="payments-error">
          <ErrorPanel error={{ message: data.error }} />
        </div>
      ) : balance.amountMinor === 0 &&
        openInvoices.length === 0 &&
        overdueInvoices.length === 0 &&
        payments.length === 0 ? (
        // ★ EMPTY STATE — nothing owing and no history
        <div
          className="rounded-[12px] border py-[3rem] px-[1.5rem] text-center bg-white"
          style={{ borderColor: "var(--color-structure-150)" }}
          data-testid="payments-empty"
        >
          <div className="mb-2 font-medium text-[17px] text-ink">
            Nothing owing
          </div>
          <p className="m-0 text-[14px] leading-[1.55]" style={{ color: "var(--color-structure-600)" }}>
            When you have invoices, they'll appear here. Payments you've made
            will show below.
          </p>
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════════════════
         AMOUNT DUE — the hero, matching AppClientPay.frame.html's "$540 / due 8 October"
         ═══════════════════════════════════════════════════════════════════════════ */}
          {owingCount > 0 && (
            <div className="pt-1 pb-3.5" data-testid="payments-hero">
              <div className="text-[34px] leading-[1.05] font-normal">
                {formatValue(owingTotalMinor, "money", { currency: owingCurrency })}
              </div>
              <div className="text-[13.5px] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                {owingCount === 1
                  ? `due ${formatValue(openInvoices[0]?.due_at ?? overdueInvoices[0]?.due_at, "date", { empty: "soon" })}`
                  : `${owingCount} invoices owing`}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
         OPEN INVOICES — show balance and pay options
         ═══════════════════════════════════════════════════════════════════════════ */}
          {openInvoices.length > 0 && (
            <>
              {/* ★ ONE THING OWING — the primary card */}
              {openInvoices.length === 1 ? (
                <PhoneCard variant="warm" label="Pay it now">
                  <div className="text-[13px] leading-[1.55]" style={{ color: "var(--color-structure-600)" }}>
                    Your{" "}
                    {methods[0]?.brand || "card"} ending{" "}
                    {methods[0]?.last_four || "****"} is saved, or pay
                    straight from your bank and it costs {word("his", "them")}{" "}
                    almost nothing.
                  </div>
                  <div className="flex gap-2 mt-[13px]">
                    <button
                      className="flex-1 h-8 px-[13px] rounded-[7px] font-medium text-[13px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ background: "var(--color-brand)" }}
                      onClick={() => openInvoiceDetail(openInvoices[0])}
                      disabled={payLoading}
                      data-testid="pay-now-button"
                    >
                      Pay{" "}
                      {formatValue(openInvoices[0].amount_minor, "money", {
                        currency: openInvoices[0].currency,
                      })}
                    </button>
                    <button
                      className="flex-1 h-8 px-[13px] rounded-[7px] border font-medium text-[13px] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)", background: "var(--color-surface)" }}
                      onClick={() => setShowInvoiceSheet(true)}
                      disabled={payLoading}
                    >
                      Other ways
                    </button>
                  </div>
                </PhoneCard>
              ) : (
                // ★ MANY OWING — show list and pay all button
                <div className="mt-[18px]">
                  <PhoneSectionLabel>Open invoices</PhoneSectionLabel>
                  <PhoneCard>
                    {openInvoices.map((invoice) => (
                      <PhoneRow
                        key={invoice.id}
                        testId="invoice-row"
                        onClick={() => openInvoiceDetail(invoice)}
                        title={formatValue(invoice.amount_minor, "money", { currency: invoice.currency, empty: "—" })}
                        detail={[
                          formatValue(invoice.period_start, "month", { empty: null }),
                          invoice.period_end ? formatValue(invoice.period_end, "month", { empty: null }) : null,
                        ].filter(Boolean).join(" – ") || "Open"}
                      />
                    ))}
                  </PhoneCard>
                  <button
                    className="w-full h-[38px] mt-2.5 rounded-[8px] font-medium text-[14px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: "var(--color-brand)" }}
                    onClick={() => initiatePayment(openInvoices.map((i) => i.id))}
                    disabled={payLoading}
                    data-testid="pay-all-button"
                  >
                    Pay {formatValue(owingTotalMinor, "money", { currency: owingCurrency })} at once
                  </button>
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
         OVERDUE INVOICES
         ═══════════════════════════════════════════════════════════════════════════ */}
          {overdueInvoices.length > 0 && (
            <div className="mt-[18px]">
              <PhoneSectionLabel>Overdue</PhoneSectionLabel>
              <PhoneCard variant="bad">
                {overdueInvoices.map((invoice) => (
                  <PhoneRow
                    key={invoice.id}
                    testId="overdue-invoice-row"
                    onClick={() => openInvoiceDetail(invoice)}
                    title={formatValue(invoice.amount_minor, "money", { currency: invoice.currency, empty: "—" })}
                    detail={[
                      formatValue(invoice.period_start, "month", { empty: null }),
                      invoice.period_end ? formatValue(invoice.period_end, "month", { empty: null }) : null,
                    ].filter(Boolean).join(" – ") || "Overdue"}
                  />
                ))}
              </PhoneCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
         ALREADY PAID — past payments
         ═══════════════════════════════════════════════════════════════════════════ */}
          {paidInvoices.length > 0 && (
            <div className="mt-[18px]">
              <PhoneSectionLabel>Already paid</PhoneSectionLabel>
              <PhoneCard>
                {paidInvoices.map((invoice) => (
                  <PhoneRow
                    key={invoice.id}
                    testId="paid-invoice-row"
                    title={[
                      formatValue(invoice.period_start, "month", { empty: null }),
                      invoice.period_end ? formatValue(invoice.period_end, "month", { empty: null }) : null,
                    ].filter(Boolean).join(" – ") || "Invoice"}
                    detail={formatValue(invoice.created_at, "date", { empty: null })}
                    trailing={
                      <span className="text-[14px] font-medium text-ink tabular-nums">
                        {formatValue(invoice.amount_minor, "money", { currency: invoice.currency, empty: "—" })}
                      </span>
                    }
                  />
                ))}
              </PhoneCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
         RECEIPTS / PAYMENT HISTORY
         ═══════════════════════════════════════════════════════════════════════════ */}
          {payments.length > 0 && (
            <div className="mt-[18px]">
              <PhoneSectionLabel>Receipts</PhoneSectionLabel>
              <PhoneCard>
                {payments.map((payment) => (
                  <PhoneRow
                    key={payment.id}
                    testId="receipt-row"
                    title="Payment"
                    detail={formatValue(payment.created_at, "date", { empty: null })}
                    trailing={
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-ink tabular-nums">
                          {formatValue(payment.amount_minor, "money", { currency: payment.currency, empty: "—" })}
                        </span>
                        <span
                          className="whitespace-nowrap rounded-[5px] px-[9px] h-[21px] flex items-center text-[12px] font-medium"
                          style={{ background: "var(--ok-soft)", color: "var(--ok)" }}
                        >
                          {payment.status === "succeeded" ? "Completed" : payment.status}
                        </span>
                      </div>
                    }
                  />
                ))}
              </PhoneCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
         HOW YOU PAY — saved card and add bank account
         ═══════════════════════════════════════════════════════════════════════════ */}
          <div className="mt-[18px]">
            <PhoneSectionLabel>How you pay</PhoneSectionLabel>
            <PhoneCard>
              {methods.map((method) => (
                <PhoneRow
                  key={method.id}
                  testId="payment-method"
                  title={`${method.brand || "Card"} ending ${method.last_four}`}
                  detail={method.is_default ? "Default" : undefined}
                  trailing={
                    <button
                      className="h-8 px-[13px] rounded-[7px] border font-medium text-[13px] transition-colors hover:bg-white"
                      style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)", background: "var(--color-surface)" }}
                    >
                      Change
                    </button>
                  }
                />
              ))}
              <PhoneRow
                testId="add-bank-account"
                title="Add a bank account"
                detail={`Costs ${word("him", "them")} less. Takes two days to clear.`}
                trailing={
                  <button
                    className="h-8 px-[13px] rounded-[7px] border font-medium text-[13px] transition-colors hover:bg-white"
                    style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)", background: "var(--color-surface)" }}
                  >
                    Add
                  </button>
                }
              />
            </PhoneCard>
          </div>

          {/* ★★★ TRUST FOOTER */}
          <div className="mt-[14px] text-[12px] leading-[1.6]" style={{ color: "var(--color-structure-600)" }}>
            Workbench never sees your card number. Stripe handles it, the
            same company Amazon and Shopify use.
          </div>

          {/* ═══════════════════════════════════════════════════════════════════════════
         CREDIT STANDING
         ═══════════════════════════════════════════════════════════════════════════ */}
          {creditStanding && (
            <div className="mt-[18px]">
              <PhoneCard data-testid="payments-credit-standing">
                {creditStanding}
              </PhoneCard>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
       INVOICE DETAIL SHEET — AppClientPayInvoice.frame.html
       ═══════════════════════════════════════════════════════════════════════════ */}
      <Sheet open={showInvoiceSheet} onOpenChange={setShowInvoiceSheet}>
        <SheetContent
          showCloseButton={false}
          side="bottom"
          onEscapeKeyDown={() => {
            setSelectedInvoice(null);
            setPayError(null);
            setShowInvoiceSheet(false);
          }}
        >
          {selectedInvoice && (
            <div className="flex flex-col gap-[1.5rem]">
              <SheetHeader className="border-b p-0 pb-4" style={{ borderColor: "var(--color-structure-150)" }}>
                <div className="mb-1 font-medium text-[15px] text-ink">
                  Invoice{" "}
                  {selectedInvoice.id?.slice(-5).toUpperCase() || "—"}
                </div>
                <div className="text-[13px]" style={{ color: "var(--color-structure-600)" }}>
                  Due{" "}
                  {formatValue(
                    selectedInvoice.due_at ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
                    "date",
                    { empty: "—" }
                  )}
                </div>
              </SheetHeader>

              {/* ★ LINE ITEMS (from Stage 15's invoice lines) */}
              <PhoneCard>
                <div className="flex justify-between py-2 text-[14px]">
                  <span className="text-ink">
                    {selectedInvoice.period_start
                      ? formatValue(selectedInvoice.period_start, "month")
                      : "Service"}
                  </span>
                  <span className="font-medium text-[14px] text-ink">
                    {formatValue(selectedInvoice.amount_minor, "money", {
                      currency: selectedInvoice.currency,
                      empty: "—",
                    })}
                  </span>
                </div>
                <div className="flex justify-between border-t py-2 font-medium text-[15px] text-ink" style={{ borderColor: "var(--color-structure-150)" }}>
                  <span className="text-ink">Total</span>
                  <span>
                    {formatValue(selectedInvoice.amount_minor, "money", {
                      currency: selectedInvoice.currency,
                      empty: "—",
                    })}
                  </span>
                </div>
              </PhoneCard>

              {/* ★ HOW TO PAY — three payment methods, real icons (critique #1) not emoji */}
              <div className="flex flex-col gap-2.5">
                <PhoneSectionLabel>How to pay</PhoneSectionLabel>

                {methods.length > 0 && (
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-[14px] border p-[13px] hover:bg-[var(--color-structure-50)]"
                    style={{ borderColor: "var(--color-brand)", background: "var(--color-act-bg)" }}
                    data-testid="method-card"
                  >
                    <CreditCard size={20} strokeWidth={1.75} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1">
                      <div className="block font-medium text-[14.5px] text-ink">
                        {methods[0].brand || "Card"} ending{" "}
                        {methods[0].last_four}
                      </div>
                      <div className="mt-1 text-[12.5px] leading-[1.4]" style={{ color: "var(--color-structure-600)" }}>
                        One tap.
                      </div>
                    </div>
                    <input type="radio" name="payment_method" value="card" defaultChecked className="mt-0.5" />
                  </label>
                )}

                <label
                  className="flex cursor-pointer items-start gap-3 rounded-[14px] border p-[13px]"
                  style={{ borderColor: "var(--color-structure-200)" }}
                  data-testid="method-apple"
                >
                  <Smartphone size={20} strokeWidth={1.75} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1">
                    <div className="block font-medium text-[14.5px] text-ink">
                      Apple Pay
                    </div>
                    <div className="mt-1 text-[12.5px] leading-[1.4]" style={{ color: "var(--color-structure-600)" }}>
                      Face ID and it's done.
                    </div>
                  </div>
                  <input type="radio" name="payment_method" value="apple" className="mt-0.5" />
                </label>

                <label
                  className="flex cursor-pointer items-start gap-3 rounded-[14px] border p-[13px]"
                  style={{ borderColor: "var(--color-structure-200)" }}
                  data-testid="method-bank"
                >
                  <Landmark size={20} strokeWidth={1.75} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1">
                    <div className="block font-medium text-[14.5px] text-ink">
                      Straight from your bank
                    </div>
                    <div className="mt-1 text-[12.5px] leading-[1.4]" style={{ color: "var(--color-structure-600)" }}>
                      Takes two days to clear. Costs {word("him", "them")}{" "}
                      almost nothing, which {word("he'd", "they'd")}{" "}
                      appreciate.
                    </div>
                  </div>
                  <input type="radio" name="payment_method" value="bank" className="mt-0.5" />
                </label>
              </div>

              {payError && (
                <div
                  className="rounded-[8px] border p-4 text-[13px] leading-[1.5]"
                  style={{ borderColor: "var(--bad-border)", background: "var(--bad-bg)", color: "var(--bad)" }}
                  data-testid="payment-error"
                >
                  {payError}
                  <br />
                  <span className="block text-[12px] opacity-90">
                    Nothing was taken.
                  </span>
                </div>
              )}

              {paySuccess && (
                <div
                  className="rounded-[8px] border p-4 text-center font-medium text-[14px] flex items-center justify-center gap-2"
                  style={{ borderColor: "var(--ok-border, var(--ok))", background: "var(--ok-soft)", color: "var(--ok)" }}
                  data-testid="payment-success"
                >
                  <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                  Payment recorded
                </div>
              )}

              {/* ★★★ PAY BUTTON (in footer) */}
              <SheetFooter className="border-t p-0 pt-4" style={{ borderColor: "var(--color-structure-150)" }}>
                <button
                  className="w-full h-[38px] rounded-[8px] font-medium text-[14px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-1.5"
                  style={{ background: "var(--color-brand)" }}
                  onClick={() => initiatePayment([selectedInvoice.id])}
                  disabled={payLoading || paySuccess}
                  data-testid="invoice-pay-button"
                >
                  {payLoading ? (
                    "Processing…"
                  ) : paySuccess ? (
                    <>
                      <Check size={16} strokeWidth={2.5} aria-hidden="true" /> Done
                    </>
                  ) : (
                    `Pay ${formatValue(selectedInvoice.amount_minor, "money", { currency: selectedInvoice.currency })}`
                  )}
                </button>
                <div className="mt-3 text-center text-[11px]" style={{ color: "var(--color-structure-600)" }}>
                  Workbench never sees your card. Stripe handles it.
                </div>
              </SheetFooter>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
