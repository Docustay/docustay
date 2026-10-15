// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ReportCoachesTable1Table — the coaches report table. Ported from
// webui/src/lib/screens/reports/ReportCoaches.svelte:177-182 (the <DataTable> element).
// Props: rows, displayRows, columns (exactly the parent-scope values the source reads).
// Uses: DataTable (kit component).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportCoachesTable1Table({ rows = [], displayRows = [], columns = [] }) {
  return (
    <DataTable
      title=""
      rows={displayRows}
      empty="Nothing to show yet"
      columns={columns}
    />
  );
}
