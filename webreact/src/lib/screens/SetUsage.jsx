// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.034 — SetUsage: the usage screen (client).
// Ported from webui/src/lib/screens/SetUsage.svelte — same props, testids and copy.
//
// Renders usage data from `/api/settings/usage`; includes the ceiling row from the response
// saved through `POST /api/settings` with the single key `usage.ai_ceiling`.
//
// The screen carries four meter rows (label · "{used} of {included} {unit}" · detail),
// "What it costs after that" pricing rows, a ceiling row, and a Worth-knowing PromptCard.
// Basis sentence (TASK 20.32) clarifies whether figures are from Stripe Meters or counted locally.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { Progress } from "@/lib/components/ui/progress.jsx";

export default function SetUsage({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [ceilingDraft, setCeilingDraft] = useState("");
  const [basis, setBasis] = useState(null);
  const [billingPeriodStart, setBillingPeriodStart] = useState(null);
  const [billingPeriodEnd, setBillingPeriodEnd] = useState(null);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setPhase("loading");
      setError(null);
      const response = await api.request("/api/settings/usage");
      setData(response);
      if (response?.ceiling?.valueMinor !== null && response?.ceiling?.valueMinor !== undefined) {
        setCeilingDraft(String(response.ceiling.valueMinor));
      }
      // Extract TASK 20.32 fields for basis clarification
      setBasis(response?.basis ?? null);
      setBillingPeriodStart(response?.billingPeriodStart ?? null);
      setBillingPeriodEnd(response?.billingPeriodEnd ?? null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
        setPhase("error");
      }
    }
  }

  async function saveCeiling() {
    if (savingCeiling) return;
    setSavingCeiling(true);
    setError(null);

    try {
      const value = ceilingDraft.trim() === "" ? null : parseInt(ceilingDraft, 10);
      await api.request("/api/settings", {
        method: "POST",
        body: { key: "usage.ai_ceiling", value },
        idempotencyKey: crypto.randomUUID(),
      });
      // Update the data with the saved value
      if (data) {
        setData({
          ...data,
          ceiling: {
            ...data.ceiling,
            valueMinor: value,
          },
        });
      }
      if (value !== null && value !== undefined) {
        setCeilingDraft(String(value));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSavingCeiling(false);
    }
  }

  function handleDismissPrompt() {
    // Placeholder for prompt dismiss logic
  }

  const isCeilingBlocked =
    data?.meters?.some(
      (m) => m.metric === "ai_drafting" && m.used === "Not in use yet"
    );

  const currentCeiling = data?.ceiling?.valueMinor ?? null;

  // ★ Basis sentence — never computed, always from payload (TASK 20.32)
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function formatDate(iso) {
    if (!iso) return null;
    try {
      return dateFormat.format(new Date(iso));
    } catch {
      return null;
    }
  }

  const displayPeriodStart = formatDate(billingPeriodStart);
  const displayPeriodEnd = formatDate(billingPeriodEnd);

  const basisSentence =
    basis === "meter"
      ? "These figures are Stripe's meter"
      : basis === "local"
        ? "counted locally until Stripe billing starts"
        : null;

  return (
    <ScreenState
      phase={phase}
      error={error}
      subject="Usage"
      testIds={{ loading: "usage-loading", error: "usage-error", denied: "usage-denied" }}
    >
      <section className="flex flex-col gap-6 p-[26px_30px]" data-testid="set-usage">
        {/* ★ Header section with title and intro */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {data?.title && (
              <h1 className="m-0 font-fraunces font-medium text-2xl text-ink tracking-[-0.01em]">
                {data.title}
              </h1>
            )}
            {data?.intro && (
              <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-[78ch]">
                {data.intro}
              </p>
            )}
          </div>
        </div>

        {/* ★ Basis sentence and period bounds (TASK 20.32) */}
        {basisSentence && (
          <div
            className="bg-white border border-line rounded-3xl p-[15px_18px]"
            data-testid="basis-section"
          >
            <p className="m-0 mb-1.5 text-sm font-medium text-ink">
              {basisSentence}.
            </p>

            {displayPeriodStart && displayPeriodEnd ? (
              <p className="m-0 text-xs text-ink-muted leading-relaxed">
                Current period: <strong>{displayPeriodStart}</strong> to <strong>{displayPeriodEnd}</strong>
              </p>
            ) : (
              <p className="m-0 text-xs text-ink-muted leading-relaxed italic">
                Period dates not available.
              </p>
            )}
          </div>
        )}

        {/* ★ Meters section */}
        {data?.meters && data.meters.length > 0 && (
          <div
            className="bg-white border border-line rounded-3xl p-[4px_18px_10px]"
            data-testid="usage-meters"
          >
            {data.meters.map((meter, index) => (
              <div
                key={meter.metric}
                className={`flex flex-col gap-2 py-3.5 ${
                  index !== data.meters.length - 1 ? "border-b border-line-soft" : ""
                }`}
                data-testid={`meter-${meter.metric}`}
              >
                <div className="flex items-baseline gap-2.5 justify-between">
                  <span className="font-medium text-[14.5px] text-ink flex-1">
                    {meter.label}
                  </span>
                  <span className="text-[13.5px] text-ink-muted flex-shrink-0 tabular-nums">
                    {meter.used} of {meter.included} {meter.unit ?? ""}
                  </span>
                </div>
                <div className="h-[7px] rounded-full overflow-hidden bg-[var(--color-structure-150)]">
                  <Progress
                    value={
                      typeof meter.used === "number"
                        ? Math.min(meter.used, meter.included)
                        : 0
                    }
                    max={meter.included}
                    className="w-full"
                    data-testid={`progress-${meter.metric}`}
                  />
                </div>
                {meter.detail && (
                  <div className="text-[12.5px] text-ink-muted leading-relaxed">
                    {meter.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ★ Ceiling row */}
        {data?.ceiling && (
          <div
            className="bg-white border border-line rounded-3xl p-[15px_18px]"
            data-testid="ceiling-section"
          >
            <div className="flex items-start gap-4.5 justify-between">
              <div className="flex flex-col gap-1 flex-1">
                <span className="font-medium text-[14.5px] text-ink block">
                  {data.ceiling.label}
                </span>
                <span className="text-xs text-ink-muted leading-relaxed block">
                  {data.ceiling.sentence}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {isCeilingBlocked ? (
                  <div className="text-xs text-ink-muted" data-testid="ceiling-blocked">
                    We'll start enforcing this when AI drafting is switched on
                  </div>
                ) : currentCeiling === null ? (
                  <span className="text-xs text-ink-muted" data-testid="ceiling-unset">
                    No ceiling set
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted" data-testid="ceiling-value">
                    {currentCeiling}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ★ Pricing section */}
        {data?.prices && data.prices.length > 0 && (
          <div className="bg-white border border-line rounded-3xl p-[4px_18px_10px]" data-testid="pricing-section">
            <h2 className="m-0 mt-3.5 font-medium text-[14.5px] text-ink pb-1.5">
              What it costs after that
            </h2>
            <div className="flex flex-col gap-0.5">
              {data.prices.map((price, index) => (
                <div
                  key={price.label}
                  className={`flex items-start gap-4.5 py-[11px] ${
                    index !== data.prices.length - 1 ? "border-b border-line-soft" : ""
                  }`}
                  data-testid={`price-${price.label
                    .replace(/\s+/g, "-")
                    .toLowerCase()}`}
                >
                  <span className="flex-1 text-sm text-ink">
                    {price.label}
                  </span>
                  <span className="text-xs text-ink-muted flex-shrink-0 text-right">
                    {price.sentence}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ★ Worth knowing prompts section */}
        {data?.prompts && data.prompts.length > 0 && (
          <div className="mt-3" data-testid="prompts-section">
            <h2 className="m-0 mb-3.5 font-medium text-[15px] text-ink">
              Worth knowing
            </h2>
            <div className="flex flex-col gap-3">
              {data.prompts.map((prompt) => (
                <PromptCard
                  key={prompt.kind}
                  icon={prompt.icon}
                  tone={prompt.tone}
                  headline={prompt.headline}
                  why={prompt.why}
                  action={prompt.action}
                  kind={prompt.kind}
                  onDismiss={handleDismissPrompt}
                  testId={`prompt-${prompt.kind}`}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </ScreenState>
  );
}
