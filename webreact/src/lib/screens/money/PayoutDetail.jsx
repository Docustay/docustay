// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 15 TASK 15.50 — MONEY › PAYOUT DETAIL + RECONCILE
// Built to StripePayoutDetail.frame.html and StripePayoutReconcile.frame.html
// Reconcile is a tab/view within this single file
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import WorklistPage from "@/lib/lists/WorklistPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PayoutDetailTable from "./PayoutDetailTable.jsx";

function formatMoney(amountMinor, currency = "USD") {
  if (amountMinor == null) return "—";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amountMinor / 100);
}

export default function PayoutDetail({ payoutId, onNavigate = null }) {
  const [payout, setPayout] = useState(null);
  const [reconcileRows, setReconcileRows] = useState([]);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [activeView, setActiveView] = useState("detail");

  async function fetchData() {
    try {
      setPhase("loading");
      setError(null);

      // Fetch payout detail
      const detailRes = await request(`/api/money/payouts/${payoutId}`);
      setPayout(detailRes);

      // Fetch reconciliation rows if detail has payments
      if (detailRes?.payments?.length > 0) {
        const reconcileRes = await request(`/api/money/payouts/${payoutId}/reconcile`);
        setReconcileRows(reconcileRes || []);
      }

      setPhase("ready");
    } catch (err) {
      console.error("Error fetching payout detail:", err);
      if (err.status === 403) {
        setPhase("denied");
      } else if (err.status === 404) {
        setPhase("notfound");
      } else {
        setPhase("error");
      }
      setError(err);
    }
  }

  useEffect(() => {
    if (payoutId) {
      fetchData();
    }
  }, [payoutId]);

  function downloadCSV() {
    if (!reconcileRows || reconcileRows.length === 0) {
      alert("No data to export");
      return;
    }

    const headers = [
      "Payment ID",
      "Gross Amount",
      "Stripe Fee",
      "Refunded",
      "Net Amount",
    ];

    const rows = reconcileRows.map((row) => [
      row.paymentId,
      formatMoney(row.grossMinor),
      formatMoney(row.stripeFeeMinor),
      formatMoney(row.refundedMinor),
      formatMoney(row.netMinor),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-${payoutId}-reconciliation.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const views = [
    { key: "detail", label: "Detail" },
    { key: "reconcile", label: "Reconcile" },
  ];

  return (
    <div data-testid="money-payout-record">
      {phase === "loading" && <ScreenState phase="loading" />}
      {phase === "denied" && (
        <ScreenState
          phase="denied"
          reason="You don't have permission to view this payout."
        />
      )}
      {phase === "notfound" && (
        <ScreenState
          phase="error"
          error={{ message: "This payout doesn't exist or has been deleted." }}
        />
      )}
      {phase === "error" && <ScreenState phase="error" error={error} />}
      {phase === "ready" && payout && (
        <WorklistPage
          title={formatMoney(payout.reconciliation.payoutMinor)}
          summary={payout.statement}
          views={views}
          activeView={activeView}
          onView={(view) => setActiveView(view)}
        >
          <PayoutDetailTable
            payout={payout}
            reconcileRows={reconcileRows}
            activeView={activeView}
            downloadCSV={downloadCSV}
            views={views}
          />
        </WorklistPage>
      )}
    </div>
  );
}
