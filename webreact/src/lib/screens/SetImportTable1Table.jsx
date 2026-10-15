// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.020.T1 — SetImport › SetImportTable1Table: the table as its own component
//
// Ported from webui/src/lib/screens/SetImport.svelte:374-393 — the `<table>` element and
// everything inside it. Built on DataTable (kit).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

export default function SetImportTable1Table({
  fieldOptions,
  columns,
  mapping,
  exampleFor,
  onMappingChange,
}) {
  return (
    <table className="w-full border-collapse" data-testid="import-mapping-table">
      <thead>
        <tr>
          <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-muted-foreground">
            Column in your file
          </th>
          <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-muted-foreground">
            Example
          </th>
          <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-muted-foreground">
            Goes to
          </th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => (
          <tr key={col} className="border-b border-hair last:[&>td]:border-b-0 h-10">
            <td className="border-b border-hair px-4 py-0 text-ui text-muted-foreground truncate max-w-56" title={col}>
              {col}
            </td>
            <td className="border-b border-hair px-4 py-0 text-xs text-muted-foreground">
              {exampleFor(col)}
            </td>
            <td className="border-b border-hair px-4 py-0">
              <NativeSelect
                value={mapping[col] ?? ""}
                onChange={(e) => onMappingChange(col, e.target.value)}
                data-testid={`import-map-${col}`}
              >
                {fieldOptions.map((opt) => (
                  <NativeSelectOption key={opt.key ?? ""} value={opt.key ?? ""}>
                    {opt.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
