// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatPracticeRecord — platform operator Practice Record page: /platform/tenants/:id
// ★ Consumes API response from 18.11's GET /api/platform/practices/:tenantId
// ★ Mounts PlatGrantAccess sheet for the "Ask to look" button
// ★ Navigates to support view (/platform/tenants/:id/look) on grant approval
// Ported from webui/src/lib/screens/platform/PlatPracticeRecord.svelte (751 lines).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import PlatGrantAccess from "./PlatGrantAccess.jsx";

export default function PlatPracticeRecord({
  app,
  tenantId,
  onNavigate,
  practiceProp = null,
  promptsProp = null,
}) {
  const [phase, setPhase] = useState("loading");
  const [practice, setPractice] = useState(null);
  const [prompts, setPrompts] = useState(null);
  const [error, setError] = useState(null);
  const [grantSheetOpen, setGrantSheetOpen] = useState(false);

  // Format currency as dollars
  function formatCurrency(minor) {
    if (minor == null) return "—";
    const dollars = (minor / 100).toFixed(2);
    return `$${dollars}`;
  }

  // Format relative time
  function formatRelative(date) {
    if (!date) return "—";
    const now = new Date();
    const d = new Date(date);
    const seconds = Math.floor((now - d) / 1000);

    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;

    // Fall back to date string
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // Get the prompt for this practice
  function getPracticePrompt() {
    if (!prompts || prompts.length === 0) return null;
    return prompts.find((p) => p.subjectTenantId === tenantId) || null;
  }

  // Get the "never used" features (filter to those not used)
  function getNeverUsed() {
    if (!practice || !practice.neverUsed) return [];
    return practice.neverUsed.filter((item) => !item.used);
  }

  // Get the label for a feature key
  function getFeatureLabel(key) {
    const labels = {
      documents: "Documents",
      packages: "Packages",
      run: "Run",
    };
    return labels[key] || key;
  }

  // Get the reason/explanation for a feature not being used
  function getFeatureReason(key) {
    const reasons = {
      documents: "Nothing sent. They're on paper.",
      packages: "Everything is invoiced one session at a time.",
      run: "Not on their plan.",
    };
    return reasons[key] || "Not used.";
  }

  // Get the tone/badge for a feature
  function getFeatureTone(key) {
    if (key === "run") return "mute";
    return "warn";
  }

  // Check if the access is currently live or pending
  function getAccessState() {
    if (!practice.access || !practice.access.lastAsked) return "none";
    const state = practice.access.lastAsked.state;
    if (state === "approved") return "approved";
    if (state === "asked") return "pending";
    if (state === "rejected") return "rejected";
    return state;
  }

  // Load practice and prompts on mount
  async function load() {
    // If test props are provided, use them directly
    if (practiceProp !== null && promptsProp !== null) {
      setPractice(practiceProp);
      setPrompts(promptsProp);

      if (!practiceProp.isReal) {
        setPhase("404");
      } else if (practiceProp.state === "Gone") {
        setPhase("gone");
      } else {
        setPhase("ready");
      }
      return;
    }

    setPhase("loading");
    setError(null);

    try {
      const [practiceData, promptsData] = await Promise.all([
        api.platformPractice(tenantId),
        api.platformPrompts(),
      ]);

      setPractice(practiceData);
      setPrompts(promptsData);

      // Check if practice is real and not gone
      if (!practiceData.isReal) {
        setPhase("404");
      } else if (practiceData.state === "Gone") {
        setPhase("gone");
      } else {
        setPhase("ready");
      }
    } catch (err) {
      if (err.status === 404) {
        setPhase("404");
      } else {
        setError(err);
        setPhase("error");
      }
    }
  }

  // Handle closing the grant access sheet
  function handleCloseSheet() {
    setGrantSheetOpen(false);
  }

  // Handle after the sheet is submitted
  function handleAsked(result) {
    setGrantSheetOpen(false);
    // Reload practice to get updated access state
    load();
  }

  // Handle opening the support view
  function handleOpenSupport() {
    onNavigate(`/platform/tenants/${tenantId}/look`);
  }

  // Dismiss the prompt
  async function dismissPrompt(prompt) {
    try {
      await api.dismissPlatformPrompt({
        key: prompt.key,
        subjectTenantId: tenantId,
      });
      // Remove from the prompts list
      setPrompts(prompts.filter((p) => p.key !== prompt.key));
    } catch (err) {
      console.error("Failed to dismiss prompt:", err);
    }
  }

  // Load on mount
  useEffect(() => {
    if (tenantId) {
      load();
    }
  }, [tenantId]);

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "404") {
    return (
      <ScreenState
        phase="404"
        detail="There is no practice here."
      />
    );
  }

  if (phase === "error") {
    return <ScreenState phase="error" error={error} />;
  }

  if (phase === "gone" && practice) {
    // Gone practice: read-only history view
    return (
      <div className="p-0">
        {/* Header Row */}
        <div className="mb-[22px] flex flex-col items-start gap-[18px] border-b border-line bg-white px-6 py-6 sm:flex-row sm:items-start">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-center font-medium text-brand text-[19px]">
            {practice.name.charAt(0).toUpperCase()}{practice.name.charAt(1)?.toUpperCase() || ""}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 font-serif text-2xl font-medium tracking-[-0.01em]">
              {practice.name}
            </h1>
            <p className="m-0 mt-1.5 text-meta text-mute">
              {practice.slug} · {practice.displayPlan}, {formatCurrency(practice.plan.monthlyMinor)} a month · since {new Date(practice.since).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              })}
            </p>
            <p className="m-0 mt-1 text-meta text-mute">read-only history</p>
          </div>
        </div>

        {/* Trouble section */}
        {practice.trouble && practice.trouble.length > 0 && (
          <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
            <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
              <h2 className="m-0 flex-1 font-medium text-control">Trouble</h2>
            </div>
            <div className="px-[17px] pb-3.5 pt-1.5">
              {practice.trouble.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="w-[74px] flex-shrink-0 text-meta text-mute font-variant-numeric">
                    {new Date(item.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                  <span className="flex flex-1 flex-col">
                    {item.kind}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (phase === "ready" && practice) {
    // Ready state: full practice record
    return (
      <div className="p-0">
        {/* Header Row */}
        <div className="mb-[22px] flex flex-col items-start gap-[18px] border-b border-line bg-white px-6 py-6 sm:flex-row sm:items-start">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-center font-medium text-brand text-[19px]">
            {practice.name.charAt(0).toUpperCase()}{practice.name.charAt(1)?.toUpperCase() || ""}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 font-serif text-2xl font-medium tracking-[-0.01em]">
              {practice.name}
            </h1>
            <p className="m-0 mt-1.5 text-meta text-mute">
              {practice.slug} · {practice.displayPlan}, {formatCurrency(practice.plan.monthlyMinor)} a month · since {new Date(practice.since).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
          <div className="flex w-full flex-shrink-0 flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <DisabledWithReason
              disabled={practice.stripe.accountId === null}
              reason={
                practice.stripe.accountId === null
                  ? "Not connected to Stripe yet"
                  : ""
              }
            >
              {({ disabled, describedBy }) => (
                <Button
                  className="w-full sm:w-auto"
                  href={
                    practice.stripe.accountId
                      ? `https://dashboard.stripe.com/connect/accounts/${practice.stripe.accountId}`
                      : undefined
                  }
                  target={practice.stripe.accountId ? "_blank" : undefined}
                  rel={practice.stripe.accountId ? "noopener" : undefined}
                  disabled={disabled}
                  aria-describedby={describedBy}
                >
                  Open their Stripe
                </Button>
              )}
            </DisabledWithReason>

            {practice.state === "Gone" ? (
              <DisabledWithReason
                disabled={true}
                reason="read-only history"
              >
                {({ disabled, describedBy }) => (
                  <Button
                    className="w-full sm:w-auto"
                    disabled={disabled}
                    aria-describedby={describedBy}
                  >
                    Ask to look at their account
                  </Button>
                )}
              </DisabledWithReason>
            ) : (
              (() => {
                const accessState = getAccessState();
                if (accessState === "approved") {
                  return (
                    <Button className="w-full sm:w-auto" onClick={handleOpenSupport}>
                      Open
                    </Button>
                  );
                } else if (accessState === "pending") {
                  return (
                    <DisabledWithReason
                      disabled={true}
                      reason={`Asked ${new Date(practice.access.lastAsked.askedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — waiting`}
                    >
                      {({ disabled, describedBy }) => (
                        <Button
                          className="w-full sm:w-auto"
                          disabled={disabled}
                          aria-describedby={describedBy}
                        >
                          Asked — waiting
                        </Button>
                      )}
                    </DisabledWithReason>
                  );
                } else {
                  return (
                    <Button className="w-full sm:w-auto" onClick={() => setGrantSheetOpen(true)}>
                      Ask to look at their account
                    </Button>
                  );
                }
              })()
            )}
          </div>
        </div>

        {/* Prompt Card */}
        {getPracticePrompt() && (
          (() => {
            const prompt = getPracticePrompt();
            return (
              <div className="mb-1.5 px-6 pb-5">
                <PromptCard
                  icon="$"
                  tone={prompt.tone || "bad"}
                  headline={prompt.headline}
                  why={prompt.why}
                  action={{
                    label: prompt.actionLabel || "Got it",
                    onClick: () => dismissPrompt(prompt),
                  }}
                  onDismiss={() => dismissPrompt(prompt)}
                />
              </div>
            );
          })()
        )}

        {/* Two-Column Layout */}
        <div className="flex flex-col gap-[22px] px-6 pb-[70px] lg:flex-row">
          <div className="min-w-0 flex-1">
            {/* How they're using it */}
            <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
              <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                <h2 className="m-0 flex-1 font-medium text-control">
                  How they're using it
                </h2>
              </div>
              <div className="px-[17px] pb-3.5 pt-1.5">
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {practice.clients} clients
                    <span className="mt-0.5 block text-xs text-mute">
                      Up {practice.clientsNewThisMonth} this month
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {formatCurrency(practice.processedThisMonthMinor)} processed this month
                    <span className="mt-0.5 block text-xs text-mute">
                      You earned {formatCurrency(practice.earnedThisMonthMinor)} of that
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {practice.team} of 5 staff
                    <span className="mt-0.5 block text-xs text-mute">
                      Last signed in {formatRelative(practice.staffLastSignedIn)}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* What they've never used */}
            {getNeverUsed().length > 0 && (
              <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
                <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                  <h2 className="m-0 flex-1 font-medium text-control">
                    What they've never used
                  </h2>
                </div>
                <div className="px-[17px] pb-3.5 pt-1.5">
                  {getNeverUsed().map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0"
                    >
                      <span className="flex flex-1 flex-col">
                        {getFeatureLabel(item.key)}
                        <span className="mt-0.5 block text-xs text-mute">
                          {getFeatureReason(item.key)}
                        </span>
                      </span>
                      <span
                        className={
                          getFeatureTone(item.key) === "warn"
                            ? "inline-flex flex-shrink-0 items-center rounded-[5px] px-[9px] py-0.5 text-xs font-medium bg-[var(--color-warn-soft)] text-[var(--color-warn)]"
                            : "inline-flex flex-shrink-0 items-center rounded-[5px] px-[9px] py-0.5 text-xs font-medium bg-[var(--color-mute-bg)] text-[var(--color-mute)]"
                        }
                      >
                        {item.key === "run" ? "Locked" : "Worth a call"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trouble */}
            {practice.trouble && practice.trouble.length > 0 && (
              <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
                <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                  <h2 className="m-0 flex-1 font-medium text-control">Trouble</h2>
                </div>
                <div className="px-[17px] pb-3.5 pt-1.5">
                  {practice.trouble.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0"
                    >
                      <span className="w-[74px] flex-shrink-0 text-meta text-mute font-variant-numeric">
                        {new Date(item.at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      <span className="flex flex-1 flex-col">
                        {item.kind}
                        {item.detail && (
                          <span className="mt-0.5 block text-xs text-mute">
                            {item.detail}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-full flex-shrink-0 lg:w-80">
            {/* Money */}
            <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
              <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                <h2 className="m-0 flex-1 font-medium text-control">Money</h2>
              </div>
              <div className="px-[17px] pb-3.5 pt-1.5">
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {formatCurrency(practice.plan.monthlyMinor)} a month
                    <span className="mt-0.5 block text-xs text-mute">
                      {practice.displayPlan}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {formatCurrency(practice.earnedThisMonthMinor)} this month
                    <span className="mt-0.5 block text-xs text-mute">
                      0.5% of what they processed
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    {formatCurrency(practice.processedAllTimeMinor)} all time
                    <span className="mt-0.5 block text-xs text-mute">
                      Since {new Date(practice.since).toLocaleDateString("en-GB", {
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Their Stripe */}
            <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
              <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                <h2 className="m-0 flex-1 font-medium text-control">
                  Their Stripe
                </h2>
              </div>
              <div className="px-[17px] pb-3.5 pt-1.5">
                {practice.stripe.accountId ? (
                  <>
                    <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                      <span className="flex flex-1 flex-col">
                        Connected {new Date(practice.stripe.connectedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                        })}
                        <span className="mt-0.5 block text-xs text-mute">
                          Standard account
                        </span>
                      </span>
                      <span className="inline-flex flex-shrink-0 items-center rounded-[5px] px-[9px] py-0.5 text-xs font-medium bg-[var(--color-ok-soft)] text-[var(--color-ok)]">
                        Fine
                      </span>
                    </div>
                    <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                      <span className="flex flex-1 flex-col">
                        Payouts
                        <span className="mt-0.5 block text-xs text-mute">
                          Not measured yet
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                      <span className="flex flex-1 flex-col">
                        Disputes
                        <span className="mt-0.5 block text-xs text-mute">
                          Not measured yet
                        </span>
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                    <span className="flex flex-1 flex-col">
                      Not connected yet
                      <span className="mt-0.5 block text-xs text-mute">
                        They need to set up their Stripe account
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Looking at their account */}
            <div className="mb-[18px] overflow-hidden rounded-[12px] border border-line bg-white">
              <div className="flex items-center gap-2.5 border-b border-hair px-[17px] py-3.5">
                <h2 className="m-0 flex-1 font-medium text-control">
                  Looking at their account
                </h2>
              </div>
              <div className="px-[17px] pb-3.5 pt-1.5">
                <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                  <span className="flex flex-1 flex-col">
                    You have to ask
                    <span className="mt-0.5 block text-xs text-mute">
                      They get an email, and it shows in their activity log.
                      Access lasts an hour.
                    </span>
                  </span>
                </div>
                {practice.access?.lastAsked && (
                  <div className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0">
                    <LastChanged
                      at={practice.access.lastAsked.askedAt}
                      label="Last asked"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Grant Access Sheet */}
        <PlatGrantAccess
          tenantId={tenantId}
          practiceName={practice.name}
          open={grantSheetOpen}
          onClose={handleCloseSheet}
          onAsked={handleAsked}
        />
      </div>
    );
  }

  return null;
}
