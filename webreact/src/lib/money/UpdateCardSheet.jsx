// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UpdateCardSheet — R6.030
// Ported from webui/src/lib/money/UpdateCardSheet.svelte (198 lines).
// Props: open, onOpenChange, subscriptionId, subscription, onSave.
// Data: `/api/money/subscriptions/` via webreact/src/lib/api.js.
// Behaviour from the Svelte source; layout from specs/mockups/MoneyUpdateCard.frame.html.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import UpdateCardSheetMoneyUpdateCardSheet from "./UpdateCardSheetMoneyUpdateCardSheet.jsx";

export default function UpdateCardSheet({
  open,
  onOpenChange,
  subscriptionId,
  subscription,
  onSave,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [channel, setChannel] = useState("email");
  const [message, setMessage] = useState("");

  // Reset state when opening/closing or changing subscription
  useEffect(() => {
    if (!open) return;
    setChannel("email");
    setMessage("");
    setError(null);
  }, [open, subscription?.id]);

  if (!open) return null;

  const dunningConfig = subscription?.dunningConfig || { retries: 3, days: 10 };

  function formatMonth() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toLocaleDateString("en-US", { month: "long" });
  }

  async function handleSave() {
    if (!subscriptionId) return;

    try {
      setBusy(true);
      setError(null);

      await request(`/api/money/subscriptions/${encodeURIComponent(subscriptionId)}/update-card`, {
        method: "POST",
        body: {
          channel,
          message,
        },
      });

      onSave?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Error requesting card update:", err);
      setError(err.message || "Failed to request card update");
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    onOpenChange(false);
    setError(null);
    setChannel("email");
    setMessage("");
  }

  return (
    <UpdateCardSheetMoneyUpdateCardSheet
      subscription={subscription}
      busy={busy}
      error={error}
      channel={channel}
      message={message}
      handleSave={handleSave}
      handleCancel={handleCancel}
      dunningConfig={dunningConfig}
      formatMonth={formatMonth}
      onChannelChange={setChannel}
      onMessageChange={setMessage}
    />
  );
}
