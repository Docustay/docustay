// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › SPLIT OFFER SHEET — PAYMENT PLAN OFFER
// Ported from webui/src/lib/money/SplitOfferSheet.svelte: same props, testids and copy.
// Allows creating a payment plan offer on an invoice.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api } from "@/lib/api.js";
import SplitOfferSheetOfferToSplitSheet from "./SplitOfferSheetOfferToSplitSheet.jsx";

export default function SplitOfferSheet({ invoice, onClose = null, onSave = null }) {
  const [installments, setInstallments] = useState(3);
  const [frequency, setFrequency] = useState("monthly");
  const [firstDueOn, setFirstDueOn] = useState(getDefaultFirstDueDate());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function getDefaultFirstDueDate() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  }

  function addDays(dateString, days) {
    const [y, m, d] = dateString.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" +
      `${dt.getUTCMonth() + 1}`.padStart(2, "0") + "-" +
      `${dt.getUTCDate()}`.padStart(2, "0");
  }

  function addMonths(dateString, months) {
    const [y, m, d] = dateString.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCMonth(dt.getUTCMonth() + months);
    return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" +
      `${dt.getUTCMonth() + 1}`.padStart(2, "0") + "-" +
      `${dt.getUTCDate()}`.padStart(2, "0");
  }

  function calculatePreview() {
    if (!invoice || !firstDueOn || installments < 1) return [];

    const totalMinor = invoice.amount - invoice.paidMinor;
    const baseAmount = Math.floor(totalMinor / installments);
    const remainder = totalMinor - (baseAmount * (installments - 1));

    const rows = [];
    for (let i = 1; i <= installments; i++) {
      let dueDate;
      if (i === 1) {
        dueDate = firstDueOn;
      } else {
        const daysBetween = frequency === "weekly" ? 7 * (i - 1)
          : frequency === "fortnightly" ? 14 * (i - 1)
            : null;
        if (daysBetween !== null) {
          dueDate = addDays(firstDueOn, daysBetween);
        } else {
          dueDate = addMonths(firstDueOn, i - 1);
        }
      }

      const amountMinor = i === installments ? remainder : baseAmount;
      rows.push({
        n: i,
        due_date: dueDate,
        amount_minor: amountMinor,
      });
    }
    return rows;
  }

  function formatMoney(minor, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(minor / 100);
  }

  async function handleSave() {
    if (!invoice || !firstDueOn || installments < 1) {
      setError("Please fill in all fields");
      return;
    }

    try {
      setBusy(true);
      setError(null);

      await api.offerPaymentPlan({
        invoiceId: invoice.id,
        installments: parseInt(installments),
        frequency,
        firstDueOn,
      });

      onSave?.();
    } catch (err) {
      console.error("Error creating payment plan:", err);
      setError(err.message || "Failed to create payment plan");
    } finally {
      setBusy(false);
    }
  }

  const previewRows = calculatePreview();

  return (
    <SplitOfferSheetOfferToSplitSheet
      open={true}
      onOpenChange={() => {}}
      invoice={invoice}
      onClose={onClose}
      onSave={onSave}
      installments={installments}
      frequency={frequency}
      firstDueOn={firstDueOn}
      error={error}
      busy={busy}
      formatMoney={formatMoney}
      handleSave={handleSave}
      previewRows={previewRows}
      onInstallmentsChange={setInstallments}
      onFrequencyChange={setFrequency}
      onFirstDueOnChange={setFirstDueOn}
    />
  );
}
