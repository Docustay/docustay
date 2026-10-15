// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FraudReviewPanel — P3.U19 (W12). Structure ported from specs/mockups/RefundRequestDecision.frame.html's
// table row + Approve `.modal` (the same frame RefundRequestRow, P3.U13, ports for refund requests) — but
// this panel lists Stripe Radar reviews held for fraud, not refund requests, so the frame's own copy
// ("card ending", "session credit") cannot be reused for a held payment. Every word shown here that isn't
// plain structure is the wiring-doc's own "held payment" wording instead (WIRING-MAP §3.3/§3.4 · W12, the
// frame's own generated "What every control on this frame does" block): the panel's name ("held
// payments"), the unreachable message ('Couldn't load held payments', verbatim), and the state an
// approval leaves ("the payment leaves the review list", verbatim — used as the confirm's consequence
// line). The frame's "Asked by" column has no equivalent for an automatic Radar hold (nobody asked for
// it) and is dropped; "Why" carries the review's own hold reason in its place — the same column, doing
// the job the frame drew it for. Client / Amount / Why keep the frame's own header text verbatim.
// ★ Live read (`fraudReviews` — a GET, called directly; `useWrite` refuses GETs, api.js's own rule).
//   Unreachable renders 'Couldn't load held payments' via ErrorPanel, verbatim, never re-worded.
// ★ One write (`approveFraudReview`): `useWrite`'s `hidden` renders NOTHING for a viewer without
//   `dispute.edit` (Team member) — the row's own figures (client, amount, why) still render, the positive
//   control CLAUDE.md's rule requires. A missing prerequisite is DISABLED WITH THE REASON
//   (`blockedReason`), never hidden. A Stripe refusal shows write.error's own message + reference and the
//   confirm stays open (write.error, never re-worded — the same rule RefundRequestRow's ErrorText follows).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";
const TH = "h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute";

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
 * @param review { id, clientName, amountMinor, currency?, reason, blockedReason? } — one open Stripe
 *   Radar review. `blockedReason` is the missing prerequisite, if any — the permission itself
 *   (`dispute.edit`) is decided by `useWrite`, never by this prop.
 * @param onApproved — called after a successful approve so the panel drops the row from its list
 *   ("the payment leaves the review list", WIRING-MAP §3.3 · W12).
 */
function FraudReviewRow({ review, onApproved }) {
  const approve = useWrite("approveFraudReview", { blockedReason: review?.blockedReason ?? null });
  const [approveOpen, setApproveOpen] = useState(false);

  const currency = review?.currency ?? "USD";
  const amountText = formatMoney(review?.amountMinor ?? 0, currency);
  const clientName = review?.clientName ?? "";
  const clientFirstName = clientName.split(" ")[0] || clientName;

  async function handleApprove() {
    try {
      await approve.run({ reviewId: review.id });
      setApproveOpen(false);
      onApproved?.(review.id);
    } catch {
      // approve.error is already set — the modal stays open and shows it (below).
    }
  }

  return (
    <tr data-testid="fraud-review-row">
      <td className={TD}>{clientName}</td>
      <td className={`${TD} text-right`}>
        <Figure size="sm" testId="fraud-review-amount">{amountText}</Figure>
      </td>
      <td className={TD}>{review?.reason}</td>
      <td className={`${TD} text-right`}>
        <WriteButton write={approve} testId="fraud-review-approve" onClick={() => setApproveOpen(true)}>
          Approve
        </WriteButton>
      </td>

      {approveOpen && (
        <DecisionModal
          open={approveOpen}
          onOpenChange={setApproveOpen}
          testId="fraud-review-approve-modal"
          title={`Approve ${clientFirstName}’s payment?`}
          cancelLabel="Not yet"
          confirmLabel="Approve payment"
          busy={approve.busy}
          confirmDisabled={!!approve.blocked}
          error={approve.error ? <ErrorText error={approve.error} testId="fraud-review-approve-modal-error" /> : null}
          onCancel={() => setApproveOpen(false)}
          onConfirm={handleApprove}
        >
          <p className="m-0 text-control leading-relaxed text-ink-2" data-testid="fraud-review-approve-modal-body">
            The payment leaves the review list.
          </p>
        </DecisionModal>
      )}
    </tr>
  );
}

/** The Money › Payments "held payments" panel — lists open Stripe Radar reviews, live. */
export default function FraudReviewPanel() {
  const [state, setState] = useState({ status: "loading", reviews: [] });

  const load = useCallback(() => {
    setState({ status: "loading", reviews: [] });
    api.fraudReviews()
      .then(({ reviews }) => setState({ status: "ready", reviews: reviews ?? [] }))
      .catch(() => setState({ status: "error", reviews: [] }));
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleApproved(reviewId) {
    setState((s) => ({ ...s, reviews: s.reviews.filter((r) => r.id !== reviewId) }));
  }

  return (
    <div data-testid="fraud-review-panel">
      <h2 className="m-0 mb-3 text-heading font-medium text-ink" data-testid="fraud-review-panel-title">Held payments</h2>

      {state.status === "loading" && (
        <AppSpinner testId="fraud-review-panel-loading" label="Loading held payments" />
      )}

      {state.status === "error" && (
        <ErrorPanel testId="fraud-review-panel-error" error={{ message: "Couldn't load held payments" }} onRetry={load} />
      )}

      {state.status === "ready" && state.reviews.length === 0 && (
        <div className="rounded-card border border-hair px-4 py-6 text-ui text-ink-2" data-testid="fraud-review-empty">
          No held payments right now.
        </div>
      )}

      {state.status === "ready" && state.reviews.length > 0 && (
        <div className="overflow-hidden rounded-card border border-hair">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Why</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody>
              {state.reviews.map((review) => (
                <FraudReviewRow key={review.id} review={review} onApproved={handleApproved} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
