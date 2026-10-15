// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MarkPaidDialog — P3.U3 (W1). Built FROM specs/mockups/InvoiceMarkPaid.frame.html's `.modal`: record
// money that reached the practice outside the platform. The write is Stripe-first (WIRING-MAP §3.3): a
// Stripe refusal rolls the whole thing back and this surface stays open, showing Stripe's own reason
// and reference (write.error) — never a re-worded one (api.js's own rule).
// ★ `useWrite` decides the permission, not this component: hidden (no `invoice.edit`) renders NOTHING,
//   the same as WriteButton — a control asking a permission it doesn't have IS the defect (CLAUDE.md).
// ★ A missing prerequisite (e.g. Stripe not connected) is `write.blocked`: DisabledWithReason renders
//   the reason and the submit stays disabled, never hidden — a blocked write is not a denied one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

function formatMoney(minor, currency = "usd") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency).toUpperCase() }).format((minor ?? 0) / 100);
  } catch {
    return `$${((minor ?? 0) / 100).toFixed(2)}`;
  }
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * @param invoice { id, number, amountDueMinor, currency?, blockedReason? } — the host screen's invoice
 *   record; `blockedReason` (e.g. "Connect Stripe to record a payment.") is the missing prerequisite,
 *   if any — a permission (`invoice.edit`) is decided by `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after a successful write (ActionSurface owns the busy lock and the discard guard).
 * @param onPaid — called after the invoice is recorded as paid, so the host screen can refetch.
 */
export default function MarkPaidDialog({ invoice, open, onOpenChange, onPaid }) {
  const write = useWrite("markInvoicePaid", { blockedReason: invoice?.blockedReason ?? null });
  const amountDueMinor = invoice?.amountDueMinor ?? 0;

  const [method, setMethod] = useState("bank_transfer");
  const [dateReceived, setDateReceived] = useState(todayISO());
  const [amountInput, setAmountInput] = useState((amountDueMinor / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [sendReceipt, setSendReceipt] = useState(true);

  // Reset to this invoice's own defaults every time the surface opens — the amount due, in particular,
  // must never carry over from whichever invoice was open here last.
  useEffect(() => {
    if (!open) return;
    setMethod("bank_transfer");
    setDateReceived(todayISO());
    setAmountInput((amountDueMinor / 100).toFixed(2));
    setNote("");
    setSendReceipt(true);
  }, [open, invoice?.id, amountDueMinor]);

  if (!open || write.hidden) return null;

  const parsedAmountMinor = (() => {
    const n = Number(amountInput);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const amountOverDue = parsedAmountMinor !== null && parsedAmountMinor > amountDueMinor;
  const amountInvalid = parsedAmountMinor === null || parsedAmountMinor <= 0 || amountOverDue;
  const selectedMethod = METHODS.find((m) => m.value === method) ?? METHODS[2];

  async function handleSubmit() {
    if (amountInvalid || write.blocked) return;
    try {
      await write.run({
        invoiceId: invoice.id,
        method,
        dateReceived,
        amountMinor: parsedAmountMinor,
        ...(note.trim() ? { note: note.trim() } : {}),
        sendReceipt,
      });
      onPaid?.();
      onOpenChange?.(false);
    } catch {
      // write.error is already set by useWrite — the surface stays open and shows it (below).
    }
  }

  return (
    <ActionSurface
      kind="dialog"
      testId="mark-paid-dialog"
      title={`Mark ${invoice?.number ?? ""} as paid`}
      busy={write.busy}
      busyLabel="Marking as paid…"
      submitLabel="Mark as paid"
      cancelLabel="Cancel"
      submitDisabled={amountInvalid || !!write.blocked}
      onCancel={() => onOpenChange?.(false)}
      onSubmit={handleSubmit}
      error={write.error ? (
        <>
          <span data-testid="mark-paid-dialog-error-message">{write.error.message}</span>
          {write.error.requestId && (
            <>
              <br />
              <span className="text-mute" data-testid="mark-paid-dialog-error-reference">Reference: {write.error.requestId}</span>
            </>
          )}
        </>
      ) : null}
    >
      <p className="m-0 mb-4 text-ui leading-relaxed text-ink-2">
        Record money that reached you outside Workbench. The invoice closes here and in Stripe, and Stripe stops reminding them.
      </p>

      <SheetRow label="How they paid">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="mark-paid-dialog-method"
                    className="flex h-(--size-control-field) w-full items-center justify-between rounded-control border border-line bg-surface px-3 text-field text-ink">
              <span>{selectedMethod.label}</span>
              <span aria-hidden="true" className="text-mute">⌄</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="mark-paid-dialog-method-menu">
            <DropdownMenuRadioGroup value={method} onValueChange={setMethod}>
              {METHODS.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value} data-testid={`mark-paid-dialog-method-${m.value}`}>
                  {m.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SheetRow>

      <SheetRow label="Date received">
        <DatePicker id="mark-paid-dialog-date" testId="mark-paid-dialog-date" value={dateReceived} onValueChange={setDateReceived} />
      </SheetRow>

      <SheetRow label="Amount" hint={amountOverDue ? `Cannot be more than ${formatMoney(amountDueMinor, invoice?.currency)} due.` : null}>
        <Input name="amount" data-testid="mark-paid-dialog-amount" inputMode="decimal" value={amountInput}
               onChange={(e) => setAmountInput(e.target.value)} />
      </SheetRow>

      <SheetRow label="Note" optional>
        <Input name="note" data-testid="mark-paid-dialog-note" placeholder="Optional" value={note}
               onChange={(e) => setNote(e.target.value)} />
      </SheetRow>

      <SheetRow label="Send a receipt">
        <Switch checked={sendReceipt} onCheckedChange={setSendReceipt} data-testid="mark-paid-dialog-send-receipt" />
      </SheetRow>

      {write.blocked && (
        <DisabledWithReason disabled reason={write.blocked.reason} testId="mark-paid-dialog-blocked">
          Mark as paid needs one more thing before it can run.
        </DisabledWithReason>
      )}
    </ActionSurface>
  );
}
