// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.019.T1 — LineItemTable › LineItemTableTable1Table: the table as its own component, built on
// DataTable (kit) — inside LedgerPage when the source used LedgerPage. Parent task R6.019 renders
// it. Ported from webui/src/lib/money/LineItemTable.svelte:38-67 — same structure, behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { MoreVertical } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/stroke.js";

// ★ the maintainer, 1 Oct 2026 — "I want real time listeners when I am creating the invoice putting in
//   numbers... it needs to update the invoice in real time in the preview, not have to click
//   away." MEASURED root cause: this table never had an input for an EXISTING line's qty/price at
//   all — both rendered as plain text, with no way to change either once a line was added (only
//   removal). Nothing to debounce; there was no field to debounce FROM. InvoiceEditor.jsx's own
//   500ms-after-last-change sync effect already reacts to every `setLineItems` call — no new
//   library needed, MIT-licensed or otherwise. These are plain `defaultValue` inputs rather than
//   React-controlled ones ON PURPOSE: a controlled input whose `value` round-trips back from the
//   parent's re-rendered `lineItems` prop reformats itself (e.g. "5.00") on every keystroke,
//   which eats the decimal point the user is mid-typing. `key={line.id}` on the row already
//   remounts these on add/remove, so `defaultValue` still resets correctly for a genuinely new or
//   deleted line — only a same-line's own typing is left alone in between.
function QtyInput({ value, onChange, testId }) {
  function commit(raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) onChange(n);
  }
  return (
    <input
      type="number"
      min="1"
      step="1"
      inputMode="numeric"
      defaultValue={value ?? 1}
      onChange={(e) => commit(e.target.value)}
      className="w-16 text-right bg-transparent border border-transparent hover:border-line focus:border-line focus:outline-none rounded px-1 py-0.5 text-ui text-ink"
      data-testid={testId}
    />
  );
}

function PriceInput({ valueMinor, onChangeMinor, testId }) {
  function commit(raw) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) onChangeMinor(Math.round(n * 100));
  }
  return (
    <div className="flex items-center justify-end gap-0.5">
      <span className="text-mute">$</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        defaultValue={((valueMinor ?? 0) / 100).toFixed(2)}
        onChange={(e) => commit(e.target.value)}
        className="w-20 text-right bg-transparent border border-transparent hover:border-line focus:border-line focus:outline-none rounded px-1 py-0.5 text-ui text-ink"
        data-testid={testId}
      />
    </div>
  );
}

export default function LineItemTableTable1Table({ lineItems, formatAmount, handleRemove, handleEdit = null }) {
  return (
    <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="line-item-table">
      <table className="w-full border-collapse" data-testid="line-item-rows">
        <thead>
          <tr>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="line-item-th-what">
              What
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-right text-caption font-medium text-mute" data-testid="line-item-th-qty">
              Qty
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-right text-caption font-medium text-mute" data-testid="line-item-th-each">
              Each
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-right text-caption font-medium text-mute" data-testid="line-item-th-total">
              Total
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-center text-caption font-medium text-mute w-10" data-testid="line-item-th-menu">
              {/* actions column header */}
            </th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((line) => (
            <tr key={line.id} className="border-b border-hair last:[&>td]:border-b-0 h-10" data-testid="line-item-row">
              <td className="border-b border-hair px-4 py-0 text-ui text-ink" data-testid="line-item-cell-what">
                {line.name}
              </td>
              <td className="border-b border-hair px-4 py-0 text-ui text-ink text-right" data-testid="line-item-cell-qty">
                {handleEdit ? (
                  <QtyInput
                    value={line.quantity}
                    onChange={(n) => handleEdit(line.id, { quantity: n })}
                    testId="line-item-qty-input"
                  />
                ) : (
                  line.quantity
                )}
              </td>
              <td className="border-b border-hair px-4 py-0 text-ui text-ink text-right" data-testid="line-item-cell-each">
                {handleEdit ? (
                  <PriceInput
                    valueMinor={line.unitAmount}
                    onChangeMinor={(n) => handleEdit(line.id, { unitAmount: n })}
                    testId="line-item-price-input"
                  />
                ) : (
                  formatAmount(line.unitAmount)
                )}
              </td>
              <td className="border-b border-hair px-4 py-0 text-ui text-ink text-right" data-testid="line-item-cell-total">
                {formatAmount((line.unitAmount * line.quantity) - (line.discount || 0) + (line.tax || 0))}
              </td>
              <td className="border-b border-hair px-4 py-0 text-center" data-testid="line-item-cell-menu">
                <button
                  onClick={() => handleRemove(line.id)}
                  aria-label="Delete line item"
                  className="inline-flex items-center justify-center w-8 h-8 border border-line rounded-lg bg-surface text-mute hover:border-destructive hover:text-destructive hover:bg-destructive-soft transition-all"
                  data-testid="line-item-delete-btn"
                >
                  <MoreVertical size={16} strokeWidth={ICON_STROKE} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
