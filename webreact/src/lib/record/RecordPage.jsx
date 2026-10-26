// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RecordPage — the RECORD archetype. Ported from webui/src/lib/record/RecordPage.svelte: same props
// (activeTab was $bindable → activeTab + onTab), testids, data-* hooks and copy. The layout is decided by
// columnsFor(viewportWidth, relatedCount) from format.js — a PROP, so a gate can assert 1081 vs 1079
// without a browser (the Svelte header's reason, kept).
// ★ Money tabs/rows are hidden when the viewer may not see money: canSeeMoney() (the viewer's grant; the
//   rank rule only when a caller passes rank alone). The server does not send money a viewer may not see.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useSubscribedOptional } from "@/lib/app/useAppState.js";
import { useContext, useState } from "react";
import { formatValue, columnsFor } from "@/lib/format.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/lib/components/ui/tabs.jsx";
import InlineEditCell from "@/lib/lists/InlineEditCell.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";
import { canSeeMoney } from "@/lib/permissions/can.js";
import { useBindable } from "@/lib/hooks/useBindable.js";

const OPENABLE = new Set(["person", "account", "network_party", "document", "service", "plan", "booking", "invoice", "subscription"]);
const MONEY_OF = new Set(["subscription", "invoice", "payment"]);
const isCopyable = (f) => f.format === "phone" || /email/i.test(f.field);

export default function RecordPage({
  shell, activeTab = undefined, viewportWidth = 1440, activity = [], relatedCounts = {}, relatedRows = {}, attachments = [],
  onTab = null, onEdit = null, onOpenRelated = null, actions = null, rank = null, editableFields = [], onEditField = null,
}) {
  const app = useSubscribedOptional(useContext(AppStateContext));
  const [tabState, setTabState] = useBindable(activeTab, undefined, "activity");
  const [copiedField, setCopiedField] = useState(null);
  const words = String(shell?.header?.title ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  const moneyOk = canSeeMoney({ permissions: app?.permissions ?? null, rank: rank ?? app?.permissions?.rank ?? null });
  const allRelated = shell?.related ?? [];
  const moneyRelated = moneyOk ? allRelated.filter((r) => MONEY_OF.has(r.of)) : [];
  const documentRelated = allRelated.filter((r) => r.of === "document");
  const otherRelated = allRelated.filter((r) => !MONEY_OF.has(r.of) && r.of !== "document");
  const railRelated = moneyOk ? allRelated : allRelated.filter((r) => !MONEY_OF.has(r.of));
  const columns = columnsFor(viewportWidth, railRelated.length);
  const tabs = [
    { key: "activity", label: "Activity" },
    ...(moneyRelated.length ? [{ key: "money", label: "Money" }] : []),
    ...(documentRelated.length ? [{ key: "documents", label: "Documents" }] : []),
    ...(otherRelated.length && columns === "1" ? [{ key: "related", label: "Related" }] : []),
    ...(shell?.type === "person" && attachments.length ? [{ key: "attachments", label: "Attachments" }] : []),
  ];
  const tab = tabs.some((t) => t.key === tabState) ? tabState : "activity";
  const chooseTab = (next) => { if (!next) return; setTabState(next); onTab?.(next); };
  async function copyField(f) {
    try { await navigator.clipboard.writeText(String(f.value ?? "")); setCopiedField(f.field); setTimeout(() => setCopiedField((c) => (c === f.field ? null : c)), 1500); } catch { /* clipboard refused */ }
  }

  const aboutField = (f) => (
    <div key={f.field} className="grid grid-cols-[--spacing(30)_1fr] gap-3 py-1.5" data-field={f.field}>
      <dt className="text-meta text-mute">{f.label}</dt>
      <dd className="m-0 flex items-center gap-2 text-ui text-ink" data-testid={`field-${f.field}`}>
        {onEditField && editableFields.includes(f.field)
          ? <InlineEditCell value={f.value} displayText={formatValue(f.value, f.format, { empty: "—", currency: f.currency })} type={f.format === "phone" ? "tel" : /email/i.test(f.field) ? "email" : "text"} testId={`field-edit-${f.field}`} onSave={(v) => onEditField(f.field, v)} />
          : formatValue(f.value, f.format, { empty: "—", currency: f.currency })}
        {isCopyable(f) && f.value && (
          <button type="button" className="text-meta text-brand" data-testid={`field-copy-${f.field}`} aria-label={`Copy ${f.label}`} onClick={() => copyField(f)}>{copiedField === f.field ? "Copied" : "Copy"}</button>
        )}
      </dd>
    </div>
  );
  const tagsField = (tags = [], label = "Tags") => (
    <div className="grid grid-cols-[--spacing(30)_1fr] gap-3 py-1.5" data-field="tags">
      <dt className="text-meta text-mute">{label}</dt>
      <dd className="m-0" data-testid="field-tags">
        {onEditField && editableFields.includes("tags") ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {(tags || []).map((tag, idx) => (
              <span key={`${tag}-${idx}`} className="inline-flex h-(--size-chip) items-center gap-1 rounded-chip bg-mute-bg px-2 text-caption text-ink-2">
                {tag}<button type="button" onClick={() => onEditField("tags", tags.filter((_, i) => i !== idx))}>×</button>
              </span>
            ))}
            <input type="text" className="min-w-24 flex-1 bg-transparent text-meta outline-none" placeholder="Add tag…"
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const val = e.currentTarget.value.trim(); if (val) { onEditField("tags", [...(tags || []), val]); e.currentTarget.value = ""; } } }} />
          </div>
        ) : tags && tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">{tags.map((tag, i) => <span key={`${tag}-${i}`} className="inline-flex h-(--size-chip) items-center rounded-chip bg-mute-bg px-2 text-caption text-ink-2">{tag}</span>)}</div>
        ) : <span className="text-mute">—</span>}
      </dd>
    </div>
  );
  const panels = (list) => (!list?.length
    ? <p className="text-ui text-mute" data-testid="panels-empty">This record has no detail fields.</p>
    : list.map((p) => (
      <section key={p.key} className="mb-5" data-panel={p.key}>
        <h2 className="m-0 mb-2 text-heading font-medium text-ink">{p.label}</h2>
        <dl className="m-0">{p.fields.map(aboutField)}</dl>
      </section>
    )));
  const relatedList = (entry, rows) => (rows === undefined
    ? <p className="text-meta text-mute" data-testid={`related-unknown-${entry.key}`}>This list could not be read.</p>
    : rows.length === 0
      ? <p className="text-meta text-mute" data-testid={`related-none-${entry.key}`}>No {entry.label.toLowerCase()} yet.</p>
      : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid={`related-rows-${entry.key}`}>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col" data-id={row.id}>
              {OPENABLE.has(entry.of)
                ? <a className="text-ui text-brand hover:underline" href={`/record/${entry.of}/${row.id}`} onClick={(e) => { if (onOpenRelated) { e.preventDefault(); onOpenRelated(entry.of, row.id); } }}>{row.label}</a>
                : <span className="text-ui text-ink" data-openable="false">{row.label}</span>}
              {row.sub && <span className="text-meta text-mute">{row.sub}</span>}
            </li>
          ))}
        </ul>
      ));
  const related = (list) => (!list?.length
    ? <p className="text-ui text-mute" data-testid="related-empty">Nothing is linked to this record yet.</p>
    : list.map((r) => (
      <section key={r.key} className="mb-5" data-related={r.key} data-kind={r.kind}>
        <h2 className="m-0 mb-1.5 text-heading font-medium text-ink">{r.label}</h2>
        {r.kind === "count" ? <p className="m-0 text-ui text-ink" data-testid={`count-${r.key}`}>{relatedCounts[r.key] ?? "—"}</p> : relatedList(r, relatedRows[r.key])}
      </section>
    )));
  const attachmentsList = (items) => (!items?.length
    ? <p className="text-ui text-mute" data-testid="attachments-empty">No attachments yet.</p>
    : (
      <ul className="m-0 flex list-none flex-col p-0" data-testid="attachments-list">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-b border-hair py-2.5" data-id={a.id}>
            <span className="flex-1 text-ui text-ink">{a.filename}</span>
            <span className="text-meta text-mute">{formatValue(a.sizeBytes, "bytes")} · {formatValue(a.createdAt, "date")}</span>
            <button type="button" className="text-meta text-bad" data-testid={`attachment-delete-${a.id}`} aria-label={`Delete ${a.filename}`}>Delete</button>
          </li>
        ))}
      </ul>
    ));
  const activityFeed = (rows, of) => (!rows?.length
    ? <p className="text-ui text-mute" data-testid="activity-empty">No activity recorded against this record yet.</p>
    : (
      <ol className="m-0 flex list-none flex-col p-0" data-testid="activity" data-of={of}>
        {rows.map((e) => (
          <li key={e.id} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-hair py-2.5 text-ui" data-topic={e.topic}>
            {/* ★ F130 — a plain sentence when the server gives one ("Pat Parent signed"); the raw topic only where nothing describes it */}
            <span className="text-ink">{e.description ?? e.topic}</span>
            <span className="text-meta text-mute">{e.description ? "" : e.emitted_by}</span>
            <time className="text-meta text-mute" dateTime={new Date(e.created_at).toISOString()}>{formatValue(e.created_at, "datetime")}</time>
            {e.reason && <span className="col-span-3 text-meta text-ink-2" data-testid="activity-reason">{e.reason}</span>}
          </li>
        ))}
      </ol>
    ));

  return (
    <article className="flex flex-col gap-5" data-testid="record-page" data-record-type={shell?.type} data-columns={columns} data-read-only={shell?.readOnly ? "true" : undefined}>
      <header className="flex items-center gap-3.5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-avatar-bg text-heading font-medium text-avatar-ink" aria-hidden="true">{initials}</span>
        <h1 className="m-0 flex-1 text-page-title font-medium text-ink" data-testid="record-title">{shell?.header?.title ?? `Untitled ${String(shell?.label ?? "record").toLowerCase()}`}</h1>
        {shell?.header?.status != null && <span className="inline-flex h-(--size-chip) items-center rounded-chip bg-mute-bg px-2.25 text-caption font-medium text-ink-2" data-testid="record-status">{formatValue(shell.header.status, "enum")}</span>}
        {shell?.readOnly
          ? <span className="text-meta text-mute" data-testid="record-locked">Executed — read only</span>
          : (
            <button type="button" className="inline-flex h-(--size-control) items-center rounded-control border border-line bg-surface px-4.25 text-ui font-medium text-ink-2 disabled:opacity-50" data-testid="record-edit"
                    disabled={!onEdit} onClick={onEdit ?? undefined}
                    title={onEdit ? "Change this record" : "Editing this record type is not built yet. Nothing here has been lost — the record is complete; there is simply no form to change it with."}>Edit</button>
          )}
        {actions}
      </header>
      <section className="flex flex-wrap gap-x-10 gap-y-3 border-y border-hair py-4" data-testid="highlights" aria-label="Highlights">
        {(shell?.highlights ?? []).map((h) => (
          <div key={h.key} className="flex flex-col" data-highlight={h.key} data-present={h.present ? "true" : "false"}>
            <span className="text-meta text-mute">{h.label}</span>
            <span className="text-ui font-medium text-ink" data-testid={`highlight-${h.key}`}>{formatValue(h.value, h.format, { empty: h.empty })}</span>
          </div>
        ))}
      </section>
      <div className={`grid gap-8 ${columns === "2" ? "grid-cols-[--spacing(70)_1fr_--spacing(75)]" : "grid-cols-1 lg:grid-cols-[--spacing(70)_1fr]"}`} data-columns={columns}>
        <aside data-testid="record-about" aria-label="About">
          {shell?.type === "person" && shell?.tags !== undefined && tagsField(shell.tags, "Tags")}
          {panels(shell?.panels)}
        </aside>
        <Tabs value={tab} onValueChange={chooseTab}>
          <TabsList aria-label="Record sections">
            {tabs.map((t) => <TabsTrigger key={t.key} value={t.key} data-testid={`record-tab-${t.key}`}>{t.label}</TabsTrigger>)}
          </TabsList>
          <div className="mt-4" data-tab={tab}>
            <TabsContent value="activity">{activityFeed(activity, shell?.activity?.of)}</TabsContent>
            <TabsContent value="money">{related(moneyRelated)}</TabsContent>
            <TabsContent value="documents">{related(documentRelated)}</TabsContent>
            <TabsContent value="related">{related(otherRelated)}</TabsContent>
            <TabsContent value="attachments">{attachmentsList(attachments)}</TabsContent>
          </div>
        </Tabs>
        {columns === "2" && <aside data-testid="related-rail" aria-label="Attached">{related(railRelated)}</aside>}
      </div>
    </article>
  );
}
