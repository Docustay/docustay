import WorklistPage from "@/lib/lists/WorklistPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import HeroNumber from "@/lib/components/kit/HeroNumber.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function LoyaltyPageItemsLoyaltyTable({
  onNavigate,
  go,
  numberWord,
  phase,
  error,
  loyalty,
  enabled,
  figures,
  rules,
  rewards,
  claimable,
  nothingYet,
  showDashboard,
  summaryText,
  numberFigure,
  deltaText,
  canClaimSub,
  scrollToRules,
  RULE_LABEL,
  ruleBusy,
  ruleErrors,
  toggleRule,
  openRewardSheet,
  tellBusy,
  tellErrors,
  tellPersonRow,
  promptDismissed,
  onPromptDismiss = null,
  tellAllBusy,
  promptHeadline,
  promptWhy,
  handleTellAll,
  enabling,
  enableError,
  handleEnable,
}) {
  return (
    <WorklistPage
      title="Loyalty"
      summary={summaryText}
      headerAction={showDashboard ? { label: "Change how it works", onClick: scrollToRules } : null}
      testId="items-loyalty"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={go}
        testIds={{ error: "loyalty-error", denied: "loyalty-denied" }}
      >
        {!enabled ? (
          // THE PITCH STATE — data-state="needs-setup"
          <div className="rounded-card border border-line bg-surface px-8 py-10 flex flex-col gap-4 max-w-62ch" data-testid="loyalty-pitch" data-state="needs-setup">
            <h2 className="m-0 text-heading-large font-medium text-ink">Turn on loyalty points</h2>
            <p className="m-0 text-ui text-mute leading-relaxed">
              Reward the clients who keep coming back &mdash; a point for what they pay, what they show
              up to, and who they send your way. Nothing changes until you turn it on, and it costs
              nothing to run.
            </p>
            <Button
              variant="default"
              onClick={handleEnable}
              disabled={enabling}
              data-testid="loyalty-pitch-enable"
            >
              {enabling ? "Turning it on…" : "Turn it on"}
            </Button>
            {enableError && (
              <p className="m-1 text-caption text-bad" role="alert" data-testid="loyalty-pitch-error">
                {enableError.message}{enableError.requestId ? ` (ref ${enableError.requestId})` : ""}
              </p>
            )}
          </div>
        ) : nothingYet ? (
          // THE "NOTHING YET" STATE
          <EmptyState
            kind="first-run"
            headline="Nobody's collecting yet"
            line="Points start counting with the next paid session."
            action={null}
            testId="loyalty-nothing-yet"
            onNavigate={onNavigate}
          />
        ) : (
          // THE POPULATED DASHBOARD — data-state="ready"
          <div className="flex flex-col gap-6 w-full" data-testid="loyalty-body" data-state="ready">
            <div className="flex gap-0 bg-surface border border-line rounded-card overflow-hidden" data-testid="loyalty-figures">
              <HeroNumber
                figure={figures ? numberFigure(figures.collecting) : undefined}
                label="collecting points"
                sub={figures ? deltaText(figures.collecting_delta_month) : ""}
                testId="loyalty-hero-collecting"
              />
              <HeroNumber
                figure={figures ? numberFigure(figures.can_claim) : undefined}
                label="can claim something"
                sub={canClaimSub}
                testId="loyalty-hero-can-claim"
              />
              <HeroNumber
                figure={figures ? numberFigure(figures.claimed_total) : undefined}
                label="rewards claimed"
                testId="loyalty-hero-claimed"
              />
            </div>

            <div className="flex gap-5.5 items-start">
              <div className="flex-1 flex flex-col gap-4">
                {/* Rules block */}
                <div className="bg-surface border border-line rounded-card" id="loyalty-rules-block">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                    <b className="text-ui font-medium flex-1">How points are earned</b>
                  </div>
                  <div className="py-1.5 px-4.25 flex flex-col">
                    {rules.map((rule) => (
                      <div key={rule.kind}>
                        <div className="flex items-start gap-3 py-2.75 border-b border-hair last:border-b-0" data-testid={`loyalty-rule-${rule.kind}`}>
                          <span className="flex-1 min-w-0 pt-0.5">
                            <div className="text-ui text-ink">
                              {RULE_LABEL[rule.kind].headline}
                            </div>
                            <div className="text-caption text-mute mt-0.5">{RULE_LABEL[rule.kind].helper}</div>
                            {rule.kind === "per_referral" && (
                              <span className="text-caption text-faint italic" data-testid="loyalty-rule-per_referral-edge-note">
                                This counts when a client brings a friend &mdash; never a referral routed in
                                from an outside organisation.
                              </span>
                            )}
                          </span>
                          <Switch
                            checked={rule.active}
                            disabled={ruleBusy[rule.kind]}
                            aria-label={rule.active ? `Turn off ${RULE_LABEL[rule.kind].headline}` : `Turn on ${RULE_LABEL[rule.kind].headline}`}
                            data-testid={`loyalty-rule-${rule.kind}-toggle`}
                            onCheckedChange={() => toggleRule(rule)}
                          />
                        </div>
                        {ruleErrors[rule.kind] && (
                          <div className="flex gap-2.5 bg-bad-bg text-bad rounded border border-0 px-3.5 py-3 mb-2.5 text-caption leading-relaxed" data-testid={`loyalty-rule-${rule.kind}-error`} role="alert">
                            <span aria-hidden="true">!</span>
                            <span>
                              {ruleErrors[rule.kind].message}{ruleErrors[rule.kind].requestId
                                ? ` (ref ${ruleErrors[rule.kind].requestId})`
                                : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rewards block */}
                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                    <b className="text-ui font-medium flex-1">What they can claim</b>
                    <Button variant="ghost" size="sm" onClick={openRewardSheet} data-testid="loyalty-add-reward">
                      Add a reward
                    </Button>
                  </div>
                  <div className="py-1.5 px-4.25 flex flex-col">
                    {rewards.length === 0 ? (
                      <p className="text-caption text-mute my-2" data-testid="loyalty-rewards-empty">
                        No rewards set up yet.
                      </p>
                    ) : (
                      rewards.map((reward) => (
                        <div key={reward.id} className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0" data-testid={`loyalty-reward-${reward.id}`}>
                          <span className="flex-1 min-w-0">
                            <div className="text-ui text-ink">{reward.name}</div>
                            <div className="text-caption text-mute mt-0.5">{numberFigure(reward.points_cost)} points</div>
                          </span>
                          <span className="text-caption text-mute flex-shrink-0" data-testid={`loyalty-reward-${reward.id}-claimed`}>
                            {reward.claimed} claimed
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="w-80 flex-shrink-0 flex flex-col gap-4">
                {/* Ready to claim block */}
                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                    <b className="text-ui font-medium flex-1">Ready to claim something</b>
                  </div>
                  <div className="py-1.5 px-4.25 flex flex-col">
                    {claimable.length === 0 ? (
                      <p className="text-caption text-mute my-2" data-testid="loyalty-claimable-empty">
                        Nobody has enough yet.
                      </p>
                    ) : (
                      claimable.map((person) => (
                        <div key={person.app_user_id}>
                          <div className="flex items-start gap-3 py-2.75 border-b border-hair last:border-b-0" data-testid={`loyalty-claimable-${person.app_user_id}`}>
                            <span className="flex-1 min-w-0">
                              <div className="text-ui text-ink">{person.display_name}</div>
                              <div className="text-caption text-mute mt-0.5">{numberFigure(person.points)} points</div>
                            </span>
                            <span className="flex items-center gap-2 flex-shrink-0">
                              <Button
                                size="sm"
                                onClick={() => tellPersonRow(person)}
                                disabled={tellBusy[person.app_user_id]}
                                data-testid={`loyalty-tell-${person.app_user_id}`}
                              >
                                Tell them
                              </Button>
                              <DisabledWithReason
                                disabled={true}
                                reason="Needs the new invoice editor — coming with Money"
                                testId={`loyalty-claim-${person.app_user_id}`}
                              >
                                {({ disabled }) => (
                                  <Button size="sm" variant="outline" disabled={disabled}>
                                    Claim
                                  </Button>
                                )}
                              </DisabledWithReason>
                            </span>
                          </div>
                          {tellErrors[person.app_user_id] && (
                            <div className="flex gap-2.5 bg-bad-bg text-bad rounded border border-0 px-3.5 py-3 mb-2.5 text-caption leading-relaxed" data-testid={`loyalty-tell-${person.app_user_id}-error`} role="alert">
                              <span aria-hidden="true">!</span>
                              <span>
                                {tellErrors[person.app_user_id].message}{tellErrors[person.app_user_id].requestId
                                  ? ` (ref ${tellErrors[person.app_user_id].requestId})`
                                  : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Worth knowing block */}
                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                    <b className="text-ui font-medium flex-1">Worth knowing</b>
                  </div>
                  <div className="py-1.5 px-4.25 flex flex-col">
                    {claimable.length > 0 && !promptDismissed ? (
                      <PromptCard
                        testId="loyalty-prompt-tell-all"
                        icon="◎"
                        tone="ok"
                        headline={promptHeadline}
                        why={promptWhy}
                        action={{ label: `Tell all ${numberWord(claimable.length)}`, onClick: handleTellAll }}
                        busy={tellAllBusy}
                        onDismiss={onPromptDismiss}
                      />
                    ) : (
                      <p className="text-caption text-mute my-2" data-testid="loyalty-prompt-empty">
                        Nothing needs your attention here yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </ScreenState>
    </WorklistPage>
  );
}
