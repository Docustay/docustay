// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DisputeDetail — rebuild from StripeDisputeDetail.frame.html on the portal archetype.
// Ported from webui/src/lib/screens/money/DisputeDetail.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisputeDetailAcceptTheDisputeModal from "./DisputeDetailAcceptTheDisputeModal.jsx";

export default function DisputeDetail({ id, onNavigate = null }) {
  const [dispute, setDispute] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [busySending, setBusySending] = useState(false);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const data = await request(`/api/money/disputes/${id}`);
      setDispute(data);
      // Determine if dispute is still actionable
      if (data.state === "won" || data.state === "lost") {
        setPhase("closed");
      } else if (data.evidenceDueBy && new Date(data.evidenceDueBy) <= new Date()) {
        setPhase("past-deadline");
      } else {
        setPhase("ready");
      }
    } catch (err) {
      console.error("Error loading dispute:", err);
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err);
    }
  }

  async function handleSendEvidence() {
    if (!dispute) return;

    setBusySending(true);
    try {
      await request(`/api/money/disputes/evidence`, {
        method: "POST",
        body: {
          disputeId: dispute.id,
        },
      });
      // Reload to show updated state
      await load();
    } catch (err) {
      console.error("Error sending evidence:", err);
      setError(err.message || "Failed to send evidence");
    } finally {
      setBusySending(false);
    }
  }

  async function handleAccept() {
    if (!dispute) return;

    setBusySending(true);
    try {
      await request(`/api/money/disputes/accept`, {
        method: "POST",
        body: {
          disputeId: dispute.id,
        },
      });
      setShowAcceptModal(false);
      // Reload to show updated state
      await load();
    } catch (err) {
      console.error("Error accepting dispute:", err);
      setError(err.message || "Failed to accept dispute");
    } finally {
      setBusySending(false);
    }
  }

  function getStrengthTone(strength) {
    if (strength === "Strong") return "ok";
    if (strength === "Supporting") return "neutral";
    if (strength === "Goes against you") return "bad";
    return "neutral";
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateAndTime(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " at " +
      new Date(dateStr).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  function calculateDaysLeft() {
    if (!dispute?.evidenceDueBy) return null;
    const daysLeft = Math.ceil((new Date(dispute.evidenceDueBy) - new Date()) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysLeft);
  }

  const daysLeft = dispute ? calculateDaysLeft() : null;

  useEffect(() => {
    if (id) load();
  }, [id]);

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="You don't have permission to view this dispute."
      />
    );
  }

  if (phase === "error") {
    return (
      <ScreenState
        phase="error"
        error={error}
      />
    );
  }

  if (!dispute) {
    return null;
  }

  return (
    <div className="flex flex-col" data-testid="money-dispute-detail">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-line bg-surface px-6 py-6">
        <div className="flex-1">
          <h1 className="m-0 font-serif text-[24px] font-medium leading-tight tracking-tight text-ink">
            ${(dispute.amountMinor / 100).toFixed(2)} disputed
          </h1>
          <p className="m-0 mt-1.5 text-sm text-mute">
            {dispute.payerDisplayName || "Unknown"} · "{dispute.reason || "—"}" · opened {formatDate(dispute.createdAt)}
          </p>
        </div>
        {phase !== "closed" && (
          <div className={`inline-flex h-[26px] items-center rounded-md px-[11px] text-sm font-medium ${
            daysLeft && daysLeft <= 3
              ? "bg-bad-soft text-bad"
              : "bg-chip-neutral-bg text-chip-neutral-ink"
          }`}>
            Answer by {formatDate(dispute.evidenceDueBy)}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad">
          <p>{error}</p>
        </div>
      )}

      {/* Warning banner (only when still actionable) */}
      {(phase === "ready" || phase === "past-deadline") && (
        <div className={`mx-6 mt-4 rounded-md border px-4 py-4 text-sm leading-relaxed ${
          phase === "past-deadline"
            ? "border-bad-border bg-bad-soft text-bad"
            : "border-warm-border bg-warn-soft text-warn"
        }`}>
          <b>{daysLeft} days left.</b> If nothing is sent, you lose automatically — the ${(dispute.amountMinor / 100).toFixed(2)} goes back to {dispute.payerDisplayName || "them"} and the $15 fee stays with you. Sending evidence costs nothing extra.
        </div>
      )}

      {/* Main content area */}
      <div className="flex gap-6 px-6 py-6">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          {/* Evidence section */}
          <div className="mb-4 rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-base font-medium text-ink">What we would send, ready to go</b>
            </div>
            <div className="px-4 py-3.5">
              {dispute.evidence && dispute.evidence.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {dispute.evidence.map((item) => (
                    <div key={item.kind} className="flex items-start gap-3 border-b border-hair py-3 last:border-b-0">
                      <div className="flex-1">
                        <div className="text-sm leading-relaxed">{item.sentence}</div>
                      </div>
                      <StatusBadge
                        label={item.strength}
                        tone={
                          item.strength === "Strong"
                            ? "ok"
                            : item.strength === "Supporting"
                            ? "neutral"
                            : "bad"
                        }
                        testId={`dispute-evidence-${item.kind}-strength`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-5 text-center text-sm text-mute">No evidence available</div>
              )}
            </div>
          </div>

          {/* Timeline section */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-base font-medium text-ink">What actually happened, so you can check</b>
            </div>
            <div className="px-4 py-3.5">
              <div className="flex flex-col gap-0">
                <div className="flex gap-3 border-b border-hair py-3 text-sm last:border-b-0">
                  <div className="w-[74px] flex-0 text-xs text-mute">{formatDate(dispute.createdAt)}</div>
                  <div className="flex-1">
                    <div className="leading-relaxed">Dispute opened</div>
                    <div className="mt-0.5 text-xs text-mute">Amount: ${(dispute.amountMinor / 100).toFixed(2)}</div>
                  </div>
                </div>
                {dispute.evidenceSubmittedAt && (
                  <div className="flex gap-3 border-b border-hair py-3 text-sm last:border-b-0">
                    <div className="w-[74px] flex-0 text-xs text-mute">{formatDate(dispute.evidenceSubmittedAt)}</div>
                    <div className="flex-1">Evidence submitted</div>
                  </div>
                )}
                {(dispute.state === "won" || dispute.state === "lost") && (
                  <div className="flex gap-3 border-b border-hair py-3 text-sm last:border-b-0">
                    <div className="w-[74px] flex-0 text-xs text-mute">Resolved</div>
                    <div className="flex-1">You {dispute.state === "won" ? "won" : "lost"} this dispute</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="w-80 flex-0">
          {/* How this goes */}
          <div className="mb-4 rounded-lg border border-line bg-surface">
            <div className="border-b border-hair px-4 py-3.5">
              <b className="text-base font-medium text-ink">How this goes</b>
            </div>
            <div className="px-4 py-3.5">
              <div className="flex flex-col gap-0">
                <div className="border-b border-hair py-3 text-sm last:border-b-0">
                  <div className="font-medium text-ink">Her bank decides</div>
                  <div className="mt-1 text-xs text-mute leading-normal">Not Stripe, not us. Up to 75 days.</div>
                </div>
                <div className="border-b border-hair py-3 text-sm last:border-b-0">
                  <div className="font-medium text-ink">The $15 fee stays either way</div>
                  <div className="mt-1 text-xs text-mute leading-normal">Win or lose</div>
                </div>
                <div className="border-b border-hair py-3 text-sm last:border-b-0">
                  <div className="font-medium text-ink">You have won both of these before</div>
                  <div className="mt-1 text-xs text-mute leading-normal">Same evidence, same claim</div>
                </div>
              </div>
            </div>
          </div>

          {/* Settlement options (only when actionable) */}
          {(phase === "ready" || phase === "past-deadline") && (
            <div className="rounded-lg border border-line bg-surface">
              <div className="border-b border-hair px-4 py-3.5">
                <b className="text-base font-medium text-ink">Or settle it</b>
              </div>
              <div className="px-4 py-3.5">
                <div className="flex flex-col gap-3">
                  {dispute.refundUnusedMinor && dispute.refundUnusedMinor > 0 && (
                    <div className="flex items-start justify-between gap-3 border-b border-hair pb-3">
                      <div>
                        <div className="font-medium text-ink">Refund the unused sessions</div>
                        <div className="mt-0.5 text-xs text-mute leading-normal">
                          ${(dispute.refundUnusedMinor / 100).toFixed(2)}. She may drop the dispute. You keep the sessions she attended.
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRefundDialog(true)}
                      >
                        Offer it
                      </Button>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-ink">Accept the whole thing</div>
                      <div className="mt-0.5 text-xs text-mute leading-normal">
                        Ends it now. You lose ${(dispute.amountMinor / 100).toFixed(2)}.
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAcceptModal(true)}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fee information */}
      {dispute.fee_minor !== null && dispute.fee_minor !== undefined && (
        <div className="px-6 py-5 text-sm text-ink2">
          <p className="m-0"><b>Either way it costs $15.</b></p>
        </div>
      )}

      {/* Action buttons */}
      {phase === "ready" && (
        <div className="flex gap-3 border-t border-line bg-surface px-6 py-6">
          <Button
            variant="primary"
            onClick={handleSendEvidence}
            disabled={busySending}
          >
            {busySending ? "Sending..." : "Send the evidence"}
          </Button>
          <Button variant="outline">
            Read it first
          </Button>
          <Button variant="outline">
            Add something
          </Button>
        </div>
      )}

      {/* Accept dispute modal */}
      <DisputeDetailAcceptTheDisputeModal
        open={showAcceptModal}
        onOpenChange={setShowAcceptModal}
        dispute={dispute}
        showAcceptModal={showAcceptModal}
        busySending={busySending}
        handleAccept={handleAccept}
      />
    </div>
  );
}
