// save-system brief, 30 Sep 2026 — THE ONE "Saved at …" TOAST, SHARED.
//
// `useSaveFlow.js` already had this exact wording inline for its own callers (hand-rolled
// editors). Every `useWrite`-based SideSheet save needs the SAME confirmation and was showing
// none at all — extracted here so both call the identical function rather than two copies of the
// same string drifting apart.
import { toast } from "sonner";

export const timeLabel = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function savedToast(message = "Saved") {
  const now = new Date();
  toast.success(message, { description: `Saved at ${timeLabel(now)}` });
}
