// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.009.T2 — ReportMoney › ReportMoneyWhatYouOweInWorkByPersonTable: the table as its own component.
// Built on DataTable (kit). Parent task `R7.009` renders it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportMoneyWhatYouOweInWorkByPersonTable({ owedRows, owedColumns }) {
  return (
    <DataTable
      title="What you owe in work, by person"
      rows={owedRows}
      columns={owedColumns}
      empty="Nobody is owed anything right now."
    />
  );
}
