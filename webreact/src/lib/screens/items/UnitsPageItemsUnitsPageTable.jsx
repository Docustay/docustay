// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UnitsPageItemsUnitsPageTable — R5.043.T1, the table as its own component
// Built from webui/src/lib/screens/items/UnitsPage.svelte:193-316 (LedgerPage + ScreenState + content)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { isUuid } from "@/lib/record/deleteTypes.js";

export default function UnitsPageItemsUnitsPageTable({
  onNavigate,
  phase,
  error,
  units,
  load,
  inUse,
  available,
  thingWord,
  actionBusy,
  actionErrors,
  setActive,
  openCreate,
  bulk = null,
}) {
  // Units are div rows, not a <table>, so the shared checkbox + row menu are placed inline (same hook, same Delete).
  const toggleOne = (id) => { const next = new Set(bulk.selected); if (next.has(id)) next.delete(id); else next.add(id); bulk.setSelected(next); };
  const toggleAll = (list) => {
    const ids = list.filter((u) => isUuid(u.id)).map((u) => u.id);
    const all = ids.length > 0 && ids.every((id) => bulk.selected.has(id));
    const next = new Set(bulk.selected);
    ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
    bulk.setSelected(next);
  };
  const headBox = (list, label) => {
    if (!bulk?.selectable) return null;
    const ids = list.filter((u) => isUuid(u.id)).map((u) => u.id);
    const all = ids.length > 0 && ids.every((id) => bulk.selected.has(id));
    const some = !all && ids.some((id) => bulk.selected.has(id));
    return <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={() => toggleAll(list)} aria-label={label} data-testid={`list-select-all-${label.includes("in use") ? "in-use" : "available"}`} />;
  };
  const rowBox = (u) => (bulk?.selectable ? <Checkbox checked={bulk.selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} aria-label="Select row" data-testid={`list-select-row-${u.id}`} /> : null);
  return (
    <LedgerPage
      title="Units"
      summary="What you sell things by."
      primary={{ label: "New unit", onClick: openCreate }}
      testId="items-units-page"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={onNavigate ?? undefined}
        onRetry={load}
        testIds={{ error: "items-units-error", denied: "items-units-denied" }}
      >
        <div className="flex flex-col gap-stack w-full" data-testid="items-units-body">
          <p className="m-0 mb-gap max-w-[70ch] text-sm text-ink leading-[1.7]">
            Most practices never open this screen, and that is fine &mdash; everything is sold by
            the session by default. It matters when you start selling something that is not a
            session.
          </p>

          <div className="flex gap-[22px] items-start" style={{ '@media (max-width: 480px)': { flexDirection: 'column' } }}>
            {/* LEFT COLUMN: In use and Available */}
            <div className="flex flex-1 auto min-w-0 flex-col gap-gap">
              {/* In use block */}
              <div className="bg-surface border border-line rounded-card">
                <div className="flex items-center gap-gap px-[17px] py-[14px] border-b border-line-soft text-base">
                  {headBox(inUse, "Select all units in use")}
                  <b className="font-medium">In use</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px] flex flex-col">
                  {inUse.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 py-[11px] border-b border-line-soft text-base last:border-b-0"
                      data-testid={`items-units-row-${u.id}`}
                    >
                      {rowBox(u)}
                      <span className="flex flex-1 auto flex-col gap-[2px] min-w-0 text-ink">
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{u.name}</span>
                        {actionErrors[u.id] && (
                          <span
                            className="text-xs text-chip-bad-ink"
                            data-testid={`items-units-row-error-${u.id}`}
                          >
                            {actionErrors[u.id].message}
                            {actionErrors[u.id].requestId && (
                              <span className="text-ink-faint"> (ref: {actionErrors[u.id].requestId})</span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-ink-muted">{thingWord(u.in_use)}</span>
                      {u.is_default ? (
                        <Badge className="text-xs bg-chip-ok-bg text-chip-ok-ink" data-testid={`items-units-default-${u.id}`}>
                          Default
                        </Badge>
                      ) : (
                        <button
                          type="button"
                          className="border-0 bg-none p-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid={`items-units-turnoff-${u.id}`}
                          disabled={actionBusy[u.id]}
                          title="Turn off this unit"
                          onClick={() => setActive(u, false)}
                        >
                          <Badge className="text-xs bg-chip-ok-bg text-chip-ok-ink">
                            {actionBusy[u.id] ? "…" : "On"}
                          </Badge>
                        </button>
                      )}
                      {bulk?.selectable && <RowActions row={u} actions={[]} />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Available block */}
              <div className="bg-surface border border-line rounded-card">
                <div className="flex items-center gap-gap px-[17px] py-[14px] border-b border-line-soft text-base">
                  {headBox(available, "Select all available units")}
                  <b className="font-medium">Available, not used</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px] flex flex-col">
                  {available.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 py-[11px] border-b border-line-soft text-base last:border-b-0"
                      data-testid={`items-units-row-${u.id}`}
                    >
                      {rowBox(u)}
                      <span className="flex flex-1 auto flex-col gap-[2px] min-w-0 text-ink">
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{u.name}</span>
                        {actionErrors[u.id] && (
                          <span
                            className="text-xs text-chip-bad-ink"
                            data-testid={`items-units-row-error-${u.id}`}
                          >
                            {actionErrors[u.id].message}
                            {actionErrors[u.id].requestId && (
                              <span className="text-ink-faint"> (ref: {actionErrors[u.id].requestId})</span>
                            )}
                          </span>
                        )}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`items-units-turnon-${u.id}`}
                        disabled={actionBusy[u.id]}
                        onClick={() => setActive(u, true)}
                      >
                        {actionBusy[u.id] ? "…" : "Turn on"}
                      </Button>
                      {bulk?.selectable && <RowActions row={u} actions={[]} />}
                    </div>
                  ))}
                  {available.length === 0 && (
                    <p className="m-2 text-sm text-ink-muted" data-testid="items-units-available-empty">
                      Every unit is turned on.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Static info */}
            <div className="w-80 flex-0 flex-col gap-gap md:w-full md:flex-1" style={{ '@media (max-width: 480px)': { width: '100%', flex: '1 1 auto' } }}>
              {/* What a unit actually changes */}
              <div className="bg-surface border border-line rounded-card">
                <div className="flex items-center gap-gap px-[17px] py-[14px] border-b border-line-soft text-base">
                  <b className="font-medium">What a unit actually changes</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px] flex flex-col">
                  <div className="flex flex-col gap-[3px] py-[11px] border-b border-line-soft text-base last:border-b-0">
                    <span className="text-ink">How the price reads</span>
                    <span className="text-xs text-ink-muted leading-[1.5]">
                      &ldquo;$125 a session&rdquo; against &ldquo;$125 an hour&rdquo;. Different promises.
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px] py-[11px] border-b border-line-soft text-base last:border-b-0">
                    <span className="text-ink">What the invoice line says</span>
                    <span className="text-xs text-ink-muted leading-[1.5]">
                      &ldquo;2 sessions&rdquo; against &ldquo;2 hours&rdquo;
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px] py-[11px] border-b border-line-soft text-base last:border-b-0">
                    <span className="text-ink">How a package counts down</span>
                    <span className="text-xs text-ink-muted leading-[1.5]">
                      A six-session block draws down in sessions, not hours &mdash; even if a session runs long
                    </span>
                  </div>
                </div>
              </div>

              {/* Careful */}
              <div className="bg-surface border border-line rounded-card">
                <div className="flex items-center gap-gap px-[17px] py-[14px] border-b border-line-soft text-base">
                  <b className="font-medium">Careful</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px] flex flex-col">
                  <div className="flex flex-col gap-[3px] py-[11px] border-b border-line-soft text-base last:border-b-0">
                    <span className="text-ink">Changing a unit does not change history</span>
                    <span className="text-xs text-ink-muted leading-[1.5]">
                      Anything already sold keeps the unit it was sold in
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
