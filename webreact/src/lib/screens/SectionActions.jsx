// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION ACTIONS (R3.002, SectionActions.svelte) — the create/price actions a list path offers, as buttons in the
// list header, each opening ONE form (drawer or dialog) whose fields and submit are declared here.
// ★ Shown per the WRITE's own permission (writeDecision on its api method — createService, createPackage…), never
//   a rank floor compared here: a permission renders NOTHING (R-34). `rank` is accepted for the route contract.
// ★ One primary per screen: the first action this viewer may use is primary — and it is the one `?new=1` opens.
// ★ Money is minor units and a non-number REFUSES (null) rather than rounding to NaN. The standing line explains a
//   versioned price above the fields, not in a tooltip.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { useAppState } from "@/lib/app/useAppState.js";
import { performWrite, writeDecision } from "@/lib/permissions/write.js";

function toMinor(text) {
  const n = Number(String(text).trim().replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const cur = (v) => String(v.currency || "USD").toUpperCase();
const PRICE_SUBJECTS = ["service", "package", "plan"];
const SOURCES = { service: "/items/services", package: "/items/packages", plan: "/items/plans", client: "/people/clients", account: "/accounts" };

const ACTIONS = {
  "/items/services": [
    { label: "New service", testId: "items-create", write: "createService", kind: "drawer",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "durationMinutes", label: "Length (minutes)", type: "number", required: true },
        { key: "amount", label: "Price", type: "text", required: true, hint: "What a client pays for one session." },
        { key: "currency", label: "Currency", type: "text", value: "USD", required: true },
      ],
      args: (v) => [{ name: v.name, durationMinutes: Number(v.durationMinutes), amountMinor: toMinor(v.amount), currency: cur(v), bookable: true }] },
    { label: "Set a new price", testId: "price-create", write: "createPrice", kind: "dialog", submitLabel: "Create the new price",
      standing: "This creates a new price. The current price stays on everything already quoted or invoiced.",
      fields: [
        { key: "subjectType", label: "Applies to", type: "select", required: true, options: PRICE_SUBJECTS, value: "service" },
        { key: "subjectId", label: "Which one", type: "combobox", required: true, source: (v) => v.subjectType },
        { key: "amount", label: "Amount", type: "text", required: true },
        { key: "currency", label: "Currency", type: "text", value: "USD", required: true },
        { key: "effectiveFrom", label: "Effective from", type: "date", required: false, hint: "Leave as today to start immediately." },
      ],
      args: (v) => [{ subjectType: v.subjectType, subjectId: v.subjectId, amountMinor: toMinor(v.amount), currency: cur(v), effectiveFrom: v.effectiveFrom || undefined }] },
    { label: "Set a contracted price", testId: "contracted-create", write: "setContractedPrice", kind: "dialog", submitLabel: "Set the contracted price",
      standing: "A contracted price applies to one party only. Everyone else keeps the standard price.",
      fields: [
        { key: "subjectType", label: "Applies to", type: "select", required: true, options: PRICE_SUBJECTS, value: "service" },
        { key: "subjectId", label: "Which one", type: "combobox", required: true, source: (v) => v.subjectType },
        { key: "partyKind", label: "For", type: "select", required: true, options: ["client", "account"], value: "client" },
        { key: "partyId", label: "Who", type: "combobox", required: true, source: (v) => (v.partyKind === "account" ? "account" : "client") },
        { key: "amount", label: "Amount", type: "text", required: true },
        { key: "currency", label: "Currency", type: "text", value: "USD", required: true },
      ],
      args: (v) => [{ subjectType: v.subjectType, subjectId: v.subjectId, amountMinor: toMinor(v.amount), currency: cur(v), ...(v.partyKind === "account" ? { accountId: v.partyId } : { appUserId: v.partyId }) }] },
  ],
  "/items/packages": [
    { label: "New package", testId: "package-create", write: "createPackage", kind: "drawer",
      fields: [
        { key: "name", label: "Package name", type: "text", required: true },
        { key: "lines", label: "What's included", type: "lines", required: true },
        { key: "amount", label: "Package price", type: "text", required: true, hint: "What a client pays for the whole package." },
        { key: "currency", label: "Currency", type: "text", value: "USD", required: true },
        { key: "installmentsAllowed", label: "Can be paid in installments", type: "checkbox" },
        { key: "neverExpiresNote", type: "note", text: "Sessions in a package never expire." },
      ],
      args: (v) => [{ name: v.name, amountMinor: toMinor(v.amount), currency: cur(v), installmentsAllowed: !!v.installmentsAllowed,
        lines: (v.lines ?? []).filter((l) => l.serviceId).map((l) => ({ serviceId: l.serviceId, quantity: Number(l.quantity) || 1 })) }] },
  ],
  "/items/plans": [
    { label: "New plan", testId: "items-create", write: "createPlan", kind: "drawer",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "interval", label: "Bills every", type: "select", required: true, options: ["week", "month", "quarter", "year"] },
        { key: "amount", label: "Price each time", type: "text", required: true },
        { key: "currency", label: "Currency", type: "text", value: "USD", required: true },
        { key: "lines", label: "Sessions included each cycle", type: "lines", required: false },
        { key: "rolloverMode", label: "Unused sessions", type: "select", required: false, options: ["none", "cap"], optionLabels: { none: "Use them that month or lose them", cap: "Roll over, up to a saved cap" }, value: "none" },
        { key: "rolloverCap", label: "Roll over up to", type: "number", required: false, hint: "Only used when unused sessions roll over." },
        { key: "rolloverNote", type: "note", text: "If a client cancels, sessions from the month they paid for stay usable until that month ends." },
      ],
      args: (v) => [{ name: v.name, interval: v.interval, amountMinor: toMinor(v.amount), currency: cur(v),
        lines: (v.lines ?? []).filter((l) => l.serviceId).map((l) => ({ serviceId: l.serviceId,
          quantityPerCycle: l.quantity === "" || l.quantity == null ? null : Number(l.quantity) })),
        rolloverMode: v.rolloverMode || "none",
        rolloverCap: v.rolloverMode === "cap" && v.rolloverCap !== "" ? Number(v.rolloverCap) : undefined }] },
  ],
  "/network": [
    { label: "Add partner", testId: "network-create", write: "createNetworkParty", kind: "drawer",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "kind", label: "Kind", type: "select", required: true, options: ["referrer", "provider", "school", "vendor", "other"] },
      ],
      args: (v) => [{ name: v.name, kind: v.kind }] },
  ],
};

const initialValues = (spec) => Object.fromEntries((spec.fields ?? []).map((f) => [f.key,
  f.type === "lines" ? [{ serviceId: "", quantity: 1 }] : f.type === "checkbox" ? (f.value ?? false) : f.type === "note" ? null : (f.value ?? "")]));

export default function SectionActions({ path, rank = null, onDone = null, openNew = false }) {
  void rank;
  const app = useAppState();
  const specs = (ACTIONS[path] ?? []).filter((s) => !writeDecision(app.permissions, s.write).hidden);
  const [active, setActive] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [loaded, setLoaded] = useState({});
  const [consumed, setConsumed] = useState(false);

  const start = (spec) => { setValues(initialValues(spec)); setProblem(null); setActive(spec); };
  const close = () => { setActive(null); setProblem(null); };
  useEffect(() => { if (openNew && !consumed && specs.length > 0) { setConsumed(true); start(specs[0]); } }, [openNew, consumed, specs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const wanted = active ? [...new Set(active.fields.flatMap((f) => (f.type === "combobox" ? [f.source(values)] : f.type === "lines" ? ["service"] : [])))] : [];
  useEffect(() => {
    for (const key of wanted) {
      if (!key || loaded[key]) continue;
      api.view(SOURCES[key])
        .then((r) => setLoaded((l) => ({ ...l, [key]: (r?.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name ?? row.name ?? row.title ?? row.id })) })))
        .catch((err) => { setLoaded((l) => ({ ...l, [key]: [] })); setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err)); });
    }
  }, [wanted.join(","), loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setValues((vs) => ({ ...vs, [k]: v }));
  const serviceOptions = loaded.service ?? [];
  const blockedReason = active?.fields?.some((f) => f.type === "lines") && serviceOptions.length === 0
    ? "Add a service first — a package is made of services, and one with none cannot be sold." : null;
  const incomplete = !active || active.fields.some((f) => {
    if (!f.required) return false;
    const v = values[f.key];
    if (f.type === "lines") return !(Array.isArray(v) && v.some((l) => l.serviceId));
    return v === "" || v === null || v === undefined;
  });
  const submit = async () => {
    if (busy || !active) return;
    setBusy(true); setProblem(null);
    try { await performWrite(app.permissions, active.write, active.args(values)); close(); onDone?.(); }
    catch (err) { setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err)); }
    finally { setBusy(false); }
  };
  const setLine = (i, patch) => set("lines", values.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const field = (f) => {
    if (f.type === "note") return <p key={f.key} className="my-2 rounded-sm border border-warm-border bg-warm-bg px-3 py-2 text-meta text-warn" data-testid={`section-note-${f.key}`}>{f.text}</p>;
    if (f.type === "checkbox") return (
      <label key={f.key} className="flex items-center gap-2 py-2 text-ui text-ink">
        <Checkbox data-testid={`section-${f.key}`} checked={!!values[f.key]} onCheckedChange={(c) => set(f.key, !!c)} /> {f.label}
      </label>
    );
    let control;
    if (f.type === "lines") {
      control = (
        <div className="flex flex-col gap-2" data-testid="section-lines">
          {(values.lines ?? []).map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <NativeSelect data-testid={`section-line-service-${i}`} value={line.serviceId} onChange={(e) => setLine(i, { serviceId: e.target.value })}>
                <NativeSelectOption value="">Choose a service…</NativeSelectOption>
                {serviceOptions.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}
              </NativeSelect>
              <Input className="w-20" type="number" min="1" data-testid={`section-line-qty-${i}`} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Button type="button" variant="outline" size="icon-sm" data-testid={`section-line-remove-${i}`} onClick={() => set("lines", values.lines.filter((_, j) => j !== i))} aria-label="Remove this line">×</Button>
            </div>
          ))}
          <div><Button type="button" variant="outline" size="sm" data-testid="section-line-add" onClick={() => set("lines", [...(values.lines ?? []), { serviceId: "", quantity: 1 }])}>+ Add another service</Button></div>
        </div>
      );
    } else if (f.type === "combobox") {
      control = <Combobox testId={`section-${f.key}`} options={loaded[f.source(values)] ?? []} value={values[f.key]} emptyText="Nothing to choose from yet." onValueChange={(v) => set(f.key, v)} />;
    } else if (f.type === "date") {
      control = <DatePicker testId={`section-${f.key}`} value={values[f.key] || undefined} onValueChange={(v) => set(f.key, v)} />;
    } else if (f.type === "select") {
      control = (
        <NativeSelect data-testid={`section-${f.key}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
          {!f.value ? <NativeSelectOption value="">Choose…</NativeSelectOption> : null}
          {f.options.map((o) => <NativeSelectOption key={o} value={o}>{f.optionLabels?.[o] ?? o}</NativeSelectOption>)}
        </NativeSelect>
      );
    } else {
      control = <Input data-testid={`section-${f.key}`} type={f.type === "number" ? "number" : "text"} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} required={f.required} autoComplete="off" />;
    }
    return <SheetRow key={f.key} label={f.label} required={!!f.required} hint={f.hint ?? null}>{control}</SheetRow>;
  };

  return (
    <>
      {specs.map((spec, i) => <Button key={spec.testId} variant={i === 0 ? "default" : "outline"} data-testid={spec.testId} onClick={() => start(spec)}>{spec.label}</Button>)}
      {active ? (
        <ActionSurface kind={active.kind} title={active.label} testId="section-form" busy={busy} error={problem} submitLabel={active.submitLabel ?? active.label}
          submitDisabled={incomplete || !!blockedReason} footerNote={blockedReason} onCancel={close} onSubmit={submit}>
          {active.standing ? <p className="mb-3 text-meta text-ink-2" data-testid="section-standing">{active.standing}</p> : null}
          {active.fields.map(field)}
        </ActionSurface>
      ) : null}
    </>
  );
}
