// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.053.M1 — PaymentLinks › PaymentLinksPaymentLinksCreateSheet: the create sheet
// Ported from webui/src/lib/screens/money/PaymentLinks.svelte:341-410
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

export default function PaymentLinksPaymentLinksCreateSheet({
  open = false,
  onOpenChange = null,
  links = [],
  error = null,
  createBusy = false,
  createError = null,
  createTitle = "",
  setCreateTitle = null,
  createVariant = "plain",
  setCreateVariant = null,
  createAmountMinor = "",
  setCreateAmountMinor = null,
  createMinAmountMinor = "",
  setCreateMinAmountMinor = null,
  submitCreate = null,
  closeCreate = null,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title="New link"
      testId="payment-links-create-sheet"
      onCancel={closeCreate}
      onSave={submitCreate}
      busy={createBusy}
      error={createError}
    >
      <Field orientation="horizontal" data-testid="payment-links-create-title">
        <FieldLabel htmlFor="create-title">What it's for</FieldLabel>
        <FieldContent>
          <Input
            id="create-title"
            data-testid="payment-links-create-title-input"
            value={createTitle}
            onChange={(e) => setCreateTitle?.(e.target.value)}
            placeholder="e.g. Single session"
            required
          />
        </FieldContent>
      </Field>

      <Field orientation="horizontal" data-testid="payment-links-create-variant">
        <FieldLabel htmlFor="create-variant">Type</FieldLabel>
        <FieldContent>
          <NativeSelect
            id="create-variant"
            data-testid="payment-links-create-variant-select"
            value={createVariant}
            onChange={(e) => setCreateVariant?.(e.target.value)}
          >
            <NativeSelectOption value="plain">Fixed price</NativeSelectOption>
            <NativeSelectOption value="pick_amount">Let them choose</NativeSelectOption>
          </NativeSelect>
        </FieldContent>
      </Field>

      {createVariant === "plain" && (
        <Field orientation="horizontal" data-testid="payment-links-create-amount">
          <FieldLabel htmlFor="create-amount">Amount</FieldLabel>
          <FieldContent>
            <div className="flex items-center gap-1">
              <span className="text-mute font-medium">$</span>
              <Input
                id="create-amount"
                data-testid="payment-links-create-amount-input"
                type="number"
                step="0.01"
                min="0"
                value={createAmountMinor}
                onChange={(e) => setCreateAmountMinor?.(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </FieldContent>
        </Field>
      )}

      {createVariant === "pick_amount" && (
        <Field orientation="horizontal" data-testid="payment-links-create-min-amount">
          <FieldLabel htmlFor="create-min-amount">Minimum (optional)</FieldLabel>
          <FieldContent>
            <div className="flex items-center gap-1">
              <span className="text-mute font-medium">$</span>
              <Input
                id="create-min-amount"
                data-testid="payment-links-create-min-amount-input"
                type="number"
                step="0.01"
                min="0"
                value={createMinAmountMinor}
                onChange={(e) => setCreateMinAmountMinor?.(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </FieldContent>
        </Field>
      )}
    </SideSheet>
  );
}
