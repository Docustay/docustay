// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PaymentPlanSheet — P3.U15 (W8). Built FROM specs/mockups/PaymentPlanOffer.frame.html's right-hand
// sheet (structure, order, labels, every text run). There is no Svelte source — these controls are
// new — so behaviour comes from the WIRING-MAP rows for `payment-plan-offer` / `payment-plan-cancel`
// (§3.3/§3.4 and the frame's own generated "What every control on this frame does" block):
//   · Offer a payment plan (`offerPaymentPlan`, CONTRACTS §4 `POST /api/money/payment-plans/offer`) is
//     one transaction; a Stripe refusal rolls it back and this surface stays open, showing Stripe's own
//     reason and reference (write.error) — never a re-worded one (api.js's own rule).
//   · Cancel a payment plan (`cancelPaymentPlan`, `POST /api/money/payment-plans/cancel {planId}`) is
//     Stripe first the same way; on success the remaining rows show Cancelled and the invoice is open
//     again — this component just hands the result back to the host screen (`onOffered`) to refetch.
// The frame draws ONLY the "no plan yet" state (`invoice.paymentPlan` absent). When the invoice already
// carries a plan (`invoice.paymentPlan` present) this sheet shows that plan instead of the create form —
// same section headers ("The plan" / "They see"), same fields, now read-only — with "Cancel the plan"
// in the footer in place of "Send the offer": the only way both calls this component makes (field 4) can
// ever fire from the one signature the task names.
// ★ Only the ACTUAL WRITE is gated on permission (WriteButton's own `hidden`/`blocked`, same convention
//   as AdjustCreditSheet/CreditNoteSheet): the fields and the computed "They see" figure stay visible to
//   a denied viewer (positive control) — only the write control itself is absent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const FREQUENCIES = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const MIN_INSTALLMENTS = 2;
const MAX_INSTALLMENTS = 12;
const DEFAULT_INSTALLMENTS = "3";
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Every payment is the ceiling of an even split; the remainder lands on the last one — the frame's own
 *  example: $590.00 split 3 ways → $196.67 · $196.67 · $196.66. */
function splitInstallments(totalMinor, n) {
  if (!Number.isFinite(totalMinor) || !Number.isInteger(n) || n < MIN_INSTALLMENTS) return [];
  const perMinor = Math.ceil(totalMinor / n);
  const lastMinor = totalMinor - perMinor * (n - 1);
  return [...Array.from({ length: n - 1 }, () => perMinor), lastMinor];
}

function frequencyLabel(value) {
  return FREQUENCIES.find((f) => f.value === value)?.label ?? value;
}

/**
 * @param invoice { id, amountDueMinor, currency?, blockedReason?, paymentPlan? } — the host screen's
 *   invoice record. `paymentPlan`, when present (`{ id, totalMinor, installments, frequency, firstDueOn }`),
 *   switches this sheet from "offer" to "manage" (read-only plan + Cancel the plan). `blockedReason`
 *   (e.g. "Connect Stripe first — Settings › Money.") is the missing prerequisite, if any — a permission
 *   (`invoice.edit`) is decided by `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after a successful write.
 * @param onOffered — called (with the write's result) after the plan is offered or cancelled, so the
 *   host screen can refetch.
 */
export default function PaymentPlanSheet({ invoice, open, onOpenChange, onOffered }) {
  const offerWrite = useWrite("offerPaymentPlan", { blockedReason: invoice?.blockedReason ?? null });
  const cancelWrite = useWrite("cancelPaymentPlan", { blockedReason: invoice?.blockedReason ?? null });
  const currency = invoice?.currency ?? "usd";
  const amountDueMinor = invoice?.amountDueMinor ?? 0;
  const existingPlan = invoice?.paymentPlan ?? null;

  const [installmentsInput, setInstallmentsInput] = useState(DEFAULT_INSTALLMENTS);
  const [frequency, setFrequency] = useState("month");
  const [firstDueOn, setFirstDueOn] = useState(todayISO());

  // Reset to this sheet's own defaults every time it opens, or for a different invoice.
  useEffect(() => {
    if (!open) return;
    setInstallmentsInput(DEFAULT_INSTALLMENTS);
    setFrequency("month");
    setFirstDueOn(todayISO());
  }, [open, invoice?.id]);

  if (!open) return null;

  const parsedInstallments = Number.parseInt(installmentsInput, 10);
  const installmentsInvalid = !Number.isInteger(parsedInstallments)
    || parsedInstallments < MIN_INSTALLMENTS || parsedInstallments > MAX_INSTALLMENTS;
  const firstDueOnInvalid = !firstDueOn;
  const offerInvalid = installmentsInvalid || firstDueOnInvalid;
  const selectedFrequency = FREQUENCIES.find((f) => f.value === frequency) ?? FREQUENCIES[1];

  const previewInstallments = installmentsInvalid ? [] : splitInstallments(amountDueMinor, parsedInstallments);
  const existingInstallments = existingPlan
    ? splitInstallments(existingPlan.totalMinor ?? amountDueMinor, existingPlan.installments)
    : [];

  async function handleOffer() {
    if (offerInvalid || offerWrite.blocked) return;
    const result = await offerWrite.run({
      invoiceId: invoice.id,
      installments: parsedInstallments,
      frequency,
      firstDueOn,
    });
    onOffered?.(result);
    onOpenChange?.(false);
  }

  async function handleCancel() {
    if (!existingPlan || cancelWrite.blocked) return;
    const result = await cancelWrite.run({ planId: existingPlan.id });
    onOffered?.(result);
    onOpenChange?.(false);
  }

  const activeWrite = existingPlan ? cancelWrite : offerWrite;

  return (
    <SideSheet
      title={existingPlan ? "The payment plan" : "Offer a payment plan"}
      testId="payment-plan-sheet"
      busy={activeWrite.busy}
      onCancel={() => onOpenChange?.(false)}
      error={activeWrite.error
        ? `${activeWrite.error.message}${activeWrite.error.requestId ? ` (ref: ${activeWrite.error.requestId})` : ""}`
        : null}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" data-testid="payment-plan-dismiss" onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          {existingPlan ? (
            <WriteButton write={cancelWrite} testId="payment-plan-cancel" type="button" busyLabel="Cancelling…"
                         onClick={handleCancel}>
              Cancel the plan
            </WriteButton>
          ) : (
            <WriteButton write={offerWrite} testId="payment-plan-offer" type="button" busyLabel="Sending…"
                         disabled={offerInvalid} onClick={handleOffer}>
              Send the offer
            </WriteButton>
          )}
        </footer>
      )}
    >
      <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">The plan</div>

      {existingPlan ? (
        <>
          <SheetRow label="Split">
            <Figure size="md" testId="payment-plan-existing-split">
              {formatMoney(existingPlan.totalMinor ?? amountDueMinor, currency)} into {existingPlan.installments} payments
            </Figure>
          </SheetRow>
          <SheetRow label="Every">
            <span className="text-field text-ink" data-testid="payment-plan-existing-frequency">
              {frequencyLabel(existingPlan.frequency)}
            </span>
          </SheetRow>
          <SheetRow label="First payment">
            <span className="text-field text-ink" data-testid="payment-plan-existing-first-payment">
              {existingPlan.firstDueOn}
            </span>
          </SheetRow>

          <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">They see</div>

          <SheetRow label="Payments">
            <Figure size="md" testId="payment-plan-preview">
              {existingInstallments.length ? existingInstallments.map((m) => formatMoney(m, currency)).join(" · ") : "—"}
            </Figure>
          </SheetRow>

          <SheetRow label="Agreement">
            <span className="text-field text-ink">Payment plan terms — they sign before the first payment</span>
          </SheetRow>
        </>
      ) : (
        <>
          <SheetRow label="Split">
            <div className="flex items-center gap-2.5">
              <Input name="installments" data-testid="payment-plan-installments" inputMode="numeric" type="number"
                     min={MIN_INSTALLMENTS} max={MAX_INSTALLMENTS} value={installmentsInput}
                     onChange={(e) => setInstallmentsInput(e.target.value)} />
              <span className="whitespace-nowrap text-field text-ink" data-testid="payment-plan-split-preview">
                {formatMoney(amountDueMinor, currency)} into {installmentsInput || "…"} payments
              </span>
            </div>
          </SheetRow>

          <SheetRow label="Every">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-testid="payment-plan-frequency"
                        className="flex h-(--size-control-field) w-full items-center justify-between rounded-control border border-line bg-surface px-3 text-field text-ink">
                  <span>{selectedFrequency.label}</span>
                  <span aria-hidden="true" className="text-mute">⌄</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent data-testid="payment-plan-frequency-menu">
                <DropdownMenuRadioGroup value={frequency} onValueChange={setFrequency}>
                  {FREQUENCIES.map((f) => (
                    <DropdownMenuRadioItem key={f.value} value={f.value} data-testid={`payment-plan-frequency-${f.value}`}>
                      {f.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SheetRow>

          <SheetRow label="First payment">
            <DatePicker id="payment-plan-first-payment" testId="payment-plan-first-payment" value={firstDueOn} onValueChange={setFirstDueOn} />
          </SheetRow>

          <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">They see</div>

          <SheetRow label="Payments">
            <Figure size="md" testId="payment-plan-preview">
              {previewInstallments.length ? previewInstallments.map((m) => formatMoney(m, currency)).join(" · ") : "—"}
            </Figure>
          </SheetRow>

          <SheetRow label="Agreement">
            <span className="text-field text-ink">Payment plan terms — they sign before the first payment</span>
          </SheetRow>
        </>
      )}
    </SideSheet>
  );
}
