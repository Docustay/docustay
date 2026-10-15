// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › SUBSCRIPTIONS - LIST SCREEN
// Built to MoneySubs.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { useContext, useEffect, useState, useMemo } from "react";
import { request } from "@/lib/api.js";
import MoneySubsMoneySubsTable from "./MoneySubsMoneySubsTable.jsx";
import NewSubscriptionSheet from "@/lib/money/NewSubscriptionSheet.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function MoneySubs({ onNavigate = null }) {
  // the route passes only onNavigate; the shell state (rank, refetch signal) comes from context, as RowActions reads it
  const app = useContext(AppStateContext);
  const [showNewSub, setShowNewSub] = useState(false);
  const [phase, setPhase] = useState("loading");
  const [summary, setSummary] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState("running");
  const [programFilter, setProgramFilter] = useState("all");
  const [dunningConfig] = useState({ retries: 3, days: 10, pause_after: true });
  const [expiredCardPerson, setExpiredCardPerson] = useState(null);

  async function fetchData() {
    try {
      setPhase("loading");
      const res = await request("/api/money/subscriptions/summary");
      setSummary(res);
      setSubscriptions(res.rows || []);

      // Determine initial phase
      if ((res.rows || []).length === 0) {
        setPhase("empty");
      } else {
        setPhase("ready");
      }
    } catch (err) {
      console.error("Error fetching subscriptions:", err);
      if (err?.status === 403) {
        setPhase("denied");
      } else {
        setError(err);
        setPhase("error");
      }
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  function handleView(viewKey) {
    setActiveView(viewKey);
  }

  function handleNavigateToUpdateCard(personId) {
    // Forward dependency: 15.46 will provide the update-card sheet
    onNavigate?.(`/money/update-card/${personId}`);
  }

  // Format currency from minor units
  function formatMoney(minor) {
    if (minor === undefined || minor === null) return "$0.00";
    return `$${(minor / 100).toFixed(2)}`;
  }

  // Filter subscriptions by view
  const filteredSubs = useMemo(() => {
    return subscriptions.filter(sub => {
      if (activeView === "running") return sub.state === "active";
      if (activeView === "paused") return sub.state === "paused";
      if (activeView === "ended") return sub.state === "canceled" || sub.state === "ended";
      return true;
    }).filter((sub) => matchesProgram(programFilter, sub.programId));
  }, [subscriptions, activeView, programFilter]);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: "/money/subscriptions", rank: app?.nav?.rank ?? null, rows: filteredSubs, onChanged: fetchData, resetKey: activeView });

  const summaryText = useMemo(() => {
    if (!summary) return "";
    const running = summary.running || 0;
    const monthly = summary.monthlyMinor || 0;
    const expiring = summary.cardsExpiring || 0;
    const monthlyStr = formatMoney(monthly);

    let parts = [];
    if (running > 0) parts.push(`${running} running`);
    if (monthly > 0) parts.push(`${monthlyStr} a month`);
    if (expiring > 0) {
      parts.push(`One card expires next month`);
    }

    return parts.join(", ");
  }, [summary]);

  return (
    <>
    <MoneySubsMoneySubsTable
      onNavigate={onNavigate}
      onStartNew={() => setShowNewSub(true)}
      phase={phase}
      summary={summary}
      subscriptions={subscriptions}
      error={error}
      activeView={activeView}
      dunningConfig={dunningConfig}
      expiredCardPerson={expiredCardPerson}
      fetchData={fetchData}
      handleView={handleView}
      handleNavigateToUpdateCard={handleNavigateToUpdateCard}
      formatMoney={formatMoney}
      filteredSubs={filteredSubs}
      programFilter={programFilter}
      onProgramFilter={setProgramFilter}
      bulk={bulk}
      summaryText={summaryText}
    />
    {showNewSub && (
      <NewSubscriptionSheet
        onCancel={() => setShowNewSub(false)}
        onCreated={() => { setShowNewSub(false); fetchData(); }}
      />
    )}
    </>
  );
}
