// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UpdateCardSheetMoneyUpdateCardSheet — R6.030.M1
// The sheet content from webui/src/lib/money/UpdateCardSheet.svelte:62-120. Parent task R6.030
// renders this.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function UpdateCardSheetMoneyUpdateCardSheet({
  subscription,
  busy,
  error,
  channel,
  message,
  handleSave,
  handleCancel,
  dunningConfig,
  formatMonth,
  onChannelChange,
  onMessageChange,
}) {
  return (
    // ★ the maintainer, 29 Sep 2026 — SLIDEUP-AUDIT.md names this file's own frame (MoneyUpdateCard) as a
      //   `modal` kind: "where the frame is a centred box, it stays one." A short "ask them to
      //   update their card" prompt is exactly that, not a full editor.
    <SideSheet
      variant="modal"
      title={`Ask ${subscription?.payerName} to update his card`}
      subtitle={`His Visa ending ${subscription?.cardLast4} expires in October. November's payment would fail.`}
      saveLabel="Send it"
      cancelLabel="Cancel"
      busy={busy}
      error={error}
      onCancel={handleCancel}
      onSave={handleSave}
      testId="money-update-card-sheet"
    >
      <SheetSection>
        <SheetRow label="How">
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="email"
                checked={channel === "email"}
                onChange={(e) => onChannelChange?.(e.target.value)}
              />
              <span>Email</span>
            </label>
            <DisabledWithReason disabled={true} reason="Text messages aren't set up yet">
              {({ disabled, describedBy }) => (
                <label className={`flex items-center gap-2 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="radio"
                    value="text"
                    checked={channel === "text"}
                    disabled={disabled}
                    onChange={(e) => !disabled && onChannelChange?.(e.target.value)}
                    aria-describedby={describedBy}
                  />
                  <span>Text</span>
                </label>
              )}
            </DisabledWithReason>
          </div>
        </SheetRow>
      </SheetSection>

      <SheetSection>
        <SheetRow
          label="What it says"
          hint="He gets a secure link. Neither you nor we ever see the number."
        >
          <div className="space-y-2">
            <textarea
              value={message}
              onChange={(e) => onMessageChange?.(e.target.value)}
              placeholder={`Hi ${subscription?.payerName} — your card is about to expire, so ${formatMonth?.()}'s payment will be the last one it covers. Takes a minute to update, link below.`}
              rows={4}
              className="w-full px-3 py-2 border border-line rounded-lg text-ui text-ink font-sans resize-vertical"
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm text-primary font-medium cursor-pointer hover:opacity-80"
              >
                ✨ Write with AI
              </button>
            </div>
          </div>
        </SheetRow>
      </SheetSection>

      <SheetSection>
        <div
          className="rounded-lg px-3.75 py-3.25 text-sm leading-relaxed"
          style={{ backgroundColor: "var(--color-brand-soft)", color: "#3B3A6B" }}
        >
          <b>If he does nothing.</b> {formatMonth?.()} goes through fine. The month after fails, we try {dunningConfig?.retries} times over {dunningConfig?.days} days, tell him each time, then pause the subscription rather than let it pile up.
        </div>
      </SheetSection>
    </SideSheet>
  );
}
