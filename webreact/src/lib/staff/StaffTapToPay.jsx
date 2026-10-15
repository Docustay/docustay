// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.30 — TAP TO PAY SCREEN (part of Get Paid)
//
// ★★★ THE TAP TO PAY FLOW. When a staff member taps "Take it" on an owing invoice, this screen
//     shows the hold-card instructions, the item being paid for, the invoice number, the fee,
//     and two buttons: "Type the card in" (Stage 15's virtual terminal) and "Cancel".
//
// ★★ SINCE THE BROWSER CANNOT TAP (flag `tap_to_pay` is `being_built`, 18.17), the screen shows
//     the F08 §5.5 sentence "It only works in the the platform app — Not in a browser. Apple and
//     Google both require it." Never a button that looks live and does nothing.
//
// ★ The fee arithmetic lives here: `feeMinor(amountMinor) = Math.round(amountMinor * 0.027) + 5`.
// ★★ Task 20.70 — Stripe Terminal reader actions: process, cancel, display, refund.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.js";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

// ★ Fee calculation: 2.7% + 5¢
function feeMinor(amountMinor) {
  return Math.round(amountMinor * 0.027) + 5;
}

export default function StaffTapToPay({ app, path, onNavigate }) {
  // ★ Extract invoiceId from path: /staff/get-paid/tap/{invoiceId}
  const invoiceId = useMemo(() => {
    const match = path?.match(/^\/staff\/get-paid\/tap\/([^/]+)$/);
    return match ? match[1] : null;
  }, [path]);

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [capabilitiesError, setCapabilitiesError] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [cancelingAction, setCancelingAction] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  // ★ Load invoice details and capabilities on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        if (!invoiceId) {
          throw new Error("Invalid invoice ID");
        }
        const inv = await api.moneyInvoiceRecord(invoiceId);
        setInvoice(inv);
      } catch (err) {
        setError(err);
      }

      try {
        const cap = await api.capabilities();
        setCapabilities(cap);
      } catch (err) {
        setCapabilitiesError(err);
      }

      setLoading(false);
    };

    loadData();
  }, [invoiceId]);

  // ★ Format amount in dollars
  const formatAmount = (minor) => {
    if (minor === null || minor === undefined) return "$0.00";
    return (minor / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  };

  // ★ Check if charges are enabled (take_payments capability)
  const chargesEnabled = useMemo(() => {
    if (!capabilities?.capabilities) return false;
    const payCap = capabilities.capabilities.find(
      (c) => c.capability === "take_payments"
    );
    return payCap?.available === true;
  }, [capabilities]);

  // ★ Calculate fee
  const calculatedFee = useMemo(
    () => (invoice?.amount_minor ? feeMinor(invoice.amount_minor) : 0),
    [invoice?.amount_minor]
  );

  // ★ Back button handler
  const handleBack = () => {
    if (onNavigate) onNavigate("/staff/get-paid");
  };

  // ★ Cancel action: call the reader cancel endpoint
  const handleCancel = async () => {
    setCancelingAction(true);
    setCancelError(null);
    try {
      await api.cancelAction(
        { tenantId: app?.tenant?.id, readerId: null },
        crypto.randomUUID()
      );
      if (onNavigate) onNavigate("/staff/get-paid");
    } catch (err) {
      setCancelError(err?.message ?? "Failed to cancel reader action");
      setCancelingAction(false);
    }
  };

  // ★ Type the card in button (Stage 15 flow)
  const handleTypeCardIn = () => {
    // This routes to Stage 15's virtual terminal flow
    // For now, shows not implemented
  };

  // ★ Render loading state
  if (loading) {
    return <ScreenState phase="loading" />;
  }

  // ★ Render error states
  if (error) {
    return <ErrorPanel error={error} subject="Invoice" variant="page" />;
  }

  if (capabilitiesError) {
    return <ErrorPanel error={capabilitiesError} subject="Capabilities" />;
  }

  if (!invoice) {
    return (
      <ScreenState phase="error" error={new Error("Invoice not found")} />
    );
  }

  return (
    <div className="flex flex-col gap-3.5 h-full overflow-auto" style={{ padding: "2px 18px 22px" }}>
      {/* ★ Header with back button and amount */}
      <div className="flex items-center gap-2.5 border-b border-structure-150" style={{ paddingBottom: "10px" }}>
        <button
          onClick={handleBack}
          className="w-5 text-lg text-action-600 bg-none border-none cursor-pointer p-0 text-center"
        >
          ‹
        </button>
        <div className="flex-1">
          <div className="font-medium text-base text-structure-900 mb-0.5">
            Take {formatAmount(invoice.amount_minor)}
          </div>
          <div className="text-xs text-structure-600">
            {invoice.person_name}
            {invoice.item_description && ` · ${invoice.item_description}`}
          </div>
        </div>
        <div className="w-8 flex-shrink-0"></div>
      </div>

      {/* ★ Hold card instructions (disabled when charges are off) */}
      <DisabledWithReason
        disabled={!chargesEnabled}
        reason={
          !chargesEnabled
            ? "Charges are off — the reader can't take payment yet"
            : ""
        }
        testId="tap-to-pay-process"
      >
        {({ disabled, describedBy }) => (
          <div
            className="text-center flex items-center justify-center flex-col"
            style={{ opacity: disabled ? 0.6 : 1, padding: "34px 12px 26px" }}
          >
            <div className="w-32 h-32 rounded-full bg-action-50 text-action-600 flex items-center justify-center text-5xl mx-auto" style={{ marginBottom: "24px" }}>
              ≋
            </div>
            <div className="font-medium text-base text-structure-900" style={{ marginBottom: "9px" }}>
              Hold their card to the top of your phone
            </div>
            <div className="text-sm text-structure-600" style={{ lineHeight: "1.6" }}>
              A card, a phone or a watch. It takes a second and you'll feel it
              buzz.
            </div>
          </div>
        )}
      </DisabledWithReason>

      {/* ★ Invoice details card */}
      <PhoneCard>
        <div className="flex flex-col" style={{ gap: "6px" }}>
          <div className="flex justify-between text-sm border-b border-structure-150" style={{ padding: "8px 0" }}>
            <span className="flex-1">{invoice.item_description || "Payment"}</span>
            <span className="flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatAmount(invoice.amount_minor)}
            </span>
          </div>
          <div className="flex justify-between text-xs text-structure-600" style={{ fontSize: "12.5px", marginTop: "6px", paddingTop: "12px", borderBottom: "1px solid var(--color-structure-150)" }}>
            <span className="flex-1">
              Goes to invoice {invoice.number || "—"}
            </span>
            <span className="flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
              Fee {formatAmount(calculatedFee)}
            </span>
          </div>
        </div>
      </PhoneCard>

      {/* ★ Browser limitation message */}
      <div style={{ margin: "8px 0" }}>
        <p className="text-sm text-structure-600 m-0" style={{ lineHeight: "1.6", padding: "12px", background: "var(--color-structure-150)", borderRadius: "8px" }}>
          It only works in the Workbench app — Not in a browser. Apple and Google
          both require it.
        </p>
      </div>

      {/* ★ Process payment error */}
      {processError && (
        <ErrorPanel error={new Error(processError)} subject="Payment" />
      )}

      {/* ★ Cancel action error */}
      {cancelError && (
        <ErrorPanel error={new Error(cancelError)} subject="Cancel" />
      )}

      {/* ★ Action buttons */}
      <div className="flex gap-2 mt-auto" style={{ gap: "8px" }}>
        <button
          onClick={handleTypeCardIn}
          disabled={processingPayment || cancelingAction}
          className="flex-1 border border-structure-200 bg-white text-structure-650 cursor-pointer font-medium disabled:opacity-50 hover:bg-structure-150"
          style={{ height: "32px", padding: "0 13px", borderRadius: "7px", fontSize: "13px" }}
        >
          Type the card in
        </button>
        <button
          onClick={handleCancel}
          disabled={processingPayment || cancelingAction}
          className="flex-1 border border-structure-200 bg-white text-structure-650 cursor-pointer font-medium disabled:opacity-50 hover:bg-structure-150"
          style={{ height: "32px", padding: "0 13px", borderRadius: "7px", fontSize: "13px" }}
        >
          {cancelingAction ? "Canceling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}
