// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › INVOICES — INVOICES LIST SCREEN
// Built from webui/src/lib/screens/money/MoneyInvoices.svelte via MoneyInvoices.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import MoneyInvoicesInvoicesList from "./MoneyInvoicesInvoicesList.jsx";
import { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";

export default function MoneyInvoices({ onNavigate }) {
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading, ready, denied, error

  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState({
    outstandingMinor: 0,
    outstandingCount: 0,
    lateMinor: 0,
    lateCount: 0,
    lateNamed: null,
    avgDaysToPaid: null,
    termsDays: null,
    fiveOpens: [],
    mirrorAsOf: new Date(),
  });
  const [stripeConnected, setStripeConnected] = useState(false);

  // Filter state
  const [activeView, setActiveView] = useState("all");
  const [programFilter, setProgramFilter] = useState("all");
  const views = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "late", label: "Late" },
    { key: "paid", label: "Paid" },
  ];

  // Fetch data on mount
  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setPhase("loading");
      setError(null);

      // Fetch invoices list
      const invoicesRes = await request("/api/list/money/invoices");
      setInvoices(invoicesRes.rows || []);

      // Fetch summary
      const summaryRes = await request("/api/money/invoices/summary");
      setSummary(summaryRes);

      // Fetch Stripe connection status
      const stripeRes = await request("/api/settings/money/connect");
      // ★ the endpoint answers { state, stripeAccountId } — this read `stripe_enabled`, a field it has never returned, so the empty page told a practice with live Stripe to "Connect Stripe"
      setStripeConnected(stripeRes?.state === "live" || stripeRes?.state === "restricted");

      setPhase("ready");
    } catch (err) {
      if (err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  // Compute summary sentence
  function computeSummaryText() {
    if (!summary.outstandingCount) return "";

    const amt = formatMoney(summary.outstandingMinor);
    const across = `${summary.outstandingCount} invoice${summary.outstandingCount === 1 ? "" : "s"}`;
    let sentence = `$${amt} outstanding across ${across}.`;

    if (summary.lateCount > 0 && summary.lateNamed) {
      sentence += ` One is ${summary.lateNamed.days} days late.`;
    }

    return sentence;
  }

  // Format money
  function formatMoney(minor) {
    if (minor == null || minor === 0) return "0";
    return (minor / 100).toFixed(0);
  }

  function formatMoneyWithCents(minor) {
    if (minor == null || minor === 0) return "0.00";
    return (minor / 100).toFixed(2);
  }

  // Get status badge class
  function getStatusClass(status) {
    const map = {
      draft: "neutral",
      sent: "warn",
      late: "bad",
      paid: "ok",
      open: "warn",
    };
    return map[status] || "neutral";
  }

  // Get status text
  function getStatusText(row) {
    if (row.status === "paid") {
      return row.paid_at ? `Paid ${formatDate(row.paid_at)}` : "Paid";
    }
    if (row.status === "void") return "Void";
    if (row.status === "uncollectible") return "Uncollectible";
    if (row.days_late > 0) {
      return `${row.days_late} days late`;
    }
    return row.status === "draft" ? "Draft" : "Sent";
  }

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Handle navigation
  function handleNewInvoice() {
    onNavigate?.("/money/invoices?new=1");
  }

  function handleConnectStripe() {
    onNavigate?.("/money/connect");
  }

  function handleWriteToPayerMessage(invoiceId, payerName) {
    // Navigate to payer's messages
    if (invoiceId && summary.lateNamed?.invoiceId === invoiceId) {
      onNavigate?.(`/people/${summary.lateNamed.payer_user_id}/messages`);
    }
  }

  // Filter invoices by active view
  function getFilteredInvoices() {
    return invoices.filter((inv) =>
      (activeView === "all" || inv.status === activeView) && matchesProgram(programFilter, inv.program_ids));
  }

  const filteredInvoices = getFilteredInvoices();

  return (
    <div data-testid="money-invoices">
      <ScreenState phase={phase} error={error}>
        <div className="px-7.5 py-6.5">
          <MoneyInvoicesInvoicesList
            onNavigate={onNavigate}
            invoices={invoices}
            summary={summary}
            stripeConnected={stripeConnected}
            activeView={activeView}
            views={views}
            onView={(key) => setActiveView(key)}
            programFilter={programFilter}
            onProgramFilter={setProgramFilter}
            computeSummaryText={computeSummaryText}
            formatMoney={formatMoney}
            formatMoneyWithCents={formatMoneyWithCents}
            getStatusClass={getStatusClass}
            getStatusText={getStatusText}
            formatDate={formatDate}
            handleNewInvoice={handleNewInvoice}
            handleConnectStripe={handleConnectStripe}
            handleWriteToPayerMessage={handleWriteToPayerMessage}
            filteredInvoices={filteredInvoices}
          />
        </div>
      </ScreenState>
    </div>
  );
}
