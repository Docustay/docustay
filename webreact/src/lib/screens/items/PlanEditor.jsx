// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.038 — PlanEditor.jsx — React port of webui/src/lib/screens/items/PlanEditor.svelte
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useId, useRef } from "react";
import { request, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";

import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import CollapsibleGroup from "@/lib/components/editor/CollapsibleGroup.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import RailOverrideNote from "@/lib/components/editor/RailOverrideNote.jsx";
import AfterSavePanel from "@/lib/components/editor/AfterSavePanel.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import GeneratedSentence from "@/lib/components/editor/GeneratedSentence.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import HeroNumber from "@/lib/components/kit/HeroNumber.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

import ProgramSelect from "@/lib/programs/ProgramSelect.jsx";
import { usePrograms } from "@/lib/programs/programs.js";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

const PLAN_INTERVALS = ["week", "month", "quarter", "year"];
const INTERVAL_LABEL = { week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly" };

const DEFAULT_FORM = () => ({
  name: "",
  description: "",
  billingDay: null,
  allowClientPause: false,
  maxPausesPerYear: 2,
  maxPauseMonths: 1,
  dunningRetries: null,
  dunningDays: null,
  dunningPauseAfter: null,
  interval: "month",
  amountMinor: null,
  currency: "USD",
  serviceId: null,
  sessionsIncluded: 0,
  rolloverMode: "none",
  rolloverCap: null,
  // ★ Programs follow-up brief (30 Sep 2026, Part 1/4/8).
  // minimumTermMonths: null = month-to-month (today's only real behaviour); non-null is Part 8's
  // Family Coaching shape, but any plan may set it.
  programId: "",
  categoryId: "",
  minimumTermMonths: null,
});

function formatMoneyShort(minor, currency) {
  if (minor === null || minor === undefined) return "";
  const symbol = { USD: "$", CAD: "$", AUD: "$", GBP: "£", EUR: "€" }[currency] ?? "";
  const dollars = (minor / 100).toFixed(2).replace(/\.00$/, "");
  return `${symbol}${dollars}`;
}

export default function PlanEditor({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const uid = useId();

  // ── which plan, or none ("new") ───────────────────────────────────────────────────
  const routeId = useMemo(() => {
    return params?.id && params.id !== "new" ? params.id : null;
  }, [params?.id]);

  const [currentId, setCurrentId] = useState(routeId);
  useEffect(() => {
    setCurrentId(routeId);
  }, [routeId]);

  const isNew = !currentId;

  // ── permissions ───────────────────────────────────────────────────────────────────
  const rank = app?.nav?.rank ?? null;
  const canEdit = useMemo(() => {
    return RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");
  }, [rank]);

  // ── screen phase ───────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  // ── data this screen reads but never edits directly ────────────────────────────────
  const [editor, setEditor] = useState(null);
  const [services, setServices] = useState([]);
  const { programs } = usePrograms();
  const [categories, setCategories] = useState([]);

  // ── the editable draft ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState(DEFAULT_FORM());
  const [baselineJson, setBaselineJson] = useState("");
  const formJson = JSON.stringify(form);
  const isDirty = formJson !== baselineJson;

  // ── dunning state ──────────────────────────────────────────────────────────────────
  const [dunningOpen, setDunningOpen] = useState(false);
  const hasDunningOverride = useMemo(() => {
    return (
      form.dunningRetries !== null ||
      form.dunningDays !== null ||
      form.dunningPauseAfter !== null
    );
  }, [form.dunningRetries, form.dunningDays, form.dunningPauseAfter]);

  // ── save state ─────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [nameServerError, setNameServerError] = useState(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [afterSave, setAfterSave] = useState(null);

  // ── blockers ───────────────────────────────────────────────────────────────────────
  const blockers = useMemo(() => {
    const out = [];
    if (!form.name?.trim()) out.push("Name");
    if (isNew) {
      if (!PLAN_INTERVALS.includes(form.interval)) out.push("Billing interval");
      if (form.amountMinor === null || form.amountMinor === undefined) out.push("Price");
      if (form.sessionsIncluded > 0 && !form.serviceId) out.push("Service");
      if (form.rolloverMode === "cap" && !(Number.isInteger(form.rolloverCap) && form.rolloverCap > 0)) {
        out.push("Rollover cap");
      }
    }
    if (hasDunningOverride) {
      if (form.dunningRetries !== null && !(Number.isInteger(form.dunningRetries) && form.dunningRetries >= 0)) {
        out.push("Retries");
      }
      if (form.dunningDays !== null && !(Number.isInteger(form.dunningDays) && form.dunningDays > 0)) {
        out.push("Days between retries");
      }
      if (form.dunningPauseAfter !== null &&
          !(Number.isInteger(form.dunningPauseAfter) && form.dunningPauseAfter >= 0)) {
        out.push("Then pause after");
      }
    }
    return out;
  }, [form, isNew, hasDunningOverride]);

  // Force dunning group open if attempted save with dunning error
  useEffect(() => {
    if (attemptedSave && blockers.some((b) => ["Retries", "Days between retries", "Then pause after"].includes(b))) {
      setDunningOpen(true);
    }
  }, [attemptedSave, blockers]);

  function serviceName(id) {
    return services.find((s) => s.id === id)?.name ?? null;
  }

  function hydrateFromItem(item) {
    const newForm = {
      name: item.name ?? "",
      description: item.description ?? "",
      billingDay: item.billing_day ?? null,
      allowClientPause: !!item.allow_client_pause,
      maxPausesPerYear: item.max_pauses_per_year ?? 2,
      maxPauseMonths: item.max_pause_months ?? 1,
      dunningRetries: item.dunning_retries ?? null,
      dunningDays: item.dunning_days ?? null,
      dunningPauseAfter: item.dunning_pause_after ?? null,
      interval: item.interval ?? "month",
      currency: item.currency ?? "USD",
      serviceId: item.service_id ?? null,
      sessionsIncluded: item.sessions_included ?? 0,
      rolloverMode: item.rollover_mode ?? "none",
      rolloverCap: item.rollover_cap ?? null,
      programId: item.program_id ?? "",
      categoryId: item.category_id ?? "",
      minimumTermMonths: item.minimum_term_months ?? null,
    };
    setForm(newForm);
    setDunningOpen(hasDunningOverride);
    setBaselineJson(JSON.stringify(newForm));
  }

  function hydrateNew() {
    const newForm = DEFAULT_FORM();
    setForm(newForm);
    setDunningOpen(false);
    setBaselineJson(JSON.stringify(newForm));
  }

  async function load() {
    setPhase("loading");
    setLoadError(null);
    try {
      const svcRes = await request("/api/list/items/services").catch(() => ({ rows: [] }));
      setServices(Array.isArray(svcRes?.rows) ? svcRes.rows : []);
      const catRes = await request("/api/items/categories").catch(() => ({ data: [] }));
      setCategories(Array.isArray(catRes?.data) ? catRes.data : []);

      if (isNew) {
        setEditor(null);
        hydrateNew();
      } else {
        const editorData = await request(`/api/items/plans/${currentId}/editor`);
        setEditor(editorData);
        hydrateFromItem(editorData.item);
      }
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setLoadError(err);
      } else {
        setPhase("error");
        setLoadError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    }
  }

  useEffect(() => {
    load();
  }, [currentId]);

  // New plan: if the practice has exactly one program, default to it (form AND baseline, so the
  // editor does not open "dirty").
  const programDefaulted = useRef(false);
  useEffect(() => {
    if (!isNew || phase !== "ready" || programDefaulted.current || programs.length !== 1) return;
    programDefaulted.current = true;
    const only = programs[0].id;
    setForm((prev) => (prev.programId ? prev : { ...prev, programId: only }));
    setBaselineJson((b) => {
      try { const o = JSON.parse(b); return o.programId ? b : JSON.stringify({ ...o, programId: only }); } catch { return b; }
    });
  }, [isNew, phase, programs]);

  // ── active now figure ──────────────────────────────────────────────────────────────
  const activeNow = editor?.active_now;
  const activeNowFigure = useMemo(() => {
    if (activeNow?.count !== undefined && activeNow?.count !== null) return String(activeNow.count);
    return undefined;
  }, [activeNow?.count]);

  const activeNowSub = useMemo(() => {
    if (activeNow?.monthlyTotalMinor != null) {
      return `${formatMoneyShort(activeNow.monthlyTotalMinor, form.currency)} a month`;
    }
    return "";
  }, [activeNow?.monthlyTotalMinor, form.currency]);

  const activeNowActionLabel = useMemo(() => {
    if (activeNow?.count != null) {
      return `${activeNow.count} client${activeNow.count === 1 ? "" : "s"} →`;
    }
    return "See clients →";
  }, [activeNow?.count]);

  // ── status and stripe badges ───────────────────────────────────────────────────────
  const statusTone = useMemo(() => {
    if (isNew) return { label: "Draft", tone: "neutral" };
    const item = editor?.item;
    if (item?.archived_at) return { label: "Archived", tone: "bad" };
    if (item && item.active === false) return { label: "Off sale", tone: "warn" };
    return { label: "On sale", tone: "ok" };
  }, [isNew, editor?.item]);

  const stripeTone = useMemo(() => {
    const state = editor?.stripe_sync?.state;
    if (state === "in_sync") return { label: "In sync", tone: "ok" };
    if (!state || state === "never") return { label: "Not yet synced", tone: "neutral" };
    return { label: state, tone: "warn" };
  }, [editor?.stripe_sync?.state]);

  // ── helper functions ───────────────────────────────────────────────────────────────
  function numEventHandler(setter, { allowNull = true, min = null } = {}) {
    return (e) => {
      const raw = e.target.value;
      if (raw === "") {
        setter(allowNull ? null : 0);
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      setter(min !== null && n < min ? min : n);
    };
  }

  function openDunningCustomize() {
    setDunningOpen(true);
    setForm((prev) => ({
      ...prev,
      dunningRetries: prev.dunningRetries === null ? 3 : prev.dunningRetries,
      dunningDays: prev.dunningDays === null ? 10 : prev.dunningDays,
      dunningPauseAfter: prev.dunningPauseAfter === null ? 1 : prev.dunningPauseAfter,
    }));
  }

  function revertDunning() {
    setForm((prev) => ({
      ...prev,
      dunningRetries: null,
      dunningDays: null,
      dunningPauseAfter: null,
    }));
    setDunningOpen(false);
  }

  const dunningIntro = useMemo(() => {
    if (hasDunningOverride || dunningOpen) {
      return (
        `Retries ${form.dunningRetries ?? "—"} time(s) over ${form.dunningDays ?? "—"} day(s), then pauses ` +
        `after ${form.dunningPauseAfter ?? "—"} more failure(s).`
      );
    }
    return "Try again, three times over ten days. Then pause it and tell you both.";
  }, [hasDunningOverride, dunningOpen, form.dunningRetries, form.dunningDays, form.dunningPauseAfter]);

  function pauseAllowanceParts() {
    const times = form.maxPausesPerYear ?? 0;
    const months = form.maxPauseMonths ?? 0;
    return [
      "Up to ",
      { text: `${times} time${times === 1 ? "" : "s"}`, bold: true },
      " a year, for ",
      { text: `${months} month${months === 1 ? "" : "s"}`, bold: true },
      " at a time.",
    ];
  }

  function whatTheyGetSentence() {
    if (!form.sessionsIncluded) return "A flat membership — no sessions included.";
    const name = serviceName(form.serviceId);
    const parts = [
      { text: `${form.sessionsIncluded}`, bold: true },
      ` of ${name ?? "a service"} each month.`,
    ];
    if (form.rolloverMode === "cap" && form.rolloverCap) {
      parts.push(` Unused sessions roll over, up to ${form.rolloverCap}.`);
    } else {
      parts.push(" Unused sessions don't roll over.");
    }
    return parts;
  }

  function close() {
    onNavigate?.("/items/plans");
  }

  function keepEditing() {
    setAfterSave(null);
  }

  async function save() {
    if (!canEdit) return;
    setAttemptedSave(true);
    if (blockers.length) return;

    setSaving(true);
    setSaveError(null);
    setNameServerError(null);
    try {
      if (isNew) {
        const body = {
          name: form.name.trim(),
          interval: form.interval,
          amountMinor: form.amountMinor,
          currency: form.currency,
          serviceId: form.sessionsIncluded > 0 ? form.serviceId : null,
          sessionsIncluded: form.sessionsIncluded,
          rolloverMode: form.rolloverMode,
          rolloverCap: form.rolloverMode === "cap" ? form.rolloverCap : null,
          description: form.description || null,
          billingDay: form.billingDay,
          allowClientPause: form.allowClientPause,
          maxPausesPerYear: form.maxPausesPerYear,
          maxPauseMonths: form.maxPauseMonths,
          dunningRetries: dunningOpen ? form.dunningRetries : null,
          dunningDays: dunningOpen ? form.dunningDays : null,
          dunningPauseAfter: dunningOpen ? form.dunningPauseAfter : null,
          programId: form.programId || undefined,
          categoryId: form.categoryId || undefined,
          minimumTermMonths: form.minimumTermMonths || undefined,
        };
        const res = await request("/api/items/plans", {
          method: "POST",
          body,
          idempotencyKey: crypto.randomUUID(),
        });
        setCurrentId(res.id);
        setBaselineJson(JSON.stringify(form));
        setAfterSave({
          headline: "Saved.",
          sentence: `It's ${formatMoneyShort(form.amountMinor, form.currency)} a ${form.interval}.`,
        });
        onRefetch?.();
      } else {
        const body = {
          id: currentId,
          expectedUpdatedAt: editor.item.updated_at,
          name: form.name.trim(),
          description: form.description || null,
          billingDay: form.billingDay,
          allowClientPause: form.allowClientPause,
          maxPausesPerYear: form.maxPausesPerYear,
          maxPauseMonths: form.maxPauseMonths,
          dunningRetries: dunningOpen ? form.dunningRetries : null,
          dunningDays: dunningOpen ? form.dunningDays : null,
          dunningPauseAfter: dunningOpen ? form.dunningPauseAfter : null,
          programId: form.programId || null,
          categoryId: form.categoryId || null,
          minimumTermMonths: form.minimumTermMonths || null,
        };
        const res = await request("/api/items/plans/update", {
          method: "POST",
          body,
          idempotencyKey: crypto.randomUUID(),
        });
        setEditor((prev) => ({
          ...prev,
          item: { ...prev.item, ...body, updated_at: res.updated_at },
        }));
        setBaselineJson(JSON.stringify(form));
        setAfterSave({ headline: "Saved.", sentence: "It's saved." });
        onRefetch?.();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.body?.error?.field === "name") {
        setNameServerError(err.message);
      } else if (err instanceof ApiError && err.status === 409) {
        setSaveError({ message: err.message, requestId: err.requestId, kind: "conflict" });
      } else if (err instanceof ApiError) {
        setSaveError({ message: err.message, requestId: err.requestId });
      } else {
        setSaveError({ message: String(err?.message ?? err) });
      }
    } finally {
      setSaving(false);
    }
  }

  const headerMeta = useMemo(() => {
    if (isNew) return "New plan — nothing is sellable until you save.";
    if (editor?.item?.updated_at) {
      return `Last saved ${new Date(editor.item.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    return "";
  }, [isNew, editor?.item?.updated_at]);

  const headerVerbs = useMemo(() => {
    if (!canEdit) return [];
    return [
      {
        label: isNew ? "Save" : "Save changes",
        kind: "primary",
        onClick: save,
        disabled: saving,
      },
    ];
  }, [canEdit, isNew, saving]);

  // ── render ──────────────────────────────────────────────────────────────────────────
  if (afterSave) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="plan-editor">
        <EditorHeader
          title={form.name || "Plan"}
          meta="Saved"
          verbs={[]}
          onClose={close}
          dirty={false}
          objectNoun="plan"
          testId="plan-editor-header"
        />
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          <EditorColumn>
            <AfterSavePanel
              headline={afterSave.headline}
              sentence={afterSave.sentence}
              nextActions={[]}
              onKeepEditing={keepEditing}
              testId="plan-after-save"
            />
          </EditorColumn>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="plan-editor">
        <div
          className="flex items-center justify-center flex-1 text-muted-foreground"
          data-testid="plan-editor-loading"
          data-state="loading"
        >
          Loading…
        </div>
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="plan-editor">
        <div
          className="flex items-center justify-center flex-1 text-muted-foreground"
          data-testid="plan-editor-denied"
          data-state="denied"
        >
          <p>You don't have permission to see this plan.</p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="plan-editor">
        <ErrorPanel
          error={loadError}
          subject="This plan"
          variant="page"
          onRetry={load}
          testId="plan-editor-error"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="plan-editor">
      <EditorHeader
        title={form.name || (isNew ? "New plan" : "Plan")}
        meta={headerMeta}
        verbs={headerVerbs}
        onClose={close}
        dirty={isDirty}
        objectNoun="plan"
        testId="plan-editor-header"
      />

      {!canEdit && (
        <p
          className="m-0 px-11 py-4 bg-chip-neutral-bg text-chip-neutral-ink text-sm"
          data-testid="plan-editor-readonly-notice"
        >
          You can view this plan. Editing is done by an owner or admin.
        </p>
      )}

      {attemptedSave && blockers.length > 0 && (
        <div className="px-11 pt-4">
          <BlockerBanner count={blockers.length} items={blockers} testId="plan-editor-blocker" />
        </div>
      )}

      {saveError && (
        <div className="px-11 pt-4">
          <ErrorPanel
            error={saveError}
            subject="Saving this plan"
            variant="band"
            testId="plan-editor-save-error"
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-auto">
          <EditorColumn>
            {/* What it is */}
            <EditorSection title="What it is">
              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-name-field">
                <FieldLabel htmlFor={`${uid}-name`}>
                  Name<span className="text-bad ml-1 aria-hidden:hidden">*</span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    id={`${uid}-name`}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={!canEdit}
                    data-testid="plan-name-input"
                  />
                  <InlineValidation message={nameServerError} testId="plan-name-error" />
                </FieldContent>
              </Field>

              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-note-field">
                <FieldLabel htmlFor={`${uid}-note`}>
                  Internal note<span className="text-xs text-muted-foreground ml-1">optional</span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    id={`${uid}-note`}
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    disabled={!canEdit}
                    data-testid="plan-note-input"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    Only your team sees this.
                  </p>
                </FieldContent>
              </Field>

              {/* ★ Programs follow-up brief Part 2 — category extended to plan. */}
              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-category-field">
                <FieldLabel htmlFor={`${uid}-category`}>Category <span className="text-xs text-muted-foreground ml-1">optional</span></FieldLabel>
                <FieldContent>
                  <NativeSelect
                    id={`${uid}-category`}
                    value={form.categoryId}
                    onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                    disabled={!canEdit}
                    data-testid="plan-category-select"
                  >
                    <option value="">(no category)</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </NativeSelect>
                </FieldContent>
              </Field>

              {/* ★ FIX, 1 Oct 2026 (Programs follow-up brief Part 2) — migration 0543 is live;
                  the life/recovery fallback is retired, same as ServiceEditor.jsx. */}
              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-coaching-group-field">
                <FieldLabel htmlFor={`${uid}-group`}>Program</FieldLabel>
                <FieldContent>
                  <ProgramSelect
                    id={`${uid}-group`}
                    value={form.programId}
                    onChange={(v) => setForm((prev) => ({ ...prev, programId: v ?? "" }))}
                    disabled={!canEdit}
                    testId="plan-program-select"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Which program a client sees this under when they book or buy.
                  </p>
                </FieldContent>
              </Field>

              {/* ★ Part 8 (Family Coaching) — a minimum-term field any plan may set (migration
                  0544, plan.minimum_term_months). NULL/empty = month-to-month, today's behaviour. */}
              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-minimum-term-field">
                <FieldLabel htmlFor={`${uid}-minimum-term`}>Minimum term<span className="text-xs text-muted-foreground ml-1">optional</span></FieldLabel>
                <FieldContent>
                  <Input
                    id={`${uid}-minimum-term`}
                    type="number"
                    min={1}
                    value={form.minimumTermMonths ?? ""}
                    onChange={(e) => setForm((prev) => ({
                      ...prev,
                      minimumTermMonths: e.target.value === "" ? null : Number(e.target.value),
                    }))}
                    disabled={!canEdit}
                    data-testid="plan-minimum-term-input"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Months of billing before a client may cancel. Leave empty for month-to-month.
                  </p>
                </FieldContent>
              </Field>

              {/* What they get each month */}
              <div className="border border-line rounded-lg bg-surface my-4 p-4" data-testid="plan-sessions-group">
                <div className="mb-4">
                  <b className="text-sm font-semibold">What they get each month</b>
                </div>
                {isNew ? (
                  <>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-service-field">
                      <FieldLabel htmlFor={`${uid}-service`}>
                        Service<span className="text-xs text-muted-foreground ml-1">optional</span>
                      </FieldLabel>
                      <FieldContent>
                        <NativeSelect
                          id={`${uid}-service`}
                          value={form.serviceId ?? ""}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              serviceId: e.target.value || null,
                            }))
                          }
                          disabled={!canEdit}
                          data-testid="plan-service-select"
                        >
                          <option value="">—</option>
                          {services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FieldContent>
                    </Field>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-sessions-field">
                      <FieldLabel htmlFor={`${uid}-sessions`}>Sessions each month</FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-sessions`}
                          type="number"
                          min="0"
                          value={String(form.sessionsIncluded ?? 0)}
                          onChange={numEventHandler(
                            (v) => setForm((prev) => ({ ...prev, sessionsIncluded: v ?? 0 })),
                            { allowNull: false, min: 0 }
                          )}
                          disabled={!canEdit}
                          data-testid="plan-sessions-input"
                        />
                      </FieldContent>
                    </Field>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-rollover-field">
                      <FieldLabel htmlFor={`${uid}-rollover`}>When unused</FieldLabel>
                      <FieldContent>
                        <NativeSelect
                          id={`${uid}-rollover`}
                          value={form.rolloverMode}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              rolloverMode: e.target.value,
                            }))
                          }
                          disabled={!canEdit}
                          data-testid="plan-rollover-select"
                        >
                          <option value="none">Use them or lose them</option>
                          <option value="cap">Roll over, up to a cap</option>
                        </NativeSelect>
                      </FieldContent>
                    </Field>
                    {form.rolloverMode === "cap" && (
                      <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-rollover-cap-field">
                        <FieldLabel htmlFor={`${uid}-cap`}>Cap</FieldLabel>
                        <FieldContent>
                          <Input
                            id={`${uid}-cap`}
                            type="number"
                            min="1"
                            value={form.rolloverCap === null ? "" : String(form.rolloverCap)}
                            onChange={numEventHandler(
                              (v) => setForm((prev) => ({ ...prev, rolloverCap: v })),
                              { min: 1 }
                            )}
                            disabled={!canEdit}
                            data-testid="plan-rollover-cap-input"
                          />
                        </FieldContent>
                      </Field>
                    )}
                  </>
                ) : (
                  <>
                    <GeneratedSentence
                      parts={whatTheyGetSentence()}
                      testId="plan-sessions-sentence"
                    />
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      These can't be changed after the plan is created.
                    </p>
                  </>
                )}
              </div>

              {/* Price hero */}
              <div className="bg-surface border-y border-line my-2 px-0 py-3" data-testid="plan-price-hero">
                {isNew ? (
                  <FieldMoney
                    label="Price"
                    valueMinor={form.amountMinor}
                    onValueMinorChange={(v) =>
                      setForm((prev) => ({ ...prev, amountMinor: v }))
                    }
                    currency={form.currency}
                    required
                    disabled={!canEdit}
                    testId="plan-price-field"
                  />
                ) : (
                  <>
                    <div className="flex items-baseline gap-2 px-11">
                      <span
                        className="text-3xl font-semibold font-serif"
                        data-testid="plan-price-figure"
                      >
                        {editor?.price_history === undefined
                          ? "Hidden"
                          : editor.price_history?.[0]
                          ? formatMoneyShort(
                              editor.price_history[0].amount_minor,
                              editor.price_history[0].currency
                            )
                          : "—"}
                      </span>
                      <span className="text-sm text-muted-foreground">a {form.interval}</span>
                      <DisabledWithReason
                        disabled
                        reason="Opens the price-change dialog — lands with a later task (14.55)."
                        testId="plan-change-price"
                      >
                        {({ disabled, describedBy }) => (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            aria-describedby={describedBy}
                            data-testid="plan-change-price-button"
                          >
                            Change price
                          </Button>
                        )}
                      </DisabledWithReason>
                    </div>
                  </>
                )}

                <GeneratedSentence
                  parts={["Billed on the same day each month until someone stops it. Clients can pause it themselves if you let them."]}
                  testId="plan-billing-sentence"
                />

                <div className="px-11">
                  <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-billing-day-field">
                    <FieldLabel htmlFor={`${uid}-billingday`}>
                      Billing day<span className="text-xs text-muted-foreground ml-1">optional</span>
                    </FieldLabel>
                    <FieldContent>
                      <NativeSelect
                        id={`${uid}-billingday`}
                        value={form.billingDay === null ? "" : String(form.billingDay)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            billingDay: v === "" ? null : Number(v),
                          }));
                        }}
                        disabled={!canEdit}
                        data-testid="plan-billing-day-select"
                      >
                        <option value="">—</option>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={String(d)}>
                            The {d}
                            {d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}
                          </option>
                        ))}
                      </NativeSelect>
                    </FieldContent>
                  </Field>
                </div>

                {isNew ? (
                  <div className="px-11">
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-interval-field">
                      <FieldLabel htmlFor={`${uid}-interval`}>Billed</FieldLabel>
                      <FieldContent>
                        <NativeSelect
                          id={`${uid}-interval`}
                          value={form.interval}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, interval: e.target.value }))
                          }
                          disabled={!canEdit}
                          data-testid="plan-interval-select"
                        >
                          {PLAN_INTERVALS.map((iv) => (
                            <option key={iv} value={iv}>
                              {INTERVAL_LABEL[iv]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FieldContent>
                    </Field>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed px-11" data-testid="plan-interval-readonly">
                    Billed {INTERVAL_LABEL[form.interval] ?? form.interval} — can't be changed after the plan is created.
                  </p>
                )}
              </div>
            </EditorSection>

            {/* Stopping and pausing */}
            <EditorSection title="Stopping and pausing">
              <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0" data-testid="plan-pause-field">
                <FieldLabel htmlFor={`${uid}-pause`}>They can pause</FieldLabel>
                <FieldContent>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`${uid}-pause`}
                      checked={form.allowClientPause}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, allowClientPause: checked }))
                      }
                      disabled={!canEdit}
                      data-testid="plan-pause-switch"
                    />
                    <span>Let clients pause it from the portal</span>
                  </div>
                  <GeneratedSentence
                    parts={pauseAllowanceParts()}
                    testId="plan-pause-sentence"
                  />
                  <div className="flex gap-2 mt-4">
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0 flex-1 text-xs">
                      <FieldLabel htmlFor={`${uid}-pauseyear`} className="text-xs">
                        Times a year
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-pauseyear`}
                          type="number"
                          min="0"
                          value={String(form.maxPausesPerYear ?? 0)}
                          onChange={numEventHandler(
                            (v) =>
                              setForm((prev) => ({ ...prev, maxPausesPerYear: v ?? 0 })),
                            { allowNull: false, min: 0 }
                          )}
                          disabled={!canEdit || !form.allowClientPause}
                          data-testid="plan-pause-times-input"
                        />
                      </FieldContent>
                    </Field>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0 flex-1 text-xs">
                      <FieldLabel htmlFor={`${uid}-pausemonths`} className="text-xs">
                        Month(s) at a time
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-pausemonths`}
                          type="number"
                          min="1"
                          value={String(form.maxPauseMonths ?? 1)}
                          onChange={numEventHandler(
                            (v) =>
                              setForm((prev) => ({ ...prev, maxPauseMonths: v ?? 1 })),
                            { allowNull: false, min: 1 }
                          )}
                          disabled={!canEdit || !form.allowClientPause}
                          data-testid="plan-pause-months-input"
                        />
                      </FieldContent>
                    </Field>
                  </div>
                </FieldContent>
              </Field>

              <CollapsibleGroup
                label="If a payment fails"
                intro={dunningIntro}
                addLabel={canEdit && !dunningOpen ? "Customize" : null}
                onAdd={openDunningCustomize}
                open={dunningOpen}
                onOpenChange={setDunningOpen}
                testId="plan-dunning-group"
              >
                {dunningOpen && (
                  <>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0 text-xs" data-testid="plan-dunning-retries-field">
                      <FieldLabel htmlFor={`${uid}-retries`} className="text-xs">
                        Retries
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-retries`}
                          type="number"
                          min="0"
                          value={form.dunningRetries === null ? "" : String(form.dunningRetries)}
                          onChange={numEventHandler(
                            (v) => setForm((prev) => ({ ...prev, dunningRetries: v })),
                            { min: 0 }
                          )}
                          disabled={!canEdit}
                          data-testid="plan-dunning-retries-input"
                        />
                      </FieldContent>
                    </Field>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0 text-xs" data-testid="plan-dunning-days-field">
                      <FieldLabel htmlFor={`${uid}-days`} className="text-xs">
                        Over how many days
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-days`}
                          type="number"
                          min="1"
                          value={form.dunningDays === null ? "" : String(form.dunningDays)}
                          onChange={numEventHandler(
                            (v) => setForm((prev) => ({ ...prev, dunningDays: v })),
                            { min: 1 }
                          )}
                          disabled={!canEdit}
                          data-testid="plan-dunning-days-input"
                        />
                      </FieldContent>
                    </Field>
                    <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0 text-xs" data-testid="plan-dunning-pauseafter-field">
                      <FieldLabel htmlFor={`${uid}-pauseafter`} className="text-xs">
                        Then pause after
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id={`${uid}-pauseafter`}
                          type="number"
                          min="0"
                          value={form.dunningPauseAfter === null ? "" : String(form.dunningPauseAfter)}
                          onChange={numEventHandler(
                            (v) => setForm((prev) => ({ ...prev, dunningPauseAfter: v })),
                            { min: 0 }
                          )}
                          disabled={!canEdit}
                          data-testid="plan-dunning-pauseafter-input"
                        />
                      </FieldContent>
                    </Field>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={revertDunning}
                        data-testid="plan-dunning-revert"
                      >
                        Use the default instead
                      </Button>
                    )}
                  </>
                )}
              </CollapsibleGroup>
            </EditorSection>
          </EditorColumn>
        </main>

        {/* Rail */}
        <EditorRail objectNoun="plan" testId="plan-editor-rail">
          <RailSection label="Status" summary={statusTone.label} testId="plan-rail-status">
            <StatusBadge
              label={statusTone.label}
              tone={statusTone.tone}
              testId="plan-rail-status-badge"
            />
          </RailSection>

          <RailSection
            label="Paying"
            summary="Card or bank on file. Bank costs you nothing."
            testId="plan-rail-paying"
          >
            <DisabledWithReason
              disabled
              reason="Pay over time can't back a recurring charge, so it's off here."
              testId="plan-rail-pay-over-time"
            >
              {({ disabled, describedBy }) => (
                <span
                  className="text-sm text-locked-text"
                  aria-describedby={describedBy}
                  data-disabled={disabled}
                >
                  Pay over time
                </span>
              )}
            </DisabledWithReason>
          </RailSection>

          {!isNew && (
            <HeroNumber
              figure={activeNowFigure}
              label="Active now"
              sub={activeNowSub}
              action={{
                label: activeNowActionLabel,
                onClick: () =>
                  onNavigate?.(
                    `/money/subscriptions?plan=${currentId}`
                  ),
              }}
              testId="plan-active-now"
            />
          )}

          {hasDunningOverride && (
            <RailSection
              label="If a payment fails"
              summary="Custom for this plan"
              testId="plan-rail-dunning"
            >
              <RailOverrideNote
                defaultPhrase="retries a failed payment three times over ten days, then pauses it and tells you both"
                onRevert={revertDunning}
                testId="plan-rail-dunning-override"
              />
            </RailSection>
          )}

          {!hasDunningOverride && (
            <RailSection
              label="If a payment fails"
              summary="Not set — no practice default yet"
              testId="plan-rail-dunning"
            />
          )}

          <RailSection
            label="Stripe"
            // ★ ITEM 16 FIX, 30 Sep 2026 — the maintainer found "A product, a price." claimed for every saved
            //   plan regardless of whether Stripe sync ever actually succeeded; `stripeTone` (below)
            //   already read `editor.stripe_sync.state` correctly for the badge, this summary text
            //   just never consulted it. Now it agrees with the badge: no real product yet reads
            //   "Not yet synced.", same as the badge says.
            summary={
              isNew
                ? "Created once you save."
                : stripeTone.tone === "ok"
                  ? `A product, a price${
                      activeNow?.count != null
                        ? ` and ${activeNow.count} subscription${
                            activeNow.count === 1 ? "" : "s"
                          }`
                        : ""
                    }.`
                  : `${stripeTone.label}.`
            }
            testId="plan-rail-stripe"
          >
            <StatusBadge
              label={stripeTone.label}
              tone={stripeTone.tone}
              testId="plan-rail-stripe-badge"
            />
          </RailSection>
        </EditorRail>
      </div>
    </div>
  );
}
