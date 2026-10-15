// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.011.T1 — ReportSessions › ReportSessionsDidnTTurnUpOrCancelledLateTable: the table as its
// own component. Built on DataTable (kit) from `webui/src/lib/screens/reports/ReportSessions.svelte:272-277`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportSessionsDidnTTurnUpOrCancelledLateTable({ noShowRows }) {
  return (
    <DataTable
      title="Didn't turn up, or cancelled late"
      rows={noShowRows}
      columns={[{ key: "row", label: "Who" }]}
      empty="Nobody missed a session in this period."
    />
  );
}
