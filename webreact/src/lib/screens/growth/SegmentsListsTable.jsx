// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SegmentsListsTable — the segments list display (seed + handmade). Extracted from the main
// Segments screen. Ported from webui/src/lib/screens/growth/Segments.svelte:223-277.
// Rendered inside LedgerPage by the parent Segments component.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { isUuid } from "@/lib/record/deleteTypes.js";

export default function SegmentsListsTable({
  seedSegments = [],
  handmadeSegments = [],
  segments = [],
  error = null,
  phase = "loading",
  countFor = () => "—",
  handleUseSegment = () => {},
  bulk = null,
  showCreateSheet = false,
  listsSummary = "",
}) {
  // §13.3 — these rows are cards, not <td>s, so the shared checkbox state (`bulk`, from useListBulk) is drawn as a plain checkbox here;
  // the row "…" menu is the shared RowActions (it adds Delete itself, Owner/Admin only). No delete code of its own.
  const selectable = Boolean(bulk?.selectable);
  const ids = segments.filter((r) => isUuid(r.id)).map((r) => r.id);
  const allSelected = ids.length > 0 && ids.every((id) => bulk?.selected?.has(id));
  const someSelected = !allSelected && ids.some((id) => bulk?.selected?.has(id));
  const toggleAll = () => {
    const next = new Set(bulk.selected);
    if (allSelected) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id));
    bulk.setSelected(next);
  };
  const toggleOne = (id) => {
    const next = new Set(bulk.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    bulk.setSelected(next);
  };
  const selectBox = (segment) => selectable ? (
    <Checkbox checked={bulk.selected.has(segment.id)} onCheckedChange={() => toggleOne(segment.id)}
      aria-label="Select row" data-testid={`list-select-row-${segment.id}`} />
  ) : null;

  return (
    <ScreenState
      phase={phase}
      empty={{ kind: "first-run", headline: "No segments yet.", line: "Create one to get started." }}
      error={error}
    >
        <div className="flex flex-col gap-6">
          {selectable && ids.length > 0 && (
            <label className="flex items-center gap-2 text-caption text-mute">
              <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll}
                aria-label="Select all shown rows" data-testid="list-select-all" />
              Select all
            </label>
          )}
          {seedSegments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-heading font-semibold text-ink">Keeps itself up to date</h2>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                {seedSegments.map((segment) => (
                  <div
                    key={segment.id}
                    data-testid={`seed-segment-${segment.seed_key}`}
                    className="flex items-center gap-4 border-b border-hair px-4 py-3 last:border-b-0"
                  >
                    {selectBox(segment)}
                    <div className="flex-1 min-w-0">
                      <div className="text-ui font-medium text-ink">{segment.name}</div>
                      {segment.filter_summary && (
                        <div className="mt-0.5 text-caption text-mute">{segment.filter_summary}</div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-ui font-variant-numeric text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {countFor(segment)}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUseSegment(segment.id)}
                    >
                      Use it
                    </Button>
                    {selectable && <RowActions row={segment} actions={[]} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {handmadeSegments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-heading font-semibold text-ink">Made by hand</h2>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                {handmadeSegments.map((segment) => (
                  <div
                    key={segment.id}
                    data-testid={`segment-item-${segment.id}`}
                    className="flex items-center gap-4 border-b border-hair px-4 py-3 last:border-b-0"
                  >
                    {selectBox(segment)}
                    <div className="flex-1 min-w-0">
                      <div className="text-ui font-medium text-ink">{segment.name}</div>
                      {segment.filter_summary && (
                        <div className="mt-0.5 text-caption text-mute">{segment.filter_summary}</div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-ui font-variant-numeric text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {countFor(segment)}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUseSegment(segment.id)}
                    >
                      Use it
                    </Button>
                    {selectable && <RowActions row={segment} actions={[]} />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScreenState>
  );
}
