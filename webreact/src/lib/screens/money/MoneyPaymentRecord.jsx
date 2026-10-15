// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyPaymentRecord — rebuild from StripePaymentDetail.frame.html
// Ported from webui/src/lib/screens/money/MoneyPaymentRecord.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { formatMoney } from "./formatMoney.js";

export default function MoneyPaymentRecord({ id, onNavigate = null }) {
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [refundError, setRefundError] = useState(null);
  const [refunding, setRefunding] = useState(false);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const data = await request(`/api/money/payments/${id}`);
      setPayment(data);
      setPhase("ready");
    } catch (err) {
      console.error("Error loading payment:", err);
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err);
    }
  }

  async function handleRefund() {
    if (!payment) return;

    setRefunding(true);
    setRefundError(null);

    try {
      await request(`/api/money/refund`, {
        method: "POST",
        body: {
          paymentId: payment.id,
          amount: payment.chargedMinor,
          reason: "requested_by_customer",
        },
      });
      // Reload the payment to show refunded state
      await load();
    } catch (err) {
      console.error("Error requesting refund:", err);
      setRefundError(err.message || "Failed to request refund");
    } finally {
      setRefunding(false);
    }
  }

  function handleReceipt() {
    // TODO: Download or view receipt
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  // ★ the maintainer, 1 Oct 2026 — card audit: this screen showed the raw `method` string ("card_on_file")
  //   but never the actual card — src/money/reads.mjs::paymentDetail already selects
  //   cardBrand/cardLastFour (fixed in an earlier pass, previously unused by any screen).
  function cardLine() {
    if (!payment.cardBrand || !payment.cardLastFour) return null;
    const brand = payment.cardBrand[0].toUpperCase() + payment.cardBrand.slice(1);
    return `${brand} •••• ${payment.cardLastFour}`;
  }

  function getStatusBadgeTone() {
    if (!payment || !payment.status) return "neutral";
    switch (payment.status) {
      case "succeeded": return "ok";
      case "clearing": return "act";
      case "failed": return "bad";
      case "refunded": return "neutral";
      default: return "neutral";
    }
  }

  function getStatusLabel() {
    if (!payment || !payment.status) return "—";
    switch (payment.status) {
      case "succeeded": return "Settled";
      case "clearing": return "Clearing";
      case "failed": return "Failed";
      case "refunded": return "Refunded";
      default: return payment.status;
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateLong(dateStr) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="You don't have permission to view this payment."
      />
    );
  }

  if (phase === "error") {
    return <ScreenState phase="error" error={error} />;
  }

  if (!payment) {
    return null;
  }

  return (
    <div className="flex flex-col" data-testid="money-payment-record">
      {/* Header with amount, metadata, status, and actions */}
      <div className="flex items-start justify-between gap-6 border-b border-line bg-surface px-6 py-6">
        <div className="flex-1">
          <h1 className="m-0 font-serif text-[54px] font-normal leading-tight tracking-tight text-ink">
            {formatMoney(payment.chargedMinor)}
          </h1>
          <p className="m-0 mt-1.5 text-sm text-mute">
            {payment.payerName ?? payment.payerId ?? "—"} · {formatDate(payment.createdAt)} · {payment.method ?? "—"}
            {cardLine() ? ` · ${cardLine()}` : ""}
          </p>
        </div>
        <StatusBadge
          label={getStatusLabel()}
          tone={getStatusBadgeTone()}
          testId="payment-status-badge"
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReceipt}>
            Receipt
          </Button>
          {payment.status === "succeeded" && (
            <Button
              variant="outline"
              onClick={handleRefund}
              disabled={refunding}
            >
              {refunding ? "Requesting..." : "Refund"}
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {refundError && (
        <div className="mx-6 mt-4 rounded-md border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad">
          <p>{refundError}</p>
        </div>
      )}

      {/* Refund notice */}
      {payment.refundCostSentence && payment.status === "refunded" && (
        <div className="mx-6 mt-4 rounded-md border border-warn-border bg-warn-soft px-4 py-3 text-sm text-warn">
          <p>{payment.refundCostSentence}</p>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex gap-6 px-6 py-6">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          {/* Where it came from and where it went */}
          <div className="mb-5 rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-base font-medium text-ink">Where it came from and where it went</b>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 border-b border-hair py-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-ink">Charged</span>
                  <span className="text-xs text-mute">
                    {payment.method ?? "—"}{cardLine() ? ` — ${cardLine()}` : ""}
                  </span>
                </div>
                <span className="[font-variant-numeric:tabular-nums] text-ink">{formatMoney(payment.chargedMinor)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-hair py-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-ink">Stripe's fee</span>
                  <span className="text-xs text-mute">Rate depends on method</span>
                </div>
                <span className="[font-variant-numeric:tabular-nums] text-ink">−{formatMoney(payment.stripeFeeMinor)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-hair py-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-ink">Workbench</span>
                  <span className="text-xs text-mute">{payment.workbenchFeeMinor > 0 ? "Platform fee" : "No platform fee on this payment"}</span>
                </div>
                <span className="[font-variant-numeric:tabular-nums] text-ink">−{formatMoney(payment.workbenchFeeMinor)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-hair py-3 text-sm font-medium">
                <div className="flex flex-col gap-1">
                  <span className="text-ink">Landing in your bank</span>
                  <span className="text-xs font-normal text-mute">
                    {formatDateLong(payment.landingOn)}
                  </span>
                </div>
                <span className="[font-variant-numeric:tabular-nums] text-ink">{formatMoney(payment.netMinor)}</span>
              </div>
            </div>
          </div>

          {/* What it was for */}
          {payment.forWhat && payment.forWhat.length > 0 && (
            <div className="mb-5 rounded-lg border border-line bg-surface">
              <div className="border-b border-hair px-4 py-3.5">
                <b className="text-base font-medium text-ink">What it was for</b>
              </div>
              <div className="px-4 py-3">
                {payment.forWhat.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 border-b border-hair py-3 text-sm last:border-b-0"
                  >
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="font-medium text-ink">{item.label ?? "—"}</span>
                      <span className="text-xs text-mute">{item.description ?? ""}</span>
                    </div>
                    {item.link && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onNavigate?.(item.link)}
                      >
                        Open
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Checks that ran */}
          {payment.checks && payment.checks.length > 0 && (
            <div className="mb-5 rounded-lg border border-line bg-surface">
              <div className="border-b border-hair px-4 py-3.5">
                <b className="text-base font-medium text-ink">Checks that ran</b>
              </div>
              <div className="px-4 py-3">
                {payment.checks.map((check, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 border-b border-hair py-3 text-sm last:border-b-0"
                  >
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="font-medium text-ink">{check.name ?? "—"}</span>
                      <span className="text-xs text-mute">{check.description ?? ""}</span>
                    </div>
                    <StatusBadge
                      label={check.status === "passed" ? "Passed" : "Failed"}
                      tone={check.status === "passed" ? "ok" : "bad"}
                      testId={`check-${idx}-status`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="w-80 flex-0">
          {/* If this is ever disputed */}
          <div className="mb-5 rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-base font-medium text-ink">If this is ever disputed</b>
            </div>
            <div className="px-4 py-3">
              <div className="flex flex-col gap-1 border-b border-hair py-3 last:border-b-0">
                <span className="font-medium text-ink text-sm">This payment is protected</span>
                <span className="text-xs text-mute leading-relaxed">
                  {payment.method === "in_person"
                    ? "The chip proves the card was physically present. Disputes on in-person payments rarely succeed."
                    : payment.method === "card_on_file"
                    ? "Card verified on file. Most disputes fail on pre-authorized charges."
                    : "The session and agreement on file protect this charge."}
                </span>
              </div>
              <div className="flex flex-col gap-1 py-3">
                <span className="font-medium text-ink text-sm">We keep the evidence</span>
                <span className="text-xs text-mute leading-relaxed">Session attended, agreement signed, receipt sent.</span>
              </div>
            </div>
          </div>

          {/* The same payment elsewhere */}
          {payment.elsewhere && payment.elsewhere.length > 0 && (
            <div className="rounded-lg border border-line bg-surface">
              <div className="border-b border-hair px-4 py-3.5">
                <b className="text-base font-medium text-ink">The same payment elsewhere</b>
              </div>
              <div className="px-4 py-3">
                {payment.elsewhere.map((alt, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-1 border-b border-hair py-3 text-sm last:border-b-0"
                  >
                    <span className="font-medium text-ink">{alt.how ?? "—"}</span>
                    <span className="text-xs text-mute">{alt.feeMinor != null ? `Fee ${formatMoney(alt.feeMinor)}` : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
