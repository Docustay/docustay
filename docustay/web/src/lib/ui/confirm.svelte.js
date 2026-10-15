// An in-app replacement for window.confirm(): `await ask("Revoke this key?", { danger: true, yes: "Revoke" })` → true | false. <ConfirmHost /> (mounted once in the app layout) draws it.
let state = $state({ open: false, message: "", yes: "", no: "", danger: false, resolve: null, input: false, value: "", required: false });
export const confirmState = state;
import { t } from "$lib/i18n/index.svelte.js";
// The answer button's wording, from what is being asked. Literal t("…") calls so the translation tools can see every string.
function yesFor(message) {
  const m = String(message);
  if (m.startsWith("Revoke")) return t("Revoke");
  if (m.startsWith("Delete")) return t("Delete");
  if (m.startsWith("Remove")) return t("Remove");
  if (m.startsWith("Archive")) return t("Archive");
  if (m.startsWith("Retire")) return t("Retire");
  if (m.startsWith("Discard")) return t("Discard draft");
  if (m.startsWith("Make a new")) return t("Make a new secret");
  if (m.startsWith("Go back")) return t("Go back to standard");
  return t("Yes");
}
export function ask(message, { yes = "", no = "", danger = true } = {}) {
  if (!yes) yes = yesFor(message);
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (state.resolve) state.resolve(false);
    state.message = message; state.yes = yes; state.no = no || t("Cancel"); state.danger = danger; state.resolve = resolve; state.input = false; state.value = ""; state.required = false; state.open = true;
  });
}
/** D-097: an in-app replacement for window.prompt(): `await askText("Why is this template being rejected?", { yes: "Reject", required: true })` → the text typed, or null when cancelled. */
export function askText(message, { yes = "", no = "", required = false, value = "", danger = false } = {}) {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (state.resolve) state.resolve(false);
    state.message = message; state.yes = yes || t("Yes"); state.no = no || t("Cancel"); state.danger = danger; state.resolve = resolve; state.input = true; state.value = value; state.required = required; state.open = true;
  });
}
export function settle(v) { const r = state.resolve, asked = state.input, typed = state.value; state.resolve = null; state.open = false; state.input = false; state.value = ""; r?.(asked ? (v ? typed : null) : v); }
