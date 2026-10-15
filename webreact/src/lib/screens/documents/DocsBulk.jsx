// DocsBulk — SEND ONE TEMPLATE TO MANY PEOPLE FROM A SPREADSHEET (QUEUE §23.5.3). Pick an uploaded template with one signer, drop a CSV (name, email, plus any extra columns), check the list, send. Each row becomes its own document.
// ★ Check first (a dry run names every bad row, creates nothing), then send in batches of 25 so a long list never times out; a bad row never spoils the rest.
import { useEffect, useState } from "react";
import Papa from "papaparse";
import { request } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { useWrite } from "@/lib/documents/ports.js";

const BATCH = 25;

export default function DocsBulk({ onNavigate = null }) {
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState(null);
  const [check, setCheck] = useState(null);          // the dry run's results, one per row
  const [done, setDone] = useState(null);            // { sent, failed, results } after sending
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const bulk = useWrite("POST /api/documents/pdf/bulk");

  useEffect(() => { request("/api/documents/pdf/kiosk-templates").then((r) => { setTemplates(r.templates); setTemplateId(r.templates[0]?.id ?? ""); }).catch((e) => { setProblem(e.message); setTemplates([]); }); }, []);

  const batches = (list) => Array.from({ length: Math.ceil(list.length / BATCH) }, (_, k) => list.slice(k * BATCH, (k + 1) * BATCH));
  async function run(dryRun) {
    setBusy(true); setProblem(null);
    try {
      const results = [];
      let offset = 0;
      for (const part of batches(rows)) {
        const r = await bulk.run({ body: { templateId, rows: part, dryRun } });
        results.push(...r.results.map((x) => ({ ...x, row: x.row + offset })));
        offset += part.length;
      }
      const summary = { sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
      if (dryRun) setCheck(summary); else setDone(summary);
    } catch (e) { setProblem(e.message || "Something went wrong."); } finally { setBusy(false); }
  }
  function onFile(file) {
    if (!file) return;
    setFileName(file.name); setCheck(null); setDone(null); setProblem(null);
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => { if (!r.data.length) setProblem("That file has no rows."); setRows(r.data.slice(0, 1000)); }, error: () => setProblem("That file could not be read as a spreadsheet (CSV).") });
  }

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-bulk">
      <PageTitle>Send to a list</PageTitle>
      {templates === null ? <p className="text-mute">Loading…</p> : templates.length === 0 ? (
        <p className="mt-4 text-body text-ink-2" data-testid="bulk-empty">Sending to a list uses an uploaded document with exactly one person signing, saved as a template. <Button variant="outline" size="sm" onClick={() => onNavigate?.("/documents/upload")}>Upload one</Button></p>
      ) : (
        <div className="mt-4 max-w-[860px] space-y-5">
          <div><p className="m-0 mb-1 text-ui font-medium">Document</p>
            <NativeSelect value={templateId} onChange={(e) => { setTemplateId(e.currentTarget.value); setCheck(null); setDone(null); }} aria-label="Template" data-testid="bulk-template">{templates.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name}</NativeSelectOption>)}</NativeSelect></div>
          <div><p className="m-0 mb-1 text-ui font-medium">Spreadsheet (CSV)</p>
            <p className="m-0 mb-2 text-meta text-mute">One row per person. Columns: <b>name</b> and <b>email</b>; any other column (for example <b>company</b>) can be used in the email as {"{{custom.company}}"}. At most 1000 rows.</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Choose a CSV file" data-testid="bulk-file" />
            {fileName && <p className="m-0 mt-1 text-meta text-ink-2" data-testid="bulk-count">{fileName}: {rows.length} row{rows.length === 1 ? "" : "s"}</p>}</div>
          {rows.length > 0 && !done && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => run(true)} data-testid="bulk-check">Check the list</Button>
            <Button disabled={busy || !check || check.sent === 0} onClick={() => run(false)} data-testid="bulk-send">{check ? `Send to ${check.sent} ${check.sent === 1 ? "person" : "people"}` : "Send"}</Button></div>}
          {check && !done && <div data-testid="bulk-check-result"><p className="m-0 text-ui" role="status">{check.sent} ready{check.failed ? `, ${check.failed} to fix` : ""}.</p>
            {check.failed > 0 && <ul className="m-0 mt-1 list-disc pl-5 text-meta text-bad">{check.results.filter((r) => !r.ok).slice(0, 30).map((r) => <li key={r.row}>Row {r.row}: {r.error}</li>)}</ul>}
            {check.failed > 0 && check.sent > 0 && <p className="m-0 mt-1 text-meta text-mute">Rows with a problem are skipped when you send.</p>}</div>}
          {done && <div data-testid="bulk-done"><p className="m-0 text-ui" role="status">Sent to {done.sent} {done.sent === 1 ? "person" : "people"}{done.failed ? `; ${done.failed} skipped` : ""}.</p>
            {done.failed > 0 && <ul className="m-0 mt-1 list-disc pl-5 text-meta text-bad">{done.results.filter((r) => !r.ok).slice(0, 30).map((r) => <li key={r.row}>Row {r.row}: {r.error}</li>)}</ul>}
            <Button className="mt-3" variant="outline" onClick={() => onNavigate?.("/documents")}>Back to documents</Button></div>}
          {problem && <p role="alert" className="m-0 text-meta text-bad" data-testid="bulk-problem">{problem}</p>}
        </div>
      )}
    </div>
  );
}
