// Toasts for success and error messages: toast("Saved") or toast("That failed", "bad"). svelte-sonner (MIT) draws them; <Toaster /> in the app shell mounts the stack. Tones: ok, bad, info.
// D-076: a toast with the same words REPLACES the one on screen (six test sends in a row stay one toast), and our own timer dismisses each toast whatever the pointer, focus or tab visibility does (sonner pauses its own timer then, which left toasts up for minutes).
import { toast as sonner } from "svelte-sonner";
import { toasted } from "./toasted.svelte.js";
const timers = new Map();
export function toast(text, tone = "ok", ms = 4500) {
  toasted.n++;
  const id = `${tone}:${text}`;
  const opts = { id, duration: ms };
  if (timers.has(id)) clearTimeout(timers.get(id));
  const shown = tone === "bad" ? sonner.error(text, opts) : tone === "info" ? sonner.message(text, opts) : sonner.success(text, opts);
  timers.set(id, setTimeout(() => { timers.delete(id); sonner.dismiss(id); }, ms + 500));
  return shown;
}
