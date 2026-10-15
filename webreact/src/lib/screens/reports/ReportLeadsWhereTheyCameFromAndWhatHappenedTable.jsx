import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportLeadsWhereTheyCameFromAndWhatHappenedTable({
  enquiries,
  sourceRows = [],
  sourceColumns = [],
}) {
  return (
    <DataTable
      title="Where they came from, and what happened"
      rows={sourceRows}
      columns={sourceColumns}
      empty="No enquiries in this period yet."
    />
  );
}
