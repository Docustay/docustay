// ═══════════════════════════════════════════════════════════════════════════════════════════════
// InvoiceEditorSlideUp — the "New invoice" ?new=1 surface, now opening the REAL invoice editor
// (SLIDEUP-AUDIT.md headline finding: InvoiceEditor.jsx, 863 lines, R6.035 — was built, nothing ever
// opened it; "New invoice" opened InvoiceDrawer.jsx instead, 253 lines, no frame at all). This is a
// thin adapter: routes.js's `?new=1` surfaces hand a component {onCancel, onDone, initialPayerUserId,
// ...} — InvoiceEditor itself takes route-shaped props ({path, params, app, onNavigate, onRefetch})
// because it was built to BE a route (R6.035's own header comment says as much). Rather than rewrite
// InvoiceEditor's internals to a different prop shape, this adapts the surface call into the route
// call it already expects, and wraps it in SlideUpScreen for the shell the maintainer's ruling asks for.
// ★ the maintainer, 29 Sep 2026 — SlideUpScreen's `requestClose` (its render-prop) is what InvoiceEditor's own
//   onNavigate is wired to, NOT onCancel/onDone directly — calling those directly would skip
//   SlideUpScreen's exit animation, since IT is what's actually mounted in the surface slot; only
//   after its own exit finishes does it call the real onClose, deferred here to `onCancel` (Escape,
//   with nothing pending) or `onDone` (InvoiceEditor decided to leave — every onNavigate call in it
//   targets /money/invoices, i.e. "this interaction is over," which in this surface is "done").
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef } from "react";
import SlideUpScreen from "@/lib/components/kit/archetypes/SlideUpScreen.jsx";
import InvoiceEditor from "./InvoiceEditor.jsx";

// ★ the maintainer, 29 Sep 2026 — F818: this adapter only ever passed `id: "new"` — there was no way to open
//   THIS surface for an EXISTING draft. Combined with MoneyInvoiceRecord.jsx having no edit
//   entry point either (grepped: no "Edit" action anywhere in it), a saved draft was a dead end —
//   the invoices list's own row click (MoneyInvoicesInvoicesList.jsx) took every row, draft or
//   not, to the read-only record page, which never offered a way back into the editor. Found live
//   testing the F815/F816 fixes: saved a draft, could not reopen it to finish and send it.
//   `invoiceId` is optional and additive — every existing `?new=1` caller (AccountRecord.jsx,
//   PersonRecord.jsx, Home) keeps creating a blank invoice exactly as before.
export default function InvoiceEditorSlideUp({ initialPayerUserId = null, invoiceId = null, onCancel = null, onDone = null }) {
  const pendingAction = useRef("cancel");
  const id = invoiceId || "new";

  return (
    <SlideUpScreen
      onClose={() => (pendingAction.current === "done" ? onDone?.() : onCancel?.())}
      testId="invoice-editor-slideup"
    >
      {({ requestClose }) => (
        <InvoiceEditor
          path={`/money/invoices/${id}`}
          params={{ id }}
          app={null}
          onNavigate={() => { pendingAction.current = "done"; requestClose(); }}
          onRefetch={() => {}}
          initialPayerUserId={initialPayerUserId}
        />
      )}
    </SlideUpScreen>
  );
}
