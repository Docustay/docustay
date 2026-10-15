// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SplitOfferSheetOfferToSplitSheet — payment plan offer sheet (lines 125-210 of the Svelte source)
// Built on SideSheet. Parent task SplitOfferSheet renders it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { SheetSection, default as SheetRow } from "@/lib/components/kit/SheetRow.jsx";

export default function SplitOfferSheetOfferToSplitSheet({
  open = true,
  onOpenChange = null,
  invoice,
  onClose,
  onSave,
  installments,
  frequency,
  firstDueOn,
  error,
  busy,
  formatMoney,
  handleSave,
  previewRows,
  onInstallmentsChange,
  onFrequencyChange,
  onFirstDueOnChange,
}) {
  if (!open) return null;

  return (
    <SideSheet
      data-testid="money-split-offer-sheet"
      title="Offer to split"
      subtitle="Create a payment plan for this invoice"
      onCancel={onClose}
      onSave={handleSave}
      saveLabel="Offer"
      cancelLabel="Cancel"
      busy={busy}
      error={error}
    >
      <SheetSection title="Payment terms">
        <SheetRow label="Number of payments">
          <Input
            type="number"
            value={installments}
            onChange={(e) => onInstallmentsChange?.(Number(e.target.value))}
            min="2"
            max="12"
            disabled={busy}
          />
        </SheetRow>

        <SheetRow label="Frequency">
          <select
            value={frequency}
            onChange={(e) => onFrequencyChange?.(e.target.value)}
            disabled={busy}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
          >
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </SheetRow>

        <SheetRow label="First payment date">
          <Input
            type="date"
            value={firstDueOn}
            onChange={(e) => onFirstDueOnChange?.(e.target.value)}
            disabled={busy}
          />
        </SheetRow>
      </SheetSection>

      <SheetSection title="Payment schedule (preview)">
        {previewRows.length > 0 ? (
          <>
            <div className="border border-line rounded-lg overflow-hidden mb-3">
              <div className="flex bg-surface-alt border-b border-line">
                <div className="w-20 shrink-0 px-4 py-2.5 text-micro font-medium text-mute">Payment</div>
                <div className="flex-1 px-4 py-2.5 text-micro font-medium text-mute">Due date</div>
                <div className="w-24 shrink-0 px-4 py-2.5 text-micro font-medium text-mute text-right" style={{ fontVariantNumeric: "tabular-nums" }}>Amount</div>
              </div>
              {previewRows.map((row) => (
                <div key={row.n} className="flex border-b border-hair last:border-b-0">
                  <div className="w-20 shrink-0 px-4 py-2.5 text-sm text-ink">#{row.n}</div>
                  <div className="flex-1 px-4 py-2.5 text-sm text-mute">
                    {new Date(row.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                  <div className="w-24 shrink-0 px-4 py-2.5 text-sm text-ink font-medium text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(row.amount_minor, invoice.currency)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-mute leading-normal mt-3">
              This is an estimate. The server will confirm the exact amounts when you save.
            </p>
          </>
        ) : null}
      </SheetSection>
    </SideSheet>
  );
}
