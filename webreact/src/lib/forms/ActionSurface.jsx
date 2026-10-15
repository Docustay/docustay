// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ActionSurface — the one form surface every action opens (drawer · dialog · confirm). Ported from
// webui/src/lib/forms/ActionSurface.svelte: same props, the same ten testids built from `testId`
// (TESTID-CONTRACT §3), same copy, same rules:
//   · BUSY IS A LOCK: submit disabled and labelled "Saving…", scrim/close/Escape do nothing
//     (db/gates/a0_3_surface_refetches.mjs: "a double-submit creates two clients")
//   · a dirty form asks before it is thrown away ("Discard what you have typed?")
//   · focus goes to the first field on open and back to the opener on close
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { useEscape, useFocusTrapLite } from "@/lib/hooks/useOverlay.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

function snapshot(form) {
  if (!form) return null;
  const parts = [];
  for (const el of form.elements) {
    if (!el.name && !el.id) continue;
    const key = el.name || el.id;
    const type = (el.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") parts.push(`${key}=${el.checked ? 1 : 0}`);
    else if (type === "file") parts.push(`${key}=${el.files?.length ?? 0}`);
    else parts.push(`${key}=${el.value ?? ""}`);
  }
  return parts.join("\u0001");
}

const PANEL = {
  drawer: "h-full w-(--size-sheet) max-w-full self-stretch ml-auto shadow-sheet",
  dialog: "w-(--size-modal) max-w-[calc(100vw-2rem)] rounded-modal shadow-modal",
  confirm: "w-(--size-modal) max-w-[calc(100vw-2rem)] rounded-modal shadow-modal",
};

export default function ActionSurface({
  kind = "drawer", title, busy = false, error = null, onCancel = null, onSubmit = null, submitLabel = "Save",
  busyLabel = null, cancelLabel = "Cancel", submitDisabled = false, testId = "action-surface", dismissable = true,
  children = null, footerNote = null, dirty = null,
}) {
  const panel = useRef(null);
  const baseline = useRef(null);
  const [interacted, setInteracted] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  useFocusTrapLite(panel);
  useEffect(() => { if (panel.current && baseline.current === null) baseline.current = snapshot(panel.current); }, []);
  const isDirty = () => dirty ?? (interacted && baseline.current !== null && snapshot(panel.current) !== baseline.current);
  const dismiss = () => {
    if (busy || !dismissable) return;
    if (isDirty() && !confirmingDiscard) { setConfirmingDiscard(true); return; }
    setConfirmingDiscard(false);
    onCancel?.();
  };
  useEscape(dismiss);
  return (
    <div className={`fixed inset-0 z-50 flex bg-scrim ${kind === "drawer" ? "justify-end" : "items-center justify-center"}`}
         data-kind={kind} data-testid={`${testId}-scrim`} role="presentation"
         onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <form ref={panel} className={`flex flex-col bg-surface ${PANEL[kind] ?? PANEL.drawer}`} data-kind={kind} data-testid={testId}
            role="dialog" aria-modal="true" aria-label={title} aria-busy={busy ? "true" : undefined}
            onSubmit={(e) => { e.preventDefault(); if (!busy && !submitDisabled) onSubmit?.(e); }}
            onInput={() => setInteracted(true)} onChange={() => setInteracted(true)}>
        <header className="flex shrink-0 items-center gap-3.5 border-b border-line px-5.5 py-4">
          <h2 className="m-0 flex-1 text-sheet-title font-medium text-ink">{title}</h2>
          {dismissable && (
            <button type="button" className="inline-flex size-(--size-filter) items-center justify-center rounded-pill border border-line bg-surface text-mute"
                    data-testid={`${testId}-close`} onClick={dismiss} disabled={busy} aria-label="Close">
              <X strokeWidth={ICON_STROKE} className="size-4" aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="flex-1 overflow-auto px-5.5 py-4">
          {children}
          {error && <p className="mt-3 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" data-testid={`${testId}-error`} role="alert">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line px-5.5 py-4">
          {confirmingDiscard ? (
            <>
              <p className="m-0 mr-auto text-meta text-ink-2" data-testid={`${testId}-discard-note`} role="alert">Discard what you have typed?</p>
              <Button type="button" variant="outline" data-testid={`${testId}-discard-keep`} onClick={() => setConfirmingDiscard(false)}>Keep editing</Button>
              <Button type="button" variant="destructive" data-testid={`${testId}-discard-confirm`} onClick={() => { setConfirmingDiscard(false); onCancel?.(); }}>Discard</Button>
            </>
          ) : (
            <>
              {footerNote && <p className="m-0 mr-auto text-meta text-mute" data-testid={`${testId}-note`}>{footerNote}</p>}
              {cancelLabel && <Button type="button" variant="outline" data-testid={`${testId}-cancel`} onClick={dismiss} disabled={busy}>{cancelLabel}</Button>}
              <Button type="submit" data-testid={`${testId}-submit`} disabled={busy || submitDisabled}>{busy ? (busyLabel ?? "Saving…") : submitLabel}</Button>
            </>
          )}
        </footer>
      </form>
    </div>
  );
}
