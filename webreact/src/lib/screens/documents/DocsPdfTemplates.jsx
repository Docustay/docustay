// DocsPdfTemplates — UPLOADED-DOCUMENT TEMPLATES (QUEUE §23.5.5): find (search, folder, tag), start a document from one, clone one, open one to change it, and — when the practice asks for approval — approve or reject.
// ★ Retired and rejected templates stay out of the way unless asked for; a template waiting for approval says so on its row.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { useWrite } from "@/lib/documents/ports.js";

export default function DocsPdfTemplates({ onNavigate = null }) {
  const go = (p) => onNavigate?.(p);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState(""), [folder, setFolder] = useState(""), [tag, setTag] = useState(""), [retired, setRetired] = useState(false);
  const [note, setNote] = useState(null);
  const [rejecting, setRejecting] = useState(null);       // { id, reason }
  const fromTemplate = useWrite("POST /api/documents/pdf/from-template");
  const clone = useWrite("POST /api/documents/pdf/templates/clone");
  const approve = useWrite("POST /api/documents/pdf/templates/approve");
  const reject = useWrite("POST /api/documents/pdf/templates/reject");

  const load = useCallback(() => api.pdfTemplates({ q, folder, tag, retired }).then((r) => { setData(r); setError(null); }).catch(setError), [q, folder, tag, retired]);
  useEffect(() => { const id = setTimeout(load, q ? 250 : 0); return () => clearTimeout(id); }, [load, q]);

  const act = async (fn, msg) => { setNote(null); try { const r = await fn(); if (msg) setNote(msg); await load(); return r; } catch (e) { setNote(e.message); return null; } };
  const filtered = Boolean(q || folder || tag);

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-pdf-templates">
      <div className="mb-4 flex flex-wrap items-center gap-3"><PageTitle>Uploaded templates</PageTitle>
        <Button className="ml-auto" onClick={() => go("/documents/upload")} data-testid="tpl-upload">Upload a file</Button></div>
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="tpl-controls">
        <Input className="min-w-[200px] max-w-[280px]" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search name, folder or tag" aria-label="Search templates" data-testid="tpl-search" />
        <NativeSelect className="w-auto" value={folder} onChange={(e) => setFolder(e.currentTarget.value)} aria-label="Folder" data-testid="tpl-folder"><NativeSelectOption value="">All folders</NativeSelectOption>{(data?.folders ?? []).map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect className="w-auto" value={tag} onChange={(e) => setTag(e.currentTarget.value)} aria-label="Tag" data-testid="tpl-tag"><NativeSelectOption value="">All tags</NativeSelectOption>{(data?.tags ?? []).map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}</NativeSelect>
        <label className="flex items-center gap-1 text-meta text-ink-2"><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} data-testid="tpl-retired" /> Include retired</label>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setFolder(""); setTag(""); }} data-testid="tpl-clear">Clear filters</Button>}
      </div>
      {note && <p className="m-0 mb-2 text-meta text-ink-2" role="status" data-testid="tpl-note">{note}</p>}
      {error ? <p role="alert" className="text-bad" data-testid="tpl-error">The templates could not be loaded ({error.message}).</p>
        : !data ? <p className="text-mute">Loading…</p>
        : data.templates.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-8 text-center" data-testid="tpl-empty">
            {filtered ? <><p className="m-0 text-body text-ink">No templates match.</p><Button className="mt-3" variant="outline" onClick={() => { setQ(""); setFolder(""); setTag(""); }}>Clear filters</Button></>
              : <><p className="m-0 text-body text-ink">No uploaded templates yet.</p><p className="m-0 mt-1 text-meta text-mute">Upload a file, place the fields, and tick “Save as a template” on the Send step.</p><Button className="mt-3" onClick={() => go("/documents/upload")}>Upload a file</Button></>}
          </div>
        ) : (
          <table className="w-full border-collapse" data-testid="tpl-table"><thead><tr>{["Name", "Folder", "Tags", "People · fields", ""].map((h) => <th key={h} className="h-9 border-b border-line bg-surface-sunken px-3 text-left text-caption font-medium text-mute">{h}</th>)}</tr></thead>
            <tbody>{data.templates.map((t) => (
              <tr key={t.id} className="hover:bg-paper" data-testid="tpl-row" data-status={t.approval_status} data-active={String(t.active)}>
                <td className="h-10 border-b border-line-soft px-3 text-ui"><button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => go(`/documents/templates/pdf/${t.id}`)} data-testid="tpl-open">{t.name}</button>
                  <span className="ml-2 text-caption text-mute">v{t.version}{t.versions > 1 ? ` of ${t.versions}` : ""}</span>
                  {t.approval_status === "pending" && <span className="ml-2"><StatusBadge label="Waiting for approval" tone="info" /></span>}
                  {t.approval_status === "rejected" && <span className="ml-2"><StatusBadge label="Not approved" tone="bad" /></span>}
                  {!t.active && t.approval_status !== "pending" && <span className="ml-2"><StatusBadge label="Retired" tone="neutral" /></span>}
                  {t.self_serve_enabled && <span className="ml-2"><StatusBadge label="Public link" tone="good" /></span>}</td>
                <td className="border-b border-line-soft px-3 text-ui text-ink-2">{t.folder ?? ""}</td>
                <td className="border-b border-line-soft px-3 text-caption text-mute">{(t.tags ?? []).join(", ")}</td>
                <td className="border-b border-line-soft px-3 text-caption text-mute">{t.seats} · {t.fields}</td>
                <td className="border-b border-line-soft px-3 text-right whitespace-nowrap">
                  {t.active && t.approval_status === "approved" && <Button size="sm" variant="ghost" disabled={fromTemplate.busy} onClick={async () => { const r = await act(() => fromTemplate.run({ body: { templateId: t.id } })); if (r?.instanceId) go(`/documents/pdf/${r.instanceId}`); }} data-testid="tpl-use">Use</Button>}
                  {t.approval_status === "pending" && <><Button size="sm" variant="outline" disabled={approve.busy} onClick={() => act(() => approve.run({ body: { templateId: t.id } }), `“${t.name}” approved.`)} data-testid="tpl-approve">Approve</Button><Button size="sm" variant="ghost" onClick={() => setRejecting({ id: t.id, reason: "" })} data-testid="tpl-reject">Reject</Button></>}
                  <Button size="sm" variant="ghost" disabled={clone.busy} onClick={() => act(() => clone.run({ body: { templateId: t.id } }), `Copied “${t.name}”.`)} data-testid="tpl-clone">Clone</Button>
                  {rejecting?.id === t.id && <span className="ml-2 inline-flex items-center gap-1"><Input className="h-8 w-52" value={rejecting.reason} onChange={(e) => setRejecting({ ...rejecting, reason: e.currentTarget.value })} placeholder="Why?" aria-label="Reason for rejecting" data-testid="tpl-reject-reason" /><Button size="sm" onClick={() => act(() => reject.run({ body: { templateId: t.id, reason: rejecting.reason } }), "Rejected.").then(() => setRejecting(null))} data-testid="tpl-reject-go">Reject</Button></span>}
                </td>
              </tr>))}</tbody></table>
        )}
      {data?.approvalRequired && <p className="mt-3 text-caption text-mute" data-testid="tpl-approval-note">New templates and new versions wait for an owner or admin to approve them before they can be sent.</p>}
    </div>
  );
}
