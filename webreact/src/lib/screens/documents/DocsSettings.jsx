// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsSettings — Documents → Settings. The island's OWN settings (QUEUE §23.2.2): GET /api/documents/settings returns groups of typed fields
// (src/documents/settings.mjs); each control saves ONE key through POST /api/documents/settings and shows the stored answer.
// Groups: Sending and reminders · Records · Signed copy (with "Preview a signed copy") · Certificate of completion.
// Props: { path, params, app, onNavigate, onRefetch } — the sectionPages.js contract.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import SignedCopyPreview from "./SignedCopyPreview.jsx";
import MailSendingPanel from "@/lib/mail/MailSendingPanel.jsx";   // the organisation's ONE sending identity (mail module) — same panel as Settings → Email

const asText = (v) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

/** One setting row: label and help on the left, the control on the right, a quiet status under it. */
function SettingRow({ field, onSave }) {
  const [draft, setDraft] = useState(null);          // null = untouched
  const [state, setState] = useState({ phase: "idle", message: "" });
  const stored = field.value;

  async function save(value) {
    setState({ phase: "saving", message: "Saving…" });
    try {
      const res = await onSave(field.key, value);
      setState({ phase: "saved", message: "Saved." });
      setDraft(null);
      return res;
    } catch (err) {
      setState({ phase: "error", message: err?.message ?? "Could not save." });
    }
  }

  const parse = (raw) => {
    if (raw === "") return field.default === null ? null : null;   // empty → back to the default
    if (field.type === "number") return Number(raw);
    if (field.type === "days") return raw.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
    if (field.type === "list") return raw.split(",").map((x) => x.trim()).filter(Boolean);
    return raw;
  };

  let control;
  if (field.type === "bool") {
    control = <Switch checked={Boolean(stored)} onCheckedChange={(on) => save(on)} aria-label={field.label} data-testid={`setting-${field.key}`} />;
  } else if (field.type === "select") {
    control = (
      <NativeSelect value={stored ?? field.default} onChange={(e) => save(e.currentTarget.value)} aria-label={field.label} data-testid={`setting-${field.key}`}>
        {/* F131 — options come as plain strings or as { value, label } (ai.provider); rendering the object crashed the page */}
        {(field.options ?? []).map((o) => (typeof o === "object" && o !== null
          ? <NativeSelectOption key={o.value} value={o.value}>{o.label ?? o.value}</NativeSelectOption>
          : <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>))}
      </NativeSelect>
    );
  } else {
    const shown = draft !== null ? draft : asText(stored);
    control = (
      <div className="flex items-center gap-2">
        <Input
          value={shown}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => { if (draft !== null && draft !== asText(stored)) save(parse(draft)); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          inputMode={field.type === "number" ? "numeric" : undefined}
          aria-label={field.label}
          placeholder={field.default === null || field.default === "" ? "Not set" : asText(field.default)}
          className="w-[280px] max-w-full"
          data-testid={`setting-${field.key}`}
        />
        {field.key === "signed_copy.accent" && /^#[0-9a-fA-F]{6}$/.test(shown) ? <span className="inline-block size-6 rounded border border-line" style={{ background: shown }} aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2 border-t border-line py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_320px] md:gap-6" data-testid={`field-${field.key}`}>
      <div>
        <p className="m-0 text-ui font-medium text-ink">{field.label}</p>
        <p className="m-0 mt-1 text-meta text-mute leading-relaxed">{field.help}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 md:items-end">
        {control}
        <p
          className={`m-0 text-meta ${state.phase === "error" ? "text-danger" : "text-mute"}`}
          role={state.phase === "error" ? "alert" : undefined}
          data-testid={`status-${field.key}`}
        >
          {state.phase === "idle" ? (field.changedAt ? "Changed from the default" : "Using the default") : state.message}
        </p>
      </div>
    </div>
  );
}

export default function DocsSettings({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const [phase, setPhase] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function load() {
    try {
      setPhase("loading");
      setData(await api.documentsSettings());
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setPhase("denied");
      else { setError(err); setPhase("error"); }
    }
  }
  useEffect(() => { load(); }, []);

  async function save(key, value) {
    const res = await api.saveDocumentSetting({ key, value });
    // the stored answer comes back; reflect it without a full reload so the control keeps focus
    setData((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, fields: g.fields.map((f) => (f.key === key ? { ...f, value: res.value, changedAt: new Date().toISOString() } : f)) })) }));
    return res;
  }

  if (phase !== "ready") return <ScreenState phase={phase} error={error} subject="Documents settings" onRetry={load} />;

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-settings">
      <div className="mb-4.5">
        <PageTitle>{data?.title ?? "Documents"}</PageTitle>
        {data?.intro ? <p className="m-0 mt-1.5 text-control text-mute">{data.intro}</p> : null}
      </div>

      <div className="max-w-[860px] space-y-6">
        {(data?.groups ?? []).map((g) => (
          <section key={g.key} className="rounded-card border border-line bg-surface px-5 py-2" data-testid={`group-${g.key}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
              <h2 className="m-0 text-ui font-semibold text-ink">{g.label}</h2>
              {g.key === "signed_copy" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)} data-testid="preview-signed-copy">Preview a signed copy</Button>
              ) : null}
            </div>
            {g.fields.map((f) => <SettingRow key={f.key} field={f} onSave={save} />)}
            {g.key === "email" ? <MailSendingPanel showIdentityForm={false} /> : null}
          </section>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4" data-testid="docs-settings-developers">
          <div><p className="m-0 text-ui font-medium text-ink">Developers and data</p><p className="m-0 mt-1 text-meta text-mute">The REST API, webhooks, putting signing on your website, exporting your records and a person's data request.</p></div>
          <Button type="button" variant="outline" size="sm" onClick={() => (onNavigate ? onNavigate("/documents/developers") : window.location.assign("/documents/developers"))} data-testid="open-developers">Open</Button>
        </div>

        <div className="rounded-card border border-line bg-surface p-5" data-testid="docs-settings-faq">
          <p className="m-0 text-ui font-medium text-ink">Is an electronic signature binding?</p>
          <p className="m-0 mt-2 text-meta text-ink-2 leading-relaxed">
            In the United States, yes — under the ESIGN Act and state law, an electronic signature has
            the same weight as ink, provided you can show who signed and when. That is what the
            certificate on every signed document is for. This is not legal advice.
          </p>
        </div>
      </div>

      <SignedCopyPreview open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
