// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LineItemTable — Shows line items in a table with add/edit/delete functionality.
// "+ Add something — A service, a package, or a plan." + "Add a discount"
// Ported from webui/src/lib/money/LineItemTable.svelte — same props, testids, and behavior.
// This component extracts the table into LineItemTableTable1Table subtask.
// ★ the maintainer, 29 Sep 2026 — `onAddLine` used to be a bare click-through to the caller (InvoiceEditor.jsx),
//   which navigated to a route that has never existed. AddLineRow is the real picker, inline, the
//   same expand-in-place pattern "Add a discount" already used — `onAddLine` now receives the
//   chosen line's data instead of being a no-argument click signal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import LineItemTableTable1Table from "./LineItemTableTable1Table.jsx";
import DiscountRow from "./DiscountRow.jsx";
import AddLineRow from "./AddLineRow.jsx";

function formatAmount(minor) {
  if (!minor && minor !== 0) return "$0";
  return `$${(minor / 100).toFixed(2)}`;
}

export default function LineItemTable({
  lineItems = [],
  onAddLine = null,
  onRemoveLine = null,
  onEditLine = null,
  onAddDiscount = null,
  testId = "money-line-item-table",
}) {
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [showAddLineForm, setShowAddLineForm] = useState(false);

  function handleRemove(id) {
    onRemoveLine?.(id);
  }

  function handleEdit(id, patch) {
    onEditLine?.(id, patch);
  }

  function handleAddDiscount(discount) {
    onAddDiscount?.(discount);
    setShowDiscountForm(false);
  }

  function handleAddLine(line) {
    onAddLine?.(line);
    setShowAddLineForm(false);
  }

  return (
    <div className="w-full" data-testid={testId}>
      <div className="mb-3">
        <LineItemTableTable1Table
          lineItems={lineItems}
          formatAmount={formatAmount}
          handleRemove={handleRemove}
          handleEdit={onEditLine ? handleEdit : null}
        />
      </div>

      <div className="mt-3" data-testid={`${testId}-actions`}>
        <div className="flex items-center gap-3 p-3.5 border border-line rounded-lg bg-surface" data-testid={`${testId}-add-line`}>
          <button
            className="flex-1 flex flex-col items-start gap-1 bg-none border-none p-0 cursor-pointer text-left"
            onClick={() => setShowAddLineForm(!showAddLineForm)}
            data-testid={`${testId}-add-line-btn`}
          >
            <span className="font-medium text-sm text-ink" data-testid={`${testId}-add-line-title`}>
              + Add something
            </span>
            <span className="text-xs text-mute" data-testid={`${testId}-add-line-desc`}>
              A service, a package, or a plan.
            </span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDiscountForm(!showDiscountForm)}
            data-testid={`${testId}-add-discount-btn`}
          >
            Add a discount
          </Button>
        </div>
      </div>

      {showAddLineForm && (
        <AddLineRow
          onAdd={handleAddLine}
          onCancel={() => setShowAddLineForm(false)}
          testId={`${testId}-add-line-row`}
        />
      )}

      {showDiscountForm && (
        <DiscountRow
          onAdd={handleAddDiscount}
          onCancel={() => setShowDiscountForm(false)}
          testId={`${testId}-discount-row`}
        />
      )}
    </div>
  );
}
