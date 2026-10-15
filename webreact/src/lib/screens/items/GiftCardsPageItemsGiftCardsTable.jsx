import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import HeroNumber from "@/lib/components/kit/HeroNumber.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

export default function GiftCardsPageItemsGiftCardsTable({
  onNavigate,
  ENABLE_HREF,
  summary,
  currency,
  rows,
  emptyState,
  formatMoney,
  formatBought,
  hasMoneyColumns,
  hasSyncColumn,
  summaryLine,
  stateTone,
  rowActions,
  openIssueSheet,
  enabling,
  handleEmptyNavigate,
  bulk = null,
}) {
  const showFigures = summary?.enabled === true;

  return (
    <LedgerPage
      title="Gift cards"
      summary={summaryLine}
      primary={
        showFigures
          ? {
              label: "How they're sold",
              onClick: openIssueSheet,
              disabled: !currency,
              disabledReason: currency
                ? null
                : "Set your practice's currency in Money settings before selling gift cards.",
            }
          : null
      }
      testId="items-gift-cards"
    >
      {!showFigures ? (
        <EmptyState
          kind="blocked"
          headline="Turn on gift cards"
          line="Nobody can buy or hold a gift card until this is turned on."
          action={{
            label: enabling ? "Turning on…" : "Turn on gift cards",
            href: ENABLE_HREF,
          }}
          onNavigate={handleEmptyNavigate}
          testId="items-gift-cards-pitch"
        />
      ) : (
        <>
          <div
            className="flex flex-wrap gap-0 border-t border-line mb-4"
            data-testid="items-gift-cards-figures"
          >
            <HeroNumber
              figure={formatMoney(summary.sold_year_minor, currency)}
              label="sold this year"
              sub={`${summary.sold_year_count} ${
                summary.sold_year_count === 1 ? "card" : "cards"
              }`}
              testId="items-gift-cards-sold"
            />
            <HeroNumber
              figure={formatMoney(summary.unspent_minor, currency)}
              label="not yet spent"
              sub={`Sitting with ${summary.unspent_holders} ${
                summary.unspent_holders === 1 ? "person" : "people"
              }`}
              testId="items-gift-cards-unspent"
            />
            <HeroNumber
              figure={formatMoney(summary.never_opened_minor, currency)}
              label="bought and never opened"
              sub="Worth a nudge"
              testId="items-gift-cards-never-opened"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              kind={emptyState?.kind ?? "first-run"}
              headline={emptyState?.headline ?? "No cards sold yet"}
              line={
                emptyState?.line ?? "put the link on your site and in your email footer."
              }
              action={
                emptyState?.action
                  ? {
                      label: emptyState.action.label,
                      href: emptyState.action.href,
                    }
                  : null
              }
              onNavigate={handleEmptyNavigate}
              testId="items-gift-cards-nothing-yet"
            />
          ) : (
            <>
              <div
                className="w-full overflow-auto rounded-card border border-line"
                data-testid="items-gift-cards-table-scroll"
              >
                <table
                  className="w-full border-collapse bg-surface"
                  data-testid="items-gift-cards-table"
                >
                  <thead>
                    <tr>
                      <BulkHeadCell bulk={bulk} rows={rows} />
                      <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                        Number
                      </th>
                      <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                        Who has it
                      </th>
                      {hasMoneyColumns && (
                        <>
                          <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                            Bought for
                          </th>
                          <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                            Left
                          </th>
                        </>
                      )}
                      <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                        When
                      </th>
                      <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                        State
                      </th>
                      {hasSyncColumn && (
                        <th className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">
                          Sync
                        </th>
                      )}
                      <th className="h-9 border-b border-line bg-surface-2 px-4 text-right text-xs font-medium text-mute" aria-hidden="true"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} data-testid={`items-gift-cards-row-${row.id}`}>
                        <BulkRowCell bulk={bulk} id={row.id} />
                        <td className="h-11.5 border-b border-hair px-4 text-sm text-ink font-variant-numeric-tabular-nums">
                          {row.number}
                        </td>
                        <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">
                          {row.holder}
                        </td>
                        {hasMoneyColumns && (
                          <>
                            <td className="h-11.5 border-b border-hair px-4 text-sm text-ink font-variant-numeric-tabular-nums">
                              {formatMoney(row.issued_minor, row.currency)}
                            </td>
                            <td className="h-11.5 border-b border-hair px-4 text-sm text-ink font-variant-numeric-tabular-nums">
                              {formatMoney(row.remaining_minor, row.currency)}
                            </td>
                          </>
                        )}
                        <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">
                          {formatBought(row.created_at)}
                        </td>
                        <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">
                          <StatusBadge
                            label={row.state}
                            tone={stateTone(row.state)}
                            testId={`items-gift-cards-state-${row.id}`}
                          />
                        </td>
                        {hasSyncColumn && (
                          <td
                            className="h-11.5 border-b border-hair px-4 text-sm text-ink"
                            data-testid={`items-gift-cards-sync-${row.id}`}
                          >
                            {row.sync_state ?? "—"}
                          </td>
                        )}
                        <td className="h-11.5 border-b border-hair px-4 text-sm text-ink text-right">
                          <RowActions actions={rowActions(row)} row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className="mt-4 rounded-sm border border-line bg-surface-sunken p-4 text-sm text-ink-2 leading-relaxed max-w-80ch"
                data-testid="items-gift-cards-placement"
                style={{ maxWidth: "80ch" }}
              >
                <b>Where they're sold.</b> On your website and your booking page.
                <b> Not inside the phone apps</b> — Apple treats a gift card as a digital
                good and takes 30% of it. The apps show the balance and spend it, which is
                allowed.
              </div>
            </>
          )}
        </>
      )}
    </LedgerPage>
  );
}
