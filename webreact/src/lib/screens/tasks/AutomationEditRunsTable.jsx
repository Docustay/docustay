// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.002.T1 — AutomationEditRunsTable.jsx — the table extracted from AutomationEdit
// Props: { automation }
// Archetype: DataTable (inside EditorPage)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function AutomationEditRunsTable({ automation }) {
  const columns = [
    { key: "ran_at", label: "When" },
    { key: "recipient_name", label: "Who" },
    { key: "outcome", label: "What came of it" },
  ];

  const rows = automation.runs || [];

  return (
    <DataTable
      title="Runs"
      rows={rows}
      columns={columns}
      empty="No runs yet"
    />
  );
}
