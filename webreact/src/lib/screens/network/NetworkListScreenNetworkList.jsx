// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.018.T1 — NetworkListScreenNetworkList — the practices table + "Recently referred" + prompts
// Ported from webui/src/lib/screens/network/NetworkListScreen.svelte:244-347 (the LedgerPage element
// and everything inside it). Built on LedgerPage and DataTable (kit2 archetypes).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

const TONE_MAP = { ok: "ok", warn: "warn", bad: "bad", act: "act", neutral: "neutral" };

export default function NetworkListScreenNetworkList({
  data = null,
  onNavigate = null,
  go = null,
  rows = [],
  emptyState = null,
  phase = "empty",
  summaryLine = null,
  initials = null,
  stateLabel = null,
  stateTone = null,
  OUTCOME_LABEL = {},
  OUTCOME_TONE = {},
  recentReferrals = [],
  referralLine = null,
  prompts = [],
  dismissPromptNow = null,
  openSheet = null,
  openRecord = null,
  rowActions = null,
  bulk = null,
}) {
  return (
    <LedgerPage
      title="Who you refer to and from"
      summary={summaryLine}
      primary={{ label: "Add a practice", onClick: openSheet }}
      testId="network-list"
    >
      <ScreenState phase={phase} empty={emptyState} onNavigate={go} testIds={{ empty: "network-empty" }}>
        {/* Table */}
        <div className="w-full">
          {bulk?.bulkBar}
          <table className="w-full border-collapse" data-testid="network-table">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={rows} />
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  Practice
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  What they do
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  Sent to you
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  You sent them
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  Last one
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                  State
                </th>
                <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} data-testid={`network-row-${row.id}`}>
                  <BulkRowCell bulk={bulk} id={row.id} />
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary-wash text-xs font-medium text-primary">
                        {initials?.(row.name)}
                      </span>
                      <a
                        href={`/network/${row.id}`}
                        onClick={(e) => {
                          if (onNavigate) {
                            e.preventDefault();
                            openRecord?.(row);
                          }
                        }}
                        className="text-primary hover:underline"
                      >
                        {row.name}
                      </a>
                    </div>
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                    {row.what_they_do ?? "—"}
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink tabular-nums">
                    {row.sent_to_you ?? 0}
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink tabular-nums">
                    {row.you_sent ?? 0}
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                    {row.last_one ? new Date(row.last_one).toLocaleDateString() : "—"}
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                    <StatusBadge
                      tone={stateTone?.(row.state) ?? "neutral"}
                      testId={`network-state-chip-${row.id}`}
                      label={stateLabel?.(row.state)}
                    />
                  </td>
                  <td className="h-(--size-row) border-b border-hair px-4 text-right text-ui">
                    <RowActions actions={rowActions?.(row) ?? []} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recently referred + Prompts */}
        <div className="mt-5 flex gap-5.5">
          {/* Recently referred */}
          <div className="flex-1 min-w-0">
            <div className="rounded-card border border-line bg-surface">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-field font-medium text-ink">Recently referred</b>
              </div>
              <div className="flex flex-col gap-2 px-4.25 py-3.5" data-testid="network-recent">
                {recentReferrals.length === 0 ? (
                  <p className="m-0 text-meta text-mute" data-testid="network-recent-empty">
                    Nothing referred yet.
                  </p>
                ) : (
                  recentReferrals.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 border-b border-hair py-2.75" data-testid={`network-recent-${r.id}`}>
                      <span className="w-18.5 shrink-0 text-meta text-mute tabular-nums">
                        {r.date ? new Date(r.date).toLocaleDateString() : "—"}
                      </span>
                      <span className="flex-1 min-w-0 overflow-wrap break-word">{referralLine?.(r)}</span>
                      {r.outcome && (
                        <StatusBadge
                          tone={OUTCOME_TONE[r.outcome] ?? "neutral"}
                          label={OUTCOME_LABEL[r.outcome] ?? r.outcome}
                        />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Worth knowing (Prompts) */}
          <div className="w-80 flex-shrink-0">
            <div className="rounded-card border border-line bg-surface">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-field font-medium text-ink">Worth knowing</b>
              </div>
              <div className="flex flex-col gap-2 px-4.25 py-3.5" data-testid="network-prompts">
                {prompts.length === 0 ? (
                  <p className="m-0 text-meta text-mute" data-testid="network-prompts-empty">
                    Nothing needs you here right now.
                  </p>
                ) : (
                  prompts.map((p) => (
                    <PromptCard
                      key={p.dismissKey}
                      icon={p.icon}
                      tone={p.tone}
                      headline={p.headline}
                      why={p.why}
                      action={p.action}
                      kind={p.kind}
                      onDismiss={() => dismissPromptNow?.(p)}
                      testId={`network-prompt-${p.dismissKey}`}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
