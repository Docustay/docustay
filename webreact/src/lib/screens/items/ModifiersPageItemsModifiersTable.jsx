// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.035.T1 — ModifiersPage › ModifiersPageItemsModifiersTable: the table as its own component
// Built on LedgerPage from webui/src/lib/screens/items/ModifiersPage.svelte:312-423
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function ModifiersPageItemsModifiersTable({
  data,
  onNavigate,
  go,
  isAdmin,
  rows,
  emptyState,
  phase,
  usedLabel,
  statusLabel,
  statusTone,
  toggleBusyId,
  toggleActive,
  openCreateSheet,
  rowActions,
  bulk = null,
}) {
  return (
    <LedgerPage
      title="Modifiers"
      summary="Things that change a service without being a different service."
      primary={isAdmin ? { label: "New modifier", onClick: openCreateSheet } : null}
      testId="items-modifiers"
    >
      {/* ★ THE DEFINITION BAND — ALWAYS VISIBLE, INCLUDING EMPTY (field 14: "first-time (definition band + New modifier)"). F06 §2.9, verbatim. */}
      <Card className="mb-6" data-testid="items-modifiers-definition">
        <CardContent>
          A modifier changes the price or the length of something you already sell. "Add 30 minutes" is a modifier. "Evening session" is a modifier. <b className="font-medium">If it needs its own booking rules, its own staff or its own agreement, it is a service, not a modifier.</b>
        </CardContent>
      </Card>

      <ScreenState
        phase={phase}
        empty={emptyState}
        onNavigate={go}
        testIds={{ empty: "items-modifiers-empty" }}
      >
        <div className="overflow-x-auto rounded-lg border border-line bg-surface" data-testid="items-modifiers-table-wrap">
          <table className="w-full border-collapse" data-testid="items-modifiers-table">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={rows} />
                <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Name</th>
                <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">What it does</th>
                <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Applies to</th>
                <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Used</th>
                <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">On</th>
                <th className="h-9 border-b border-line bg-surface-2 px-4" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`items-modifiers-row-${row.id}`}>
                  <BulkRowCell bulk={bulk} id={row.id} />
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">{row.name}</td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">{row.effect || "—"}</td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">{row.applies_to ?? "—"}</td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink font-variant-numeric-tabular-nums" data-testid={`items-modifiers-used-${row.id}`}>
                    {usedLabel(row)}
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.active}
                        disabled={!isAdmin || toggleBusyId === row.id}
                        aria-label={row.active ? `Turn off ${row.name}` : `Turn on ${row.name}`}
                        data-testid={`items-modifiers-toggle-${row.id}`}
                        onCheckedChange={() => toggleActive(row)}
                      />
                      <StatusBadge
                        label={statusLabel(row)}
                        tone={statusTone(row)}
                        testId={`items-modifiers-status-${row.id}`}
                      />
                    </div>
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink text-right">
                    <RowActions actions={rowActions(row)} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex gap-5.5">
          <div className="min-w-0 flex-1">
            <Card data-testid="items-modifiers-worth-knowing">
              <div className="border-b border-hair px-4.5 py-3.5"><b className="font-medium">Worth knowing</b></div>
              <CardContent>
                {/* ★ NOT DRAWN — no catalogue entry for either usage prompt */}
                <p className="text-sm text-mute my-2" data-testid="items-modifiers-prompts-empty">
                  Nothing needs your attention here yet.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="w-80 flex-shrink-0">
            <Card data-testid="items-modifiers-behaviour">
              <div className="border-b border-hair px-4.5 py-3.5"><b className="font-medium">How a modifier behaves</b></div>
              <CardContent>
                <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                  <span className="min-w-0 flex-1">
                    It rides on the service
                    <span className="block text-xs text-mute mt-0.5">Archive the service and its modifiers stop appearing with it</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                  <span className="min-w-0 flex-1">
                    Price and length both
                    <span className="block text-xs text-mute mt-0.5">Either, neither, or both</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                  <span className="min-w-0 flex-1">
                    It shows on the invoice
                    <span className="block text-xs text-mute mt-0.5">As its own line, so the client sees what they paid the extra for</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                  <span className="min-w-0 flex-1">
                    Two can stack
                    <span className="block text-xs text-mute mt-0.5">Evening plus 30 minutes is $85 more. Discounts never stack; modifiers do.</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
