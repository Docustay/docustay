// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EstimateSheet — "New estimate" (P3.U11 · W4). New component, no Svelte source: ported from
// specs/mockups/EstimateNew.frame.html (structure, order, labels, every text run) and the frame's
// generated wiring-doc block (§3.3/§3.4) for the `estimate-save` / `estimate-action-cancel` /
// `estimate-download-pdf` testids. Opens from Money › Estimates (the frame's own breadcrumb) — unlike
// StartSubscriptionSheet/AttachPaymentSheet/PauseDialog, there is no host record to hand in a
// recipient, so this sheet finds its own.
//
// Two views, one sheet:
//   · CREATE — the frame's own form: For (Client, Title) · Lines (Add, Discount) · When they accept
//     (Then, Agreement) · Terms (Good for, Message). "Save as draft" calls createEstimate.
//     · Client is a Combobox over `api.view("/people/clients")` — the same api.view(...) idiom
//       StartSubscriptionSheet.jsx already uses for a PICKER's options (its `api.view("/items/plans")`),
//       not a list screen; rows keep the read's own snake_case field names.
//     · "Add"/"Discount" are UI-only: createEstimate's body (api.js) carries no lines/discount field —
//       the same "UI-only until a later task carries it onto the wire" idiom as PauseDialog's resume
//       date. Nothing typed here is sent.
//     · "Agreement" IS real — createEstimate accepts `documentTemplateId` — but with no landed
//       template-list read to build a picker from, it is a plain field: what's typed is sent verbatim
//       (or omitted when blank, `documentTemplateId: null`, exactly createEstimate's own default).
//   · SAVED — once "Save as draft" succeeds, the sheet re-reads the estimate through estimateEditor
//     (GET /api/money/estimates/:id/editor) and shows it: a StatusBadge, "Cancel estimate"
//     (DecisionModal → cancelEstimate — Stripe-first; a refusal rolls the transaction back and the
//     modal stays open showing Stripe's own reason + reference) and "Download PDF" — a plain link
//     (GET, never permission-gated), same precedent as InvoiceActionsMenu's Download PDF.
// Each write renders write.error. `onCreated` fires once, right after createEstimate succeeds.
// ★ A PERMISSION renders nothing (WriteButton/useWrite `hidden`); a missing PREREQUISITE (no
//   recipient/title chosen yet, or the estimate is already cancelled) renders DISABLED WITH THE
//   REASON (DisabledWithReason, via WriteButton's `blocked`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import { api } from "@/lib/api.js";

const THEN_LABEL = { invoice: "Send an invoice", plan: "Start their plan" };

/** write.error is an ApiError — the server's own message, plus its request id (StartSubscriptionSheet's
 *  own writeErrorNode idiom, the named house-style sibling). */
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

export default function EstimateSheet({ open, onOpenChange, onCreated }) {
  // ── create-mode fields (For / Lines / When they accept / Terms) ──────────────────────────────
  const [recipientId, setRecipientId] = useState(null);
  const [title, setTitle] = useState("");
  const [addLine, setAddLine] = useState(null); // UI-only — see header note
  const [discount, setDiscount] = useState(""); // UI-only — see header note
  const [thenChoice, setThenChoice] = useState("invoice"); // "invoice" | "plan"
  const [agreement, setAgreement] = useState("");
  const [goodForDays, setGoodForDays] = useState(30);
  const [message, setMessage] = useState("");

  const [recipients, setRecipients] = useState({ loading: false, error: null, data: [] });
  const [saved, setSaved] = useState(null); // the created estimate, once Save as draft succeeds
  const [editor, setEditor] = useState({ loading: false, error: null });
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecipientId(null); setTitle(""); setAddLine(null); setDiscount("");
    setThenChoice("invoice"); setAgreement(""); setGoodForDays(30); setMessage("");
    setSaved(null); setEditor({ loading: false, error: null }); setConfirmCancel(false);
  }, [open]);

  function refreshRecipients() {
    setRecipients((r) => ({ ...r, loading: true, error: null }));
    api.view("/people/clients")
      .then((r) => setRecipients({ loading: false, error: null, data: r?.data?.rows ?? [] }))
      .catch((err) => setRecipients({ loading: false, error: err, data: [] }));
  }
  useEffect(() => { if (open) refreshRecipients(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  async function loadEditor(id) {
    setEditor({ loading: true, error: null });
    try {
      const data = await api.estimateEditor(id);
      setSaved((s) => ({ ...s, ...data, id }));
      setEditor({ loading: false, error: null });
    } catch (err) {
      setEditor({ loading: false, error: err });
    }
  }

  const create = useWrite("createEstimate", {
    blockedReason: !recipientId
      ? "Choose who this estimate is for."
      : !title.trim()
        ? "Give the estimate a title."
        : null,
  });
  const cancelWrite = useWrite("cancelEstimate", {
    blockedReason: saved?.status === "cancelled" ? "This estimate is already cancelled." : null,
  });

  if (!open) return null;

  async function handleSave() {
    const result = await create.run({
      recipientUserId: recipientId,
      title: title.trim(),
      message: message.trim() || undefined,
      goodForDays: Number(goodForDays) || 30,
      onAcceptInvoice: thenChoice === "invoice",
      onAcceptRecord: thenChoice === "plan",
      documentTemplateId: agreement.trim() || null,
    });
    onCreated?.(result);
    const id = result?.id ?? result?.estimateId ?? null;
    setSaved({
      id, title: title.trim(), status: result?.status ?? "draft", goodForDays: Number(goodForDays) || 30,
      recipientName: recipients.data.find((p) => p.id === recipientId)?.display_name
        ?? recipients.data.find((p) => p.id === recipientId)?.displayName ?? null,
    });
    if (id) await loadEditor(id);
  }

  async function confirmCancelEstimate() {
    try {
      await cancelWrite.run({ estimateId: saved.id });
      setSaved((s) => ({ ...s, status: "cancelled" }));
      setConfirmCancel(false);
    } catch {
      // cancelWrite.error renders inline, in the DecisionModal below — the surface stays open.
    }
  }

  const recipientOptions = recipients.data.map((p) => ({
    value: p.id, label: p.display_name ?? p.displayName ?? p.name ?? String(p.id),
  }));
  const pdfHref = saved?.id ? `/api/money/estimates/${encodeURIComponent(saved.id)}/pdf` : null;

  return (
    <>
      <SideSheet
        title={saved ? `Estimate — ${saved.title || "Untitled"}` : "New estimate"}
        testId="estimate-new"
        error={!saved ? writeErrorNode(create.error) : null}
        onCancel={() => onOpenChange?.(false)}
        footer={saved ? (
          <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-2.5 border-t border-line bg-surface px-5.5 py-4">
            <a href={pdfHref} target="_blank" rel="noreferrer" className="text-ui text-brand underline" data-testid="estimate-download-pdf">
              Download PDF
            </a>
            <div className="flex gap-2.5">
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Close</Button>
              <WriteButton write={cancelWrite} testId="estimate-action-cancel" variant="destructive"
                           onClick={() => setConfirmCancel(true)}>
                Cancel estimate
              </WriteButton>
            </div>
          </footer>
        ) : (
          <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
            <WriteButton write={create} testId="estimate-save" onClick={handleSave}>Save as draft</WriteButton>
          </footer>
        )}
      >
        {saved ? (
          <>
            <div className="mb-3 flex items-center gap-2.5">
              <StatusBadge label={saved.status === "cancelled" ? "Cancelled" : "Draft"}
                           tone={saved.status === "cancelled" ? "bad" : "act"} testId="estimate-new-status" />
            </div>
            {editor.loading && <Skeleton className="h-9 w-full" data-testid="estimate-new-editor-loading" />}
            {editor.error && (
              <ErrorPanel error={editor.error} subject="Estimate" onRetry={() => loadEditor(saved.id)}
                          testId="estimate-new-editor-error" />
            )}

            <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">For</div>
            <SheetRow label="Client">
              <p className="m-0 text-field text-ink-2" data-testid="estimate-new-recipient-readonly">
                {saved.recipientName ?? "—"}
              </p>
            </SheetRow>
            <SheetRow label="Title">
              <p className="m-0 text-field text-ink-2">{saved.title}</p>
            </SheetRow>

            <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Terms</div>
            <SheetRow label="Good for">
              <Figure size="sm" testId="estimate-new-good-for-figure">{saved.goodForDays ?? goodForDays} days</Figure>
            </SheetRow>
          </>
        ) : (
          <>
            <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">For</div>
            <SheetRow label="Client">
              {recipients.loading ? (
                <Skeleton className="h-9 w-full" data-testid="estimate-new-recipient-loading" />
              ) : recipients.error ? (
                <ErrorPanel error={recipients.error} subject="People" onRetry={refreshRecipients}
                            testId="estimate-new-recipient-error" />
              ) : (
                <Combobox testId="estimate-new-recipient" value={recipientId} options={recipientOptions}
                          onValueChange={setRecipientId} placeholder="Search people" emptyText="No clients yet." />
              )}
            </SheetRow>
            <SheetRow label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder="Twelve-week programme" data-testid="estimate-new-title" />
            </SheetRow>

            <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Lines</div>
            <SheetRow label="Add">
              <Combobox testId="estimate-new-add-line" value={addLine} options={[]} onValueChange={setAddLine}
                        placeholder="Service, package or plan" emptyText="Nothing to add yet — lines join a later task." />
            </SheetRow>
            <SheetRow label="Discount">
              <Input value={discount} onChange={(e) => setDiscount(e.target.value)}
                     placeholder="Optional" data-testid="estimate-new-discount" />
            </SheetRow>

            <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">When they accept</div>
            <SheetRow label="Then">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between" data-testid="estimate-new-then">
                    {THEN_LABEL[thenChoice]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem data-testid="estimate-new-then-invoice" onSelect={() => setThenChoice("invoice")}>
                    Send an invoice
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="estimate-new-then-plan" onSelect={() => setThenChoice("plan")}>
                    Start their plan
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SheetRow>
            <SheetRow label="Agreement">
              <Input value={agreement} onChange={(e) => setAgreement(e.target.value)}
                     placeholder="Send Coaching agreement v3 to sign" data-testid="estimate-new-agreement" />
            </SheetRow>

            <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Terms</div>
            <SheetRow label="Good for">
              <div className="flex items-center gap-3">
                <Input type="number" min={1} value={goodForDays} onChange={(e) => setGoodForDays(e.target.value)}
                       className="w-20" data-testid="estimate-new-good-for" />
                <Figure size="sm" testId="estimate-new-good-for-figure">{goodForDays} days</Figure>
              </div>
            </SheetRow>
            <SheetRow label="Message">
              <Input value={message} onChange={(e) => setMessage(e.target.value)}
                     placeholder="Optional — shown above the lines" data-testid="estimate-new-message" />
            </SheetRow>
          </>
        )}
      </SideSheet>

      <DecisionModal
        open={confirmCancel}
        onOpenChange={(v) => { if (!v) setConfirmCancel(false); }}
        title="Cancel this estimate?"
        rows={[{
          headline: "The estimate becomes Cancelled.",
          detail: "Stripe cancels it first; if that fails nothing here changes. The client's link will say so.",
        }]}
        cancelLabel="Keep estimate"
        confirmLabel="Cancel estimate"
        danger
        busy={cancelWrite.busy}
        error={writeErrorNode(cancelWrite.error)}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={confirmCancelEstimate}
        testId="estimate-cancel-confirm"
      />
    </>
  );
}
