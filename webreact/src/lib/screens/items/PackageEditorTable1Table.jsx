// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.037.T1 — PackageEditorTable1Table.jsx
// The table component from webui/src/lib/screens/items/PackageEditor.svelte:564-588
// Displays package line items with service, quantity, worth, and remove action.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function PackageEditorTable1Table({ testId, currency, lines, formatMoney, removeLine, setQuantity }) {
  return (
    <table className="w-full border-collapse" data-testid={`${testId}-lines-table`}>
      <thead>
        <tr className="border-t border-line bg-surface-2">
          <th className="h-[36px] border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Service</th>
          <th className="h-[36px] border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">How many</th>
          <th className="h-[36px] border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Worth</th>
          <th className="h-[36px] border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.serviceId} data-testid={`${testId}-line`} className="border-b border-hair hover:bg-surface-soft">
            <td className="h-[40px] border-b border-hair px-4 text-ui text-ink">{line.name}</td>
            <td className="h-[40px] border-b border-hair px-4 text-ui text-ink">
              <Input
                type="number"
                min="1"
                step="1"
                className="w-16"
                data-testid={`${testId}-line-qty`}
                value={String(line.quantity)}
                onChange={(e) => setQuantity(line.serviceId, e.target.value)}
              />
            </td>
            <td className="h-[40px] border-b border-hair px-4 text-ui text-ink tabular-nums" data-testid={`${testId}-line-worth`}>
              {line.unitPriceMinor === undefined ? "—" : formatMoney(line.unitPriceMinor * line.quantity, line.currency ?? currency)}
            </td>
            <td className="h-[40px] border-b border-hair px-4">
              <Button
                variant="ghost"
                size="sm"
                data-testid={`${testId}-line-remove`}
                onClick={() => removeLine(line.serviceId)}
              >
                Remove
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
