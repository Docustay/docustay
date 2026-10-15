// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.013 — DocsSend. Send documents from everywhere.
// Ported from webui/src/lib/screens/documents/DocsSend.svelte (372 lines, 43 of them <style>)
// Props: { builder, templates, people, origin, personId, onDone, onCancel }
// ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this read `templates`/`people` PURELY from props, and the one
//   real caller (routes.js's "sendDocument" surface) fed them from `c.data`, which is populated by
//   the matched route's own loader — present for a "page"-type route with a PAGE_LOADS entry
//   (added there for /documents/contracts/all), ABSENT for a "view"-type route (VIEW_FALLBACK's
//   generic list loader, which /documents/forms/all and /documents/pipeline actually use). So the
//   exact same drawer showed real templates and clients on one path and "No templates yet" /
//   "Nobody to send to yet" on another, with the same tenant, same session, same data underneath —
//   purely because of which route-matching machinery happened to answer that URL. Self-fetching
//   here (the same pattern DocTemplateEditor.jsx, DocsList.jsx and DocsClauses.jsx already use)
//   makes this correct from every entry point, regardless of which route type gets there — the
//   PAGE_LOADS entry this used to depend on is removed as redundant, not left as dead weight.
//   `templatesProp`/`peopleProp` stay real props ONLY so DocsSend.stories.jsx's existing fixtures
//   keep working without a live backend; the real app never supplies them, so it always fetches.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import { listPeopleForPicker } from "@/lib/documents/ports.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { labelsMatch, labelsMismatch, usePersonLabels } from "./labels.js";
import DocsSendSendDocumentSheet1Sheet from "./DocsSendSendDocumentSheet1Sheet.jsx";
import DocsSendSendDocumentSheet2Sheet from "./DocsSendSendDocumentSheet2Sheet.jsx";

export default function DocsSend({
  builder = "contract",
  templates: templatesProp = null,
  people: peopleProp = null,
  origin = "documents",
  personId = null,
  onDone = null,
  onCancel = null,
}) {
  const [fetchedTemplates, setFetchedTemplates] = useState([]);
  const [fetchedPeople, setFetchedPeople] = useState([]);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (templatesProp !== null || peopleProp !== null) return; // caller supplied real data (e.g. a story)
    let live = true;
    (async () => {
      try {
        const [templatesRes, peopleRes] = await Promise.all([
          request(builder === "form" ? "/api/list/documents/forms/templates" : "/api/list/documents/contracts/templates"),
          listPeopleForPicker(),
        ]);
        if (!live) return;
        setFetchedTemplates((templatesRes?.rows ?? []).map((r) => ({ id: r.id, name: r.name, labels: r.labels ?? [] })));
        setFetchedPeople((peopleRes?.rows ?? []).map((r) => ({ id: r.id, display_name: r.display_name })));
      } catch (err) {
        if (live) setLoadError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    })();
    return () => { live = false; };
  }, [builder, templatesProp, peopleProp]);

  const templates = templatesProp ?? fetchedTemplates;
  const people = peopleProp ?? fetchedPeople;
  // ★ Reason shown for BOTH disabled "Attach it to" options — Stage 15's `15.65 createClientPayment`
  //   (CT-F40) does not exist yet, so signing-and-paying-together is visible and explained, never
  //   hidden.
  const ATTACH_REASON = "Signing and paying together comes with Money";

  const [templateId, setTemplateId] = useState("");
  const [subjectUserId, setSubjectUserId] = useState(personId ?? "");
  const [message, setMessage] = useState("");
  const [remind, setRemind] = useState(true);
  const [attachTo, setAttachTo] = useState(
    origin === "invoice" ? "invoice" : origin === "estimate" ? "estimate" : "none"
  );

  const [phase, setPhase] = useState("form"); // "form" | "sent"
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sentName, setSentName] = useState("");

  // ★ One key per submit, reused on a retry of the SAME action (idempotency.js's own rule).
  const [sendKey, setSendKey] = useState(null);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const subject = people.find((p) => p.id === subjectUserId) ?? null;
  const subjectName = subject?.display_name ?? subject?.name ?? null;
  // ★ QUEUE §4 — Documents' generic labels. Once a recipient is chosen, templates "used for" them come first and are
  //   marked; a template that names labels none of which fit them gets a note. NEVER blocks the send.
  const personLabels = usePersonLabels(subjectUserId ? [subjectUserId] : [])[subjectUserId] ?? null;
  const isSuggested = (t) => personLabels !== null && (t.labels?.length ?? 0) > 0 && labelsMatch(t.labels, personLabels);
  const templateOptions = [...templates]
    .sort((a, b) => Number(isSuggested(b)) - Number(isSuggested(a)))
    .map((t) => ({ value: t.id, label: isSuggested(t) ? `${t.name} — Suggested for ${subjectName ?? "them"}` : t.name }));
  const templateNote = template && personLabels !== null && labelsMismatch(template.labels, personLabels)
    ? `This document is set up for other people than ${subjectName ?? "this person"}. You can still send it.`
    : null;
  const ready = !!templateId && !!subjectUserId;

  // ★ No control in either frame picks this — see header note. Sent at the server's own default
  //   value rather than omitted, so this screen's behaviour matches what a caller who DID have a
  //   picker would get by leaving it on the friendliest choice.
  const sendMode = "fill";

  const send = useCallback(async () => {
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);

    let key = sendKey;
    if (!key) {
      key = newIdempotencyKey();
      setSendKey(key);
    }

    try {
      await request("/api/documents/send", {
        method: "POST",
        idempotencyKey: key,
        body: {
          personId: subjectUserId,
          template: templateId,
          sendMode,
          remind,
          message: message.trim() || null,
        },
      });
      setSentName(subjectName ?? "them");
      setPhase("sent");
      setSendKey(null);
    } catch (err) {
      // ★ The server's own sentence, never a re-worded one — its requestId appended as a plain
      //   reference, not folded into the message itself.
      const errorMessage =
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` — reference ${err.requestId}` : ""}`
          : String(err?.message ?? err);
      setProblem(errorMessage);
    } finally {
      setBusy(false);
    }
  }, [busy, ready, sendKey, subjectUserId, templateId, sendMode, remind, message, subjectName]);

  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      onCancel?.();
    }
  };

  return (
    <>
      {/* M1: Confirmation sheet shown when phase === "sent" */}
      <DocsSendSendDocumentSheet1Sheet
        open={phase === "sent"}
        onOpenChange={handleOpenChange}
        onDone={onDone}
        onCancel={onCancel}
        sentName={sentName}
        template={template}
        send={send}
      />

      {/* M2: Compose form sheet shown when phase !== "sent" */}
      <DocsSendSendDocumentSheet2Sheet
        open={phase !== "sent"}
        onOpenChange={handleOpenChange}
        templates={templates}
        people={people}
        onCancel={onCancel}
        ATTACH_REASON={ATTACH_REASON}
        templateId={templateId}
        subjectUserId={subjectUserId}
        message={message}
        remind={remind}
        attachTo={attachTo}
        busy={busy}
        problem={problem ?? (loadError ? `Couldn't load templates or people to send to: ${loadError}` : null)}
        template={template}
        templateOptions={templateOptions}
        templateNote={templateNote}
        subject={subject}
        subjectName={subjectName}
        ready={ready}
        send={send}
        onTemplateChange={setTemplateId}
        onSubjectChange={setSubjectUserId}
        onMessageChange={setMessage}
        onRemindChange={setRemind}
        onAttachToChange={setAttachTo}
      />
    </>
  );
}
