// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StopSubscriptionModal — portal for stopping a subscription with cancel/pause options.
// Ported from webui/src/lib/money/StopSubscriptionModal.svelte: same props, testids, behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { request } from "@/lib/api.js";
import StopSubscriptionModalMoneyStopSubscriptionModal from "./StopSubscriptionModalMoneyStopSubscriptionModal.jsx";

export default function StopSubscriptionModal({
  open = false,
  onOpenChange = null,
  subscription = null,
  onConfirm = null,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMode, setSelectedMode] = useState("period_end");

  async function handleConfirm() {
    if (!subscription) return;

    try {
      setBusy(true);
      setError(null);

      if (selectedMode === "pause") {
        // Pause operation (separate endpoint, separate handler)
        const resumeOn = new Date();
        resumeOn.setDate(resumeOn.getDate() + 30);

        await request(
          `/api/money/subscriptions/${encodeURIComponent(subscription.id)}/pause`,
          {
            method: "POST",
            body: { resumeOn: resumeOn.toISOString().split("T")[0] },
          },
        );
      } else {
        // Cancel operation — NEW SEMANTICS: when='period_end'|'now', not mode
        await request(
          `/api/money/subscriptions/${encodeURIComponent(subscription.id)}/cancel`,
          {
            method: "POST",
            body: { when: selectedMode },
          },
        );
      }

      onConfirm?.(selectedMode);
      onOpenChange?.(false);
    } catch (err) {
      console.error("Error:", err);
      if (err.status === 503) {
        setError(
          "Refunds can't go out while charges are switched off.",
        );
      } else {
        setError(err.message || "Failed to process request");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    onOpenChange?.(false);
    setError(null);
  }

  const options = subscription
    ? [
        {
          key: "period_end",
          label: "At the end of what he's paid for",
          consequence: `Stops on ${formatDate(subscription.currentPeriodEnd)}. He keeps the ${subscription.sessionsIncluded} sessions he's already paid for this month, and nothing more is taken.`,
        },
        {
          key: "now",
          label: "Right now, and refund the rest",
          consequence: `He's used ${subscription.sessionsUsed} of ${subscription.sessionsIncluded} sessions this month, so ${formatMoney(subscription.refundAmount)} goes back to his card. Takes 5 to 10 days to land.`,
        },
        {
          key: "pause",
          label: "Pause it instead",
          consequence:
            "Up to three months. Nothing is charged, nothing is refunded, and it picks up where it left off.",
        },
      ]
    : [];

  const confirmButtonLabel = (() => {
    if (selectedMode === "period_end" && subscription?.currentPeriodEnd) {
      return `Stop on ${formatDate(subscription.currentPeriodEnd)}`;
    } else if (selectedMode === "now") {
      return "Stop right now";
    } else if (selectedMode === "pause") {
      return "Pause instead";
    }
    return "Confirm";
  })();

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
  }

  function formatMoney(minor) {
    if (minor === undefined || minor === null) return "$0.00";
    return `$${(minor / 100).toFixed(2)}`;
  }

  return (
    <StopSubscriptionModalMoneyStopSubscriptionModal
      open={open}
      onOpenChange={onOpenChange}
      subscription={subscription}
      onConfirm={onConfirm}
      busy={busy}
      error={error}
      selectedMode={selectedMode}
      handleConfirm={handleConfirm}
      handleCancel={handleCancel}
      options={options}
      confirmButtonLabel={confirmButtonLabel}
      formatDate={formatDate}
      formatMoney={formatMoney}
      onSelect={setSelectedMode}
    />
  );
}
