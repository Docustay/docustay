import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";

export default function WaitlistScreenWaitlistPageTable({
  onNavigate,
  go,
  PREFERENCE_LABEL,
  preferenceTone,
  phase,
  error,
  summary,
  prompts,
  offerMinutes,
  filtered,
  displayPhase,
  clearFilters,
  emptyPropFor,
  summaryText,
  offerWindowText,
  ago,
  dismissPrompt,
  openAdd,
  openOffer,
  rowActions,
}) {
  return (
    <div style={{ display: "flex", gap: "var(--gap)", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 17px",
          }}>
            <b>Waiting</b>
          </div>
          <div style={{ padding: "14px 17px" }}>
            {filtered.map((row) => (
              <div
                key={row.id}
                data-testid="waitlist-row"
                data-id={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <span data-testid={`waitlist-name-${row.id}`} style={{
                    display: "block",
                    fontWeight: 500,
                    wordBreak: "break-word",
                  }}>
                    {row.displayName}
                  </span>
                  <span
                    data-testid={`waitlist-note-${row.id}`}
                    style={{
                      fontSize: "14px",
                      color: "var(--ink-muted)",
                      display: "block",
                    }}
                  >
                    {row.preferenceNote ? `${row.preferenceNote} ` : ""}Added {ago(row.createdAt)}.
                  </span>
                </div>
                <Badge
                  data-testid={`waitlist-chip-${row.id}`}
                  style={{
                    flex: "0 0 auto",
                    background: preferenceTone(row.preference) === "warn" ? "var(--warn-soft)" : "var(--ink-2)",
                    color: preferenceTone(row.preference) === "warn" ? "var(--warn)" : "var(--paper)",
                  }}
                >
                  {PREFERENCE_LABEL[row.preference] ?? row.preference}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`waitlist-offer-${row.id}`}
                  onClick={() => openOffer(row)}
                  style={{ flex: "0 0 auto" }}
                >
                  Offer a time
                </Button>
                <RowActions actions={rowActions(row)} row={row} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ width: "320px", flex: "0 0 320px", display: "flex", flexDirection: "column", gap: "var(--stack)" }}>
        {prompts.length > 0 && (
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 17px",
            }}>
              <b>Worth knowing</b>
            </div>
            <div style={{ padding: "14px 17px" }}>
              {prompts.map((p) => (
                <PromptCard
                  key={p.dismissKey}
                  icon={p.icon}
                  tone={p.tone}
                  headline={p.headline}
                  why={p.why}
                  action={p.action}
                  kind={p.kind}
                  onDismiss={() => dismissPrompt(p)}
                  testId={`waitlist-prompt-${p.dismissKey}`}
                />
              ))}
            </div>
          </div>
        )}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 17px",
          }}>
            <b>What happens automatically</b>
          </div>
          <div style={{ padding: "14px 17px" }}>
            <div
              data-testid="waitlist-auto-offered"
              style={{
                display: "flex",
                gap: "10px",
                padding: "12px 0",
              }}
            >
              <span style={{
                fontWeight: 500,
                minWidth: "max-content",
              }}>When a slot opens</span>
              <span style={{
                fontSize: "14px",
                color: "var(--ink-muted)",
              }}>
                Everyone whose preference matches is told at once, and the first to take it gets it.
              </span>
            </div>
            <div
              data-testid="waitlist-auto-expiry"
              style={{
                display: "flex",
                gap: "10px",
                padding: "12px 0",
              }}
            >
              <span style={{
                fontWeight: 500,
                minWidth: "max-content",
              }}>If nobody takes it in {offerWindowText(offerMinutes)}</span>
              <span style={{
                fontSize: "14px",
                color: "var(--ink-muted)",
              }}>It goes on your booking page like any other slot.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
