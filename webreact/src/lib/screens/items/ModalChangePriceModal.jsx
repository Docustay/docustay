// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalChangePriceModal — the main form for ModalChangePrice.
// Extracted from webui/src/lib/screens/items/ModalChangePrice.svelte:373-478.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function ModalChangePriceModal({
  open,
  onOpenChange,
  testId,
  resolvedCurrency,
  touchesPhase,
  touchesError,
  whatKeepsWorking,
  loadTouches,
  newPriceText,
  setNewPriceText,
  effectiveFrom,
  setEffectiveFrom,
  busy,
  submitError,
  newPriceMinor,
  newPriceInvalid,
  deltaPct,
  title,
  subtitle,
  confirmLabel,
  touchesRows,
  cancel,
  submit,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      cancelLabel="Cancel"
      confirmLabel={confirmLabel}
      confirmDisabled={newPriceMinor == null || newPriceInvalid}
      busy={busy}
      error={submitError}
      onCancel={cancel}
      onConfirm={submit}
      testId={testId}
    >
      <div className="flex flex-col gap-4">
        {/* New Price Field */}
        <Field orientation="horizontal" data-testid={`${testId}-new-price-field`}>
          <FieldLabel htmlFor={`${testId}-new-price`}>New price</FieldLabel>
          <FieldContent>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 min-h-10 border border-input rounded-lg p-0 px-3 bg-transparent flex-1 ${newPriceInvalid ? "border-bad-border" : ""}`}>
                <span className="text-mute text-sm">
                  {resolvedCurrency === "USD" || !resolvedCurrency ? "$" : resolvedCurrency}
                </span>
                <Input
                  id={`${testId}-new-price`}
                  data-testid={`${testId}-new-price-input`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={newPriceText}
                  onChange={(e) => setNewPriceText(e.target.value)}
                  disabled={busy}
                  className="border-0 bg-transparent p-0 h-auto text-base"
                />
              </div>
              {deltaPct != null && (
                <span data-testid={`${testId}-delta`} className="text-ok text-sm whitespace-nowrap">
                  {deltaPct > 0 ? "+" : ""}{deltaPct}%
                </span>
              )}
            </div>
            {newPriceInvalid && (
              <p data-testid={`${testId}-new-price-error`} className="text-meta text-bad mt-1.5">
                Enter dollars and cents, like 140.00.
              </p>
            )}
          </FieldContent>
        </Field>

        {/* From When Field */}
        <Field orientation="horizontal" data-testid={`${testId}-from-field`}>
          <FieldLabel htmlFor={`${testId}-from`}>From when</FieldLabel>
          <FieldContent>
            <Input
              id={`${testId}-from`}
              data-testid={`${testId}-from-input`}
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={busy}
            />
            <p data-testid={`${testId}-from-hint`} className="text-meta text-mute mt-1.5">
              Give people notice. Most practices pick the start of a month.
            </p>
          </FieldContent>
        </Field>

        {/* Tell Regulars Toggle */}
        <div data-testid={`${testId}-tell-regulars`} className="flex items-start gap-3 py-2.5">
          <DisabledWithReason
            disabled={true}
            reason="Campaign drafts come with Growth"
            testId={`${testId}-tell-regulars-lock`}
          >
            {({ disabled, describedBy }) => (
              <div className="flex items-center gap-3 w-full">
                <div className="flex flex-col flex-1">
                  <span className="text-ui text-ink">Tell everyone who books it regularly</span>
                  <span className="text-meta text-mute mt-0.5">A short note from you, six weeks ahead.</span>
                </div>
                <Switch
                  checked={false}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  data-testid={`${testId}-tell-regulars-switch`}
                />
              </div>
            )}
          </DisabledWithReason>
        </div>

        {/* What This Touches Section */}
        {touchesPhase === "unavailable" && null /* package has no whatKeepsWorking source */}
        {touchesPhase === "loading" && (
          <p data-testid={`${testId}-touches-loading`} className="text-meta text-mute">
            Loading what this affects…
          </p>
        )}
        {touchesPhase === "error" && (
          <ErrorPanel
            subject="What this touches"
            error={touchesError}
            variant="band"
            onRetry={loadTouches}
            testId={`${testId}-touches-error`}
          />
        )}
        {touchesPhase === "ready" && (
          <div data-testid={`${testId}-touches`} className="bg-brand-soft border border-brand-edge rounded-sm p-3 text-sm text-ink">
            <b>What this touches.</b>
            <ul className="mt-2 pl-4.5 flex flex-col gap-1">
              {touchesRows.map((row, i) => (
                <li key={i} data-testid={`${testId}-touches-row-${i}`} className="list-disc">
                  <b>{row.headline}</b> — {row.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DecisionModal>
  );
}
