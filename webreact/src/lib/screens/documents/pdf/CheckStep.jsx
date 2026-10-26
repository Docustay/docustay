// CheckStep — STEP 5 · CHECK IT (QUEUE §23.4.5): the checklist the server enforces, "as <person> will see it", "as the signed copy", and "send me a test".
import { useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { useWrite } from "@/lib/documents/ports.js";
import { PdfPage, usePdf } from "./pdfView.jsx";
import { seatColour } from "./editorStore.js";

const SAMPLE = { signature: "Jane Sample", initials: "JS", date_signed: "October 3, 2026", text: "Sample text", checkbox: "✕", dropdown: "Option", image: "▣" };

function Preview({ doc, loadFile, mode, seat }) {
  const { pdf } = usePdf(loadFile, doc.body.file.file_id);
  const w = Math.min(560, typeof window === "undefined" ? 560 : window.innerWidth - 48);
  if (!pdf) return <p className="p-6 text-center text-mute">Loading pages…</p>;
  return (
    <div className="max-h-[560px] space-y-3 overflow-auto rounded-card border border-line bg-surface-sunken p-3" data-testid={`preview-${mode}`}>
      {Array.from({ length: doc.body.file.page_count }, (_, i) => i + 1).map((n) => {
        const h = w * (doc.body.file.pages[n - 1].h / doc.body.file.pages[n - 1].w);
        return <PdfPage key={n} pdf={pdf} pageNumber={n} width={w}>
          {doc.body.fields.filter((f) => f.page === n).map((f) => {
            const mine = f.role === seat, c = seatColour(f.role);
            return <div key={f.id} className="absolute flex items-center overflow-hidden px-1" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ...(mode === "signed" ? { color: "#1e1b4b", fontFamily: f.type === "signature" ? "cursive" : "inherit", fontSize: Math.max(8, f.h * h * 0.6) } : { background: mine ? `${c}22` : "#0000000a", border: `1.5px ${mine ? "solid" : "dashed"} ${mine ? c : "#9ca3af"}`, color: mine ? c : "#6b7280", fontSize: 11 }) }}>
              {mode === "signed" ? SAMPLE[f.type] : (mine ? `${f.label || f.type}${f.required ? " *" : ""}` : "")}
            </div>;
          })}
        </PdfPage>;
      })}
    </div>
  );
}

export default function CheckStep({ doc, loadFile }) {
  const [view, setView] = useState("signing");
  const signers = doc.parties.filter((p) => p.action_role === "signer");
  const [seat, setSeat] = useState(signers[0]?.role ?? "signer_1");
  const test = useWrite("POST /api/documents/pdf/test");
  const [testMsg, setTestMsg] = useState(null);
  const items = doc.checklist?.items ?? [];
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" data-testid="check-step">
      <section aria-label="Checklist" className="space-y-3">
        <ul className="m-0 list-none space-y-1.5 p-0" data-testid="check-list">
          {items.map((it, i) => <li key={i} className={`flex gap-2 text-ui ${it.ok ? "text-ink" : it.severity === "warning" ? "text-warn" : "text-bad"}`} data-ok={it.ok} data-testid="check-item"><span aria-hidden="true">{it.ok ? "✓" : it.severity === "warning" ? "!" : "✕"}</span><span>{it.text}</span></li>)}
        </ul>
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="sm" disabled={test.busy} onClick={async () => { setTestMsg(null); try { const r = await test.run({ body: { instanceId: doc.id } }); setTestMsg(r.sent ? `A test was sent to ${r.to}.` : `The test could not be emailed (${r.status}).`); } catch (e) { setTestMsg(e.message); } }} data-testid="check-send-test">Send me a test</Button>
          {testMsg && <p className="m-0 text-meta text-mute" role="status" data-testid="check-test-msg">{testMsg}</p>}
        </div>
      </section>
      <section aria-label="Preview" className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="inline-flex rounded border border-line">
            {[["signing", "As the signer sees it"], ["signed", "As the signed copy"]].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} type="button" onClick={() => setView(k)} className={`px-3 py-1.5 text-ui ${view === k ? "bg-paper font-medium" : ""}`} data-testid={`preview-tab-${k}`}>{l}</button>)}
          </div>
          {view === "signing" && signers.length > 1 && <NativeSelect className="w-auto" value={seat} onChange={(e) => setSeat(e.currentTarget.value)} aria-label="See it as">{signers.map((p) => <NativeSelectOption key={p.role} value={p.role}>{p.name}</NativeSelectOption>)}</NativeSelect>}
        </div>
        <Preview doc={doc} loadFile={loadFile} mode={view} seat={seat} />
      </section>
    </div>
  );
}
