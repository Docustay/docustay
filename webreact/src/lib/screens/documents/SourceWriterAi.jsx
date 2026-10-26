// SourceWriterAi.jsx — AI drafting, guided questions and "ask for a change" for the shared-engine writer (6 Oct 2026).
// Nothing is applied until the person presses a button. API: /api/documents/engine/{ai/status,ai/jobs,guided,patches/apply}.
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { WIZARD_UNIVERSAL, WIZARD_TYPES, WIZARD_FINAL_QUESTION, AGENT_KINDS, AGENT_DEFAULT_NAME } from "@keystone/documents/flowDefinition.mjs";

const ENGINE = "/api/documents/engine";
const POLL_MS = 1500;
const POLL_MAX_MS = 7 * 60 * 1000;
const unwrap = (r) => r?.data ?? r;
const msg = (e) => e?.message ?? e?.error ?? String(e);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function useJob() {
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const jobId = useRef(null);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  async function run(body) {
    setError(null); setJob(null); setBusy(true); stop.current = false; jobId.current = null;
    try {
      const start = unwrap(await request(`${ENGINE}/ai/jobs`, { method: "POST", body }));
      jobId.current = start.jobId;
      const t0 = Date.now();
      while (!stop.current) {
        await sleep(POLL_MS);
        if (stop.current) return null;
        const j = unwrap(await request(`${ENGINE}/ai/jobs/${encodeURIComponent(start.jobId)}`));
        if (["done", "failed", "cancelled"].includes(j.state)) {
          setJob(j);
          if (j.state === "failed") setError(j.message || "The draft could not be written.");
          if (j.state === "cancelled") setError(j.message || "Cancelled.");
          return j.state === "done" ? j : null;
        }
        if (Date.now() - t0 > POLL_MAX_MS) { setError("This is taking longer than expected. You can ask again, or check back in a few minutes."); return null; }
      }
      return null;
    } catch (e) { setError(msg(e)); return null; }
    finally { setBusy(false); }
  }
  async function cancel() {
    stop.current = true;
    if (jobId.current) { try { await request(`${ENGINE}/ai/jobs/cancel`, { method: "POST", body: { jobId: jobId.current } }); } catch (e) { setError(msg(e)); } }
    setBusy(false);
  }
  return { job, setJob, busy, error, run, cancel };
}

function Card({ title, testid, children }) {
  return (
    <section className="rounded-card border border-line bg-surface p-3" data-testid={testid}>
      <h3 className="mb-2 text-ui font-medium">{title}</h3>
      {children}
    </section>
  );
}

function describePatch(p) {
  switch (p.op) {
    case "replace_text": return (<><div className="text-caption text-mute">Before</div><div className="text-ui line-through">{p.before}</div><div className="text-caption text-mute">After</div><div className="text-ui">{p.after}</div></>);
    case "insert_block": return (<><div className="text-caption text-mute">Add</div><div className="text-ui">{nodeText(p.node)}</div></>);
    case "replace_block": return (<><div className="text-caption text-mute">Replace block {p.block} with</div><div className="text-ui">{nodeText(p.node)}</div></>);
    case "remove_block": return <div className="text-ui">Remove block {p.block}</div>;
    default: return <div className="text-ui">{JSON.stringify(p)}</div>;
  }
}
function nodeText(n) {
  if (!n) return "";
  if (n.text) return n.text;
  if (n.type === "variableChip") return `{${n.attrs?.name ?? ""}}`;
  return (n.content ?? []).map(nodeText).join(n.type === "doc" || n.type === "bulletList" || n.type === "orderedList" ? "\n" : "");
}

export default function SourceWriterAi({ getSource, onSource, onNotes }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  useEffect(() => {
    let alive = true;
    request(`${ENGINE}/ai/status`).then((r) => alive && setStatus(unwrap(r))).catch((e) => alive && setStatusError(msg(e)));
    return () => { alive = false; };
  }, []);
  const aiOff = status && !status.enabled;

  // (a) describe it
  // the wizard asks everything BEFORE any model call and sends one brief
  const [typeId, setTypeId] = useState(""), [kindId, setKindId] = useState("plain"), [wAnswers, setWAnswers] = useState({}), [final, setFinal] = useState("");
  const draft = useJob();
  const wType = WIZARD_TYPES.find((x) => x.id === typeId) ?? null;
  const wQuestions = wType ? [...WIZARD_UNIVERSAL, ...wType.pack] : [];
  const wMissing = wQuestions.find((q) => q.required && !String(wAnswers[q.key] ?? q.default ?? "").trim());
  const wReady = Boolean(wType) && !wMissing && final.trim().length >= 10;
  const agent = status?.agentName || AGENT_DEFAULT_NAME;
  const goDraft = () => draft.run({ brief: { type: typeId, kind: kindId, answers: Object.fromEntries(wQuestions.map((q) => [q.key, String(wAnswers[q.key] ?? q.default ?? "")])), final: final.trim() }, mode: "template", vocabulary: "mainstay", kind: "draft" });
  const notes = draft.job?.state === "done" ? (draft.job.patches?.notes ?? []) : [];
  const assumed = draft.job?.state === "done" ? (draft.job.patches?.assumptions ?? []) : [], openQ = draft.job?.state === "done" ? (draft.job.patches?.open_questions ?? []) : [], careful = draft.job?.state === "done" ? (draft.job.patches?.careful ?? []) : [];

  // (b) guided
  const [questions, setQuestions] = useState(null);
  const [qError, setQError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [guided, setGuided] = useState(null);
  const [gBusy, setGBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    request(`${ENGINE}/guided/questions`).then((r) => alive && setQuestions(unwrap(r)?.questions ?? [])).catch((e) => alive && setQError(msg(e)));
    return () => { alive = false; };
  }, []);
  async function buildGuided() {
    setQError(null); setGBusy(true);
    try { const r = unwrap(await request(`${ENGINE}/guided`, { method: "POST", body: { answers } })); setGuided(r); onNotes?.(r.notes ?? []); }
    catch (e) { setQError(msg(e)); } finally { setGBusy(false); }
  }

  // (c) ask for a change
  const [editPrompt, setEditPrompt] = useState("");
  const edit = useJob();
  const [askedSource, setAskedSource] = useState(null);
  const [checked, setChecked] = useState({});
  const [applyError, setApplyError] = useState(null);
  const [applying, setApplying] = useState(false);
  async function goEdit() {
    const base = getSource();
    setAskedSource(JSON.parse(JSON.stringify(base))); setChecked({}); setApplyError(null);
    const j = await edit.run({ prompt: editPrompt.trim(), mode: "template", vocabulary: "mainstay", kind: "edit", baseSource: base });
    if (j) setChecked(Object.fromEntries((j.patches?.applied ?? []).map((_, i) => [i, true])));
  }
  const applied = edit.job?.state === "done" ? (edit.job.patches?.applied ?? []) : [];
  const rejected = edit.job?.state === "done" ? (edit.job.patches?.rejected ?? []) : [];
  async function applyChecked() {
    setApplyError(null); setApplying(true);
    try {
      const patches = applied.filter((_, i) => checked[i]);
      const r = unwrap(await request(`${ENGINE}/patches/apply`, { method: "POST", body: { source: askedSource, patches } }));
      onSource(r.source);
      edit.setJob(null);
    } catch (e) { setApplyError(msg(e)); } finally { setApplying(false); }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="source-writer-ai">
      <Card title="Describe it" testid="sa-describe">
        {statusError ? <p className="text-caption text-bad">{statusError}</p> : null}
        {aiOff ? (
          <p className="text-caption text-mute" data-testid="sa-off">AI drafting is switched off for this practice. You can still build a draft with the questions below.</p>
        ) : (
          <>
            <label className="mb-2 block text-caption text-mute">What kind of document is it?
              <NativeSelect value={typeId} onChange={(e) => setTypeId(e.target.value)} data-testid="sa-type"><option value="">Choose one</option>{WIZARD_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>
            </label>
            <label className="mb-2 block text-caption text-mute">Who should write it?
              <NativeSelect value={kindId} onChange={(e) => setKindId(e.target.value)} data-testid="sa-kind">{AGENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} — {k.hint}</option>)}</NativeSelect>
            </label>
            {wType ? (
              <div data-testid="sa-questions">
                {wQuestions.map((q) => (
                  <label key={q.key} className="mb-2 block text-caption text-mute">{q.label}{q.required ? " *" : ""}
                    {q.type === "choice" ? (
                      <NativeSelect value={wAnswers[q.key] ?? q.default ?? ""} onChange={(e) => setWAnswers({ ...wAnswers, [q.key]: e.target.value })} data-testid={`sa-q-${q.key}`}><option value="">Choose one</option>{q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
                    ) : q.type === "longtext" ? (
                      <textarea className="mt-1 min-h-[64px] w-full rounded-control border border-line bg-surface p-2 text-ui" maxLength={1200} value={wAnswers[q.key] ?? ""} onChange={(e) => setWAnswers({ ...wAnswers, [q.key]: e.target.value })} data-testid={`sa-q-${q.key}`} />
                    ) : (
                      <Input maxLength={1200} value={wAnswers[q.key] ?? ""} onChange={(e) => setWAnswers({ ...wAnswers, [q.key]: e.target.value })} data-testid={`sa-q-${q.key}`} />
                    )}
                  </label>
                ))}
                <label className="mb-2 block text-caption text-mute">{WIZARD_FINAL_QUESTION.label} *
                  <textarea className="mt-1 min-h-[80px] w-full rounded-control border border-line bg-surface p-2 text-ui" maxLength={2000} value={final} onChange={(e) => setFinal(e.target.value)} data-testid="sa-final" />
                </label>
              </div>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={goDraft} disabled={draft.busy || !wReady} data-testid="sa-go">{draft.busy ? `${agent} is writing…` : "Write a draft"}</Button>
              {draft.busy ? <Button size="sm" variant="outline" onClick={draft.cancel} data-testid="sa-cancel">Cancel</Button> : null}
            </div>
            {wType && !wReady ? <p className="mt-1 text-caption text-mute" data-testid="sa-need">{wMissing ? `Answer: ${wMissing.label}` : "Answer the last question to go on."}</p> : null}
            {draft.busy ? <p className="mt-2 text-caption text-mute">This can take a few minutes. You can keep working.</p> : null}
            {draft.error ? <p className="mt-2 text-caption text-bad" data-testid="sa-error">{draft.error}</p> : null}
            {draft.job?.state === "done" ? (
              <div className="mt-3" data-testid="sa-result">
                <p className="text-ui font-medium" data-testid="sa-finished">{draft.job.message?.includes("finished") ? draft.job.message : `${agent} finished your document. Review it, AI can make mistakes.`}</p>
                {assumed.length ? <><h4 className="mt-2 text-ui font-medium">What {draft.job.patches?.agent?.name || agent} assumed</h4><ul className="ml-4 list-disc text-caption text-mute" data-testid="sa-assumed">{assumed.map((n, i) => <li key={i}>{n}</li>)}</ul></> : null}
                {openQ.length ? <><h4 className="mt-2 text-ui font-medium">Questions to settle</h4><ul className="ml-4 list-disc text-caption text-mute">{openQ.map((n, i) => <li key={i}>{n}</li>)}</ul></> : null}
                {careful.length ? <><h4 className="mt-2 text-ui font-medium">Check these carefully</h4><ul className="ml-4 list-disc text-caption text-mute">{careful.map((n, i) => <li key={i}>{n}</li>)}</ul></> : null}
                {!assumed.length && !openQ.length && !careful.length ? <ul className="ml-4 list-disc text-caption text-mute">{notes.map((n, i) => <li key={i}>{typeof n === "string" ? n : msg(n)}</li>)}</ul> : null}
                <Button size="sm" className="mt-2" data-testid="sa-use" onClick={() => { onNotes?.(notes); onSource(draft.job.source, draft.job.patches?.title); }}>Use this draft</Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card title="Build it with questions" testid="sa-guided">
        {qError ? <p className="mb-2 text-caption text-bad" data-testid="sa-guided-error">{qError}</p> : null}
        {(questions ?? []).map((q) => (
          <label key={q.key} className="mb-2 block text-caption text-mute">
            {q.label}{q.required ? " *" : ""}
            {q.type === "choice" ? (
              <NativeSelect value={answers[q.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}>
                <option value="">Choose…</option>
                {(q.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            ) : q.type === "bool" ? (
              <input type="checkbox" className="ml-2" checked={!!answers[q.key]} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.checked })} />
            ) : q.type === "number" ? (
              <Input type="number" min={q.min} max={q.max} placeholder={q.placeholder} value={answers[q.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value === "" ? "" : Number(e.target.value) })} />
            ) : (
              <Input maxLength={q.max} placeholder={q.placeholder} value={answers[q.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
            )}
          </label>
        ))}
        <Button size="sm" variant="outline" onClick={buildGuided} disabled={gBusy || !questions} data-testid="sa-guided-go">{gBusy ? "Building…" : "Build the draft"}</Button>
        {guided ? (
          <div className="mt-3" data-testid="sa-guided-result">
            {(guided.notes ?? []).length ? <ul className="ml-4 list-disc text-caption text-mute">{guided.notes.map((n, i) => <li key={i}>{typeof n === "string" ? n : msg(n)}</li>)}</ul> : null}
            <Button size="sm" className="mt-2" data-testid="sa-guided-use" onClick={() => onSource(guided.source, guided.title)}>Use this draft</Button>
          </div>
        ) : null}
      </Card>

      <Card title="Ask for a change" testid="sa-edit">
        {aiOff ? <p className="text-caption text-mute">AI drafting is switched off for this practice.</p> : (
          <>
            <textarea className="min-h-[70px] w-full rounded-control border border-line bg-surface p-2 text-ui" maxLength={4000} data-testid="sa-edit-prompt" placeholder="What should change? For example, make the cancellation notice 48 hours." value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={goEdit} disabled={edit.busy || !editPrompt.trim()} data-testid="sa-edit-go">{edit.busy ? "Working…" : "Ask"}</Button>
              {edit.busy ? <Button size="sm" variant="outline" onClick={edit.cancel}>Cancel</Button> : null}
            </div>
            {edit.error ? <p className="mt-2 text-caption text-bad" data-testid="sa-edit-error">{edit.error}</p> : null}
            {edit.job?.state === "done" ? (
              <div className="mt-3 flex flex-col gap-2" data-testid="sa-edit-result">
                {applied.length === 0 && rejected.length === 0 ? <p className="text-caption text-mute">No changes were suggested.</p> : null}
                {applied.map((p, i) => (
                  <label key={`a${i}`} className="flex gap-2 rounded-control border border-line p-2" data-testid="sa-patch">
                    <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />
                    <div>{describePatch(p)}</div>
                  </label>
                ))}
                {rejected.map((r, i) => (
                  <div key={`r${i}`} className="rounded-control border border-line p-2 opacity-50" data-testid="sa-patch-rejected">
                    {describePatch(r.patch ?? {})}<div className="text-caption text-mute">{r.why}</div>
                  </div>
                ))}
                {applyError ? <p className="text-caption text-bad">{applyError}</p> : null}
                {applied.length ? <Button size="sm" onClick={applyChecked} disabled={applying || !Object.values(checked).some(Boolean)} data-testid="sa-edit-apply">{applying ? "Applying…" : "Apply the checked changes"}</Button> : null}
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
