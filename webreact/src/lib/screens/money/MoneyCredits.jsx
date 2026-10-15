// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › CREDITS — CREDITS LIST SCREEN
// R6.039 — Built from webui/src/lib/screens/money/MoneyCredits.svelte and MoneyCredits.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import MoneyCreditsCreditsTable from "./MoneyCreditsCreditsTable.jsx";

export default function MoneyCredits({ onNavigate }) {
  const [phase, setPhase] = useState("loading");
  const [summary, setSummary] = useState({
    owedCount: 0,
    people: 0,
    worthMinor: 0,
    expiringSoon: [],
    mirrorAsOf: new Date(),
  });
  const [credits, setCredits] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setPhase("loading");
        setError(null);
        const res = await request("/api/money/credits");

        if (res.summary) {
          setSummary(res.summary);
        }
        const creditsData = (res.rows || []).map(row => ({
          ...row,
          expiresAtFormatted: row.expiresAt
            ? new Date(row.expiresAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "—",
        }));

        setCredits(creditsData);
        setPhase(creditsData.length === 0 ? "empty" : "ready");
      } catch (err) {
        console.error("Error fetching credits:", err);
        if (err.status === 403) {
          setPhase("denied");
        } else {
          setPhase("error");
          setError(err);
        }
      }
    }

    fetchData();
  }, []);

  function formatMoney(minor) {
    if (minor === undefined || minor === null) return "$0.00";
    return `$${(minor / 100).toFixed(2)}`;
  }

  const summaryText = `${summary.owedCount} sessions, ${formatMoney(summary.worthMinor)}. That's work you owe.`;
  const expiringCount = summary.expiringSoon?.length || 0;
  const expiringWorthMinor = summary.expiringSoon?.reduce((sum, item) => sum + (item.worthMinor || 0), 0) || 0;

  const columns = [
    { key: "person", label: "Who" },
    { key: "description", label: "What they bought" },
    { key: "used", label: "Used", format: "number" },
    { key: "left", label: "Left", format: "number" },
    { key: "expiresAtFormatted", label: "Expires" },
    { key: "worthMinor", label: "Worth", format: "money" },
  ];

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="You don't have permission to view credit details."
      />
    );
  }

  if (phase === "error") {
    return <ScreenState phase="error" error={error} />;
  }

  if (phase === "empty") {
    return <ScreenState phase="empty" empty="No session credits owed right now." />;
  }

  return (
    <div data-testid="money-credits">
      {/* Summary trio */}
      <div className="mb-5 flex overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="mb-1 text-4xl font-normal tracking-tight">
            {summary.owedCount}
          </div>
          <div className="mb-1.5 text-sm text-mute">sessions owed</div>
          <div className="text-xs text-ink-2 leading-relaxed">
            Across {summary.people} {summary.people === 1 ? "person" : "people"}
          </div>
        </div>
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="mb-1 text-4xl font-normal tracking-tight">
            {formatMoney(summary.worthMinor)}
          </div>
          <div className="mb-1.5 text-sm text-mute">what they're worth</div>
          <div className="text-xs text-ink-2 leading-relaxed">
            At the price each was sold at
          </div>
        </div>
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="mb-1 text-4xl font-normal tracking-tight">
            {expiringCount}
          </div>
          <div className="mb-1.5 text-sm text-mute">expiring within a month</div>
          <div className={`text-xs leading-relaxed ${expiringCount > 0 ? "text-warn" : "text-ink-2"}`}>
            {expiringCount > 0
              ? `Worth telling ${expiringCount > 1 ? "those" : "this"} ${expiringCount === 1 ? "person" : "people"}`
              : "No expiring credits"}
          </div>
        </div>
      </div>

      {/* Credits table and Worth doing section */}
      {credits.length > 0 && (
        <MoneyCreditsCreditsTable
          onNavigate={onNavigate}
          summary={summary}
          credits={credits}
          formatMoney={formatMoney}
          summaryText={summaryText}
          expiringCount={expiringCount}
          expiringWorthMinor={expiringWorthMinor}
          columns={columns}
        />
      )}
    </div>
  );
}
