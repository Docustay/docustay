// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › DISPUTES — DISPUTES LIST SCREEN
// Built from webui/src/lib/screens/money/MoneyDisputes.svelte via MoneyDisputes.frame.html
// and StripeDisputes.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import MoneyDisputesDisputesTable from "./MoneyDisputesDisputesTable.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function MoneyDisputes({ onNavigate }) {
  // the route passes only onNavigate; the shell state (rank, refetch signal) comes from context, as RowActions reads it
  const app = useContext(AppStateContext);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState({
    open: 0,
    answerBy: 0,
    wonThisYear: 0,
    lostThisYear: 0,
    rows: [],
  });
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    async function fetchData() {
      try {
        setPhase("loading");
        setError(null);
        const raw = await request("/api/money/disputes");
        const res = raw?.disputes ?? raw; // the route nests the list under `disputes`; this screen read it flat
        setData(res);
        setPhase(res.rows && res.rows.length === 0 ? "empty" : "ready");
      } catch (err) {
        console.error("Error fetching disputes:", err);
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
        } else if (err instanceof ApiError && err.status === 404) {
          setPhase("empty");
        } else {
          setPhase("error");
        }
        setError(err);
      }
    }

    fetchData();
  }, [reload]);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: "/money/disputes", rank: app?.nav?.rank ?? null, rows: data.rows ?? [], onChanged: () => setReload((n) => n + 1) });

  function handleDispute(disputeId) {
    onNavigate?.(`/money/disputes/${disputeId}`);
  }

  // Format summary line based on counts
  const summaryText = (() => {
    const open = data.open > 0 ? `One open, ${data.answerBy} days to answer.` : "No open disputes.";
    const won = `${data.wonThisYear} won this year, `;
    const lost = `${data.lostThisYear} lost.`;
    return `${open} ${won}${lost}`;
  })();

  // Get state badge class
  function getStateClass(state) {
    if (state === "won") return "ok";
    if (state === "lost") return "bad";
    return "bad"; // warning for open disputes
  }

  // Get state label
  function getStateLabel(state, evidenceDueBy) {
    if (state === "won") return "Won";
    if (state === "lost") return "Lost";
    if (evidenceDueBy) {
      const daysLeft = Math.ceil(
        (new Date(evidenceDueBy) - new Date()) / (1000 * 60 * 60 * 24)
      );
      if (daysLeft > 0) return `${daysLeft} days left`;
      return "Time's up";
    }
    return "Open";
  }

  return (
    <div className="flex min-h-full flex-col" data-testid="money-disputes">
      {phase === "loading" && <ScreenState phase="loading" />}
      {phase === "denied" && (
        <ScreenState
          phase="denied"
          reason="You don't have permission to view disputes."
        />
      )}
      {phase === "error" && <ScreenState phase="error" error={error} />}
      {phase === "empty" && <ScreenState phase="empty" empty="No disputes yet — nothing to answer." />}
      {phase === "ready" && (
        <MoneyDisputesDisputesTable
          data={data}
          bulk={bulk}
          handleDispute={handleDispute}
          summaryText={summaryText}
          getStateClass={getStateClass}
          getStateLabel={getStateLabel}
        />
      )}
    </div>
  );
}
