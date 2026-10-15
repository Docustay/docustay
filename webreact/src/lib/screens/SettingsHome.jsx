// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SettingsHome — ported from webui/src/lib/screens/SettingsHome.svelte
// States: empty (no settings groups), with groups, plan block, recently changed section
// Testids: settings-home, settings-home-subtitle, settings-home-groups, settings-group-*,
//          settings-card-*, settings-card-status-*, settings-plan-block, settings-plan-status,
//          settings-recently-changed-block, settings-recently-changed-row, settings-home-lastchanged
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge";
import EmptyState from "@/lib/empty/EmptyState";

export default function SettingsHome({ view = null, onNavigate = null }) {
  const groups = (view?.groups ?? []).filter((g) => (g.cards ?? []).length > 0);
  const attentionCount = view?.attentionCount ?? 0;
  const lastChanged = view?.lastChanged ?? null;
  const plan = view?.plan ?? null;
  const recentlyChanged = view?.recentlyChanged ?? [];
  const headerSentence = view?.headerSentence ?? "";

  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function statusLabel(status) {
    if (status === "ok") return "Connected";
    if (status === "attention") return "Needs attention";
    if (status === "broken") return "Broken";
    return null;
  }

  function statusBadgeLabel(status) {
    if (status === "active") return "Active";
    return "Inactive";
  }

  function formatMetricName(metric) {
    if (metric === "ai_draft") return "AI drafts";
    if (metric === "text") return "Text messages";
    if (metric === "esign") return "E-signs";
    if (metric === "marketing_email") return "Marketing emails";
    return metric;
  }

  function goto(e, href) {
    e.preventDefault();
    onNavigate?.(href);
  }

  return (
    <div className="flex flex-col gap-[var(--stack)]" data-testid="settings-home">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-2xl font-medium tracking-[-0.01em] text-ink">Settings</h1>
        <p className="m-0 text-sm text-mute" data-testid="settings-home-subtitle">{headerSentence}</p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          kind="not-built"
          headline="No settings pages yet"
          line="Settings pages appear here as they're built."
          testId="settings-home-empty"
        />
      ) : (
        <div className="flex gap-[22px] items-start">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-3 gap-[var(--gap)]" data-testid="settings-home-groups">
              {groups.map((group) =>
                group.cards.length > 0 ? (
                  <div
                    key={group.key}
                    className="border border-line rounded-2xl p-4.5 flex flex-col gap-[var(--stack)] min-w-0"
                    data-testid={`settings-group-${group.key}`}
                  >
                    <div className="flex items-center gap-[var(--stack)]">
                      <h2 className="m-0 text-base font-semibold text-ink">{group.title}</h2>
                    </div>
                    <div className="flex flex-col">
                      {group.cards.map((card) => (
                        <a
                          key={card.key}
                          href={card.href}
                          className="flex items-center gap-[var(--stack)] py-3.75 border-b border-line-soft text-sm text-ink no-underline last:border-b-0 hover:text-primary"
                          data-testid={`settings-card-${card.key}`}
                          onClick={(e) => goto(e, card.href)}
                        >
                          <span className="flex-1 font-medium text-ink">{card.title}</span>
                          {card.status && (
                            <Badge
                              className={`h-[var(--chip-h)] text-[length:var(--chip-fs)] font-[number:var(--chip-fw)] ${
                                card.status === "ok"
                                  ? "bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]"
                                  : card.status === "attention"
                                  ? "bg-[var(--chip-warn-bg)] text-[var(--chip-warn-ink)]"
                                  : "bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]"
                              }`}
                              data-testid={`settings-card-status-${card.key}`}
                            >
                              {statusLabel(card.status)}
                            </Badge>
                          )}
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-4.25 h-4.25 flex-shrink-0 text-mute"
                          >
                            <path d="m9 6 6 6-6 6"></path>
                          </svg>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </div>

          <div className="w-80 flex-shrink-0">
            {plan && (
              <div className="border border-line rounded-xl p-4 bg-white mb-4.5" data-testid="settings-plan-block">
                <h3 className="m-0 mb-3.5 text-xs font-medium text-ink">Your plan</h3>
                <div className="flex items-baseline gap-2 mb-3">
                  {plan.name ? (
                    <>
                      <span className="font-medium text-ink">{plan.name}</span>
                      <span className="text-xs text-mute">{plan.priceSentence}</span>
                      {plan.renews && <span className="text-xs text-mute">renews {plan.renews}</span>}
                    </>
                  ) : (
                    <span>No plan yet</span>
                  )}
                </div>
                {plan.status && (
                  <div className="mb-3">
                    <Badge
                      className="h-[var(--chip-h)] text-[length:var(--chip-fs)] font-[number:var(--chip-fw)] bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]"
                      data-testid="settings-plan-status"
                    >
                      {statusBadgeLabel(plan.status)}
                    </Badge>
                  </div>
                )}
                {plan.staff && (
                  <div className="text-xs text-mute mb-2">
                    {plan.staff.used} of {plan.staff.included} staff
                  </div>
                )}
                {plan.usage && (
                  <div className="text-xs text-mute">
                    {formatMetricName(plan.usage.metric)} {plan.usage.used} of {plan.usage.included} this month
                  </div>
                )}
              </div>
            )}

            {recentlyChanged.length > 0 && (
              <div className="border border-line rounded-xl p-4 bg-white" data-testid="settings-recently-changed-block">
                <h3 className="m-0 mb-3.5 text-xs font-medium text-ink">Recently changed</h3>
                <div className="flex flex-col">
                  {recentlyChanged.map((change) => (
                    <div
                      key={change.at}
                      className="flex flex-col gap-[3px] py-3 border-b border-line-soft last:border-b-0 text-xs"
                      data-testid="settings-recently-changed-row"
                    >
                      <span className="font-medium text-ink">{change.object}</span>
                      {change.before !== null && change.before !== undefined && change.after !== null && change.after !== undefined && (
                        <span className="text-xs text-mute">
                          {change.before} to {change.after}
                        </span>
                      )}
                      <span className="text-xs text-mute">{change.by}, {when(change.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="m-0 text-xs text-mute" data-testid="settings-home-lastchanged">
        {lastChanged && (
          <>
            Last change: by {lastChanged.by}, {when(lastChanged.at)}{" "}
            <span className="mx-1">·</span>
          </>
        )}
        <a href="/settings/developer/audit-log" className="text-primary no-underline" onClick={(e) => goto(e, "/settings/developer/audit-log")}>
          Change log
        </a>
      </p>
    </div>
  );
}
