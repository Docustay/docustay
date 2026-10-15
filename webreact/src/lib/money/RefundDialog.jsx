// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.023 — RefundDialog
// A DecisionModal for refunding a payment with approval workflow, cost calculation, and
// session credit return options.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request } from "@/lib/api.js";
import RefundDialogMoneyRefundDialog from "./RefundDialogMoneyRefundDialog.jsx";

const REFUND_REASONS = [
  "requested_by_customer",
  "duplicate",
  "service_not_delivered",
  "goodwill",
  "other",
];

function refundCostSentence({ refundMinor, stripeFeeMinor, payerDisplayName, currency = "USD" }) {
  const totalMinor = refundMinor + (stripeFeeMinor ?? 0);
  const totalMajor = (totalMinor / 100).toFixed(2);

  const possessive = payerDisplayName.endsWith("s")
    ? `${payerDisplayName}'`
    : `${payerDisplayName}'s`;

  let amount;
  if (currency === "USD") {
    amount = `$${totalMajor}`;
  } else {
    amount = `${currency} ${totalMajor}`;
  }

  return `It takes 5 to 10 days to reach ${possessive} card, and Stripe's fee on the original payment doesn't come back to you — so this refund actually costs you ${amount}.`;
}

export default function RefundDialog({
  open = false,
  onOpenChange,
  paymentId,
  paymentData,
  tenantId,
  onSuccess,
  onError,
}) {
  const [busySending, setBusySending] = useState(false);
  const [error, setError] = useState(null);
  const [approvalSent, setApprovalSent] = useState(false);
  const [chargesOff, setChargesOff] = useState(false);

  // Initialize form fields
  const [refundAmount, setRefundAmount] = useState(null);
  const [selectedReason, setSelectedReason] = useState("requested_by_customer");
  const [returnCredit, setReturnCredit] = useState(true);
  const [costSentence, setCostSentence] = useState("");
  const [isFullRefund, setIsFullRefund] = useState(true);

  // Initialize refund options and cost sentence when paymentData changes
  useEffect(() => {
    if (paymentData) {
      const fullAmount = paymentData.amountMinor;
      const refundedAlready = paymentData.refundedMinor || 0;
      const refundableAmount = fullAmount - refundedAlready;

      setRefundAmount(refundableAmount);
      setIsFullRefund(true);

      // Calculate cost sentence
      const stripeFeeMinor = paymentData.stripeFeeMinor || 0;
      setCostSentence(
        refundCostSentence({
          refundMinor: refundableAmount,
          stripeFeeMinor,
          payerDisplayName: paymentData.payerDisplayName || "the customer",
        })
      );

      // Check if payment has entitlement credit
      const hasCredit = paymentData.entitlementCreditId !== null && paymentData.entitlementCreditId !== undefined;
      setReturnCredit(hasCredit);
    }
  }, [paymentData]);

  async function handleRefund() {
    if (!paymentId || !tenantId) {
      setError("Missing payment or tenant information");
      return;
    }

    setBusySending(true);
    setError(null);
    setApprovalSent(false);
    setChargesOff(false);

    try {
      const response = await request("/api/money/refund", {
        method: "POST",
        body: {
          paymentId,
          amount: refundAmount,
          reason: selectedReason,
          returnCredit,
        },
        idempotencyKey: crypto.randomUUID(),
      });

      if (response.approvalNeeded) {
        setApprovalSent(true);
      } else {
        onOpenChange?.(false);
        onSuccess?.();
      }
    } catch (err) {
      if (err.status === 503) {
        setChargesOff(true);
      } else {
        setError(err.message || "Failed to request refund");
      }
      onError?.(err);
    } finally {
      setBusySending(false);
    }
  }

  function handleCancel() {
    onOpenChange?.(false);
    setError(null);
    setApprovalSent(false);
    setChargesOff(false);
  }

  return (
    <RefundDialogMoneyRefundDialog
      open={open}
      onOpenChange={onOpenChange}
      REFUND_REASONS={REFUND_REASONS}
      paymentData={paymentData}
      busySending={busySending}
      error={error}
      approvalSent={approvalSent}
      chargesOff={chargesOff}
      refundAmount={refundAmount}
      selectedReason={selectedReason}
      returnCredit={returnCredit}
      costSentence={costSentence}
      isFullRefund={isFullRefund}
      handleRefund={handleRefund}
      handleCancel={handleCancel}
      onIsFullRefundChange={setIsFullRefund}
      onSelectedReasonChange={setSelectedReason}
      onReturnCreditChange={setReturnCredit}
    />
  );
}
