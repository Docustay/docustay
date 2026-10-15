// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneySubRecord — rebuild from MoneySubRecord.frame.html
// Ported from webui/src/lib/screens/money/MoneySubRecord.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import CreditBalance from "@/lib/money/CreditBalance.jsx";

export default function MoneySubRecord({ subscriptionId, onNavigate = null }) {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [dunningConfig] = useState({ retries: 3, days: 10, pause_after: true });
  const [creditInfo, setCreditInfo] = useState({
    sessionsIncluded: 0,
    sessionsUsed: 0,
    serviceDescription: "",
  });

  async function fetchData() {
    try {
      setPhase("loading");
      setError(null);
      const res = await request(`/api/money/subscriptions/${encodeURIComponent(subscriptionId)}`);
      setSubscription(res);
      setCreditInfo({
        sessionsIncluded: res.sessionsIncluded || 0,
        sessionsUsed: res.sessionsUsed || 0,
        serviceDescription: res.serviceDescription || "",
      });
      setPhase("ready");
    } catch (err) {
      console.error("Error fetching subscription:", err);
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else if (err instanceof ApiError && err.status === 404) {
        setPhase("not-built");
      } else {
        setError(err);
        setPhase("error");
      }
    }
  }

  useEffect(() => {
    if (subscriptionId) {
      fetchData();
    }
  }, [subscriptionId]);

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  async function handlePause() {
    if (!subscription) return;
    try {
      await request(`/api/money/subscriptions/${subscriptionId}/pause`, { method: "POST" });
      setSubscription({ ...subscription, state: "paused" });
    } catch (err) {
      console.error("Error pausing subscription:", err);
    }
  }

  async function handleStop() {
    if (!subscription) return;
    try {
      await request(`/api/money/subscriptions/${subscriptionId}/cancel`, { method: "POST" });
      setSubscription({ ...subscription, state: "canceled" });
    } catch (err) {
      console.error("Error stopping subscription:", err);
    }
  }

  async function handleCreateInStripe() {
    if (!subscription) return;
    try {
      await request(`/api/money/subscriptions/stripe`, { method: "POST", body: { subscriptionId } });
      setSubscription({ ...subscription, stripeSubscriptionId: "sub_..." });
    } catch (err) {
      console.error("Error creating in Stripe:", err);
    }
  }

  function getHeaderSubtitle() {
    if (!subscription) return "";
    const amount = (subscription.amountMinor / 100).toFixed(2);
    const since = formatDate(subscription.createdAt);
    const nextPayment = formatDate(subscription.currentPeriodEnd);
    return `$${amount} a month since ${since} · next payment ${nextPayment}`;
  }

  function getInitials() {
    if (!subscription?.payerInitials) return "?";
    return subscription.payerInitials;
  }

  const isInSync = subscription?.stripeSubscriptionId ? true : false;

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="You do not have access to subscriptions"
        subject="Subscription"
      />
    );
  }

  if (phase === "error") {
    return <ScreenState phase="error" error={error} subject="Subscription" onRetry={fetchData} />;
  }

  if (!subscription) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="money-sub-record">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b border-line pb-6">
        <div className="flex gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-avatar-bg text-heading font-medium text-avatar-ink">
            {getInitials()}
          </div>
          <div className="flex-1">
            <h1 className="m-0 text-page-title font-medium text-ink">
              {subscription.payer} — {subscription.planName}
            </h1>
            <div className="mt-1.5 text-sm text-mute">{getHeaderSubtitle()}</div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handlePause}>
            Pause
          </Button>
          <Button variant="outline" size="sm" onClick={handleStop}>
            Stop it
          </Button>
          <Button variant="default" size="sm" onClick={() => onNavigate?.(`/money/subscriptions/${subscriptionId}/edit`)}>
            Edit
          </Button>
        </div>
      </div>

      {/* Card expiring prompt */}
      {subscription.cardExpiringSoon && (
        <div className="flex gap-3.5 rounded-lg border border-line bg-surface p-4">
          <div className="flex size-7 shrink-0 items-center justify-center rounded bg-warn-soft text-warn text-sm font-medium">
            $
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-ink">His card expires in October</div>
            <div className="mt-1 text-xs text-mute leading-relaxed">
              <b>Why:</b> October's payment goes through. November's fails. Asking now is easier than chasing a failure.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => onNavigate?.(`/money/update-card/${subscription.payerId}`)}>
              Ask him to update it
            </Button>
            <button
              type="button"
              className="flex size-5 items-center justify-center text-mute hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Two-column content area */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main content */}
        <div className="flex flex-col gap-6">
          {/* What's happened */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-sm font-medium text-ink">What's happened</b>
            </div>
            <div className="px-4 py-3">
              {subscription.timeline && subscription.timeline.length > 0 ? (
                <div className="flex flex-col">
                  {subscription.timeline.map((event, idx) => (
                    <div
                      key={event.id || idx}
                      className="flex gap-3 border-b border-hair py-3 text-sm last:border-b-0"
                    >
                      <div className="w-16 flex-shrink-0 text-mute text-xs font-variant-numeric">
                        {formatDate(event.timestamp)}
                      </div>
                      <div className="flex-1">
                        <div className="text-ink">{event.label}</div>
                        {event.detail && <div className="mt-0.5 text-xs text-mute">{event.detail}</div>}
                      </div>
                      {event.tag && (
                        <StatusBadge
                          label={event.tag}
                          tone={event.tagVariant === "bad" ? "bad" : event.tagVariant === "warn" ? "warn" : "ok"}
                          testId={`timeline-badge-${idx}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-mute">No timeline events</div>
              )}
            </div>
          </div>

          {/* What he gets */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-sm font-medium text-ink">What he gets</b>
            </div>
            <div className="px-4 py-3">
              <CreditBalance
                sessionsIncluded={creditInfo.sessionsIncluded}
                sessionsUsed={creditInfo.sessionsUsed}
                serviceDescription={creditInfo.serviceDescription}
                showDisclaimer={true}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* If a payment fails */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-sm font-medium text-ink">If a payment fails</b>
            </div>
            <div className="px-4 py-3">
              <div className="flex flex-col gap-0">
                {[
                  { label: `Tried ${dunningConfig.retries} times`, sub: `Over ${dunningConfig.days} days` },
                  { label: "He's told each time", sub: "With a link to fix the card" },
                  { label: "You're told on the first", sub: "Not the third" },
                  { label: "Then it pauses", sub: "Rather than piling up debt" },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="border-b border-hair py-2.75 last:border-b-0"
                  >
                    <div className="text-sm font-medium text-ink">{item.label}</div>
                    <div className="mt-0.75 text-xs text-mute">{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* In Stripe */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-sm font-medium text-ink">In Stripe</b>
            </div>
            <div className="px-4 py-3">
              {isInSync ? (
                <div className="flex items-center justify-between gap-2 py-2.75">
                  <div className="text-sm text-ink font-variant-numeric">{subscription.stripeSubscriptionId}</div>
                  <StatusBadge label="In sync" tone="ok" testId="stripe-status-badge" />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-mute">Not in Stripe yet - charges are switched off</div>
                  {(subscription.role === "owner" || subscription.role === "admin") && (
                    <Button size="sm" variant="default" onClick={handleCreateInStripe}>
                      Create it in Stripe
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
