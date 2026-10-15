// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ReportCoaches — "How the team is doing" report. Sessions, hours and utilisation per coach.
// Ported from webui/src/lib/screens/reports/ReportCoaches.svelte (214 lines).
// Props: onNavigate, data (optional for testing). Archetype: LedgerPage.
//
// ★★★ THE EARNED COLUMN IS CONDITIONAL ON THE DATA, NOT ON THE VIEWER'S ROLE. The column is
//     included in the columns array only when at least one row actually carries earned_minor.
//     This matches the Svelte implementation where the column genuinely does not exist for viewers
//     without 'invoice' 'view' permission.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ReportCoachesTable1Table from "./ReportCoachesTable1Table.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";

export default function ReportCoaches({ onNavigate = null, data = null }) {
  const [payload, setPayload] = useState(data);
  const [screenPhase, setScreenPhase] = useState(data ? "ready" : "loading");
  const [errorInfo, setErrorInfo] = useState(null);
  const [range, setRange] = useState("this-month");
  const [compare, setCompare] = useState(false);

  function computeDates(sel) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    if (sel === "last-3-months") {
      const from = new Date(Date.UTC(y, m - 2, 1)); const to = new Date(Date.UTC(y, m + 1, 1));
      const compareFrom = new Date(Date.UTC(y, m - 5, 1)); const compareTo = new Date(Date.UTC(y, m - 2, 1));
      return { from, to, compareFrom, compareTo };
    }
    if (sel === "this-quarter") {
      const qStart = m - (m % 3);
      const from = new Date(Date.UTC(y, qStart, 1)); const to = new Date(Date.UTC(y, qStart + 3, 1));
      const compareFrom = new Date(Date.UTC(y, qStart - 3, 1)); const compareTo = new Date(Date.UTC(y, qStart, 1));
      return { from, to, compareFrom, compareTo };
    }
    // "this-month" and "custom" both fall back to the current month.
    const from = new Date(Date.UTC(y, m, 1)); const to = new Date(Date.UTC(y, m + 1, 1));
    const compareFrom = new Date(Date.UTC(y, m - 1, 1)); const compareTo = new Date(Date.UTC(y, m, 1));
    return { from, to, compareFrom, compareTo };
  }

  const isoDate = (d) => d.toISOString().slice(0, 10);

  async function load() {
    setScreenPhase("loading");
    setErrorInfo(null);
    try {
      const { from, to, compareFrom, compareTo } = computeDates(range);
      const result = await api.report(`coaches`, {
        from: isoDate(from), to: isoDate(to),
        compareFrom: isoDate(compareFrom), compareTo: isoDate(compareTo),
      });
      setPayload(result);
      setScreenPhase("ready");
    } catch (err) {
      setErrorInfo(err);
      setScreenPhase("error");
    }
  }

  useEffect(() => {
    if (!data) load();
  }, []);

  useEffect(() => {
    if (!data) load();
  }, [range]);

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const enoughData = payload?.enough_data ?? { enough: true, days_going: 0, payments: 0 };

  // ★★★ THE CRITICAL CHECK: Present only when a row genuinely carries it.
  const hasEarned = rows.some((r) => r.earned_minor !== null && r.earned_minor !== undefined);

  function formatMoney(minor) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(Number(minor) / 100);
  }

  const displayRows = rows.map((r) => ({
    id: r.coach_id,
    display_name: r.display_name,
    sessions: r.sessions ?? 0,
    hours_booked: Math.round(Number(r.hours_booked ?? 0)),
    utilisation: `${Math.round(Number(r.utilisation_pct ?? 0))}%`,
    no_shows: r.no_shows ?? 0,
    ...(hasEarned ? { earned: formatMoney(r.earned_minor ?? 0) } : {}),
  }));

  const columns = [
    { key: "display_name", label: "Who" },
    { key: "sessions", label: "Sessions" },
    { key: "hours_booked", label: "Hours booked" },
    { key: "utilisation", label: "Of their available hours" },
    { key: "no_shows", label: "No-shows" },
    ...(hasEarned ? [{ key: "earned", label: "Earned" }] : []),
  ];

  const totalSessions = rows.reduce((sum, r) => sum + (r.sessions ?? 0), 0);

  // Page headline: "91 sessions between three of you. the maintainer is doing two thirds of them."
  const TEAM_WORDS = [null, "one", "two", "three", "four", "five", "six", "seven", "eight"];
  let headline = "";
  if (rows.length > 0 && totalSessions > 0) {
    const teamWord = rows.length < TEAM_WORDS.length ? TEAM_WORDS[rows.length] : String(rows.length);
    const base = `${totalSessions} session${totalSessions === 1 ? "" : "s"} between ${teamWord} of you.`;
    if (rows.length >= 2) {
      const busiest = rows.reduce((a, b) => ((b.sessions ?? 0) > (a.sessions ?? 0) ? b : a), rows[0]);
      const share = busiest.sessions / totalSessions;
      const shareWord = share >= 0.66 ? "two thirds" : share >= 0.5 ? "half" : share >= 0.33 ? "a third" : null;
      headline = shareWord ? `${base} ${busiest.display_name} is doing ${shareWord} of them.` : base;
    } else {
      headline = base;
    }
  }

  // Utilisation prompt: shown when spread is ≥20 points between highest and lowest utilised coaches
  let utilisationSpread = null;
  if (rows.length >= 2) {
    let max = rows[0], min = rows[0];
    for (const r of rows) {
      if (Number(r.utilisation_pct ?? 0) > Number(max.utilisation_pct ?? 0)) max = r;
      if (Number(r.utilisation_pct ?? 0) < Number(min.utilisation_pct ?? 0)) min = r;
    }
    const spread = Number(max.utilisation_pct ?? 0) - Number(min.utilisation_pct ?? 0);
    if (spread >= 20) utilisationSpread = { max, min };
  }

  function handleShareLink() {
    onNavigate?.("/settings/booking");
  }

  const renderContent = () => (
    <div className="flex flex-col gap-6">
      <ReportCoachesTable1Table
        rows={displayRows}
        displayRows={displayRows}
        columns={columns}
      />

      {utilisationSpread && (
        <div className="flex flex-col gap-0 rounded-card border border-line bg-surface">
          <div className="px-4 py-3.5 border-b border-hair">
            <h2 className="text-ui font-semibold text-ink">Worth knowing</h2>
          </div>
          <div className="px-4 py-3.5">
            <PromptCard
              icon="▦"
              tone="act"
              headline={`${utilisationSpread.max.display_name} is at ${Math.round(Number(utilisationSpread.max.utilisation_pct))}% and ${utilisationSpread.min.display_name} is at ${Math.round(Number(utilisationSpread.min.utilisation_pct))}%`}
              why="people booking through the public page get offered whoever is free, but sharing the practice link instead of a coach's own gives every coach an even chance at new bookings."
              action={{ label: "Share the practice link instead", onClick: handleShareLink }}
              onDismiss={() => {}}
              testId="report-coaches-prompt"
            />
          </div>
        </div>
      )}
    </div>
  );

  const emptyBlock = {
    kind: "first-run",
    headline: "Not enough has happened yet. Come back after your first month",
    line: `Reports compare one period against another, so they need something to compare against. You've been going ${enoughData.days_going} days and taken ${enoughData.payments} payments — that's not a trend yet, it's ${enoughData.payments} payments.`,
    action: {
      label: `See the ${enoughData.payments} payments`,
      href: "/money/payments",
    },
  };

  return (
    <LedgerPage
      testId="report-coaches"
      title="How the team is doing"
      summary={headline}
      loading={screenPhase === "loading"}
      primary={{ label: "Export", onClick: () => {} }}
      controls={
        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-2">
            <label htmlFor="when-select" className="text-xs font-medium text-mute">When</label>
            <select
              id="when-select"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="h-8.5 px-3 border border-line rounded-sm bg-white text-xs font-normal text-ink cursor-pointer"
            >
              <option value="this-month">This month</option>
              <option value="last-3-months">Last 3 months</option>
              <option value="this-quarter">This quarter</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="inline-flex items-center gap-2">
            <label htmlFor="compare-toggle" className="text-xs font-medium text-mute">Compare</label>
            <input
              id="compare-toggle"
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="w-5 h-5 cursor-pointer"
            />
          </div>
        </div>
      }
    >
      {screenPhase === "error" ? (
        <ScreenState phase="error" error={{ message: errorInfo?.message ?? "Unknown error" }} />
      ) : !enoughData.enough ? (
        <ScreenState phase="empty" empty={emptyBlock} />
      ) : (
        renderContent()
      )}
    </LedgerPage>
  );
}
