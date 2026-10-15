// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.039 — ReachConfirm: rebuild from the frame on the archetype
//
// When a settings change affects existing bookings, sessions, agreements, or service overrides,
// the server returns 409 with computed reach consequences. This component shows them and collects
// an optional explanation from the operator before saving.
//
// ★ The reach data comes from the server's 409 response (one item from the reach array).
//   Each row has {headline, sentence, kind, n} where headline is bold and sentence explains it.
//   We always show the tell textarea; tell is sent only when it's non-empty.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from "react";
import ReachConfirmReachConfirmModal from "./ReachConfirmReachConfirmModal.jsx";

export default function ReachConfirm({
  reach = null,
  label = "",
  onKeep = null,
  onConfirm = null,
  busy = false,
  error = null,
}) {
  const [tellText, setTellText] = useState("");

  // Compute whether there's a mismatch row that needs navigation
  const mismatchRow = useMemo(
    () => reach?.rows?.find((r) => r.kind === "mismatch"),
    [reach]
  );

  const title = useMemo(
    () =>
      label && reach?.to !== undefined
        ? `Change the ${label} to ${reach.to}?`
        : "",
    [label, reach]
  );

  const subtitle = useMemo(
    () => {
      if (!reach?.from) return null;
      const sinceText = reach.since ? ` since ${reach.since}` : "";
      return `It's been ${reach.from}${sinceText}. This affects everyone from the moment you save.`;
    },
    [reach]
  );

  const cancelLabel = useMemo(
    () => `Leave it at ${reach?.from ?? ""}`,
    [reach]
  );

  const confirmLabel = useMemo(
    () =>
      mismatchRow
        ? "Change it, and update the agreement"
        : "Change it",
    [mismatchRow]
  );

  const rows = useMemo(
    () =>
      reach?.rows?.map((r) => ({
        headline: r.headline,
        detail: r.sentence,
      })) ?? [],
    [reach]
  );

  function handleKeep() {
    setTellText("");
    onKeep?.();
  }

  function handleConfirm() {
    // ★ tell is sent only when the textarea is non-empty.
    const tell =
      tellText.trim().length > 0 ? { message: tellText.trim() } : undefined;
    onConfirm?.(tell);
  }

  return (
    <ReachConfirmReachConfirmModal
      open={reach !== null}
      onOpenChange={(open) => {
        if (!open) {
          handleKeep();
        }
      }}
      reach={reach}
      label={label}
      onConfirm={onConfirm}
      busy={busy}
      error={error}
      tellText={tellText}
      onTellTextChange={setTellText}
      title={title}
      subtitle={subtitle}
      cancelLabel={cancelLabel}
      confirmLabel={confirmLabel}
      rows={rows}
      handleKeep={handleKeep}
      handleConfirm={handleConfirm}
    />
  );
}
