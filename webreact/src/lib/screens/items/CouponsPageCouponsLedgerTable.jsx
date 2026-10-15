// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CouponsPageCouponsLedgerTable — the table component for CouponsPage (R5.026.T1).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { ChevronRight, ChevronDown } from "lucide-react";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

const ICON_STROKE = 2;

function codeStatus(code) {
  return code.active ? { label: "Active", tone: "ok" } : { label: "Inactive", tone: "neutral" };
}

export default function CouponsPageCouponsLedgerTable({
  path,
  onNavigate,
  go,
  viewData,
  fetchError,
  load,
  phase,
  canWrite,
  codesOf,
  filtered,
  displayPhase,
  showControls,
  clearFilters,
  emptyPropFor,
  summaryText,
  expandedIds,
  toggleExpanded,
  togglingId,
  setActive,
  rowActions,
  bulk = null,
}) {
  return (
    <div className="w-full rounded-card border border-line bg-surface overflow-hidden">
      <table className="w-full border-collapse" data-testid="coupons-table">
          <thead>
            <tr>
              <BulkHeadCell bulk={bulk} rows={filtered} />
              <th className="w-8 border-b border-line bg-surface-sunken" aria-hidden="true"></th>
              <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="coupons-th-name">Name</th>
              <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="coupons-th-codes">Codes</th>
              <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="coupons-th-active">Active</th>
              <th className="h-9 px-4 py-0 text-right text-sm font-medium text-mute border-b border-line bg-surface-sunken" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const codes = codesOf(row);
              const isOpen = expandedIds.has(row.id);
              return [
                (<tr key={`main-${row.id}`} data-testid="coupons-row" data-id={row.id}>
                    <BulkRowCell bulk={bulk} id={row.id} />
                    <td className="w-8 h-10 px-0 border-b border-line-soft">
                      <button
                        type="button"
                        className="flex items-center justify-center w-full h-full bg-none border-0 text-mute cursor-pointer hover:bg-surface-sunken"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Collapse ${row.name}` : `Expand ${row.name}`}
                        data-testid={`coupons-expand-${row.id}`}
                        onClick={() => toggleExpanded(row.id)}
                      >
                        {isOpen ? (
                          <ChevronDown size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        )}
                      </button>
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`coupons-cell-name-${row.id}`}>
                      <a
                        href={`${path}/${row.id}`}
                        onClick={(e) => {
                          if (onNavigate) {
                            e.preventDefault();
                            go(`${path}/${row.id}`);
                          }
                        }}
                        className="text-brand hover:text-brand no-underline"
                      >
                        {row.name}
                      </a>
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft font-variant-numeric tabular-nums" data-testid={`coupons-cell-codes-${row.id}`}>
                      {row.codes_count ?? codes.length}
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`coupons-cell-active-${row.id}`}>
                      {canWrite === true ? (
                        <Switch
                          checked={row.active === true}
                          disabled={togglingId === row.id}
                          onCheckedChange={(v) => setActive(row, !!v)}
                          data-testid={`coupons-active-toggle-${row.id}`}
                        />
                      ) : (
                        <StatusBadge
                          label={row.active ? "Active" : "Inactive"}
                          tone={row.active ? "ok" : "neutral"}
                          testId={`coupons-active-badge-${row.id}`}
                        />
                      )}
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft text-right">
                      {canWrite === true && (
                        <RowActions actions={rowActions(row)} row={row} />
                      )}
                    </td>
                </tr>),
                isOpen && (
                  <tr key={`child-${row.id}`} className="bg-surface-sunken" data-testid={`coupons-children-${row.id}`}>
                      {bulk?.selectable && <td></td>}
                      <td></td>
                      <td colSpan="4" className="px-4 py-3 border-b border-line-soft">
                        {codes.length === 0 ? (
                          <p className="text-sm text-mute m-0" data-testid={`coupons-no-codes-${row.id}`}>No codes yet.</p>
                        ) : (
                          <table className="w-full border-collapse" data-testid={`coupons-codes-table-${row.id}`}>
                            <thead>
                              <tr>
                                <th className="text-left text-xs font-medium text-mute h-8 px-4 py-0">Code</th>
                                <th className="text-left text-xs font-medium text-mute h-8 px-4 py-0">Active</th>
                                <th className="text-left text-xs font-medium text-mute h-8 px-4 py-0">Redemptions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {codes.map((code) => (
                                <tr key={code.id ?? code.code} data-testid={`coupons-code-row-${row.id}`}>
                                  <td className="text-sm h-10 px-4 py-0 font-mono">{code.code}</td>
                                  <td className="text-sm h-10 px-4 py-0">
                                    <StatusBadge {...codeStatus(code)} testId={`coupons-code-status-${code.id ?? code.code}`} />
                                  </td>
                                  <td className="text-sm h-10 px-4 py-0 font-variant-numeric tabular-nums">{code.redemption_count ?? 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                ),
              ].filter(Boolean);
            })}
          </tbody>
        </table>
    </div>
  );
}
