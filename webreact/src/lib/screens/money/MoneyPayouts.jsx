// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyPayouts — Payouts list screen. Ported from
// webui/src/lib/screens/money/MoneyPayouts.svelte:1-161. Same props, testids, copy, and behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import MoneyPayoutsPayoutsTable from "./MoneyPayoutsPayoutsTable.jsx";
import { formatMoney } from "./formatMoney.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function MoneyPayouts({ onNavigate = null }) {
  // the route passes only onNavigate; the shell state (rank, refetch signal) comes from context, as RowActions reads it
  const app = useContext(AppStateContext);
  const [payouts, setPayouts] = useState([]);
  const [stats, setStats] = useState({
    landedMinor: 0,
    count: 0,
    failedCount: 0,
  });
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");

  async function fetchData() {
    try {
      setPhase("loading");
      setError(null);
      // ★ The route answers `{ payouts: { landedMinor, count, failedCount, rows } }` — this screen read
      //   `res.rows` and so showed "No payouts yet." for every practice since the 28 Sep rework
      //   (found in the 2 Oct 2026 browser check, with two real payouts in Stripe).
      const raw = await request("/api/money/payouts");
      const res = raw?.payouts ?? raw;
      const rows = res?.rows || [];
      setStats(res);
      setPayouts(rows);
      setPhase(rows.length === 0 ? "empty" : "ready");
    } catch (err) {
      console.error("Error fetching payouts:", err);
      if (err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: "/money/payouts", rank: app?.nav?.rank ?? null, rows: payouts, onChanged: fetchData });

  function handleSeeInside(payoutId) {
    onNavigate?.(`/money/payouts/${payoutId}`);
  }

  const summaryText = `${formatMoney(stats.landedMinor)} has reached your bank over six months. Nothing has ever failed.`;

  return (
    <div data-testid="money-payouts">
      {phase === "loading" && <ScreenState phase="loading" />}
      {phase === "denied" && (
        <ScreenState
          phase="denied"
          reason="You don't have permission to view payout details."
        />
      )}
      {phase === "error" && <ScreenState phase="error" error={error} />}
      {phase === "empty" && <ScreenState phase="empty" empty="No payouts yet." />}
      {phase === "ready" && (
        <MoneyPayoutsPayoutsTable
          payouts={payouts}
          bulk={bulk}
          handleSeeInside={handleSeeInside}
          summaryText={summaryText}
        />
      )}
    </div>
  );
}
