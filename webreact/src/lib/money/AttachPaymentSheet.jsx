// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AttachPaymentSheet — "Attach a payment" (P3.U4 · W1). New component, no Svelte source: ported from
// specs/mockups/InvoiceAttachPayment.frame.html (structure, order, labels, every text run) and the
// frame's generated wiring block (§3.3/§3.4). Opens as the invoice record's right-hand sheet.
//   · "Payment" — From: a description of the list (the payer's payments not yet on an invoice);
//     Choose: pick one of them.
//   · "What happens" — On save: the invoice is paid by that payment, in Stripe too, no new charge.
// The payer's payments (personPaymentMethods) come back already narrowed to "not on an invoice" —
// that is the read's own contract (P3.A/P3.S), not a filter this component reinvents.
// Attach renders write.error (server reason + reference); on success onAttached() lets the host
// screen refresh the invoice.
// ★ A PERMISSION renders nothing (WriteButton); a missing PREREQUISITE (nothing chosen yet) renders
//   DISABLED WITH THE REASON (DisabledWithReason, via WriteButton's `blocked`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import { api } from "@/lib/api.js";
import { formatMoney, formatDate } from "@/lib/screens/money/formatMoney.js";

function paymentLabel(p, fallbackCurrency) {
  const amount = formatMoney(p.amountMinor, p.currency ?? fallbackCurrency);
  const card = p.cardLastFour ? `card ending ${p.cardLastFour}` : (p.method ?? "other");
  return `${amount} · ${card} · ${formatDate(p.createdAt)}`;
}

export default function AttachPaymentSheet({ invoice, open, onOpenChange, onAttached }) {
  const currency = invoice?.currency ?? "USD";
  const payerName = invoice?.payerName ?? invoice?.payerDisplayName ?? "this payer";

  const [selected, setSelected] = useState(null);
  const [payments, setPayments] = useState({ loading: false, error: null, data: [] });

  useEffect(() => { setSelected(null); }, [invoice?.id]);

  function refreshPayments() {
    if (!invoice?.payerUserId) return;
    setPayments((p) => ({ ...p, loading: true, error: null }));
    api.personPaymentMethods(invoice.payerUserId)
      .then((data) => setPayments({ loading: false, error: null, data: data?.items ?? data ?? [] }))
      .catch((err) => setPayments({ loading: false, error: err, data: [] }));
  }
  useEffect(() => { if (open) refreshPayments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, invoice?.payerUserId]);

  const attach = useWrite("attachPaymentToInvoice", {
    blockedReason: selected ? null : "Choose a payment to attach.",
  });

  if (!open) return null;

  async function handleAttach() {
    const result = await attach.run({ invoiceId: invoice.id, paymentId: selected });
    onAttached?.(result);
  }

  const options = payments.data.map((p) => ({ value: p.id, label: paymentLabel(p, currency) }));

  return (
    <SideSheet
      title="Attach a payment"
      testId="attach-payment-sheet"
      error={attach.error ? `${attach.error.message}${attach.error.requestId ? ` (ref: ${attach.error.requestId})` : ""}` : null}
      onCancel={() => onOpenChange?.(false)}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <WriteButton write={attach} testId="invoice-action-attach-payment" onClick={handleAttach}>Attach</WriteButton>
        </footer>
      )}
    >
      <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Payment</div>
      <SheetRow label="From">
        <p className="m-0 text-field text-ink-2">Payments {payerName} has made that aren’t on an invoice</p>
      </SheetRow>
      <SheetRow label="Choose">
        {payments.loading ? (
          <Skeleton className="h-9 w-full" data-testid="attach-payment-sheet-loading" />
        ) : payments.error ? (
          <ErrorPanel error={payments.error} subject="Payments" onRetry={refreshPayments} testId="attach-payment-sheet-list-error" />
        ) : payments.data.length === 0 ? (
          <p className="m-0 text-field text-mute" data-testid="attach-payment-sheet-empty">No payments to attach — record one instead.</p>
        ) : (
          <Combobox testId="attach-payment-choose" value={selected} options={options} onValueChange={setSelected} />
        )}
      </SheetRow>

      <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">What happens</div>
      <SheetRow label="On save">
        <p className="m-0 text-field text-ink-2">The invoice is paid by that payment — here and in Stripe. No new charge.</p>
      </SheetRow>
    </SideSheet>
  );
}
