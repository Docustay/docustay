// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServiceEditorTable1Table — price variations table rendered inside ServiceEditor.
// Ported from webui/src/lib/screens/items/ServiceEditor.svelte:903-914.
// Props: { DELIVERY_MODE_LABEL, variationRows, locationName } — parent-scope values the source reads.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { formatValue } from "@/lib/format.js";

export default function ServiceEditorTable1Table({ DELIVERY_MODE_LABEL, variationRows = [], locationName }) {
  if (!variationRows || variationRows.length === 0) {
    return null;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Where</th>
          <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">How</th>
          <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Price</th>
        </tr>
      </thead>
      <tbody>
        {variationRows.map((row) => (
          <tr key={row.id} className="last:[&>td]:border-b-0">
            <td className="h-10 border-b border-hair px-4 text-ui text-ink">
              {row.location_id ? locationName(row.location_id) : "Any location"}
            </td>
            <td className="h-10 border-b border-hair px-4 text-ui text-ink">
              {row.delivery_mode ? (DELIVERY_MODE_LABEL[row.delivery_mode] ?? row.delivery_mode) : "Any"}
            </td>
            <td className="h-10 border-b border-hair px-4 text-ui text-ink">
              {formatValue(row.amount_minor, "money", { currency: row.currency })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
