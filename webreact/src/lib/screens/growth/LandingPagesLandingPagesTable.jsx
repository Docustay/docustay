// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LandingPagesLandingPagesTable — the landing pages table component. Ported from
// webui/src/lib/screens/growth/LandingPages.svelte lines 241-251.
// §13.3 — a hand-written table (was the DataTable kit, which has only a right-click menu) so it can carry the shared
// selection cells and the row "…" menu; RowActions adds the shared Delete itself (Owner/Admin). This screen passes
// only its own non-delete actions (Edit, Publish) through `rowActions`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";

const TH = "h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute";
const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

function cell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function LandingPagesLandingPagesTable({
  pages = [],
  rowActions = null,
  bulk = null,
}) {
  const columns = [
    { key: "slug", label: "Slug" },
    { key: "title", label: "Title" },
    { key: "is_published", label: "Published" },
    { key: "created_at", label: "Created" },
  ];
  const safeRows = Array.isArray(pages) ? pages : [];

  return (
    <section data-testid="data-table" data-rows={safeRows.length}>
      <h1 className="mb-4.5 text-page-title font-medium text-ink">Landing Pages</h1>
      {safeRows.length === 0 ? (
        <p className="text-ui text-mute" data-testid="empty">No landing pages found.</p>
      ) : (
        <div className="overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={safeRows} />
                {columns.map((c) => <th key={c.key} scope="col" className={TH}>{c.label}</th>)}
                <th scope="col" className={`${TH} text-right`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {safeRows.map((row, i) => (
                <tr key={row.id ?? i} className="last:[&>td]:border-b-0">
                  <BulkRowCell bulk={bulk} id={row.id} />
                  {columns.map((c) => <td key={c.key} className={TD}>{cell(row[c.key])}</td>)}
                  <td className={`${TD} text-right`} data-testid="cell-row-actions" onClick={(e) => e.stopPropagation()}>
                    <RowActions row={row} actions={rowActions ? rowActions(row) : []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
