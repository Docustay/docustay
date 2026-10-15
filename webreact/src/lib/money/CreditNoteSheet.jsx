// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CreditNoteSheet — "Issue a credit note" (P3.U2 · W1). New component, no Svelte source: ported from
// specs/mockups/InvoiceCreditNote.frame.html (structure, order, labels, every text run) and the frame's
// generated wiring block (§3.3/§3.4). Opens as the invoice record's right-hand sheet.
//   · "What it covers" — the invoice's lines, each with an editable quantity to credit, the reason
//     (duplicate · fraudulent · order_change · product_unsatisfactory).
//   · "Where the money goes" — destination radio: refund to the card · credit to their balance ·
//     settled outside Stripe — plus an optional note the client will see.
//   · "Tell them" — email a copy toggle.
//   · "Already issued" — prior credit notes on this invoice (listInvoiceCreditNotes), each voidable
//     (voidCreditNote) with a READ-ONLY memo (R11: no updateCreditNote route until P3.S2). Empty → the frame draws nothing, so
//     this section renders nothing (the frame's own empty state).
// Totals come from previewCreditNote (live); when Stripe didn't answer (source 'ours') the frame's own
// note is shown. Issue renders write.error (server reason + reference); on success onIssued() lets the
// host screen refresh the invoice's credit-note block.
// ★ A PERMISSION renders nothing (WriteButton); a missing PREREQUISITE (nothing selected to credit)
//   renders DISABLED WITH THE REASON (DisabledWithReason, via WriteButton's `blocked`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import { api } from "@/lib/api.js";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const REASONS = [
  { value: "duplicate", label: "Charged twice by mistake" },
  { value: "fraudulent", label: "Fraudulent charge" },
  { value: "order_change", label: "Didn't go ahead as planned" },
  { value: "product_unsatisfactory", label: "They weren't happy with it" },
];
const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.value, r.label]));

const DESTINATIONS = {
  REFUND: "refund_to_card",
  BALANCE: "credit_to_balance",
  OUT_OF_BAND: "settled_outside_stripe",
};

export default function CreditNoteSheet({ invoice, open, onOpenChange, onIssued }) {
  const lines = invoice?.lines ?? [];
  const currency = invoice?.currency ?? "USD";

  const [qty, setQty] = useState({});
  const [reason, setReason] = useState("order_change");
  const [destination, setDestination] = useState(DESTINATIONS.REFUND);
  const [note, setNote] = useState("");
  const [emailCopy, setEmailCopy] = useState(true);

  const [preview, setPreview] = useState({ loading: false, error: null, data: null });
  const [list, setList] = useState({ loading: false, error: null, data: [] });
  const [voidTarget, setVoidTarget] = useState(null);

  useEffect(() => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, l.quantity])));
    setReason("order_change");
    setDestination(DESTINATIONS.REFUND);
    setNote("");
    setEmailCopy(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const selectedLines = useMemo(
    () => lines.map((l) => ({ lineId: l.id, quantity: qty[l.id] ?? 0 })).filter((l) => l.quantity > 0),
    [lines, qty],
  );
  const totalQuantity = selectedLines.reduce((sum, l) => sum + l.quantity, 0);

  useEffect(() => {
    if (!open || !invoice?.id) return;
    let cancelled = false;
    setPreview((p) => ({ ...p, loading: true, error: null }));
    api.previewCreditNote({ invoiceId: invoice.id, lines: selectedLines })
      .then((data) => { if (!cancelled) setPreview({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setPreview({ loading: false, error: err, data: null }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id, JSON.stringify(selectedLines)]);

  function refreshList() {
    if (!invoice?.id) return;
    setList((l) => ({ ...l, loading: true, error: null }));
    api.listInvoiceCreditNotes(invoice.id)
      .then((data) => setList({ loading: false, error: null, data: data?.items ?? data ?? [] }))
      .catch((err) => setList({ loading: false, error: err, data: [] }));
  }
  useEffect(() => { if (open) refreshList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, invoice?.id]);

  const issue = useWrite("issueCreditNote", {
    blockedReason: totalQuantity === 0 ? "Select at least one line to credit." : null,
  });
  const voidNote = useWrite("voidCreditNote");
  // ★ R11 ruling (RECONCILE, the maintainer 27 Sep) — no memo edit until P3.S2 lands: `updateCreditNote` has no
  //   server route (credit_note has no updated_at and app_rw no UPDATE grant), so useWrite threw and
  //   the whole sheet crashed. The memo shows read-only.

  if (!open) return null;

  const amountMinor = preview.data?.amountMinor ?? selectedLines.reduce((sum, l) => {
    const line = lines.find((x) => x.id === l.lineId);
    return sum + (line ? line.unitAmountMinor * l.quantity : 0);
  }, 0);

  async function handleIssue() {
    const result = await issue.run({
      invoiceId: invoice.id,
      lines: selectedLines,
      reason,
      destination,
      memo: note || null,
      sendEmailCopy: emailCopy,
    });
    onIssued?.(result);
  }

  return (
    <>
      <SideSheet
        title="Issue a credit note"
        testId="credit-note-sheet"
        error={issue.error ? `${issue.error.message}${issue.error.requestId ? ` (ref: ${issue.error.requestId})` : ""}` : null}
        onCancel={() => onOpenChange?.(false)}
        footer={(
          <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
            <WriteButton write={issue} testId="credit-note-issue" type="button" onClick={handleIssue}>Issue credit note</WriteButton>
          </footer>
        )}
      >
        {(list.loading || list.error || list.data.length > 0) && (
          <SheetSection title="Already issued" testId="credit-note-existing">
            {list.loading ? (
              <Skeleton className="h-8 w-full" data-testid="credit-note-existing-loading" />
            ) : list.error ? (
              <ErrorPanel error={list.error} subject="Credit notes" onRetry={refreshList} testId="credit-note-existing-error" />
            ) : list.data.map((n) => (
              <div key={n.id} className="flex items-center gap-2.5 border-b border-hair py-2 last:border-b-0" data-testid={`credit-note-row-${n.id}`}>
                <StatusBadge label={REASON_LABEL[n.reason] ?? n.reason} tone="neutral" />
                <Figure size="sm" testId="credit-note-existing-amount">{formatMoney(n.amountMinor, n.currency ?? currency)}</Figure>
                {n.status === "void" ? (
                  <StatusBadge label="Void" tone="bad" />
                ) : (
                  <span className="flex-1 truncate text-sm text-muted-foreground" data-testid="credit-note-memo-readonly">
                    {n.memo ?? ""}
                  </span>
                )}
                {n.status !== "void" && (
                  <WriteButton write={voidNote} testId="credit-note-void" variant="outline" type="button" onClick={() => setVoidTarget(n)}>Void</WriteButton>
                )}
              </div>
            ))}
          </SheetSection>
        )}

        <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">What it covers</div>
        <SheetRow label="Lines">
          <div className="flex flex-col gap-1.5" data-testid="credit-note-lines">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center gap-2 text-field text-ink-2">
                <span className="min-w-0 flex-1 truncate">{line.description}</span>
                <span className="text-mute">×</span>
                <Input
                  type="number" min={0} max={line.quantity} value={qty[line.id] ?? 0}
                  className="h-7 w-14 text-center"
                  data-testid={`credit-note-line-qty-${line.id}`}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(line.quantity, Number(e.target.value) || 0));
                    setQty((q) => ({ ...q, [line.id]: v }));
                  }}
                />
                <span className="text-mute">·</span>
                <span>{formatMoney(line.unitAmountMinor * (qty[line.id] ?? 0), currency)}</span>
              </div>
            ))}
          </div>
        </SheetRow>
        <SheetRow label="Amount">
          {preview.loading ? (
            <Skeleton className="h-6 w-24" data-testid="credit-note-amount-loading" />
          ) : (
            <Figure size="md" testId="credit-note-total">{formatMoney(amountMinor, currency)}</Figure>
          )}
          {preview.data?.source === "ours" && (
            <p className="mt-1.5 text-meta text-mute" data-testid="credit-note-amount-note">
              Stripe didn't answer — totals may differ by tax
            </p>
          )}
        </SheetRow>
        <SheetRow label="Reason">
          <Combobox testId="credit-note-reason" value={reason} options={REASONS} onValueChange={setReason} />
        </SheetRow>

        <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Where the money goes</div>
        <RadioGroup value={destination} onValueChange={setDestination} data-testid="credit-note-destination">
          <SheetRow label="Back to them">
            <label className="flex items-center gap-2.5">
              <RadioGroupItem value={DESTINATIONS.REFUND} data-testid="credit-note-destination-refund_to_card" />
              <span className="text-field text-ink">Refund to the card they paid with</span>
            </label>
          </SheetRow>
          <SheetRow label="Or">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2.5">
                <RadioGroupItem value={DESTINATIONS.BALANCE} data-testid="credit-note-destination-credit_to_balance" />
                <span className="text-field text-ink">Credit to their balance</span>
              </label>
              <label className="flex items-center gap-2.5">
                <RadioGroupItem value={DESTINATIONS.OUT_OF_BAND} data-testid="credit-note-destination-settled_outside_stripe" />
                <span className="text-field text-ink">Already settled outside Stripe</span>
              </label>
            </div>
          </SheetRow>
        </RadioGroup>
        <SheetRow label="Note on the credit note">
          <Input
            value={note} placeholder="Optional — they'll see this"
            data-testid="credit-note-memo-new"
            onChange={(e) => setNote(e.target.value)}
          />
        </SheetRow>

        <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Tell them</div>
        <SheetRow label="Email a copy">
          <div className="flex items-center gap-2.5">
            <Switch checked={emailCopy} onCheckedChange={setEmailCopy} data-testid="credit-note-email-copy" />
            <span className="text-field text-ink-2">{emailCopy ? `On — to ${invoice?.payerEmail ?? "them"}` : "Off"}</span>
          </div>
        </SheetRow>
      </SideSheet>

      <DecisionModal
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
        title="Void this credit note?"
        subtitle={voidTarget ? `${formatMoney(voidTarget.amountMinor, voidTarget.currency ?? currency)} — this can't be undone.` : ""}
        cancelLabel="Keep it"
        confirmLabel="Void it"
        danger
        busy={voidNote.busy}
        error={voidNote.error ? `${voidNote.error.message}${voidNote.error.requestId ? ` (ref: ${voidNote.error.requestId})` : ""}` : null}
        onCancel={() => setVoidTarget(null)}
        onConfirm={async () => {
          await voidNote.run({ creditNoteId: voidTarget.id });
          setVoidTarget(null);
          refreshList();
        }}
        testId="credit-note-void-confirm"
      />
    </>
  );
}
