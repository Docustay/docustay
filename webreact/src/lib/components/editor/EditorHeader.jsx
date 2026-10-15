// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EditorHeader — close ×, the object's name (Fraunces 19px, kit2 .nm), meta line, verbs, overflow.
// Ported from webui/src/lib/components/editor/EditorHeader.svelte: same props, testids and rules — closing a
// dirty editor asks first (DiscardGuard); leaving the page with unsaved changes asks the browser to confirm.
// ★ the maintainer, 29 Sep 2026 — TITLE CENTRED. SLIDEUP-AUDIT.md's ruling for every Accounts/Clients/Money/
//   Services editor: "an X top-left, the title in the middle, the actions top-right, like Square's
//   New invoice." The title used to sit left-aligned right next to the X (a flex-1 div absorbing all
//   the leftover space) — close to the ruling but not centred. Now: X and verbs each get a fixed-width
//   flex-1 spacer of equal size (so the middle column is genuinely centred in the row, not just
//   "whatever's left of it"), and the title itself is centred text inside that middle column.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { Ellipsis, X } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import EditorName from "@/lib/components/kit/EditorName.jsx";
import DiscardGuard from "./DiscardGuard.jsx";
import { ICON_STROKE } from "@/lib/empty/icons.js";
import { AppStateContext } from "@/lib/app/useAppState.js";
import { requestDelete } from "@/lib/record/DeleteDialog.jsx";
import { deleteTypeForPath, isUuid, mayDelete } from "@/lib/record/deleteTypes.js";

export default function EditorHeader({ title, meta = "", verbs = [], onClose = null, dirty = false, objectNoun, testId = "editor-header" }) {
  const [guardOpen, setGuardOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // ★ THE SHARED DELETE (QUEUE §13.2): every editor drawn with this header gets "Delete" in its "…" menu, with NO per-editor code — when the page is
  //   /<list path>/<record id> for a type the server can delete and the viewer is Owner/Admin. A new (unsaved) editor has no id, so no Delete.
  const app = useContext(AppStateContext);
  const here = typeof window === "undefined" ? "" : window.location.pathname;
  const hereId = here.split("/").filter(Boolean).pop();
  const deleteType = isUuid(hereId) ? deleteTypeForPath(here) : null;
  const deleteVerb = deleteType && mayDelete(app?.nav?.rank ?? null) && !verbs.some((v) => v.label === "Delete")
    ? [{ label: "Delete", overflowOnly: true, onClick: () => requestDelete({ object: deleteType, id: hereId, label: typeof title === "string" ? title : null, onDone: () => onClose?.() }) }]
    : [];
  verbs = [...verbs, ...deleteVerb];
  const plainVerbs = verbs.filter((v) => v.kind !== "primary");
  // ★ the maintainer, 29 Sep 2026 (Square Contracts rebuild) — "Header: X · title · status · Preview · Save.
  //   Write with AI, Check it and Send a test go in one '…' menu." Purely additive and opt-in: a
  //   verb with `overflowOnly: true` still lists in `plainVerbs` (so it's in the dropdown), but is
  //   excluded from the inline row below. Every OTHER caller of this shared header (PackageEditor,
  //   ServiceEditor, PlanEditor…) never sets this flag, so their inline verbs are unchanged.
  const inlineVerbs = verbs.filter((v) => !v.overflowOnly);
  useEffect(() => {
    const h = (e) => { if (!dirty) return; e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const requestClose = () => { setOverflowOpen(false); if (dirty) { setGuardOpen(true); return; } onClose?.(); };
  const runVerb = (verb) => { setOverflowOpen(false); if (verb.disabled) return; verb.onClick?.(); };
  return (
    <>
      {/* ★ the maintainer, 29 Sep 2026 — FOUND LIVE: a plain `1fr` grid track carries an implicit min-content
          floor, so with enough header verbs (DocTemplateEditor's 5, the most of any editor) their
          column's own minimum plus the close-button column's forced-equal width consumed nearly the
          whole header, crushing the centered title's `auto` track down to a few px — it wrapped
          letter-by-letter. `minmax(0,1fr)` only changes behavior when the row is already too narrow
          to fit everything (every screen where it currently fits renders pixel-identical); it lets
          the title keep its space and the flanking columns shrink instead of hijacking it. */}
      <header className="relative grid h-(--size-editor-head) shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4.5 border-b border-line bg-surface px-7" data-testid={testId}>
        <div className="justify-self-start">
          <button type="button" className="inline-flex size-(--size-filter) items-center justify-center rounded-pill border border-line bg-surface text-mute"
                  data-testid={`${testId}-close`} onClick={requestClose} aria-label="Close"><X strokeWidth={ICON_STROKE} className="size-4" aria-hidden="true" /></button>
        </div>
        <div className="min-w-0 max-w-full justify-self-center text-center">
          <EditorName as="h1" testId={`${testId}-title`}>{title}</EditorName>
          {meta && <p className="m-0 mt-0.5 text-meta text-mute" data-testid={`${testId}-meta`}>{meta}</p>}
        </div>
        <div className="flex min-w-0 items-center justify-self-end gap-2 overflow-x-auto" data-testid={`${testId}-verbs`}>
          {inlineVerbs.map((verb) => (
            <Button key={verb.label} type="button" variant={verb.kind === "primary" ? "default" : "outline"} data-testid={`${testId}-verb-${verb.label}`}
                    disabled={verb.disabled} onClick={() => runVerb(verb)}>{verb.label}</Button>
          ))}
          {plainVerbs.length > 0 && (
            <Button type="button" variant="outline" size="icon" data-testid={`${testId}-more`} aria-expanded={overflowOpen} aria-label="More actions" onClick={() => setOverflowOpen((o) => !o)}>
              <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
            </Button>
          )}
        </div>
        {overflowOpen && (
          <div className="absolute top-full right-7 z-20 mt-1 flex min-w-48 flex-col rounded-control border border-line bg-surface p-1 shadow-modal" data-testid={`${testId}-overflow`} role="menu">
            {plainVerbs.map((verb) => (
              <button key={verb.label} type="button" className="rounded-sm px-3 py-2 text-left text-ui text-ink hover:bg-paper disabled:opacity-50"
                      data-testid={`${testId}-overflow-${verb.label}`} disabled={verb.disabled} role="menuitem" onClick={() => runVerb(verb)}>{verb.label}</button>
            ))}
          </div>
        )}
      </header>
      <DiscardGuard open={guardOpen} onOpenChange={setGuardOpen} objectNoun={objectNoun} onDiscard={() => onClose?.()} />
    </>
  );
}
