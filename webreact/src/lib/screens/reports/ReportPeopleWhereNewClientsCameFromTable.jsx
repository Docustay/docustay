// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.010.T1 — REPORTPEOPLE › WHERE NEW CLIENTS CAME FROM TABLE — the sources table as its own component.
// Built from webui/src/lib/screens/reports/ReportPeople.svelte:276-281.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportPeopleWhereNewClientsCameFromTable({ sources, sourceRows, sourceColumns }) {
  return (
    <DataTable
      title="Where new clients came from"
      rows={sourceRows ?? []}
      columns={sourceColumns ?? []}
      empty="No sources recorded yet."
    />
  );
}
