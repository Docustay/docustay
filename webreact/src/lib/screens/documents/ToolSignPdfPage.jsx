// FREE "SIGN A PDF ONLINE" — public, no account (QUEUE §23.5.14). Drop a PDF, put a signature, the date and any text where you want them, download the signed PDF.
// ★ EVERYTHING RUNS IN THIS BROWSER TAB. The file is read with FileReader, drawn with pdf.js, and the marks are burned in by the SAME flattening the server uses (src/documents/pdfFlatten.mjs, run here with pdf-lib).
//   There is not one network request in this page after it loads — that is the claim on the screen, so it is also kept true in the code.
// It makes a picture of a signature, not a legally evidenced one: no audit trail, no certificate. The end of the page offers the real thing.
import { useCallback, useMemo, useRef, useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { usePdf, PdfPage } from "./pdf/pdfView.jsx";
import SignaturePad from "./pdf/SignaturePad.jsx";
import { flattenOntoOriginal } from "@keystone/documents/pdfFlatten.mjs";

const MAX_BYTES = 25 * 1024 * 1024;
const SIZES = { signature: { w: 0.26, h: 0.06 }, text: { w: 0.3, h: 0.03 }, date: { w: 0.18, h: 0.03 } };
const todayText = () => { try { return new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch { return new Date().toISOString().slice(0, 10); } };

export default function ToolSignPdfPage() {
  const [bytes, setBytes] = useState(null);                 // ArrayBuffer of the chosen file
  const [name, setName] = useState("");
  const [problem, setProblem] = useState(null);
  const [mode, setMode] = useState("signature");            // what a click on a page drops
  const [marks, setMarks] = useState([]);                   // { id, type, page, x, y, w, h, value?, mark? }
  const [padFor, setPadFor] = useState(null);               // a placed signature waiting for its drawing
  const [width, setWidth] = useState(720);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const column = useRef(null), seq = useRef(0);

  const loadBytes = useCallback(async () => bytes, [bytes]);
  const { pdf, error: pdfError } = usePdf(loadBytes, bytes ? `${name}:${bytes.byteLength}` : null);
  const pages = useMemo(() => Array.from({ length: pdf?.numPages ?? 0 }, (_, i) => i + 1), [pdf]);

  function choose(file) {
    setProblem(null); setDone(false);
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setProblem("That is not a PDF. Choose a file that ends in .pdf."); return; }
    if (file.size > MAX_BYTES) { setProblem("That file is over 25 MB. Choose a smaller one."); return; }
    const r = new FileReader();
    r.onload = () => { setBytes(r.result); setName(file.name); setMarks([]); setWidth(Math.max(280, Math.min(820, (column.current?.clientWidth ?? window.innerWidth) - 16))); };
    r.onerror = () => setProblem("That file could not be read.");
    r.readAsArrayBuffer(file);
  }

  function place(e, page) {
    if (e.target.closest("[data-mark]")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const size = SIZES[mode];
    const x = Math.min(Math.max((e.clientX - r.left) / r.width - size.w / 2, 0), 1 - size.w);
    const y = Math.min(Math.max((e.clientY - r.top) / r.height - size.h / 2, 0), 1 - size.h);
    const id = `m${(seq.current += 1)}`;
    const base = { id, type: mode, page, x, y, ...size };
    if (mode === "date") setMarks((m) => [...m, { ...base, value: todayText() }]);
    else if (mode === "text") setMarks((m) => [...m, { ...base, value: "" }]);
    else { setMarks((m) => [...m, { ...base, mark: null }]); setPadFor(id); }
  }
  const update = (id, patch) => setMarks((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id) => { setMarks((m) => m.filter((x) => x.id !== id)); if (padFor === id) setPadFor(null); };

  async function download() {
    setBusy(true); setProblem(null);
    try {
      const real = marks.filter((m) => (m.type === "signature" ? m.mark : m.value));
      if (real.length === 0) { setProblem("Add at least one signature, date or text first — click on the page to place it."); setBusy(false); return; }
      const out = await flattenOntoOriginal(new Uint8Array(bytes), real.map((m) => ({ id: m.id, type: m.type === "signature" ? "signature" : "text", role: "signer_1", page: m.page, x: m.x, y: m.y, w: m.w, h: m.h })), Object.fromEntries(real.map((m) => [m.id, { value: m.type === "signature" ? null : m.value, mark: m.type === "signature" ? m.mark : null }])));
      const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${name.replace(/\.pdf$/i, "")} - signed.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDone(true);
    } catch { setProblem("That PDF could not be signed here. It may be damaged or password protected."); }
    setBusy(false);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-4 py-8" data-testid="tool-sign-pdf" ref={column}>
      <PageTitle>Sign a PDF online</PageTitle>
      <p className="m-0 mt-1 text-body text-ink-2">Free, no account. Your file never leaves this device — it is not uploaded anywhere.</p>
      {!bytes ? (
        <label className="mt-6 flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line bg-surface p-10 text-center" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files?.[0]); }} data-testid="tool-drop">
          <span className="text-ui font-medium text-ink">Drop a PDF here, or choose one</span>
          <span className="text-meta text-mute">Up to 25 MB</span>
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} data-testid="tool-file" aria-label="Choose a PDF to sign" />
        </label>
      ) : (
        <>
          <div className="sticky top-0 z-30 mt-4 flex flex-wrap items-center gap-2 border-b border-line bg-paper py-2" data-testid="tool-bar">
            <span className="text-meta text-mute">Click the page to place:</span>
            {[["signature", "Signature"], ["date", "Date"], ["text", "Text"]].map(([k, l]) => <Button key={k} size="sm" variant={mode === k ? "default" : "outline"} onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`tool-mode-${k}`}>{l}</Button>)}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => { setBytes(null); setMarks([]); setDone(false); }} data-testid="tool-another">Another file</Button>
            <Button size="sm" onClick={download} disabled={busy} data-testid="tool-download">{busy ? "Preparing…" : "Download signed PDF"}</Button>
          </div>
          {pdfError && <p role="alert" className="mt-3 text-bad" data-testid="tool-pdf-error">That PDF could not be opened. It may be damaged or password protected.</p>}
          <div className="mt-4 space-y-4" aria-label="Pages">
            {pages.map((n) => (
              <div key={n} className="mx-auto cursor-crosshair" style={{ width }} onClick={(e) => place(e, n)} data-testid={`tool-page-${n}`}>
                <PdfPage pdf={pdf} pageNumber={n} width={width}>
                  {marks.filter((m) => m.page === n).map((m) => (
                    <div key={m.id} data-mark={m.id} className="border border-ink bg-yellow-100/60" style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
                      {m.type === "signature" ? (m.mark ? <img src={m.mark} alt="Your signature" className="h-full w-full object-contain" /> : <button type="button" className="h-full w-full text-caption" onClick={() => setPadFor(m.id)}>Sign here</button>)
                        : <input value={m.value} onChange={(e) => update(m.id, { value: e.currentTarget.value })} aria-label={m.type === "date" ? "Date" : "Text"} placeholder="Type here" className="h-full w-full bg-transparent px-1 text-caption outline-none" />}
                      <button type="button" className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-ink text-[10px] leading-4 text-surface" onClick={() => remove(m.id)} aria-label="Remove this" data-testid="tool-remove">×</button>
                    </div>))}
                </PdfPage>
              </div>))}
          </div>
        </>
      )}
      {problem && <p role="alert" className="mt-3 text-meta text-bad" data-testid="tool-problem">{problem}</p>}
      {padFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Add your signature">
          <div className="w-full max-w-[520px] rounded-t-card bg-surface p-4 sm:rounded-card"><SignaturePad label="signature" onDone={(url) => { update(padFor, { mark: url }); setPadFor(null); }} onCancel={() => { const id = padFor; setPadFor(null); setMarks((m) => m.filter((x) => !(x.id === id && !x.mark))); }} /></div>
        </div>)}
      {done && (
        <div className="mt-6 rounded-card border border-line bg-surface p-5" data-testid="tool-next">
          <p className="m-0 text-ui font-medium text-ink">Downloaded.</p>
          <p className="m-0 mt-1 text-meta text-ink-2">This is a picture of a signature on your PDF — there is no record of who signed or when. If you need that, or need other people to sign too, send it for signature: each person gets a link, and you get a sealed copy with a certificate.</p>
          <div className="mt-3 flex gap-2"><Button asChild><a href="/signup" data-testid="tool-signup">Create a free account</a></Button><Button variant="ghost" onClick={() => setDone(false)}>Keep editing</Button></div>
        </div>)}
    </main>
  );
}
