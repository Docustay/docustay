// ServiceAfterSave — service created/updated, what to do next; built on EditorPage.
// Ported from webui/src/lib/screens/items/ServiceAfterSave.svelte: same props, testids, copy.
import { useMemo } from "react";
import { formatValue } from "@/lib/format.js";
import AfterSavePanel from "@/lib/components/editor/AfterSavePanel.jsx";

export default function ServiceAfterSave({
  serviceId,
  publicBookable = false,
  priceAmountMinor = null,
  priceCurrency = null,
  priceVisible = true,
  stripeProductCreated = false,
  bookingUrl = null,
  onNavigate,
  onAttachDocument,
  onKeepEditing,
  testId = "service-after-save",
}) {
  // Validate required props
  if (typeof onNavigate !== "function") {
    throw new Error("ServiceAfterSave: onNavigate is required — \"Make a package\"/\"Make a plan\" must always be wired to a real navigation, never a dead control.");
  }
  if (typeof onAttachDocument !== "function") {
    throw new Error("ServiceAfterSave: onAttachDocument is required — \"Put a document on it\" must always be wired to a real action (14.55's attach modal), never a dead control.");
  }
  if (typeof onKeepEditing !== "function") {
    throw new Error("ServiceAfterSave: onKeepEditing is required — AfterSavePanel's own footer button must always be wired to a real action.");
  }

  // Calculate the price clause
  const priceClause = useMemo(() => {
    if (!priceVisible) return " (its price isn't shown to you)";
    if (Number.isInteger(priceAmountMinor) && priceCurrency) {
      return `, at ${formatValue(priceAmountMinor, "money", { currency: priceCurrency })}`;
    }
    return "";
  }, [priceVisible, priceAmountMinor, priceCurrency]);

  // Calculate the sentence
  const sentence = useMemo(() => {
    const parts = [];
    parts.push(publicBookable
      ? `It's on your booking page now${priceClause}.`
      : "It's saved and hidden from your booking page for now.");
    if (stripeProductCreated) parts.push("A Stripe product was created for it.");
    return parts.join(" ");
  }, [publicBookable, priceClause, stripeProductCreated]);

  // Calculate next actions
  const nextActions = useMemo(() => {
    const actions = [
      {
        title: "Sell it as a block",
        why: "Twelve sessions at once is how most coaching gets bought.",
        label: "Make a package",
        onClick: () => onNavigate(`/items/packages/new?serviceId=${encodeURIComponent(serviceId)}`),
      },
      {
        title: "Charge for it monthly",
        why: "For clients who'd rather it just rolled on.",
        label: "Make a plan",
        onClick: () => onNavigate(`/items/plans/new?serviceId=${encodeURIComponent(serviceId)}`),
      },
      {
        title: "Put a document on it",
        why: "So the agreement goes out the moment someone books.",
        label: "Choose one",
        onClick: () => onAttachDocument({ serviceId }),
      },
    ];
    if (bookingUrl) {
      actions.push({
        title: "Try booking it",
        why: "See what a client sees.",
        label: "Open the booking page",
        onClick: () => window.open(bookingUrl, "_blank", "noopener"),
      });
    }
    return actions;
  }, [serviceId, bookingUrl, onNavigate, onAttachDocument]);

  return (
    <AfterSavePanel
      headline="Saved."
      sentence={sentence}
      nextActions={nextActions}
      onKeepEditing={onKeepEditing}
      testId={testId}
    />
  );
}
