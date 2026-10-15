// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NewDocumentWizard.jsx — Square Contracts rebuild (29 Sep 2026), §3: "New document — a short
// stepped flow that slides up: 1) pick a template, 2) pick the client(s) — up to 20, each gets
// their own copy — 3) see the finished document with their details filled in, 4) send."
// Opened via the `newSurface` mechanism at /documents?new=1 (same convention every other list's
// "New X" button already uses — routes.js's NEW_SURFACE_COMPONENTS, surfaceRegistry.js's
// NEW_SURFACES). One document per selected recipient: `POST /api/documents/send` already accepts
// exactly one {personId, template} per call (src/documents/sendDocument.mjs) and creates+sends in
// one step — this wizard calls it once per recipient rather than inventing a batch endpoint the
// backend doesn't have, the same "loop the existing single-item write" pattern used elsewhere in
// this app for anything that fans out to N rows.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { request, ApiError } from "@/lib/api.js";
import { listPeopleForPicker } from "@/lib/documents/ports.js";
import { labelsMismatch, usePersonLabels } from "./labels.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import PreviewPanel from "@/lib/components/editor/PreviewPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import DocumentPreviewTabs from "./DocumentPreviewTabs.jsx";
import { RESOLVABLE_VARIABLES } from "@keystone/documents/variableCatalogue.mjs";

const MAX_RECIPIENTS = 20;

export default function NewDocumentWizard({ onCancel = null, onDone = null }) {
  const [step, setStep] = useState(1);
  // ★ ITEM 10 — which way the step transition slides: +1 forward (Continue), -1 back (Back).
  const [direction, setDirection] = useState(1);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState(null);
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — the Details step: "document name, description
  //   and message — filled in from the template, editable." Applied to every recipient in this one
  //   send (the wizard sends one shared document to up to 20 people; per-recipient personalisation
  //   of the TITLE is not built — see the report).
  // ★ FIX, 30 Sep 2026 ("smart fields in the Message" brief) — Description and Message ARE now
  //   personalised per recipient: each may contain `{{name}}` tokens (the "Insert field" pickers
  //   below), resolved to THAT recipient's own data server-side, once, at send
  //   (src/documents/sendDocument.mjs) — "Good afternoon Example…" for one recipient, "Good afternoon
  //   Dana…" for another, from the one template typed here.
  const [docTitle, setDocTitle] = useState("");
  const [docDescription, setDocDescription] = useState("");
  const [docMessage, setDocMessage] = useState("");
  const descriptionRef = useRef(null);
  const messageRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, f] = await Promise.all([
          request("/api/list/documents/contracts/templates"),
          request("/api/list/documents/forms/templates"),
        ]);
        // ★ FOUND LIVE, 30 Sep 2026 (save-system test pass) — this list carries EVERY version of a
        //   template, active or retired (a new version is a new row, per contractDoc.js/writes.mjs's
        //   own "a new version is a new row" rule) — a retired row keeps its own name and its own
        //   real `sent_instances` count, so it looks exactly like a normal, healthy template with
        //   history. MEASURED: picking one sends successfully (title, email, everything) but the
        //   instance's `template_id` points at a row `sendInstance` can never find an ACTIVE match
        //   for, so the frozen body is silently null — the recipient's sign page says "This
        //   document's frozen wording is missing." No error anywhere in the product. Filtering to
        //   `active !== false` here is the client-side half of the fix; `sendDocument.mjs`'s
        //   `loadTemplate` now also refuses a non-active id with a clear message, for a caller other
        //   than this screen (or a stale cached list) that could still pass one through.
        setTemplates([
          ...(c.rows ?? []).filter((r) => r.active !== false).map((r) => ({ ...r, builder: "contract" })),
          ...(f.rows ?? []).filter((r) => r.active !== false).map((r) => ({ ...r, builder: "form" })),
        ]);
      } catch { setTemplates([]); }
      finally { setTemplatesLoading(false); }
    })();
    (async () => {
      try {
        const res = await listPeopleForPicker();
        setPeople(res.rows ?? []);
      } catch { setPeople([]); }
      finally { setPeopleLoading(false); }
    })();
  }, []);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const selectedPeople = people.filter((p) => selectedIds.includes(p.id));
  // ★ QUEUE §4 — Documents' generic labels: a template that names labels none of which fit a chosen person gets an inline
  //   note (names only). It never blocks the send.
  const personLabels = usePersonLabels(selectedIds);
  const labelMismatched = template && (template.labels?.length ?? 0) > 0
    ? selectedPeople.filter((p) => personLabels[p.id] !== undefined && labelsMismatch(template.labels, personLabels[p.id]))
    : [];

  // ★ FIX, 30 Sep 2026 (documents preview brief) — step 4 used to print the hardcoded smart-field
  //   catalogue's first 8 samples, the same on every send. This is a REAL send about to happen to a
  //   REAL, already-chosen person — the preview now shows THAT person's actual resolved data, via the
  //   same route DocPreview.jsx uses.
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  useEffect(() => {
    if (step !== 4 || !templateId || !selectedPeople[0]) return;
    setPreviewLoading(true);
    setPreviewError(null);
    request(`/api/documents/templates/${templateId}/preview?personId=${encodeURIComponent(selectedPeople[0].id)}`)
      .then((res) => setPreview(res.data))
      .catch((err) => setPreviewError(err))
      .finally(() => setPreviewLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, templateId, selectedPeople[0]?.id]);

  // ★ SAVE-SYSTEM BRIEF, 30 Sep 2026 — F825-everywhere: closing this wizard (× / Cancel / browser tab
  //   close) discarded whatever was picked/typed with zero warning. SideSheet.jsx itself now carries
  //   this (beforeunload + "Discard this document?" before the close actually runs) behind a `dirty`
  //   prop — passed straight through below, no separate guard needed here. `results` already sent
  //   isn't "unsaved" — only mid-flow, un-sent work is.
  const isWizardDirty = !results && (templateId !== null || selectedIds.length > 0 || docTitle.trim() !== "" || docDescription.trim() !== "" || docMessage.trim() !== "");

  function handleCancel() { onCancel?.(); }

  function pickTemplate(id) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    // ★ "filled in from the template, editable" — the defaults, not yet sent.
    setDocTitle(t?.name ?? "");
    setDocDescription(t?.client_description ?? "");
    setDocMessage(t?.message ?? "");
    setDirection(1);
    setStep(2);
  }

  function next() {
    if (step === 2 && selectedIds.length === 0) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, 5));
  }
  function back() { setDirection(-1); setStep((s) => Math.max(s - 1, 1)); }

  // ★ Insert `{{name}}` at the cursor (or append, if the field never took focus) — same idea as the
  //   Content editor's slash-menu variable insert, adapted for a plain-text field.
  function insertToken(ref, setValue, name) {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) { setValue((v) => `${v}${token}`); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function sendAll() {
    setBusy(true);
    setError(null);
    const outcomes = [];
    for (const person of selectedPeople) {
      try {
        await request("/api/documents/send", {
          method: "POST",
          idempotencyKey: newIdempotencyKey(),
          body: {
            personId: person.id, template: templateId,
            title: docTitle.trim() || undefined,
            description: docDescription.trim() || undefined,
            message: docMessage.trim() || undefined,
          },
        });
        outcomes.push({ person, ok: true });
      } catch (err) {
        outcomes.push({ person, ok: false, message: err instanceof ApiError ? err.message : String(err?.message ?? err) });
      }
    }
    setResults(outcomes);
    setBusy(false);
    if (outcomes.every((o) => o.ok)) {
      setTimeout(() => onDone?.(), 900);
    }
  }

  const stepTitle = ["", "Pick a template", "Who is this for?", "Details", "Check it", "Send"][step];

  return (
    <SideSheet
      title="New document"
      subtitle={stepTitle}
      testId="new-document-wizard"
      onCancel={handleCancel}
      dirty={isWizardDirty}
      objectNoun="document"
      footer={
        <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <div>
            {step > 1 && step < 5 && (
              <Button type="button" variant="outline" onClick={back} disabled={busy} data-testid="wizard-back">Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={busy} data-testid="wizard-cancel">Cancel</Button>
            {step === 2 && (
              <Button type="button" onClick={next} disabled={selectedIds.length === 0} data-testid="wizard-next">
                Continue{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
              </Button>
            )}
            {step === 3 && (
              <Button type="button" onClick={next} disabled={!docTitle.trim()} data-testid="wizard-details-next">Continue</Button>
            )}
            {step === 4 && (
              <Button type="button" onClick={next} data-testid="wizard-to-send">Continue</Button>
            )}
            {step === 5 && !results && (
              <Button type="button" onClick={sendAll} disabled={busy} data-testid="wizard-send">
                {busy ? "Sending…" : selectedIds.length > 1 ? `Send to ${selectedIds.length} people` : "Send"}
              </Button>
            )}
            {step === 5 && results && results.every((o) => o.ok) && (
              <Button type="button" onClick={() => onDone?.()} data-testid="wizard-finish">Done</Button>
            )}
          </div>
        </footer>
      }
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: 24 * direction }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 * direction }}
          transition={{ duration: 0.18 }}
        >
      {step === 1 && (
        <div className="grid grid-cols-2 gap-3" data-testid="wizard-step-template">
          {templatesLoading ? (
            <p className="col-span-2 text-meta text-mute">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="col-span-2 text-meta text-mute">No templates yet — create one under Documents → Templates.</p>
          ) : templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pickTemplate(t.id)}
              className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 text-left hover:border-brand hover:shadow-phone"
              data-testid={`wizard-template-${t.id}`}
            >
              <span className="text-ui font-medium text-ink">{t.name}</span>
              <span className="text-meta text-mute">{t.builder === "form" ? "Form" : "Agreement"} · {t.sent_instances ?? 0} sent</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3" data-testid="wizard-step-people">
          <p className="m-0 text-meta text-mute">Sending: <b className="text-ink">{template?.name}</b>. Pick up to {MAX_RECIPIENTS} people — each gets their own copy.</p>
          <Combobox
            multiple
            testId="wizard-people"
            placeholder="Search people…"
            value={selectedIds}
            options={people.map((p) => ({ value: p.id, label: p.display_name ?? p.name }))}
            onValueChange={(ids) => setSelectedIds(ids.slice(0, MAX_RECIPIENTS))}
          />
          {peopleLoading && <p className="text-meta text-mute">Loading people…</p>}
          {labelMismatched.length > 0 && (
            <p className="m-0 text-meta text-warn" data-testid="wizard-label-note">
              This document is set up for other people than {labelMismatched.map((p) => p.display_name ?? p.name).join(", ")}. You can still send it.
            </p>
          )}
          {selectedIds.length >= MAX_RECIPIENTS && <p className="text-meta text-warn">That's the most this can send at once — {MAX_RECIPIENTS}.</p>}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4" data-testid="wizard-step-details">
          <p className="m-0 text-meta text-mute">Filled in from the template — editable for this send only.</p>
          <label className="flex flex-col gap-1.5 text-meta text-ink">
            Document name
            <input
              type="text" value={docTitle} onChange={(e) => setDocTitle(e.target.value)}
              data-testid="wizard-details-title"
              className="rounded-control border border-line bg-surface px-3 py-2 text-ui text-ink"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-meta text-ink">
            <div className="flex items-center justify-between">
              <span>Description <span className="text-mute">— the client sees this</span></span>
              <select
                value=""
                data-testid="wizard-details-description-insert"
                className="rounded-control border border-line bg-surface px-2 py-1 text-caption text-mute"
                onChange={(e) => { if (e.target.value) insertToken(descriptionRef, setDocDescription, e.target.value); e.target.value = ""; }}
              >
                <option value="">Insert field…</option>
                {RESOLVABLE_VARIABLES.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>
            <textarea
              ref={descriptionRef}
              rows={2} value={docDescription} onChange={(e) => setDocDescription(e.target.value)}
              data-testid="wizard-details-description"
              className="rounded-control border border-line bg-surface px-3 py-2 text-ui text-ink"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-meta text-ink">
            <div className="flex items-center justify-between">
              <span>Message <span className="text-mute">— the body of the email they get</span></span>
              <select
                value=""
                data-testid="wizard-details-message-insert"
                className="rounded-control border border-line bg-surface px-2 py-1 text-caption text-mute"
                onChange={(e) => { if (e.target.value) insertToken(messageRef, setDocMessage, e.target.value); e.target.value = ""; }}
              >
                <option value="">Insert field…</option>
                {RESOLVABLE_VARIABLES.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>
            <textarea
              ref={messageRef}
              rows={4} value={docMessage} onChange={(e) => setDocMessage(e.target.value)}
              data-testid="wizard-details-message"
              className="rounded-control border border-line bg-surface px-3 py-2 text-ui text-ink"
            />
            {selectedPeople.length > 1 && (
              <p className="m-0 text-caption text-mute">
                Each of the {selectedPeople.length} recipients gets their own copy, with fields filled in for them.
              </p>
            )}
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4" data-testid="wizard-step-preview">
          <p className="m-0 text-meta text-mute">
            {selectedPeople.length === 1
              ? <>Sending <b className="text-ink">{docTitle || template?.name}</b> to <b className="text-ink">{selectedPeople[0]?.display_name ?? selectedPeople[0]?.name}</b>.</>
              : <>Sending <b className="text-ink">{docTitle || template?.name}</b> to <b className="text-ink">{selectedPeople.length} people</b>, each their own copy.</>}
          </p>
          <PreviewPanel
            title={docTitle || template?.name || "Document"}
            subtitle={selectedPeople.length === 1
              ? `Filled in for ${selectedPeople[0]?.display_name ?? selectedPeople[0]?.name} — their real data.`
              : `Filled in for ${selectedPeople[0]?.display_name ?? selectedPeople[0]?.name} — the first recipient; every other recipient gets their own copy filled in the same way.`}
            printable={false}
          >
            {/* ★ QUEUE §23.3.1 — the same two previews the editor offers, drawn from the ONE document view with the first recipient's real values */}
            <DocumentPreviewTabs templateId={templateId} personId={selectedPeople[0]?.id ?? null} />
          </PreviewPanel>
          <DisabledWithReason disabled reason="Signing and paying together comes with Money" testId="wizard-attach-invoice">
            {({ disabled, describedBy }) => (
              <label className="flex items-center gap-2 text-meta text-mute" aria-describedby={describedBy} data-disabled={disabled}>
                <input type="checkbox" disabled className="h-4 w-4" />
                Attach an invoice
              </label>
            )}
          </DisabledWithReason>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-3" data-testid="wizard-step-send">
          {!results ? (
            <p className="m-0 text-meta text-mute">Ready to send <b className="text-ink">{docTitle || template?.name}</b> to {selectedPeople.length === 1 ? selectedPeople[0]?.display_name : `${selectedPeople.length} people`}.</p>
          ) : (
            <div className="flex flex-col gap-2" data-testid="wizard-results">
              {results.map((o) => (
                <div key={o.person.id} className={`rounded-control border px-3 py-2 text-meta ${o.ok ? "border-line bg-ok-soft text-ok" : "border-bad-border bg-bad-bg text-bad"}`}>
                  {o.person.display_name ?? o.person.name} — {o.ok ? "sent" : o.message}
                </div>
              ))}
            </div>
          )}
          {error && <p className="m-0 text-meta text-bad">{error}</p>}
        </div>
      )}
        </motion.div>
      </AnimatePresence>
    </SideSheet>
  );
}
