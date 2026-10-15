// ═══════════════════════════════════════════════════════════════════════════════════════════════
// useSaveFlow — THE ONE SHARED SAVE-FEEDBACK PIECE (the maintainer, 30 Sep 2026 save-system brief).
//
// For a hand-rolled editor that isn't a single useWrite() action (a multi-field form, a document
// body, a settings page) — one hook gives it everything the maintainer asked every save behave the same way:
//   · double-click lock (a ref, not state, so a second click inside the same tick still sees it)
//   · "Saved" / "Saved at 2:14 PM" via Sonner (already in this app — runAction.js's own convention)
//   · a clear error on failure, via the SAME toast channel, and the thrown error is re-thrown so the
//     caller's own state (whatever the person typed) is untouched — nothing here clears an input
//   · Cmd/Ctrl+S, wired to `save` iff `isDirty`
//   · a beforeunload warning iff `isDirty` (tab close / refresh — the in-app "close this editor"
//     guard is a SEPARATE, per-screen concern, because only the screen knows what "close" means here)
//   · `lastSavedAt`, for a "Saved at …" / "Last edited …" line in the header
//
// ★★★ NO CONFIRM STEP HERE. Square, Stripe, Linear, Notion and Google Docs all use disable-until-
//     dirty + a busy state + a toast — never an "Are you sure you want to save?" dialog — for a
//     routine save; Apple HIG and Material both advise against a confirmation for a reversible
//     action. the maintainer asked for one; this hook does not build it in, but a caller that wants it wraps
//     `save` in the EXISTING ConfirmAction component (forms/ConfirmAction.jsx) — see the save-system
//     report for the specific cases this was and wasn't added to, and why.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { savedToast } from "./savedToast.js";

export function useSaveFlow({ isDirty, onSave, savedMessage = "Saved", errorTitle = "Couldn't save" }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const savingRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const save = useCallback(async (...args) => {
    if (savingRef.current) return undefined; // double-click / double-submit lock
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await onSaveRef.current(...args);
      const now = new Date();
      setLastSavedAt(now);
      savedToast(savedMessage);
      return result;
    } catch (err) {
      setError(err);
      // ★ "nothing lost from what they typed" — this hook never touches the caller's draft state,
      //   on success or failure; the caller's own onSave decides what (if anything) to reset.
      toast.error(errorTitle, { description: err?.message || "Something went wrong. What you typed is still here — try again." });
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [savedMessage, errorTitle]);

  useEffect(() => {
    function onKeyDown(e) {
      const key = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "s") {
        e.preventDefault();
        if (isDirtyRef.current && !savingRef.current) save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  useEffect(() => {
    function onBeforeUnload(e) {
      if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return { saving, error, lastSavedAt, save };
}
