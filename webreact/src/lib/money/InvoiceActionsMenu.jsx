// ═══════════════════════════════════════════════════════════════════════════════════════════════
// InvoiceActionsMenu — the "…" menu on an invoice (record + list row). No Svelte source: behaviour
// comes from the WIRING-MAP §3.3 rows for these testids (each frame's own "What every control on
// this frame does" block, quoted below) and from PHASE-3.md's rules for P3.U1 (W1).
//
// Menu contents by invoice.status (PHASE-3.md field 4):
//   draft              → Delete draft, Duplicate
//   open                → everything but Delete draft
//   paid                → Download PDF, Duplicate, Issue a credit note, Void + Mark uncollectible
//                          DISABLED with the frames' reasons
//   void / uncollectible → Download PDF, Duplicate
//
// ★★★ "a write the viewer may not make renders nothing" (useWrite(...).hidden) — every money action
//     here, INCLUDING Duplicate, is gated by its OWN real route declaration (routePermissions.json);
//     this component never invents a softer rule for one item than another. Download PDF is a GET,
//     never a useWrite, and is the one control every state keeps.
// ★ Mark as paid / Attach a payment / Issue a credit note are OPENED here (MarkPaidDialog,
//   AttachPaymentSheet, CreditNoteSheet — each another task's file, reached only via fileComponent
//   inside its own <Suspense>, DISPATCH.md). This component performs their permission/blocked check
//   (same routes, so the item can be hidden/disabled correctly) but never their write.
// ★ Void and Mark uncollectible confirm through DecisionModal, in this file, using the outcome each
//   frame's wiring-doc block records for that control; each renders its own write.error inline.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Suspense, useState } from "react";
import { Ellipsis } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/lib/components/ui/button.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/lib/components/ui/dropdown-menu.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { fileComponent } from "@/lib/app/lazyScreens.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

const MarkPaidDialog = fileComponent("lib/money/MarkPaidDialog.jsx");
const AttachPaymentSheet = fileComponent("lib/money/AttachPaymentSheet.jsx");
const CreditNoteSheet = fileComponent("lib/money/CreditNoteSheet.jsx");

const STRIPE_FIRST_REASON = "Connect Stripe first — Settings › Money.";
const VOID_PAID_REASON = "A paid invoice can't be voided — issue a credit note instead.";
const UNCOLLECTIBLE_OPEN_ONLY_REASON = "Only an open invoice can be written off.";

/** write.error is an ApiError — the server's own message, plus its request id (InvoiceActionsStates.frame.html). */
function writeErrorNode(error) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute">Reference {error.requestId} — nothing changed.</span>
        </>
      )}
    </>
  );
}

/** One menu row: hidden → nothing; blocked → disabled with its reason; else the active item. */
function ActionItem({ testId, label, write, onSelect, shortcut = null }) {
  if (write.hidden) return null;
  if (write.blocked) {
    // ★ `${testId}-blocked` (never `testId` itself) — the same split WriteButton.jsx uses — so the
    //   disabled item keeps its own plain testid instead of sharing one with DisabledWithReason's wrapper.
    return (
      <DisabledWithReason disabled reason={write.blocked.reason} testId={`${testId}-blocked`}>
        {({ describedBy }) => (
          <DropdownMenuItem data-testid={testId} disabled aria-describedby={describedBy} onSelect={(e) => e.preventDefault()}>
            {label}
          </DropdownMenuItem>
        )}
      </DisabledWithReason>
    );
  }
  return (
    <DropdownMenuItem data-testid={testId} onSelect={onSelect}>
      {label}
      {shortcut && <span className="ml-auto text-meta text-mute">{shortcut}</span>}
    </DropdownMenuItem>
  );
}

export default function InvoiceActionsMenu({ invoice, onChanged, stripeConnected = true }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // "void" | "uncollectible" | null
  const [sheet, setSheet] = useState(null); // "mark-paid" | "attach-payment" | "credit-note" | null

  // ★ Hooks run unconditionally (Rules of Hooks) even while `invoice` has not loaded yet — the
  //   loading render below is chosen AFTER every useWrite has been called, never before.
  const ownerId = invoice?.ownerId ?? null;
  const status = invoice?.status ?? "open";
  const isDraft = status === "draft";
  const isOpen = status === "open";
  const isPaid = status === "paid";

  const duplicate = useWrite("duplicateInvoice", { ownerId });
  const reminders = useWrite("toggleInvoiceReminders", { ownerId });
  const markPaid = useWrite("markInvoicePaid", { ownerId, blockedReason: !stripeConnected ? STRIPE_FIRST_REASON : null });
  const attachPayment = useWrite("attachPaymentToInvoice", { ownerId, blockedReason: !stripeConnected ? STRIPE_FIRST_REASON : null });
  const creditNote = useWrite("issueCreditNote", { ownerId });
  const uncollectible = useWrite("markInvoiceUncollectible", {
    ownerId, blockedReason: !isOpen ? UNCOLLECTIBLE_OPEN_ONLY_REASON : null,
  });
  const voidWrite = useWrite("voidInvoice", { ownerId, blockedReason: isPaid ? VOID_PAID_REASON : null });
  const deleteDraft = useWrite("deleteDraftInvoice", { ownerId });

  // ★ Everything from here on reads `invoice` fields directly, so the "not loaded yet" render (below,
  //   AFTER every hook above has already run) has to come before any of it is defined.
  if (!invoice) {
    return (
      <Button variant="ghost" size="icon-sm" disabled aria-busy="true" data-testid="invoice-actions-menu" aria-label="Invoice actions">
        <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
      </Button>
    );
  }

  const close = () => setOpen(false);

  const withToast = (write, args, okLabel) => async () => {
    close();
    try {
      await write.run(args);
      toast.success(okLabel);
      onChanged?.();
    } catch {
      toast.error(okLabel, { description: write.error?.message ?? "Action failed" });
    }
  };

  const runDuplicate = withToast(duplicate, { invoiceId: invoice.id }, "Invoice duplicated");
  const runToggleReminders = withToast(
    reminders,
    { invoiceId: invoice.id, enabled: invoice.remindersEnabled === false },
    invoice.remindersEnabled === false ? "Reminders turned on" : "Reminders turned off",
  );
  const runDeleteDraft = withToast(deleteDraft, { invoiceId: invoice.id }, "Draft deleted");

  const confirmVoid = async () => {
    try {
      await voidWrite.run({ invoiceId: invoice.id });
      setConfirm(null);
      onChanged?.();
    } catch {
      // voidWrite.error renders inline below — the surface stays open (InvoiceActions.frame.html).
    }
  };

  const confirmUncollectible = async () => {
    try {
      await uncollectible.run({ invoiceId: invoice.id });
      setConfirm(null);
      onChanged?.();
    } catch {
      // uncollectible.error renders inline below — the surface stays open.
    }
  };

  const downloadHref = `/api/money/invoices/${encodeURIComponent(invoice.id)}/pdf`;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" data-testid="invoice-actions-menu" aria-label="Invoice actions">
            <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isDraft && (
            <DropdownMenuItem data-testid="invoice-action-download-pdf" asChild>
              <a href={downloadHref} target="_blank" rel="noreferrer">Download PDF</a>
            </DropdownMenuItem>
          )}

          <ActionItem testId="invoice-action-duplicate" label="Duplicate" write={duplicate} onSelect={runDuplicate} shortcut="⌘D" />

          {isDraft && (
            <ActionItem testId="invoice-action-delete-draft" label="Delete draft" write={deleteDraft} onSelect={runDeleteDraft} />
          )}

          {isOpen && (
            <>
              <ActionItem
                testId="invoice-action-reminders-off"
                label={invoice.remindersEnabled === false ? "Turn on reminders for this invoice" : "Turn off reminders for this invoice"}
                write={reminders}
                onSelect={runToggleReminders}
              />
              {(!markPaid.hidden || !attachPayment.hidden || !creditNote.hidden) && <DropdownMenuSeparator />}
              <ActionItem testId="invoice-action-mark-paid" label="Mark as paid" write={markPaid} onSelect={() => { close(); setSheet("mark-paid"); }} />
              <ActionItem testId="invoice-action-attach-payment" label="Attach a payment" write={attachPayment} onSelect={() => { close(); setSheet("attach-payment"); }} />
              <ActionItem testId="invoice-action-credit-note" label="Issue a credit note" write={creditNote} onSelect={() => { close(); setSheet("credit-note"); }} />
              {(!uncollectible.hidden || !voidWrite.hidden) && <DropdownMenuSeparator />}
              <ActionItem testId="invoice-action-uncollectible" label="Mark uncollectible" write={uncollectible} onSelect={() => { close(); setConfirm("uncollectible"); }} />
              <ActionItem testId="invoice-action-void" label="Void" write={voidWrite} onSelect={() => { close(); setConfirm("void"); }} />
            </>
          )}

          {isPaid && (
            <>
              {!creditNote.hidden && <DropdownMenuSeparator />}
              <ActionItem testId="invoice-action-credit-note" label="Issue a credit note" write={creditNote} onSelect={() => { close(); setSheet("credit-note"); }} />
              {(!uncollectible.hidden || !voidWrite.hidden) && <DropdownMenuSeparator />}
              <ActionItem testId="invoice-action-uncollectible" label="Mark uncollectible" write={uncollectible} onSelect={() => { close(); setConfirm("uncollectible"); }} />
              <ActionItem testId="invoice-action-void" label="Void" write={voidWrite} onSelect={() => { close(); setConfirm("void"); }} />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DecisionModal
        open={confirm === "void"}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title="Void this invoice?"
        rows={[{ headline: "The invoice becomes Void.", detail: "Stripe voids it first; if that fails nothing here changes. The activity line will name who voided it and why." }]}
        cancelLabel="Keep invoice"
        confirmLabel="Void invoice"
        danger
        busy={voidWrite.busy}
        error={writeErrorNode(voidWrite.error)}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmVoid}
        testId="invoice-void-confirm"
      />

      <DecisionModal
        open={confirm === "uncollectible"}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title="Mark this invoice uncollectible?"
        rows={[{ headline: "The invoice becomes Uncollectible.", detail: "The status chip changes to Uncollectible and the outstanding total drops." }]}
        cancelLabel="Keep invoice"
        confirmLabel="Mark uncollectible"
        danger
        busy={uncollectible.busy}
        error={writeErrorNode(uncollectible.error)}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmUncollectible}
        testId="invoice-uncollectible-confirm"
      />

      {/* Each opens with its OWN useWrite (same route this menu already checked to draw its item) and
          returns null while its own `open` is false — mounted once, shown via `open`, exactly as
          MarkPaidDialog.stories.jsx/CreditNoteSheet.stories.jsx exercise them. */}
      <Suspense fallback={<AppSpinner label="Loading…" />}>
        <MarkPaidDialog invoice={invoice} open={sheet === "mark-paid"}
                        onOpenChange={(v) => setSheet(v ? "mark-paid" : null)}
                        onPaid={() => { setSheet(null); onChanged?.(); }} />
      </Suspense>
      <Suspense fallback={<AppSpinner label="Loading…" />}>
        <AttachPaymentSheet invoice={invoice} open={sheet === "attach-payment"}
                            onOpenChange={(v) => setSheet(v ? "attach-payment" : null)}
                            onAttached={() => { setSheet(null); onChanged?.(); }} />
      </Suspense>
      <Suspense fallback={<AppSpinner label="Loading…" />}>
        <CreditNoteSheet invoice={invoice} open={sheet === "credit-note"}
                         onOpenChange={(v) => setSheet(v ? "credit-note" : null)}
                         onIssued={() => { setSheet(null); onChanged?.(); }} />
      </Suspense>
    </>
  );
}
