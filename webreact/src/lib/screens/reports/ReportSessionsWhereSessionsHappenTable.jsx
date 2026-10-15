// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.011.T2 — ReportSessions › ReportSessionsWhereSessionsHappenTable: the table as its own
// component. Built on DataTable (kit) from `webui/src/lib/screens/reports/ReportSessions.svelte:301-306`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportSessionsWhereSessionsHappenTable({ locationRows }) {
  return (
    <DataTable
      title="Where sessions happen"
      rows={locationRows}
      columns={[{ key: "where", label: "Where" }, { key: "sessions", label: "Sessions" }]}
      empty="Nothing booked in this period yet."
    />
  );
}
