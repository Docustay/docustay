// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SideSheet — the create/edit surface every Accounts/Clients/Money form uses (COMPONENTS.md
// "SideSheet"; CLAUDE.md vocabulary 4). Ported from webui/src/lib/forms/SideSheet.svelte, then
// rebuilt for the slide-up ruling below — same props, testids and copy throughout.
// ★ Save is type="submit" inside a <form> — the harness presses button[type="submit"] (TESTID-CONTRACT §4).
// ★ `footer` replaces the default footer, `children` is the body.
//
// ★★★ the maintainer, 29 Sep 2026 — SLIDEUP-AUDIT.md's ruling: every one of these opens as a FULL SCREEN
//   sliding up from the bottom, like Square's New invoice — X top-left, title centred, actions
//   top-right — not a right-docked panel. This ONE file is what every Accounts/Clients/Money create
//   or edit screen already renders through (grepped: AccountFormNewAccountSheet excepted, everything
//   else in the audit's table does), so rebuilding it here is what makes the ruling apply to all of
//   them at once, consistently, rather than N bespoke rewrites drifting apart from each other.
// ★ `variant="modal"` is the one deliberate exception: SLIDEUP-AUDIT.md names three controls whose
//   OWN frame is drawn as a `modal` (MoneyActions' cancel/update-card/grant-access, and
//   UpdateCardSheetMoneyUpdateCardSheet's own file) — "where the frame is a centred box, it stays
//   one." Same header shape (X / centred title / actions), different shell: a bounded, centred card
//   with a scrim, not a full-screen slide.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { useEscape, useFocusTrapLite } from "@/lib/hooks/useOverlay.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";
import SlideUpScreen from "@/lib/components/kit/archetypes/SlideUpScreen.jsx";
import DiscardGuard from "@/lib/components/editor/DiscardGuard.jsx";

function SheetHeader({ title, subtitle, onCancel, onSave, saveLabel, cancelLabel, busy, testId }) {
  return (
    // ★ the maintainer, 29 Sep 2026 — same fix as EditorHeader.jsx (found there first): a plain `1fr` track's
    //   implicit min-content floor can crush the centered title when the close-button/actions
    //   columns need more room than an equal share allows. `minmax(0,1fr)` is a no-op whenever the
    //   row already fits, so this changes nothing for the common 2-button case.
    <header className="relative grid h-(--size-editor-head) shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4.5 border-b border-line bg-surface px-7">
      <div className="justify-self-start">
        <button type="button" className="inline-flex size-(--size-filter) items-center justify-center rounded-pill border border-line bg-surface text-mute"
                onClick={() => onCancel?.()} disabled={busy} aria-label="Close" data-testid={`${testId}-close`}>
          <X strokeWidth={ICON_STROKE} className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-w-0 max-w-full justify-self-center text-center">
        <h2 className="m-0 truncate text-editor-name font-medium tracking-[-0.005em] text-ink" data-testid={`${testId}-title`}>{title}</h2>
        {subtitle && <p className="m-0 mt-0.5 truncate text-meta text-mute" data-testid={`${testId}-subtitle`}>{subtitle}</p>}
      </div>
      <div className="flex items-center justify-self-end gap-2">
        <Button type="button" variant="outline" onClick={() => onCancel?.()} disabled={busy} data-testid={`${testId}-cancel`}>{cancelLabel}</Button>
        {onSave && <Button type="submit" disabled={busy} data-testid={`${testId}-save`}>{busy ? "Saving…" : saveLabel}</Button>}
      </div>
    </header>
  );
}

export default function SideSheet({
  title = "", subtitle = null, onCancel = null, onSave = null, saveLabel = "Save", cancelLabel = "Cancel",
  busy = false, error = null, footer = null, children = null, testId = "side-sheet", variant = "slideUp",
  // ★ SAVE-SYSTEM BRIEF, 30 Sep 2026 (F825-everywhere) — OPT-IN, default `false`: every one of this
  //   component's ~45 existing callers is byte-for-byte unchanged until it starts passing its own
  //   `dirty`. `objectNoun` names what "Discard this ___?" reads (default "changes" reads fine
  //   generically; a caller can be more specific — "document", "client", "invoice").
  dirty = false, objectNoun = "changes",
}) {
  const panel = useRef(null);
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);

  // ★ Focus trap runs either way; the escape binding is below, once `requestCancelModal` exists — it
  //   is a no-op for `slideUp` on purpose: SlideUpScreen owns its OWN Escape internally (animates the
  //   exit before calling onClose), and this component never had a second listener for that variant.
  useFocusTrapLite(panel);

  // ★ Same two pieces EditorHeader.jsx already gives every full-page editor: a beforeunload warning
  //   for the browser tab, and a "Discard this ___?" confirmation before the in-app close actually
  //   runs — here, opt-in via `dirty`, since a SideSheet with nothing typed yet has nothing to lose.
  useEffect(() => {
    function onBeforeUnload(e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  // ★ For the modal variant there is no separate exit animation to protect — checking `dirty` right
  //   here, before ever calling the real `onCancel`, is the whole guard.
  const requestCancelModal = () => {
    if (dirty && !showDiscardGuard) { setShowDiscardGuard(true); return; }
    onCancel?.();
  };
  useEscape(() => { if (variant === "modal" && !busy) requestCancelModal(); });
  const discardGuard = (onConfirmDiscard) => (
    <DiscardGuard
      open={showDiscardGuard} onOpenChange={setShowDiscardGuard} objectNoun={objectNoun}
      onKeepEditing={() => setShowDiscardGuard(false)}
      onDiscard={() => { setShowDiscardGuard(false); onConfirmDiscard(); }}
      testId={`${testId}-discard-guard`}
    />
  );

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" role="presentation"
           onClick={(e) => { if (e.target === e.currentTarget && !busy) requestCancelModal(); }}>
        <form ref={panel} className="flex max-h-[85vh] w-(--size-modal) max-w-full flex-col rounded-modal bg-surface shadow-modal"
              role="dialog" aria-modal="true" aria-label={title} data-testid={testId}
              onSubmit={(e) => { e.preventDefault(); onSave?.(e); }}>
          <SheetHeader title={title} subtitle={subtitle} onCancel={requestCancelModal} onSave={onSave}
                       saveLabel={saveLabel} cancelLabel={cancelLabel} busy={busy} testId={testId} />
          <div className="flex-1 overflow-auto px-5.5 pt-1.5 pb-7.5">
            {children}
            {error && <p className="mt-3 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" role="alert">{error}</p>}
          </div>
          {footer}
        </form>
        {discardGuard(() => onCancel?.())}
      </div>
    );
  }

  // ★ SlideUpScreen's own rule (see that file's header comment): "A CHILD MUST ROUTE EVERY WAY IT CAN
  //   CLOSE... through the `requestClose` this component hands it" — `requestClose` starts the exit
  //   ANIMATION and only calls `onClose` (passed to SlideUpScreen below, unconditionally `onCancel`)
  //   once it finishes. So the dirty-check has to happen BEFORE `requestClose` is ever called, not by
  //   wrapping `onClose` — by then the sheet has already visually slid away with nothing to "keep
  //   editing" back to. `guardedRequestClose` is what the header's × / Cancel actually calls.
  return (
    <SlideUpScreen onClose={() => onCancel?.()} testId={testId}>
      {({ requestClose }) => {
        const guardedRequestClose = () => {
          if (dirty && !showDiscardGuard) { setShowDiscardGuard(true); return; }
          requestClose();
        };
        return (
          <form ref={panel} className="flex h-full min-h-0 flex-col"
                onSubmit={(e) => { e.preventDefault(); onSave?.(e); }}>
            <SheetHeader title={title} subtitle={subtitle} onCancel={guardedRequestClose} onSave={onSave}
                         saveLabel={saveLabel} cancelLabel={cancelLabel} busy={busy} testId={testId} />
            <div className="flex-1 overflow-auto px-7 pt-4 pb-10" data-testid={`${testId}-body`}>
              {children}
              {error && <p className="mt-3 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" role="alert">{error}</p>}
            </div>
            {footer}
            {discardGuard(requestClose)}
          </form>
        );
      }}
    </SlideUpScreen>
  );
}
