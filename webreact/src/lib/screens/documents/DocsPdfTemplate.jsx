// DocsPdfTemplate — ONE UPLOADED-DOCUMENT TEMPLATE (QUEUE §23.5.5, §23.5.7): its details (name, folder, tags), the send choices it remembers, its public link, its fields (changing them saves a NEW version, with a note), its versions and what changed.
// ★ Only the current version can change; an earlier one is shown read-only. With approval switched on, a new version waits (and the current one keeps working) until an owner or admin approves it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { useWrite } from "@/lib/documents/ports.js";
import FieldsStep from "./pdf/FieldsStep.jsx";

const Section = ({ title, help, children, testId }) => <section className="rounded-card border border-line bg-surface p-4" data-testid={testId}><h2 className="m-0 text-heading font-medium">{title}</h2>{help && <p className="m-0 mt-0.5 text-meta text-mute">{help}</p>}<div className="mt-3 space-y-3">{children}</div></section>;
const Row = ({ label, children }) => <label className="grid gap-1 md:grid-cols-[180px_minmax(0,1fr)] md:items-center"><span className="text-ui text-ink-2">{label}</span>{children}</label>;
const bodyKey = (b) => JSON.stringify({ roles: b.roles, fields: b.fields });
const when = (v) => (v ? new Date(v).toLocaleDateString([], { dateStyle: "medium" }) : "");

export default function DocsPdfTemplate({ params = null, onNavigate = null }) {
  const id = params?.id;
  const go = (p) => onNavigate?.(p);
  const [t, setT] = useState(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [draft, setDraft] = useState(null);
  const [changeNote, setChangeNote] = useState("");
  const [details, setDetails] = useState({ name: "", folder: "", tags: "" });
  const [choices, setChoices] = useState({});
  const [link, setLink] = useState({ enabled: false, slug: "" });
  const [diff, setDiff] = useState(null);
  const meta = useWrite("POST /api/documents/pdf/templates/meta");
  const version = useWrite("POST /api/documents/pdf/templates/version");
  const clone = useWrite("POST /api/documents/pdf/templates/clone");
  const retire = useWrite("POST /api/documents/pdf/templates/retire");
  const approve = useWrite("POST /api/documents/pdf/templates/approve");
  const reject = useWrite("POST /api/documents/pdf/templates/reject");
  const fromTemplate = useWrite("POST /api/documents/pdf/from-template");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.pdfTemplate(id);
      setT(r); setDraft(r.body); setError(null);
      setDetails({ name: r.name, folder: r.folder ?? "", tags: (r.tags ?? []).join(", ") });
      setChoices(r.send_defaults ?? {}); setLink({ enabled: r.self_serve_enabled, slug: r.self_serve_slug ?? "" });
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const loadFile = useCallback(async () => {
    const r = await fetch(`/api/documents/pdf/templates/${encodeURIComponent(id)}/file`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`the pages could not be loaded (${r.status})`);
    return r.arrayBuffer();
  }, [id]);
  const synthetic = useMemo(() => (t ? { id: t.id, body: t.body, parties: [] } : null), [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="p-6 text-bad" role="alert" data-testid="tpl-load-error">This template could not be loaded ({error.message}). <Button size="sm" variant="outline" onClick={() => go("/documents/templates/pdf")}>Back to templates</Button></p>;
  if (!t) return <p className="p-6 text-mute">Loading…</p>;

  const act = async (fn, msg) => { setNote(null); try { const r = await fn(); setNote(msg); await load(); return r; } catch (e) { setNote(e.message); return null; } };
  const editable = t.active && t.approval_status === "approved";
  const pendingNewer = t.versions.find((v) => v.approval_status === "pending" && !v.active);
  const dirty = draft && bodyKey(draft) !== bodyKey(t.body);
  const link_url = link.slug && t.self_serve_enabled ? `${window.location.origin}/s/${link.slug}` : null;
  const setDefault = (k, v) => setChoices((c) => { const n = { ...c }; if (v === "" || v === undefined || v === null) delete n[k]; else n[k] = v; return n; });

  return (
    <div className="space-y-4 px-4 py-6 md:px-7" data-testid="docs-pdf-template" data-version={t.version} data-active={String(t.active)}>
      <div className="flex flex-wrap items-center gap-3">
        <PageTitle>{t.name}</PageTitle><span className="text-meta text-mute">version {t.version}</span>
        {t.approval_status === "pending" && <StatusBadge label="Waiting for approval" tone="info" />}
        {t.approval_status === "rejected" && <StatusBadge label="Not approved" tone="bad" />}
        {!t.active && t.approval_status === "approved" && <StatusBadge label="Retired version" tone="neutral" />}
        <span className="ml-auto flex flex-wrap gap-2">
          {t.active && t.approval_status === "approved" && <Button disabled={fromTemplate.busy} onClick={async () => { const r = await act(() => fromTemplate.run({ body: { templateId: t.id } }), ""); if (r?.instanceId) go(`/documents/pdf/${r.instanceId}`); }} data-testid="tpl-use">Use this template</Button>}
          <Button variant="outline" disabled={clone.busy} onClick={() => act(() => clone.run({ body: { templateId: t.id } }), "Copied — find the copy in the list.")} data-testid="tpl-clone">Clone</Button>
          {t.active && <Button variant="ghost" disabled={retire.busy} onClick={() => setRetireOpen(true)} data-testid="tpl-retire">Retire</Button>}
          {/* F172: the app's own confirm, not window.confirm */}
          <ConfirmAction open={retireOpen} onOpenChange={setRetireOpen} verb="Retire" object="this template"
            consequence="Documents already made from it are not affected." confirmLabel="Retire" busy={retire.busy} testId="tpl-retire-confirm"
            onCancel={() => setRetireOpen(false)}
            onConfirm={() => { setRetireOpen(false); act(() => retire.run({ body: { templateId: t.id } }), "Retired.").then(() => go("/documents/templates/pdf")); }} />
          <Button variant="ghost" onClick={() => go("/documents/templates/pdf")}>All templates</Button>
        </span>
      </div>
      {note && <p className="m-0 text-meta text-ink-2" role="status" data-testid="tpl-note">{note}</p>}

      {t.approval_status === "pending" && (
        <Section title="Waiting for approval" help="Nobody can send this until an owner or admin approves it." testId="tpl-approval">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={approve.busy} onClick={() => act(() => approve.run({ body: { templateId: t.id } }), "Approved.")} data-testid="tpl-approve">Approve</Button>
            <Input className="max-w-[320px]" value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="Why not? (needed to reject)" aria-label="Reason for rejecting" data-testid="tpl-reject-reason" />
            <Button variant="outline" disabled={reject.busy || !reason.trim()} onClick={() => act(() => reject.run({ body: { templateId: t.id, reason } }), "Rejected.")} data-testid="tpl-reject">Reject</Button>
          </div>
        </Section>)}
      {t.approval_status === "rejected" && <p className="m-0 rounded-card border border-line bg-surface p-3 text-meta text-bad" role="status" data-testid="tpl-rejected">Not approved{t.approval_note ? `: ${t.approval_note}` : "."}</p>}

      <Section title="Details" testId="tpl-details">
        <Row label="Name"><Input value={details.name} onChange={(e) => setDetails({ ...details, name: e.currentTarget.value })} data-testid="tpl-name" /></Row>
        <Row label="Folder"><Input value={details.folder} onChange={(e) => setDetails({ ...details, folder: e.currentTarget.value })} placeholder="e.g. Intake" data-testid="tpl-folder" /></Row>
        <Row label="Tags"><Input value={details.tags} onChange={(e) => setDetails({ ...details, tags: e.currentTarget.value })} placeholder="comma-separated, e.g. liability, intake" data-testid="tpl-tags" /></Row>
        <Button disabled={meta.busy} onClick={() => act(() => meta.run({ body: { templateId: t.id, name: details.name, folder: details.folder, tags: details.tags.split(",").map((x) => x.trim()).filter(Boolean) } }), "Saved.")} data-testid="tpl-save-details">Save details</Button>
      </Section>

      <Section title="What it remembers when you send it" help="Each new document made from this template starts with these choices. Leave a box empty to use the practice's own." testId="tpl-choices">
        <Row label="Email subject"><Input value={choices.subject ?? ""} onChange={(e) => setDefault("subject", e.currentTarget.value)} data-testid="tpl-subject" /></Row>
        <Row label="Message"><Textarea rows={3} value={choices.message ?? ""} onChange={(e) => setDefault("message", e.currentTarget.value)} data-testid="tpl-message" /></Row>
        <Row label="Expires after (days)"><Input inputMode="numeric" className="max-w-[120px]" value={choices.expiry_days ?? ""} onChange={(e) => setDefault("expiry_days", e.currentTarget.value === "" ? undefined : Math.max(0, Math.min(365, Number(e.currentTarget.value) || 0)))} data-testid="tpl-expiry" /></Row>
        <Row label="Remind after (days)"><Input className="max-w-[200px]" placeholder="e.g. 3, 7" defaultValue={(choices.reminders?.days ?? []).join(", ")} onBlur={(e) => { const d = e.currentTarget.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60).slice(0, 3); setDefault("reminders", d.length ? { on: true, days: d } : undefined); }} data-testid="tpl-reminders" /></Row>
        <Row label="Signing order"><NativeSelect className="max-w-[220px]" value={choices.order ?? ""} onChange={(e) => setDefault("order", e.currentTarget.value)} data-testid="tpl-order"><NativeSelectOption value="">Practice default</NativeSelectOption><NativeSelectOption value="parallel">Everyone at once</NativeSelectOption><NativeSelectOption value="sequential">One after another</NativeSelectOption></NativeSelect></Row>
        <Row label="Language"><NativeSelect className="max-w-[220px]" value={choices.language ?? ""} onChange={(e) => setDefault("language", e.currentTarget.value)} data-testid="tpl-language"><NativeSelectOption value="">English</NativeSelectOption><NativeSelectOption value="es">Español</NativeSelectOption><NativeSelectOption value="fr">Français</NativeSelectOption><NativeSelectOption value="de">Deutsch</NativeSelectOption></NativeSelect></Row>
        <Button disabled={meta.busy} onClick={() => act(() => meta.run({ body: { templateId: t.id, sendDefaults: Object.keys(choices).length ? choices : null } }), "Saved.")} data-testid="tpl-save-choices">Save choices</Button>
      </Section>

      {t.active && t.approval_status === "approved" && (
        <Section title="Public link" help="Anyone with the link can fill this in and sign it — no account. It is rate-limited and checks that a person, not a script, is filling it in. Each person gets their own document." testId="tpl-link">
          <label className="flex items-center gap-2 text-ui"><input type="checkbox" checked={link.enabled} onChange={(e) => setLink({ ...link, enabled: e.target.checked })} data-testid="tpl-link-enabled" /> Turn the link on</label>
          <Row label="Link name"><Input value={link.slug} onChange={(e) => setLink({ ...link, slug: e.currentTarget.value.toLowerCase() })} placeholder="e.g. sign-our-waiver" data-testid="tpl-link-slug" /></Row>
          {t.body.roles.length !== 1 && <p className="m-0 text-meta text-bad" data-testid="tpl-link-seats">A public link needs a template with exactly one person signing; this one has {t.body.roles.length}.</p>}
          {link_url && <p className="m-0 text-meta" data-testid="tpl-link-url">Share: <a className="underline" href={link_url} target="_blank" rel="noopener noreferrer">{link_url}</a></p>}
          <Button disabled={meta.busy} onClick={() => act(() => meta.run({ body: { templateId: t.id, selfServe: { enabled: link.enabled, slug: link.slug || null } } }), link.enabled ? "The link is on." : "Saved.")} data-testid="tpl-save-link">Save link</Button>
        </Section>)}

      <Section title="People and fields" help={editable ? "Change where people sign and what they fill in. Saving makes a new version; documents already sent are not touched." : t.active ? "Waiting for approval — fields can be changed once it is approved." : "This is an earlier version, so it cannot be changed. Open the current version to edit."} testId="tpl-fields">
        {pendingNewer && <p className="m-0 text-meta text-ink-2" data-testid="tpl-pending-newer">Version {pendingNewer.version} is waiting for approval; this version keeps being used until then.</p>}
        {editable && !pendingNewer ? (
          <>
            <FieldsStep doc={synthetic} loadFile={loadFile} onChange={(b) => setDraft(b)} />
            <div className="flex flex-wrap items-center gap-2">
              <Input className="min-w-[240px] max-w-[420px] flex-1" value={changeNote} onChange={(e) => setChangeNote(e.currentTarget.value)} placeholder="What changed? (shown in the version list)" maxLength={300} aria-label="What changed" data-testid="tpl-change-note" />
              <Button disabled={!dirty || version.busy} onClick={async () => { const r = await act(() => version.run({ body: { templateId: t.id, body: draft, changeNote } }), "Saved as a new version."); if (r?.templateId) { setChangeNote(""); go(`/documents/templates/pdf/${r.templateId}`); } }} data-testid="tpl-save-version">Save as a new version</Button>
              {!dirty && <span className="text-caption text-mute">No changes yet.</span>}
            </div>
          </>
        ) : <p className="m-0 text-meta text-mute">{t.body.fields.length} fields for {t.body.roles.length} {t.body.roles.length === 1 ? "person" : "people"} on {t.body.file.page_count} page{t.body.file.page_count === 1 ? "" : "s"}.</p>}
      </Section>

      <Section title="Versions" testId="tpl-versions">
        <ul className="m-0 list-none space-y-2 p-0">{t.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 text-ui" data-testid="tpl-version" data-version={v.version}>
            <span className="font-medium">Version {v.version}</span>{v.id === t.id && <span className="text-caption text-mute">(this one)</span>}
            {v.active && <StatusBadge label="Current" tone="good" />}{v.approval_status === "pending" && <StatusBadge label="Waiting for approval" tone="info" />}{v.approval_status === "rejected" && <StatusBadge label="Not approved" tone="bad" />}
            <span className="text-caption text-mute">{when(v.created_at)}{v.change_note ? ` — ${v.change_note}` : ""}</span>
            {v.id !== t.id && <Button size="sm" variant="ghost" onClick={() => go(`/documents/templates/pdf/${v.id}`)}>Open</Button>}
            {v.version > 1 && <Button size="sm" variant="ghost" onClick={async () => setDiff({ id: v.id, version: v.version, ...(await api.pdfTemplateDiff(v.id)) })} data-testid="tpl-compare">What changed</Button>}
          </li>))}</ul>
        {diff && <div className="rounded border border-line bg-paper p-3" data-testid="tpl-diff"><p className="m-0 mb-1 text-ui font-medium">Version {diff.from?.version ?? "—"} → version {diff.version}</p><ul className="m-0 list-disc pl-5 text-meta text-ink-2">{diff.lines.map((l, k) => <li key={k}>{l}</li>)}</ul><Button size="sm" variant="ghost" className="mt-2" onClick={() => setDiff(null)}>Close</Button></div>}
      </Section>
    </div>
  );
}
