// DocsPdf — an uploaded document, steps 3–8 (QUEUE §23.4): Who signs → Place the fields → Check it → Send (while it is a draft), then Track and Done. Steps 1–2 (upload, processing) are DocsUpload.jsx.
// ★ The draft autosaves (800 ms after the last change); closing the page loses nothing. `props.params.id` is the document.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { useWrite } from "@/lib/documents/ports.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";
import PeopleStep from "./pdf/PeopleStep.jsx";
import FieldsStep from "./pdf/FieldsStep.jsx";
import CheckStep from "./pdf/CheckStep.jsx";
import SendStep from "./pdf/SendStep.jsx";
import TrackStep from "./pdf/TrackStep.jsx";

const STEPS = [["people", "Who signs"], ["fields", "Place the fields"], ["check", "Check it"], ["send", "Send"]];

export default function DocsPdf({ params = null, onNavigate = null }) {
  const id = params?.id;
  const [phase, setPhase] = useState("loading");
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("people");
  const [saving, setSaving] = useState("saved");
  const [sendErr, setSendErr] = useState(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardErr, setDiscardErr] = useState(null);
  const pending = useRef({});
  const timer = useRef(null);
  const save = useWrite("POST /api/documents/pdf/save");
  const send = useWrite("POST /api/documents/pdf/send");
  const discard = useWrite("POST /api/documents/pdf/discard");

  const load = useCallback(async () => {
    try { setDoc(await api.pdfDocument(id)); setPhase("ready"); }
    catch (e) { if (e instanceof ApiError && e.status === 403) setPhase("denied"); else if (e instanceof ApiError && e.status === 404) setPhase("missing"); else { setError(e); setPhase("error"); } }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    const patch = pending.current; pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaving("saving");
    try {
      const res = await save.run({ body: { instanceId: id, ...patch } });
      // keep what the person is editing: the server's answer refreshes people, checklist and status, not the field boxes in their hands
      setDoc((d) => ({ ...res, body: patch.body ?? d?.body ?? res.body }));
      setSaving(Object.keys(pending.current).length ? "saving" : "saved");
    } catch (e) { setSaving("error"); setSendErr(e.message); }
  }, [id, save]);

  const change = useCallback((patch) => {
    pending.current = { ...pending.current, ...patch };
    setDoc((d) => (d ? { ...d, ...(patch.body ? { body: patch.body } : {}), ...(patch.parties ? { parties: patch.parties.map((p, i) => ({ ...p, seat_label: p.name, in_person: (patch.sendOptions ?? d.sendOptions).in_person?.includes(p.role) ?? false, id: d.parties[i]?.id ?? p.role })) } : {}), ...(patch.sendOptions ? { sendOptions: patch.sendOptions } : {}), ...(patch.title !== undefined ? { title: patch.title } : {}) } : d));
    setSaving("saving"); clearTimeout(timer.current); timer.current = setTimeout(flush, 800);
  }, [flush]);
  useEffect(() => () => { clearTimeout(timer.current); if (Object.keys(pending.current).length) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFile = useCallback(async () => {
    const r = await fetch(`/api/documents/pdf/${encodeURIComponent(id)}/file/${encodeURIComponent(doc.body.file.file_id)}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`the pages could not be loaded (${r.status})`);
    return r.arrayBuffer();
  }, [id, doc?.body?.file?.file_id]);

  if (phase !== "ready") return <ScreenState phase={phase === "missing" ? "error" : phase} error={phase === "missing" ? new Error("That document does not exist.") : error} subject="Document" onRetry={load} />;
  const draft = doc.state === "draft";
  const go = (path) => onNavigate?.(path);

  const sendNow = async () => {
    setSendErr(null);
    await flush();
    try { const r = await send.run({ body: { instanceId: id } }); if (r.scheduled) { await load(); setStep("people"); } else await load(); }
    catch (e) { setSendErr(e.message); }
  };

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-pdf" data-state={doc.state} data-status={doc.status}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {draft ? <Input className="max-w-[420px] text-heading font-medium" value={doc.title} onChange={(e) => change({ title: e.currentTarget.value })} aria-label="Document title" data-testid="pdf-title" /> : <PageTitle>{doc.title}</PageTitle>}
        <span className="text-meta text-mute" role="status" data-testid="pdf-saving">{draft ? (saving === "saving" ? "Saving…" : saving === "error" ? "Not saved" : "Saved") : ""}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => go("/documents")}>Back to documents</Button>
      </div>

      <ol className="m-0 mb-5 flex list-none flex-wrap gap-2 p-0" aria-label="Steps" data-testid="pdf-steps">
        {["Upload", "Processing"].map((l) => <li key={l} className="rounded-full bg-paper px-3 py-1 text-caption text-mute">✓ {l}</li>)}
        {draft ? STEPS.map(([k, l], i) => <li key={k}><button type="button" onClick={() => setStep(k)} className={`rounded-full px-3 py-1 text-caption ${step === k ? "bg-ink text-surface" : "bg-paper text-ink-2"}`} aria-current={step === k ? "step" : undefined} data-testid={`step-${k}`}>{i + 3}. {l}</button></li>)
          : <li className="rounded-full bg-ink px-3 py-1 text-caption text-surface" aria-current="step">{doc.status === "completed" ? "8. Done" : "7. Track"}</li>}
      </ol>

      {draft ? (
        <>
          {step === "people" && <PeopleStep doc={doc} onChange={change} />}
          {step === "fields" && <FieldsStep doc={doc} loadFile={loadFile} onChange={(body) => change({ body })} />}
          {step === "check" && <CheckStep doc={doc} loadFile={loadFile} />}
          {step === "send" && <SendStep doc={doc} onChange={change} onRefresh={load} />}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4" data-testid="pdf-footer">
            {step !== "people" && <Button variant="outline" onClick={() => setStep(STEPS[STEPS.findIndex(([k]) => k === step) - 1][0])} data-testid="pdf-back">Back</Button>}
            {step !== "send" ? <Button onClick={() => setStep(STEPS[STEPS.findIndex(([k]) => k === step) + 1][0])} data-testid="pdf-next">Next</Button>
              : <Button disabled={send.busy || !(doc.checklist?.ok)} onClick={sendNow} data-testid="pdf-send">{doc.sendOptions.send_at ? "Schedule it" : "Send for signature"}</Button>}
            {step === "send" && !doc.checklist?.ok && <span className="text-meta text-bad" data-testid="pdf-not-ready">Not ready: {doc.checklist?.items.find((i) => !i.ok && i.severity !== "warning")?.text}</span>}
            {doc.scheduledSendAt && <span className="text-meta text-mute">Scheduled for {new Date(doc.scheduledSendAt).toLocaleString()}</span>}
            {/* the app's own confirm (the one every delete uses), not the browser's window.confirm */}
            <Button variant="ghost" className="ml-auto" disabled={discard.busy} onClick={() => { setDiscardErr(null); setDiscardOpen(true); }} data-testid="pdf-discard">Discard draft</Button>
            <ConfirmAction
              open={discardOpen}
              onOpenChange={setDiscardOpen}
              verb="Discard"
              object="this draft"
              consequence="The uploaded file is removed. Nothing was sent, so nobody is told."
              confirmLabel="Discard draft"
              busy={discard.busy}
              error={discardErr}
              testId="pdf-discard-confirm"
              onCancel={() => setDiscardOpen(false)}
              onConfirm={async () => {
                try { await discard.run({ body: { instanceId: id } }); setDiscardOpen(false); go("/documents"); }
                catch (err) { setDiscardErr(err instanceof ApiError ? err.message : String(err?.message ?? err)); }
              }}
            />
          </div>
          {sendErr && <p className="mt-3 text-meta text-bad" role="alert" data-testid="pdf-error">{sendErr}</p>}
        </>
      ) : <TrackStep docId={id} onChanged={load} />}
    </div>
  );
}
