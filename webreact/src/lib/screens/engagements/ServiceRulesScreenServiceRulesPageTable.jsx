// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServiceRulesScreenServiceRulesPageTable — the table from ServiceRulesScreen, extracted as its
// own component. Ported from webui/src/lib/screens/engagements/ServiceRulesScreen.svelte:90-168
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";

export default function ServiceRulesScreenServiceRulesPageTable({
  onNavigate,
  go,
  phase,
  error,
  rows,
  whoCanBookLabel,
  rowActions,
}) {
  return (
    <LedgerPage
      title="Rules per service"
      testId="service-rules-page"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={{
          kind: "blocked",
          headline: "Nothing is public yet",
          line: "There are no services to show rules for until at least one is public.",
          action: { label: "Make a service public", href: "/items/services" },
        }}
        onNavigate={go}
        testIds={{ empty: "service-rules-empty", error: "service-rules-error", denied: "service-rules-denied" }}
      >
        <div data-testid="service-rules-body" className="w-full">
          <table
            data-testid="service-rules-table"
            className="w-full border-collapse rounded-card border border-line bg-surface overflow-hidden"
          >
            <thead>
              <tr>
                <th className="h-10 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-2">
                  Service
                </th>
                <th className="h-10 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-2">
                  Who can book
                </th>
                <th className="h-10 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-2">
                  Paying
                </th>
                <th className="h-10 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-2">
                  Notice
                </th>
                <th className="h-10 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-2">
                  Cancelling
                </th>
                <th className="h-10 px-4" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.serviceId} data-testid={`service-rules-row-${row.serviceId}`}>
                  <td className="h-11 px-4 border-b border-hair text-ui text-ink">
                    <b className="block max-w-sm overflow-hidden text-ellipsis whitespace-nowrap font-medium" title={row.name}>
                      {row.name}
                    </b>
                  </td>
                  <td className="h-11 px-4 border-b border-hair text-ui text-ink" data-testid={`service-rules-who-${row.serviceId}`}>
                    {whoCanBookLabel(row.whoCanBook)}
                  </td>
                  <td className="h-11 px-4 border-b border-hair text-ui text-ink" data-testid={`service-rules-paying-${row.serviceId}`}>
                    {row.differs?.paying ? (
                      <Badge className="h-5 bg-warn-soft text-warn" data-testid={`service-rules-paying-${row.serviceId}-amber`}>
                        {row.paying}
                      </Badge>
                    ) : (
                      <span className="text-ink" data-testid={`service-rules-paying-${row.serviceId}-plain`}>
                        {row.paying}
                      </span>
                    )}
                  </td>
                  <td className="h-11 px-4 border-b border-hair text-ui text-ink" data-testid={`service-rules-notice-${row.serviceId}`}>
                    {row.differs?.notice ? (
                      <Badge className="h-5 bg-warn-soft text-warn" data-testid={`service-rules-notice-${row.serviceId}-amber`}>
                        {row.notice}
                      </Badge>
                    ) : (
                      <span className="text-ink" data-testid={`service-rules-notice-${row.serviceId}-plain`}>
                        {row.notice}
                      </span>
                    )}
                  </td>
                  <td className="h-11 px-4 border-b border-hair text-ui text-ink" data-testid={`service-rules-cancelling-${row.serviceId}`}>
                    {row.differs?.cancelling ? (
                      <Badge className="h-5 bg-warn-soft text-warn" data-testid={`service-rules-cancelling-${row.serviceId}-amber`}>
                        {row.cancelling}
                      </Badge>
                    ) : (
                      <span className="text-ink" data-testid={`service-rules-cancelling-${row.serviceId}-plain`}>
                        {row.cancelling}
                      </span>
                    )}
                  </td>
                  <td className="h-11 px-4 border-b border-hair text-right">
                    <RowActions actions={rowActions(row)} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          className="mt-4.5 rounded-card bg-brand-soft px-4 py-3.75 text-xs leading-relaxed text-brand max-w-lg"
          data-testid="service-rules-closing"
        >
          <b className="font-medium">Anything in amber differs from your practice default.</b> That is usually deliberate
          — a free discovery call has no reason to hold a card, and a group with six seats needs
          more notice than a one-to-one. This screen exists so a difference is never a surprise.
        </p>
      </ScreenState>
    </LedgerPage>
  );
}
