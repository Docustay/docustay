import { Button } from "@/lib/components/ui/button.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function GiftCardsPageItemsGiftCardsIssueSheet({
  open,
  onOpenChange,
  currency,
  formatMoney,
  amountInput,
  holderEmail,
  issueBusy,
  issueError,
  issuedResult,
  closeIssueSheet,
  submitIssue,
  copySecret,
}) {
  if (!open) return null;

  const issuedFooter = (
    <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
      <Button
        type="button"
        data-testid="items-gift-cards-issued-done"
        onClick={closeIssueSheet}
      >
        Done
      </Button>
    </footer>
  );

  return (
    <SideSheet
      title={
        issuedResult
          ? `Gift card ${issuedResult.number}`
          : "How they're sold"
      }
      subtitle={issuedResult ? null : "Issue a card by hand for someone who asks in person or by phone."}
      onCancel={closeIssueSheet}
      onSave={issuedResult ? null : submitIssue}
      saveLabel="Issue the card"
      busy={issueBusy}
      error={issuedResult ? null : issueError}
      footer={issuedResult ? issuedFooter : undefined}
      testId="items-gift-cards-issue-sheet"
    >
      {issuedResult ? (
        <div className="flex flex-col gap-4" data-testid="items-gift-cards-issued">
          <p
            className="m-0 text-title font-medium text-ink"
            style={{ fontSize: "var(--fs-title)" }}
          >
            {formatMoney(issuedResult.amountMinor, currency)} on{" "}
            {issuedResult.number}
          </p>
          <div className="flex items-center gap-2 rounded-sm border border-line bg-surface-sunken p-3">
            <code
              className="flex-1 text-sm leading-relaxed font-variant-numeric-tabular-nums"
              data-testid="items-gift-cards-issued-code"
              style={{ letterSpacing: "0.04em", userSelect: "all" }}
            >
              {issuedResult.secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="items-gift-cards-issued-copy"
              onClick={copySecret}
            >
              Copy
            </Button>
          </div>
          <p className="m-0 text-sm text-mute" data-testid="items-gift-cards-issued-warning">
            This is the only time the code is shown.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4" style={{ padding: "20px" }}>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="gc-amount">
              Amount{currency ? ` (${currency})` : ""}
            </FieldLabel>
            <FieldContent>
              <Input
                id="gc-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => {}}
                disabled={!currency}
                data-testid="items-gift-cards-amount"
              />
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="gc-holder-email">
              Holder email<span style={{ color: "var(--ink-faint)", fontSize: "var(--fs-xs)", marginLeft: "5px" }}>optional</span>
            </FieldLabel>
            <FieldContent>
              <Input
                id="gc-holder-email"
                type="email"
                value={holderEmail}
                onChange={(e) => {}}
                data-testid="items-gift-cards-holder-email"
              />
              <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-muted)", margin: "6px 0 0" }}>
                Leave blank and the card stays "Not yet claimed" until someone links it.
              </p>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="gc-expiry">Expires after</FieldLabel>
            <FieldContent>
              <DisabledWithReason
                disabled={true}
                reason="Locked for now — expiry rules differ by state and several ban it outright. This unlocks when we can check your state's rules for you."
                testId="items-gift-cards-expiry"
              >
                {({ disabled, describedBy }) => (
                  <Input
                    id="gc-expiry"
                    value=""
                    placeholder="Never"
                    disabled={disabled}
                    aria-describedby={describedBy}
                    data-testid="items-gift-cards-expiry-input"
                  />
                )}
              </DisabledWithReason>
            </FieldContent>
          </Field>
        </div>
      )}
    </SideSheet>
  );
}
