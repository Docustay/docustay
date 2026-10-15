// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DisputeAcceptDialog — P3.U14 (W7). Built FROM specs/mockups/DisputeAccept.frame.html's `.modal`: a
// destructive DecisionModal — accepting means no evidence is sent and the disputed amount plus the
// dispute fee stay with the cardholder's bank, which can't be undone (the frame's own copy, verbatim).
// ★ The request body is exactly CONTRACTS.md §4 / api.js's `{ disputeId, confirmationText }`
//   (acceptDispute → POST /api/money/disputes/close). The frame carries no typed confirmation field,
//   so `confirmationText` is the confirm button's own label — the thing the person actually agreed to
//   by clicking it, sent verbatim, never re-worded.
// ★ `useWrite` decides the permission, not this component: hidden (no `invoice.edit`) renders NOTHING,
//   the same as WriteButton — a control asking a permission it doesn't have IS the defect (CLAUDE.md).
// ★ A missing prerequisite is `write.blocked`: DisabledWithReason renders the reason and the confirm
//   stays disabled, never hidden — a blocked write is not a denied one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";

// Stripe's standard dispute (chargeback) fee — not a per-dispute figure, so it isn't read off `dispute`
// unless the host screen supplies one explicitly.
const DISPUTE_FEE_MINOR = 1500;
const CONFIRM_LABEL = "Accept dispute";

function formatMoney(minor, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency).toUpperCase() }).format((minor ?? 0) / 100);
}

/**
 * @param dispute { id, amountMinor, currency, feeAmountMinor?, blockedReason? } — the host screen's
 *   dispute record; `blockedReason` is the missing prerequisite, if any — a permission (`invoice.edit`)
 *   is decided by `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the dialog is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/confirm/Escape (DecisionModal owns the busy lock).
 * @param onAccepted — called after the dispute is accepted, so the host screen can refetch.
 */
export default function DisputeAcceptDialog({ dispute, open, onOpenChange, onAccepted }) {
  const write = useWrite("acceptDispute", { blockedReason: dispute?.blockedReason ?? null });

  if (!open || write.hidden) return null;

  async function handleConfirm() {
    if (write.blocked) return;
    try {
      await write.run({ disputeId: dispute.id, confirmationText: CONFIRM_LABEL });
      onAccepted?.();
      onOpenChange?.(false);
    } catch {
      // write.error is already set by useWrite — the dialog stays open and shows it (below).
    }
  }

  const amount = formatMoney(dispute?.amountMinor, dispute?.currency ?? "usd");
  const fee = formatMoney(dispute?.feeAmountMinor ?? DISPUTE_FEE_MINOR, dispute?.currency ?? "usd");

  return (
    <DecisionModal
      testId="dispute-accept"
      open={open}
      onOpenChange={onOpenChange}
      title="Accept this dispute?"
      subtitle={
        <>
          You won&rsquo;t send evidence. <b>{amount}</b> and the {fee} dispute fee stay with the
          cardholder&rsquo;s bank. This can&rsquo;t be undone.
        </>
      }
      cancelLabel="Keep fighting it"
      confirmLabel={write.busy ? "Accepting…" : CONFIRM_LABEL}
      danger
      busy={write.busy}
      confirmDisabled={!!write.blocked}
      onCancel={() => onOpenChange?.(false)}
      onConfirm={handleConfirm}
      error={write.error ? (
        <>
          <span data-testid="dispute-accept-error-message">{write.error.message}</span>
          {write.error.requestId && (
            <>
              <br />
              <span className="text-mute" data-testid="dispute-accept-error-reference">Reference: {write.error.requestId}</span>
            </>
          )}
        </>
      ) : null}
    >
      {write.blocked && (
        <DisabledWithReason disabled reason={write.blocked.reason} testId="dispute-accept-blocked">
          Accepting needs one more thing before it can run.
        </DisabledWithReason>
      )}
    </DecisionModal>
  );
}
