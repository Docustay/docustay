// DocsUpload — STEPS 1 and 2 (QUEUE §23.4.1, §23.4.2): one big drop zone (drop, click, paste, or take a photo on a phone), the progress of the upload and of reading the pages, then straight on to the draft.
// ★ First-time state: a practice with no documents sees only this and "Try with a sample".
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Progress } from "@/lib/components/ui/progress.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { uploadFile } from "@/lib/documents/upload.js";
import { useWrite } from "@/lib/documents/ports.js";

const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg";
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** A small real PDF built in the browser for "Try with a sample" (no download, nothing stored until the person goes on). */
async function sampleFile() {
  const text = "SAMPLE SERVICE AGREEMENT\n\nThis sample shows how sending a document works. The two parties agree to try it.\n\nSignature: ______________________\n\nDate: ______________\n\nPrinted name: ______________________";
  const esc = (s) => s.replace(/[\\()]/g, "\\$&");
  const lines = text.split("\n");
  const stream = `BT /F1 12 Tf 72 720 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([out], "Sample agreement.pdf", { type: "application/pdf" });
}

export default function DocsUpload({ onNavigate = null }) {
  const [phase, setPhase] = useState("idle");           // idle | uploading | processing | error
  const [prog, setProg] = useState({ sent: 0, total: 0 });
  const [file, setFile] = useState(null);
  const [problem, setProblem] = useState(null);
  const [over, setOver] = useState(false);
  const [templates, setTemplates] = useState([]);
  const ctl = useRef(null), resume = useRef(null);
  const fromTemplate = useWrite("POST /api/documents/pdf/from-template");
  const go = (p) => onNavigate?.(p);

  useEffect(() => { api.pdfTemplates().then((r) => setTemplates(r.templates.filter((t) => t.active && t.approval_status === "approved"))).catch(() => {}); }, []);

  async function start(f) {
    if (!f) return;
    setFile(f); setProblem(null); setPhase("uploading"); setProg({ sent: 0, total: f.size });
    ctl.current = new AbortController();
    try {
      const r = await uploadFile(f, { signal: ctl.current.signal, resumeUploadId: resume.current, onProgress: (p) => { setProg(p); if (p.phase === "processing") setPhase("processing"); if (p.uploadId) resume.current = p.uploadId; } });
      resume.current = null;
      go(`/documents/pdf/${r.instanceId}`);
    } catch (e) {
      if (e.name === "AbortError") { setPhase("idle"); resume.current = null; return; }
      if (e.uploadId) resume.current = e.uploadId;
      setProblem(e instanceof ApiError || e.message ? e.message : "The upload did not finish."); setPhase("error");
    }
  }
  useEffect(() => { const onPaste = (e) => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); start(f); } }; window.addEventListener("paste", onPaste); return () => window.removeEventListener("paste", onPaste); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onDrop = (e) => { e.preventDefault(); setOver(false); start(e.dataTransfer.files?.[0]); };
  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-upload" data-phase={phase}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <PageTitle>Send a document for signature</PageTitle>
      <div className={`mt-5 flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed p-8 text-center ${over ? "border-ink bg-paper" : "border-line bg-surface"}`} data-testid="upload-zone">
        {!busy ? (<>
          <p className="m-0 text-heading font-medium text-ink">Drop a file here</p>
          <p className="m-0 max-w-[48ch] text-meta text-mute">PDF, Word, Excel, PowerPoint, or a photo (JPEG or PNG) — up to 100 MB. You can also paste a file, or choose one.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center rounded bg-ink px-4 text-ui text-surface">Choose a file<input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { start(e.target.files?.[0]); e.target.value = ""; }} data-testid="upload-input" /></label>
            <label className="inline-flex h-9 cursor-pointer items-center rounded border border-line bg-surface px-4 text-ui md:hidden">Take a photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { start(e.target.files?.[0]); e.target.value = ""; }} data-testid="upload-camera" /></label>
            <Button variant="outline" onClick={async () => start(await sampleFile())} data-testid="upload-sample">Try with a sample</Button>
          </div>
        </>) : (
          <div className="w-full max-w-[420px] space-y-2" role="status" data-testid="upload-progress">
            <p className="m-0 text-ui font-medium text-ink">{phase === "processing" ? "Reading the pages…" : prog.phase === "hashing" ? "Checking the file…" : `Uploading ${file?.name ?? ""}`}</p>
            <Progress value={prog.total ? Math.round((prog.sent / prog.total) * 100) : 0} aria-label="Upload progress" />
            <p className="m-0 text-caption text-mute">{mb(prog.sent)} of {mb(prog.total)}</p>
            {phase === "uploading" && <Button variant="ghost" size="sm" onClick={() => ctl.current?.abort()} data-testid="upload-cancel">Cancel</Button>}
          </div>
        )}
        {phase === "error" && (
          <div className="space-y-2" role="alert" data-testid="upload-error"><p className="m-0 text-ui text-bad">{problem}</p>
            <div className="flex justify-center gap-2">{resume.current && file && <Button size="sm" onClick={() => start(file)} data-testid="upload-retry">Try again (it will carry on where it stopped)</Button>}<Button size="sm" variant="outline" onClick={() => { resume.current = null; setPhase("idle"); setFile(null); }}>Choose another file</Button></div></div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3" data-testid="upload-alternatives">
        <Button variant="outline" onClick={() => go("/documents?new=1")}>Start from a template</Button>
        <Button variant="outline" onClick={() => go("/documents/templates/new")}>Write one</Button>
        <Button variant="outline" onClick={() => go("/documents/kiosk")} data-testid="upload-kiosk">Kiosk mode</Button>
        <Button variant="outline" onClick={() => go("/documents/bulk")} data-testid="upload-bulk">Send to a list</Button>
        {templates.length > 0 && (
          <span className="flex items-center gap-2 text-meta text-mute">or reuse an uploaded one:
            {templates.slice(0, 4).map((t) => <Button key={t.id} size="sm" variant="ghost" disabled={fromTemplate.busy} onClick={async () => { const r = await fromTemplate.run({ body: { templateId: t.id } }); go(`/documents/pdf/${r.instanceId}`); }} data-testid="upload-template">{t.name}</Button>)}</span>
        )}
      </div>
    </div>
  );
}
