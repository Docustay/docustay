// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.013.M2 — DocsSendSendDocumentSheet2Sheet. Compose/form sheet for sending documents.
// Ported from webui/src/lib/screens/documents/DocsSend.svelte:164-326 (the {:else} block, phase !== "sent")
// Props: { open, onOpenChange, templates, people, onCancel, ATTACH_REASON, templateId, subjectUserId,
//          message, remind, attachTo, busy, problem, template, templateOptions, subject, subjectName, ready, send }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function DocsSendSendDocumentSheet2Sheet({
  open = false,
  onOpenChange = null,
  templates = [],
  people = [],
  onCancel = null,
  ATTACH_REASON = "",
  templateId = "",
  subjectUserId = "",
  message = "",
  remind = true,
  attachTo = "none",
  busy = false,
  problem = null,
  template = null,
  templateOptions = [],
  templateNote = null,
  subject = null,
  subjectName = null,
  ready = false,
  send = null,
  onTemplateChange = null,
  onSubjectChange = null,
  onMessageChange = null,
  onRemindChange = null,
  onAttachToChange = null,
}) {
  if (!open) return null;

  const handleCancel = () => {
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleSend = (e) => {
    e?.preventDefault?.();
    send?.();
  };

  return (
    <SideSheet
      title={`Send ${template?.name ?? "a document"}`}
      subtitle={
        subject
          ? `To ${subjectName}. They'll get an email with a link — no account needed to read or sign it.`
          : null
      }
      error={problem}
      busy={busy}
      testId="send-document-sheet"
      onCancel={handleCancel}
      onSave={handleSend}
      saveLabel={busy ? "Sending…" : "Send it"}
      footer={
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !ready}
            data-testid="send-submit"
          >
            {busy ? "Sending…" : "Send it"}
          </Button>
        </footer>
      }
    >
      {/* ★ the maintainer, 29 Sep 2026 (Square critique) — SheetRow/SheetSection carry no max-width of their own
          (by design: SideSheet's body is full-bleed so a wide table or multi-column layout can use
          it), so on a large screen this form's fields stretched edge to edge instead of reading as a
          comfortable, centered column the way Square's own slide-up forms do. Capped here, at this
          call site only — SideSheet.jsx and SheetRow.jsx are shared by every create/edit sheet in the
          app (Accounts, Clients, Money…) and are deliberately left alone. */}
      <div className="mx-auto max-w-160">
        <SheetSection>
          <SheetRow label="Document">
            {templates.length ? (
              <Combobox
                id="send-template"
                testId="send-template"
                options={templateOptions}
                value={templateId}
                disabled={busy}
                emptyText="No matches."
                onValueChange={onTemplateChange}
              />
            ) : (
              <p className="m-0 text-meta text-mute" data-testid="send-template-empty">
                No templates yet — create one under Documents.
              </p>
            )}
            {templateNote && (
              <p className="m-0 mt-1.5 text-meta text-warn" data-testid="send-template-label-note">{templateNote}</p>
            )}
          </SheetRow>
        </SheetSection>

        <SheetSection>
          <SheetRow label="Who">
            <Combobox
              id="send-who"
              testId="send-who"
              options={people.map((p) => ({
                value: p.id,
                label: p.display_name ?? p.name,
              }))}
              value={subjectUserId}
              disabled={busy}
              emptyText="Nobody to send to yet."
              onValueChange={onSubjectChange}
            />
          </SheetRow>
        </SheetSection>

        <SheetSection>
          <fieldset
            className="border-0 p-0 m-0 flex items-start gap-5"
            data-testid="send-attach-to"
          >
            <legend className="w-(--size-field-label) shrink-0 pt-2.5 text-ui text-ink-2">
              Attach it to
            </legend>
            <div className="min-w-0 flex-1 space-y-2">
              <label className="flex items-center gap-3">
                <input
                  type="radio"
                  name="attach-to"
                  value="none"
                  checked={attachTo === "none"}
                  disabled={busy}
                  onChange={(e) => onAttachToChange?.("none")}
                  className="h-4 w-4"
                />
                <span className="text-ui text-ink">
                  Nothing — send it on its own
                </span>
              </label>

              <DisabledWithReason
                disabled={true}
                reason={ATTACH_REASON}
                testId="send-attach-invoice"
              >
                {({ disabled, describedBy }) => (
                  <label className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="attach-to"
                      value="invoice"
                      checked={attachTo === "invoice"}
                      disabled={disabled}
                      onChange={(e) => onAttachToChange?.("invoice")}
                      aria-describedby={describedBy}
                      className="h-4 w-4"
                    />
                    <span className="text-ui text-ink">An invoice</span>
                  </label>
                )}
              </DisabledWithReason>

              <DisabledWithReason
                disabled={true}
                reason={ATTACH_REASON}
                testId="send-attach-estimate"
              >
                {({ disabled, describedBy }) => (
                  <label className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="attach-to"
                      value="estimate"
                      checked={attachTo === "estimate"}
                      disabled={disabled}
                      onChange={(e) => onAttachToChange?.("estimate")}
                      aria-describedby={describedBy}
                      className="h-4 w-4"
                    />
                    <span className="text-ui text-ink">An estimate</span>
                  </label>
                )}
              </DisabledWithReason>
            </div>
          </fieldset>
        </SheetSection>

        <SheetSection>
          <SheetRow label="Message" htmlFor="send-message">
            <Textarea
              id="send-message"
              data-testid="send-message"
              value={message}
              onChange={(e) => onMessageChange?.(e.target.value)}
              disabled={busy}
              maxLength="2000"
              placeholder="Optional"
              rows={4}
            />
          </SheetRow>
        </SheetSection>

        <SheetSection>
          <div className="flex items-start justify-between gap-3.5 py-2.5">
            <div className="w-(--size-field-label) shrink-0 text-ui text-ink-2">
              <label>Remind them if they haven't signed</label>
            </div>
            <div className="min-w-0 flex-1">
              <Switch
                checked={remind}
                disabled={busy}
                aria-label="Remind them if they haven't signed"
                data-testid="send-remind"
                onCheckedChange={onRemindChange}
              />
              <p className="m-0 mt-1.5 text-meta leading-normal text-mute">
                They'll get an automatic nudge if they haven't signed, then it stops.
              </p>
            </div>
          </div>
        </SheetSection>

        <SheetSection>
          <p
            className="m-0 rounded-control bg-notice-wash px-3 py-2.5 text-meta text-notice leading-relaxed"
            data-testid="send-info"
          >
            <strong>When they sign.</strong> You both get a PDF, it lands in their record with the date, time
            and device, and you're told straight away.
          </p>
        </SheetSection>
      </div>
    </SideSheet>
  );
}
