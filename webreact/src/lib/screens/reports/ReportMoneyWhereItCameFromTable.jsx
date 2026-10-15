// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.009.T1 — ReportMoney › ReportMoneyWhereItCameFromTable: the table as its own component.
// Built on DataTable (kit). Parent task `R7.009` renders it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportMoneyWhereItCameFromTable({ itemRows, itemColumns }) {
  return (
    <DataTable
      title="Where it came from"
      rows={itemRows}
      columns={itemColumns}
      empty="Nothing sold in this period yet."
    />
  );
}
