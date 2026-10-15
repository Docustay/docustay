// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.016.T1 — AccountsListAccountsList: the table component. Ported from
// webui/src/lib/screens/accounts/AccountsList.svelte:239-333 (LedgerPage element and contents).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

export default function AccountsListAccountsList({
  onNavigate = null, go = null, phase = "loading", error = null, activeView = "all", onView = null, moneyVisible = false,
  summary = null, filtered = [], isFiltered = false, showViews = false, displayPhase = "loading",
  clearFilters = null, controls = null, kindLabel = null, whoWeTalkTo = null, initials = null, formatOwing = null,
  openSheet = null, handleEmptyNavigate = null, rowActions = null, bulk = null,
}) {
  function defaultKindLabel(kind) {
    return kind === "family" ? "Family" : kind === "employer" ? "Employer"
      : kind === "third_party" ? "Third party" : kind;
  }

  function defaultWhoWeTalkTo(row) {
    return row.contactName ?? "—";
  }

  function defaultInitials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  }

  function defaultFormatOwing(row) {
    if (!row.owingMinor) return "—";
    const n = row.owingMinor / 100;
    const amt = new Intl.NumberFormat("en-US", { style: "currency", currency: row.currency ?? "USD" }).format(n);
    return `${amt} owing`;
  }

  function defaultRowActions(row) {
    return [
      { id: "open", label: "Open", onRun: () => go?.(`/accounts/${row.id}`) },
      { id: "add-someone", label: "Add someone to it", onRun: () => go?.(`/accounts/${row.id}`) },
      { id: "archive", label: "Archive", destructive: true, onRun: () => {} },
    ];
  }

  const k = kindLabel ?? defaultKindLabel;
  const w = whoWeTalkTo ?? defaultWhoWeTalkTo;
  const i = initials ?? defaultInitials;
  const f = formatOwing ?? defaultFormatOwing;
  const ra = rowActions ?? defaultRowActions;

  return (
    <LedgerPage
      title="Accounts"
      summary={phase === "ready" || phase === "empty" ? summary : null}
      primary={{ label: "New account", onClick: () => openSheet?.() }}
      views={showViews ? [
        { key: "all", label: "All" },
        { key: "families", label: "Families" },
        { key: "employers", label: "Employers" },
        { key: "third-parties", label: "Third parties" },
      ] : null}
      activeView={activeView}
      onView={onView}
      controls={controls}
      testId="accounts-list"
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={isFiltered
          ? { kind: "filtered", headline: "Nothing matches these filters", line: "Try different filters or clear them.", action: null }
          : {
              kind: "first-run",
              headline: "No accounts yet, and you may never need one",
              line: "An account is for when the money comes from somewhere other than the client — a parent paying for a teenager, an employer paying for staff, a county programme paying for referrals. If everyone pays for themselves, skip this entirely.",
              action: { label: "Add a family account", href: "#new-account:family" },
            }}
        onClearFilters={clearFilters}
        onNavigate={handleEmptyNavigate}
      >
        {displayPhase === "ready" && bulk?.bulkBar}
        {displayPhase === "ready" && (
          <table className="w-full border-collapse bg-surface border border-line rounded-radius overflow-hidden" data-testid="accounts-table">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={filtered} />
                <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">Account</th>
                <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">Type</th>
                <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">Who we talk to</th>
                <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">Covers</th>
                {moneyVisible && (
                  <>
                    <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken" data-testid="accounts-th-owing">Owing</th>
                    <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">State</th>
                  </>
                )}
                <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} data-testid="accounts-row" data-id={row.id}>
                  <BulkRowCell bulk={bulk} id={row.id} />
                  <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center bg-primary-wash text-primary text-xs font-medium flex-shrink-0">{i(row.name)}</span>
                      <a href={`/accounts/${row.id}`} className="text-brand hover:underline">{row.name}</a>
                    </div>
                  </td>
                  <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word">{k(row.kind)}</td>
                  <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word">{w(row)}</td>
                  <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word">{row.covers?.length ?? 0} {row.covers?.length === 1 ? "person" : "people"}</td>
                  {moneyVisible && (
                    <>
                      <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word font-variant-numeric-tabular" data-testid="accounts-owing-cell">{f(row)}</td>
                      <td className="h-10 px-4 border-b border-line-soft text-sm overflow-wrap-break-word">
                        <Badge className={row.state === "owes" ? "bg-chip-warn-bg text-chip-warn-ink" : "bg-chip-ok-bg text-chip-ok-ink"} data-testid="accounts-state-chip">
                          {row.state === "owes" ? "Owes" : "Paid up"}
                        </Badge>
                      </td>
                    </>
                  )}
                  <td className="h-10 px-4 border-b border-line-soft text-sm text-right">
                    <RowActions actions={ra(row)} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScreenState>

      {displayPhase === "ready" && (
        <div className="mt-5 bg-primary-wash rounded-radius p-3.5 text-xs text-ink leading-relaxed max-w-82ch" data-testid="accounts-definition-band">
          <b>What an account is.</b> Somewhere other than the client that the money comes from. A parent, an employer, a county programme. The client still has their own record, their own portal and their own notes — the account only sees what it pays for.
        </div>
      )}

      {displayPhase === "empty" && !isFiltered && (
        <div className="flex justify-center mt-neg-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-brand text-white font-medium"
            data-testid="accounts-empty-add-employer"
            onClick={() => openSheet?.("employer")}
          >
            Add an employer
          </button>
        </div>
      )}
    </LedgerPage>
  );
}
