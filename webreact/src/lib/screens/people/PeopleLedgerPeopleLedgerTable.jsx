// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PeopleLedgerPeopleLedgerTable — the table component for PeopleLedger, built from
// webui/src/lib/screens/people/PeopleLedger.svelte:343-463. Rendered inside LedgerPage.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import CatalogueDataTable from "@/lib/screens/catalogue/CatalogueDataTable.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { formatValue } from "@/lib/format.js";

export default function PeopleLedgerPeopleLedgerTable({
  view = null,
  path = "/people/all",
  onNavigate = null,
  go = () => {},
  VIEWS = [],
  bulkAllowed = false,
  phase = "loading",
  columns = [],
  selected = new Set(),
  filtered = [],
  displayPhase = "loading",
  isEveryoneRichEmpty = false,
  clearFilters = () => {},
  emptyPropFor = () => ({ kind: "first-run", headline: "Nothing here yet", line: "" }),
  toggleRow = () => {},
  toggleAll = () => {},
  summaryText = null,
  statusBadge = () => ({ label: "—", tone: "neutral" }),
  initials = () => "·",
  rowActions = () => [],
  quickName = "",
  quickEmail = "",
  quickBusy = false,
  quickError = null,
  quickSave = () => {},
}) {
  if (isEveryoneRichEmpty) {
    return (
      <div className="rounded-card border border-line bg-surface p-14 text-center" data-state="empty" data-testid="people-empty-rich" role="status">
        <p className="m-0 text-lg font-medium text-ink" data-testid="people-empty-headline">
          Bring your people over, rather than typing them in
        </p>
        <p className="mx-auto mt-1.75 max-w-prose text-control text-mute leading-1.6" data-testid="people-empty-line">
          If you're coming from Mindbody, Vagaro, Boulevard, Practice Better or SimplePractice, we
          already know what their exports look like.
        </p>
        <div className="mt-4.5 flex flex-wrap justify-center gap-2">
          <Button data-testid="people-empty-bring-over" onClick={() => go("/settings/import")}>
            Bring them over
          </Button>
          <Button variant="outline" data-testid="people-empty-add-by-hand" onClick={() => go(`${path}?new=1`)}>
            Add someone by hand
          </Button>
          <Button variant="outline" disabled data-testid="people-empty-have-us-do-it"
                  title="No inbox for this yet.">
            Have us do it
          </Button>
        </div>
        <p className="m-0 mt-1.5 text-meta text-mute" data-testid="people-empty-have-us-do-it-reason">
          No inbox for this yet.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-line-soft pt-5" data-testid="people-quick-create">
          <Input
            placeholder="Name"
            data-testid="people-quick-name"
            value={quickName}
          />
          <Input
            placeholder="Email"
            data-testid="people-quick-email"
            value={quickEmail}
          />
          <Button
            data-testid="people-quick-save"
            disabled={quickBusy}
            onClick={quickSave}
          >
            {quickBusy ? "Saving…" : "Save"}
          </Button>
        </div>
        {quickError && (
          <p className="m-0 mt-2.5 text-control text-danger" role="alert" data-testid="people-quick-error">{quickError}</p>
        )}
      </div>
    );
  }

  const tableColumns = columns.map((c) => ({
    field: c.field,
    label: c.label,
    format: c.format,
    cell: (row) => {
      if (c.field === "display_name") {
        return (
          <span className="flex items-center gap-2">
            <span className="h-6 w-6 flex items-center justify-center rounded-full bg-surface-2 text-meta font-medium text-ink" aria-hidden="true">
              {initials(row.display_name)}
            </span>
            <a
              href={`/record/person/${row.id}`}
              onClick={(e) => { if (onNavigate) { e.preventDefault(); go(`/record/person/${row.id}`); } }}
              className="text-brand hover:underline"
            >
              {row.display_name}
            </a>
          </span>
        );
      }
      if ((c.field === "status" || c.field === "state") && c.format === "enum") {
        const b = statusBadge(row[c.field]);
        return <StatusBadge label={b.label} tone={b.tone} testId={`people-status-${row.id}`} />;
      }
      if (c.format === "programs") return <ProgramChips ids={row[c.field]} />;
      return formatValue(row[c.field], c.format, { currency: c.currency ? row[c.currency] : null });
    },
  }));
  // the shared table hands back the WHOLE new selection; the parent exposes "toggle one" and "toggle all"
  const onSelectedChange = (next) => {
    if (next.size === 0 || next.size === filtered.length) { if ((next.size === 0) !== (selected.size === 0)) toggleAll(); return; }
    const changed = filtered.map((r) => r.id).find((id) => next.has(id) !== selected.has(id));
    if (changed) toggleRow(changed);
  };

  return (
    <ScreenState
      phase={displayPhase}
      error={phase === "error" ? view?.error : null}
      reason={phase === "denied" ? (view?.error?.message ?? view?.reason ?? null) : null}
      empty={emptyPropFor()}
      onClearFilters={clearFilters}
      onNavigate={go}
    >
      {displayPhase === "ready" && (
        // ★ TanStack Table (the maintainer, 2 Oct 2026 — "TanStack Table for the People tabs"): the SAME shared table the Packages and
        //   Plans lists use, so every People tab gets click-to-sort headers and the selection checkboxes for free, with the
        //   people-* testids unchanged. The parent still owns the selection Set (toggleRow/toggleAll), so the table's
        //   whole-set callback is translated back into those two calls.
        <CatalogueDataTable
          testIdPrefix="people"
          rows={filtered.map((r) => ({ ...r, name: r.display_name }))}
          columns={tableColumns}
          selectable={bulkAllowed}
          selected={selected}
          onSelectedChange={onSelectedChange}
          extraColumn={{ label: "", cell: (row) => <RowActions actions={rowActions(row)} row={row} /> }}
        />
      )}
    </ScreenState>
  );
}
