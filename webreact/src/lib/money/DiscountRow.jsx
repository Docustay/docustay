// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DiscountRow — Form for adding a discount: amount OR percent (mutually exclusive).
// Ported from webui/src/lib/money/DiscountRow.svelte — same props, testids, and behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function DiscountRow({ onAdd = null, onCancel = null, testId = "money-discount-row" }) {
  const [kind, setKind] = useState("percent");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");

  function handleAdd() {
    if (kind === "percent" && percent) {
      onAdd?.({ kind: "percent", value: parseFloat(percent) });
      setPercent("");
    } else if (kind === "amount" && amount) {
      onAdd?.({ kind: "amount", value: parseFloat(amount) });
      setAmount("");
    }
  }

  function handleCancel() {
    setPercent("");
    setAmount("");
    onCancel?.();
  }

  return (
    <div className="border border-line rounded-lg p-3.5 bg-surface my-3" data-testid={testId}>
      <div className="flex gap-3 mb-3" data-testid={`${testId}-controls`}>
        <div className="flex-shrink-0 w-[140px]" data-testid={`${testId}-type`}>
          <NativeSelect
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            data-testid={`${testId}-type-select`}
          >
            <NativeSelectOption value="percent">Percent off</NativeSelectOption>
            <NativeSelectOption value="amount">Amount off</NativeSelectOption>
          </NativeSelect>
        </div>

        {kind === "percent" ? (
          <div className="flex-1 relative flex items-center" data-testid={`${testId}-input-percent`}>
            <Input
              type="number"
              placeholder="0"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              min="0"
              max="100"
              className="pr-8"
              data-testid={`${testId}-percent-input`}
            />
            <span className="absolute right-3 text-sm text-mute font-medium pointer-events-none" data-testid={`${testId}-percent-unit`}>
              %
            </span>
          </div>
        ) : (
          <div className="flex-1 relative flex items-center" data-testid={`${testId}-input-amount`}>
            <span className="absolute left-3 text-sm text-mute font-medium pointer-events-none" data-testid={`${testId}-amount-currency`}>
              $
            </span>
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
              className="pl-8 pr-3"
              data-testid={`${testId}-amount-input`}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end" data-testid={`${testId}-actions`}>
        <Button
          variant="ghost"
          onClick={handleCancel}
          data-testid={`${testId}-cancel-btn`}
        >
          Cancel
        </Button>
        <Button
          onClick={handleAdd}
          disabled={kind === "percent" ? !percent : !amount}
          data-testid={`${testId}-add-btn`}
        >
          Add discount
        </Button>
      </div>
    </div>
  );
}
