// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RefundRequestRow — P3.U13 (W6). Built FROM specs/mockups/RefundRequestDecision.frame.html's table
// row (Client · Amount · Asked by · Why · actions) and its Approve `.modal`, ported verbatim: same
// order, same labels, same text runs (including the modal's exact copy and its en dash). Mounted by the
// host screen's own `<table><tbody>`, one `<tr>` per open refund request.
// ★ Three writes, three permission checks, three error bands (WIRING-MAP §3.3 · W6):
//     · Approve  → `approveRefundRequest` — Stripe first; a refusal rolls back and this row's Approve
//       modal stays open, showing Stripe's own reason + reference (write.error, never re-worded — api.js's
//       own rule).
//     · Decline  → `declineRefundRequest` — same Stripe-first rule. `declineRefundRequest` only ever
//       carries `{requestId}` (api.js:2808 / CONTRACTS §4) — the reason typed here is the person's own
//       record of why, validated locally (≤500, same idiom as AdjustCreditSheet's "Why"), but it is NOT
//       part of the wire body; inventing a second field the server does not read would be exactly the
//       kind of drift api.js's own header forbids.
//     · Cancel   → `cancelRefund` — only offered once a refund exists and is still cancelable
//       (`request.status === "processing"`); carries `{refundId}`, never `{requestId}`.
// ★ `useWrite`'s `hidden` decides ALL THREE identically for a viewer without `invoice.edit` (Owner/Admin
//   only, WIRING-MAP §3.3): every WriteButton below renders NOTHING and the row's own figures (client,
//   amount, asked-by, why) still render — the positive control CLAUDE.md's rule requires.
// ★ A missing prerequisite (e.g. Stripe not connected) is `write.blocked`, carried on `request.blockedReason`
//   exactly like PauseDialog/AdjustCreditSheet: DISABLED WITH THE REASON, never hidden.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { createPortal } from "react-dom";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const WHY_MAX = 500;
const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

const FINAL_STATUS = {
  approved: { label: "Approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function ErrorText({ error, testId }) {
  if (!error) return null;
  return (
    <>
      <span data-testid={`${testId}-message`}>{error.message}</span>
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute" data-testid={`${testId}-reference`}>Reference: {error.requestId}</span>
        </>
      )}
    </>
  );
}

/**
 * @param request { id, clientName, amountMinor, currency?, askedByName, askedByIsTeamMember?, reason,
 *   cardLastFour, refundId?, status?, blockedReason? } — `status` ∈ "requested" (awaiting a decision,
 *   the frame's own default) · "processing" (approved; the refund is still cancelable) · "approved" ·
 *   "declined" · "cancelled" (all three terminal, no write control left). `blockedReason` is the missing
 *   prerequisite, if any — the permission itself (`invoice.edit`) is decided by `useWrite`, never by this prop.
 * @param onDecided — called after any successful write (approve/decline/cancel), so the host screen refetches.
 */
export default function RefundRequestRow({ request, onDecided }) {
  const approve = useWrite("approveRefundRequest", { blockedReason: request?.blockedReason ?? null });
  const decline = useWrite("declineRefundRequest", { blockedReason: request?.blockedReason ?? null });
  const cancel = useWrite("cancelRefund", { blockedReason: request?.blockedReason ?? null });

  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const status = request?.status ?? "requested";
  const currency = request?.currency ?? "USD";
  const amountText = formatMoney(request?.amountMinor ?? 0, currency);
  const clientName = request?.clientName ?? "";
  const clientFirstName = clientName.split(" ")[0] || clientName;
  const askedByLabel = request?.askedByIsTeamMember ? `${request.askedByName} (team member)` : (request?.askedByName ?? "");
  const declineReasonTrimmed = declineReason.trim();
  const declineReasonInvalid = declineReasonTrimmed.length === 0 || declineReasonTrimmed.length > WHY_MAX;

  async function handleApprove() {
    try {
      await approve.run({ requestId: request.id });
      setApproveOpen(false);
      onDecided?.();
    } catch {
      // approve.error is already set — the modal stays open and shows it (below).
    }
  }

  async function handleDecline() {
    if (declineReasonInvalid) return;
    try {
      await decline.run({ requestId: request.id });
      setDeclineOpen(false);
      setDeclineReason("");
      onDecided?.();
    } catch {
      // decline.error is already set — the dialog stays open and shows it (below).
    }
  }

  async function handleCancel() {
    try {
      await cancel.run({ refundId: request.refundId });
      setCancelOpen(false);
      onDecided?.();
    } catch {
      // cancel.error is already set — the confirm stays open and shows it (below).
    }
  }

  const final = FINAL_STATUS[status] ?? null;

  return (
    <tr data-testid="refund-request-row">
      <td className={TD}>{clientName}</td>
      <td className={`${TD} text-right`}>
        <Figure size="sm" testId="refund-request-amount">{amountText}</Figure>
      </td>
      <td className={TD}>{askedByLabel}</td>
      <td className={TD}>{request?.reason}</td>
      <td className={`${TD} text-right`}>
        <div className="flex items-center justify-end gap-2">
          {status === "requested" && (
            <>
              <WriteButton write={decline} testId="refund-request-decline" variant="outline"
                           onClick={() => { setDeclineReason(""); setDeclineOpen(true); }}>
                Decline
              </WriteButton>
              <WriteButton write={approve} testId="refund-request-approve"
                           onClick={() => setApproveOpen(true)}>
                Approve
              </WriteButton>
            </>
          )}
          {status === "processing" && (
            <>
              <StatusBadge label="Refund pending" tone="act" testId="refund-request-status" />
              <WriteButton write={cancel} testId="refund-action-cancel" variant="outline"
                           onClick={() => setCancelOpen(true)}>
                Cancel
              </WriteButton>
            </>
          )}
          {final && <StatusBadge label={final.label} tone={final.tone} testId="refund-request-status" />}
        </div>
      </td>

      {approveOpen && (
        <DecisionModal
          open={approveOpen}
          onOpenChange={setApproveOpen}
          testId="refund-approve-modal"
          title={`Approve ${clientFirstName}’s refund?`}
          cancelLabel="Not yet"
          confirmLabel="Approve refund"
          busy={approve.busy}
          confirmDisabled={!!approve.blocked}
          error={approve.error ? <ErrorText error={approve.error} testId="refund-approve-modal-error" /> : null}
          onCancel={() => setApproveOpen(false)}
          onConfirm={handleApprove}
        >
          <p className="m-0 text-control leading-relaxed text-ink-2" data-testid="refund-approve-modal-body">
            <b className="text-ink">{amountText}</b>{" goes back to the card ending "}{request?.cardLastFour}
            {" and the session credit returns to their balance. It usually lands in 5–10 days."}
          </p>
        </DecisionModal>
      )}

      {declineOpen && createPortal(
        // ★ Portalled to document.body ourselves — ActionSurface (unlike DecisionModal/ConfirmAction,
        //   which use Radix's own Portal) renders inline, and this component's own root is a `<tr>`:
        //   a `<div>` sibling of `<td>` inside `<tr>` is invalid table content, so the surface is
        //   portalled the same way its Radix-based siblings already are.
        <ActionSurface
          kind="dialog"
          testId="refund-decline-dialog"
          title={`Decline ${clientFirstName}’s refund request?`}
          busy={decline.busy}
          busyLabel="Declining…"
          submitLabel="Decline request"
          cancelLabel="Keep it"
          submitDisabled={declineReasonInvalid || !!decline.blocked}
          onCancel={() => setDeclineOpen(false)}
          onSubmit={handleDecline}
          error={decline.error ? <ErrorText error={decline.error} testId="refund-decline-dialog-error" /> : null}
        >
          <SheetRow label="Why"
                    hint={declineReasonTrimmed.length > WHY_MAX
                      ? `500 characters or fewer (${declineReasonTrimmed.length}).`
                      : null}>
            <Input name="reason" data-testid="refund-decline-reason"
                   placeholder="Let them know why — they’ll see this"
                   value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
          </SheetRow>
        </ActionSurface>,
        document.body,
      )}

      {cancelOpen && (
        <ConfirmAction
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          testId="refund-cancel-confirm"
          object="this refund"
          verb="Cancel"
          consequence="The payment stays charged and nothing changes."
          confirmLabel="Cancel refund"
          cancelLabel="Keep it"
          busy={cancel.busy}
          error={cancel.error ? <ErrorText error={cancel.error} testId="refund-cancel-confirm-error" /> : null}
          onCancel={() => setCancelOpen(false)}
          onConfirm={handleCancel}
        />
      )}
    </tr>
  );
}
