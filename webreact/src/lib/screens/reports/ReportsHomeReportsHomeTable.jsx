import ScreenState from "@/lib/empty/ScreenState.jsx";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";

export default function ReportsHomeReportsHomeTable({
  onNavigate = null,
  phase,
  error,
  hub,
  load,
  cards,
  notEnoughYet,
  go,
  onOffLabel,
}) {
  return (
    <LedgerPage
      title="Reports"
      summary="Five of them. Each one answers a question rather than showing you a table."
      testId="reports-home"
    >
      <ScreenState
        phase={phase}
        error={error}
        subject="Reports"
        onRetry={load}
        testIds={{ loading: "reports-home-loading", error: "reports-home-error" }}
      >
        <div className="flex max-sm:flex-col gap-5.5 items-start" data-testid="reports-home-cols">
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {cards.map((card) => (
              <Card key={card.name} className="border-line" data-testid={`reports-card-${card.name}`}>
                <CardContent className="flex max-sm:flex-col max-sm:items-stretch items-center gap-2.5">
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <b className="text-control font-medium text-ink">{card.title}</b>
                    <span className="text-ui text-mute leading-1.5">{card.question}</span>
                    {notEnoughYet && (
                      <span className="text-meta text-ink-faint" data-testid={`reports-card-flag-${card.name}`}>
                        Not enough yet
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`reports-card-open-${card.name}`}
                    onClick={() => go(card.href)}
                  >
                    Open
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="w-80 flex-shrink-0 max-sm:w-full max-sm:flex-1">
            <Card className="border-line" data-testid="reports-sent-automatically">
              <CardContent className="flex flex-col">
                <b className="text-ui font-medium text-ink pb-2 border-b border-line-soft mb-0.5">
                  Sent automatically
                </b>
                <SettingsHubRow
                  label="Everything, to you"
                  where={`Monday mornings · ${onOffLabel(hub?.sent_automatically?.weekly_digest)}`}
                  href="/settings"
                  onNavigate={onNavigate}
                  testId="reports-sent-digest"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
