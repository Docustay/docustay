import DataTable from "@/lib/lists/DataTable.jsx";

export default function ReportLeadsWhoDidnTTable({
  didntRows = [],
  didntColumns = [],
}) {
  return (
    <DataTable
      title="Who didn't"
      rows={didntRows}
      columns={didntColumns}
      empty="Everyone who enquired became a client."
    />
  );
}
