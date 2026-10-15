// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.046 — PlatOverview: rebuild from the frame on the archetype
//
// Platform operator home: headline, three figures, practice table, Needs looking at prompts,
// Everything running strip. Three independent bands fetch separately.
//
// ★ Each band (overview, prompts, health) has its own loading/error state.
// ★ One band failing never blanks the others.
// ★ Cross-tenant rule: counts, never names of a practice's people.
// ★ Numbers are dense labelled strips with thin dividers, not tiles in boxes.
// ★ An empty list is the REAL PAGE with ONE BAND where the rows would be.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import PlatOverviewTable1Table from "./PlatOverviewTable1Table.jsx";
import PlatOverviewTable2Table from "./PlatOverviewTable2Table.jsx";

export default function PlatOverview({
  app,
  onNavigate,
  // ★ Optional props for testing: pass data/error/loading state directly instead of fetching
  overviewProp = null,
  promptsProp = null,
  healthProp = null,
}) {
  // ───────────────────────────────────────────────────────────────────────────────────
  // State for the three independent bands
  // ───────────────────────────────────────────────────────────────────────────────────
  const [overviewLoading, setOverviewLoading] = useState(!overviewProp);
  const [overviewError, setOverviewError] = useState(null);
  const [overviewData, setOverviewData] = useState(overviewProp);

  const [promptsLoading, setPromptsLoading] = useState(!promptsProp);
  const [promptsError, setPromptsError] = useState(null);
  const [promptsData, setPromptsData] = useState(promptsProp);

  const [healthLoading, setHealthLoading] = useState(!healthProp);
  const [healthError, setHealthError] = useState(null);
  const [healthData, setHealthData] = useState(healthProp);

  const [dismissingPromptKey, setDismissingPromptKey] = useState(null);

  // ───────────────────────────────────────────────────────────────────────────────────
  // Load overview data: practices + totals
  // ───────────────────────────────────────────────────────────────────────────────────
  async function loadOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const result = await api.platformOverview();
      setOverviewData(result);
    } catch (err) {
      if (err.status === 403) {
        // Permission denied at the band level
        setOverviewError({ message: "Access denied", kind: "denied" });
      } else {
        setOverviewError(err);
      }
    } finally {
      setOverviewLoading(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────
  // Load prompts data
  // ───────────────────────────────────────────────────────────────────────────────────
  async function loadPrompts() {
    setPromptsLoading(true);
    setPromptsError(null);
    try {
      const result = await api.platformPrompts();
      setPromptsData(result);
    } catch (err) {
      if (err.status === 403) {
        setPromptsError({ message: "Access denied", kind: "denied" });
      } else {
        setPromptsError(err);
      }
    } finally {
      setPromptsLoading(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────
  // Load health data
  // ───────────────────────────────────────────────────────────────────────────────────
  async function loadHealth() {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const result = await api.platformHealth();
      setHealthData(result);
    } catch (err) {
      if (err.status === 403) {
        setHealthError({ message: "Access denied", kind: "denied" });
      } else {
        setHealthError(err);
      }
    } finally {
      setHealthLoading(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────
  // Dismiss a prompt
  // ───────────────────────────────────────────────────────────────────────────────────
  async function handleDismissPrompt(key, subjectTenantId) {
    setDismissingPromptKey(key);
    try {
      await api.dismissPlatformPrompt({ key, subjectTenantId });
      // Remove from the prompts array
      if (promptsData) {
        setPromptsData({
          ...promptsData,
          prompts: promptsData.prompts.filter((p) => p.key !== key || p.subjectTenantId !== subjectTenantId),
        });
      }
    } catch (err) {
      console.error("Failed to dismiss prompt:", err);
    } finally {
      setDismissingPromptKey(null);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────
  // Number formatting helpers
  // ───────────────────────────────────────────────────────────────────────────────────
  function formatNumberInWords(n) {
    const words = ["zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
    return n <= 12 ? words[n] || String(n) : String(n);
  }

  function formatCurrency(minor) {
    return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    const now = new Date();
    const thisMonth = now.getMonth() === d.getMonth() && now.getFullYear() === d.getFullYear();
    if (thisMonth) {
      return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    }
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function getStateChip(state) {
    if (state === "Fine") return { label: "Fine", tone: "ok" };
    if (state === "Payment failing") return { label: "Payment failed", tone: "bad" };
    if (state === "Gone") return { label: "Gone", tone: "neutral" };
    if (typeof state === "string" && state.includes("days left")) return { label: state, tone: "act" };
    return { label: state, tone: "neutral" };
  }

  function getPracticeBadgeInitials(name) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // ───────────────────────────────────────────────────────────────────────────────────
  // On mount, initialize state from props or load all three bands from API
  // ───────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!overviewProp) {
      loadOverview();
    }

    if (!promptsProp) {
      loadPrompts();
    }

    if (!healthProp) {
      loadHealth();
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────────────

  // Handle denied access at band level
  if (overviewError?.kind === "denied") {
    return <ScreenState phase="denied" />;
  }

  // Handle loading state
  if (overviewLoading) {
    return <ScreenState phase="loading" />;
  }

  // Handle error state
  if (overviewError) {
    return <ErrorPanel error={overviewError} />;
  }

  // Render the main content
  if (!overviewData) {
    return null;
  }

  const practices = overviewData.practices || [];
  const totals = overviewData.totals || {};

  return (
    <div className="flex flex-col h-full" data-testid="platform-overview">
      {/* ═══════════════════════════════════════════════════════════════════════════════════════════ */}
      {/* HEADER + FIGURES (from overview band) */}
      {/* ═══════════════════════════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-end gap-4 mb-[18px]">
        <div className="flex-1">
          <h1 className="m-0 font-medium text-[24px] leading-none font-serif text-ink tracking-[-0.01em]">
            Practices
          </h1>
          <div className="text-[13.5px] text-mute mt-[5px]">
            {practices.length === 0
              ? "No practices yet."
              : `${formatNumberInWords(totals.count)} live.${
                  totals.needsLooking > 0
                    ? ` ${totals.needsLooking} ${totals.needsLooking === 1 ? "needs" : "need"} looking at.`
                    : ""
                }`}
          </div>
        </div>
        <Button variant="outline" onClick={() => onNavigate?.("/platform/health")}>
          Health
        </Button>
        <Button variant="default" onClick={() => onNavigate?.("/signup")}>
          New practice
        </Button>
      </div>

      {/* Three figures strip */}
      {practices.length > 0 && (
        <div className="flex gap-0 bg-surface border border-line rounded-card overflow-hidden mb-5">
          <div className="flex-1 px-[22px] py-5 border-r border-hair">
            <div className="font-serif text-[34px] leading-none font-normal tracking-[-0.02em] text-ink">
              {totals.count}
            </div>
            <div className="text-[13px] text-mute mt-[7px]">practices</div>
            <div className={`text-[12.5px] mt-[5px] ${totals.joinedThisMonth > 0 ? "text-ok" : "text-mute"}`}>
              {totals.joinedThisMonth > 0
                ? `${formatNumberInWords(totals.joinedThisMonth)} joined this month`
                : "No new practices this month"}
            </div>
          </div>
          <div className="flex-1 px-[22px] py-5 border-r border-hair">
            <div className="font-serif text-[34px] leading-none font-normal tracking-[-0.02em] text-ink">
              {formatCurrency(totals.mrrMinor)}
            </div>
            <div className="text-[13px] text-mute mt-[7px]">a month</div>
            <div className="text-[12.5px] mt-[5px] text-mute">
              Plus {(0.5).toFixed(1)}% of {formatCurrency(totals.processedThisMonthMinor)} processed
            </div>
          </div>
          <div className="flex-1 px-[22px] py-5">
            <div className="font-serif text-[34px] leading-none font-normal tracking-[-0.02em] text-ink">
              {totals.needsLooking}
            </div>
            <div className="text-[13px] text-mute mt-[7px]">needs looking at</div>
            <div className={`text-[12.5px] mt-[5px] ${totals.needsLooking > 0 ? "text-bad" : "text-mute"}`}>
              {totals.needsLooking > 0
                ? `${totals.needsLooking} practice needs attention`
                : "All practices running fine"}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════════════════════ */}
      {/* PRACTICES TABLE + PROMPTS + HEALTH (two-column layout) */}
      {/* ═══════════════════════════════════════════════════════════════════════════════════════════ */}
      {practices.length === 0 ? (
        // Empty state: the real page with one band where rows would be
        <PlatOverviewTable1Table />
      ) : (
        <div className="flex gap-[22px] items-start">
          <div className="flex-1 min-w-0">
            {/* Practices table (max 50 rows shown) */}
            <PlatOverviewTable2Table
              practices={practices.slice(0, 50)}
              onNavigate={onNavigate}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              getStateChip={getStateChip}
              getPracticeBadgeInitials={getPracticeBadgeInitials}
            />
            {practices.length > 50 && (
              <div className="text-[13.5px] text-mute pl-0.5 mt-2.5">
                <a href="#" onClick={() => onNavigate?.("/platform/tenants")} className="text-brand no-underline hover:underline">
                  See all {practices.length} practices
                </a>
              </div>
            )}
          </div>

          {/* Right column: Prompts + Health */}
          <div className="w-80 flex-shrink-0">
            {/* NEEDS LOOKING AT PROMPTS */}
            <div className="bg-surface border border-line rounded-card mb-[18px]">
              <div className="flex items-center gap-2.5 px-[17px] py-[14px] border-b border-hair">
                <b className="font-medium text-[14.5px]">Needs looking at</b>
              </div>
              <div className="px-[17px] py-[14px]">
                {promptsLoading ? (
                  <div className="px-5 py-5 text-center text-mute text-sm">Loading…</div>
                ) : promptsError ? (
                  <ErrorPanel error={promptsError} />
                ) : promptsData?.prompts && promptsData.prompts.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {promptsData.prompts.map((prompt) => (
                      <PromptCard
                        key={`${prompt.key}-${prompt.subjectTenantId || ""}`}
                        icon={prompt.key === "payment_failing" ? "$" : "◈"}
                        tone={prompt.key === "payment_failing" ? "bad" : "act"}
                        headline={prompt.title}
                        why={prompt.why}
                        action={prompt.actions?.[0] || { label: "View", href: `/platform/tenants/${prompt.subjectTenantId}` }}
                        onDismiss={() => handleDismissPrompt(prompt.key, prompt.subjectTenantId)}
                        busy={dismissingPromptKey === prompt.key}
                        testId="prompt-card"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-5 text-center text-mute text-sm">Nothing needs you right now.</div>
                )}
              </div>
            </div>

            {/* EVERYTHING RUNNING (HEALTH STATUS) */}
            <div className="bg-surface border border-line rounded-card">
              <div className="flex items-center gap-2.5 px-[17px] py-[14px] border-b border-hair">
                <b className="font-medium text-[14.5px]">Everything running</b>
              </div>
              <div className="px-[17px] py-[14px]">
                {healthLoading ? (
                  <div className="px-5 py-5 text-center text-mute text-sm">Loading…</div>
                ) : healthError ? (
                  <ErrorPanel error={healthError} />
                ) : healthData?.board ? (
                  <>
                    {/* App and worker (database + worker_heartbeat) */}
                    {healthData.board.ours?.map((item) => (
                      <div key={item.label} className="flex items-center gap-3 py-[11px] border-b border-hair">
                        <span className="flex-1">
                          <div className="text-sm">{item.label}</div>
                          <span className="block text-[12.5px] text-mute mt-0.5">{item.detail}</span>
                        </span>
                        <StatusBadge
                          label={item.state === "up" ? "Up" : item.state === "down" ? "Down" : "Unknown"}
                          tone={item.state === "up" ? "ok" : item.state === "down" ? "bad" : "neutral"}
                        />
                      </div>
                    ))}
                    {/* Stripe (stripe_webhooks) */}
                    {healthData.board.theirs?.slice(0, 3).map((item) => (
                      <div key={item.label} className="flex items-center gap-3 py-[11px] border-b border-hair">
                        <span className="flex-1">
                          <div className="text-sm">{item.label}</div>
                          <span className="block text-[12.5px] text-mute mt-0.5">{item.detail}</span>
                        </span>
                        <StatusBadge
                          label={item.state === "fine" ? "Fine" : item.state === "down" ? "Down" : "Not measured"}
                          tone={item.state === "fine" ? "ok" : item.state === "down" ? "bad" : "neutral"}
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="px-5 py-5 text-center text-mute text-sm">No health data available.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
