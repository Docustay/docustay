// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServiceEditor — service definition editor. Ported from webui/src/lib/screens/items/ServiceEditor
// .svelte (1242 lines). Uses EditorPage archetype with EditorHeader, EditorColumn, EditorRail.
// Props: { path, params, app, onNavigate, onRefetch, rail, onChangePrice, onAddVariation, testId }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { request, ApiError } from "@/lib/api.js";
import { listAgreementTemplates } from "@/lib/documents/index.js";
import { formatValue } from "@/lib/format.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import HeroNumber from "@/lib/components/kit/HeroNumber.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
// ★ the maintainer, 29 Sep 2026 — the editor kit's OWN 190px-label-column layout (DESIGN-TOKENS §3.4),
//   already built and already correctly used by FieldMoney.jsx/FieldDuration.jsx (both imported
//   below but never RENDERED until now) — this screen used the generic shadcn `Field
//   orientation="horizontal"` instead, whose label is `flex-auto` (grows to fill space) rather
//   than a fixed column. That mismatch is exactly "labels sit far left, fields far right, with a
//   big gap and nothing lining up."
import { ROW, LABEL, CONTROL, HINT, AFFIX } from "@/lib/components/editor/styles.js";
import FieldDuration from "@/lib/components/editor/FieldDuration.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import { prepareImage, nameFromFile } from "@/lib/items/prepareImage.js";

import ProgramSelect from "@/lib/programs/ProgramSelect.jsx";
import { usePrograms } from "@/lib/programs/programs.js";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import CollapsibleGroup from "@/lib/components/editor/CollapsibleGroup.jsx";

import ServiceEditorTable1Table from "./ServiceEditorTable1Table.jsx";

const DELIVERY_MODE_LABEL = Object.freeze({
  in_person: "In person",
  video: "Video call",
  at_client: "At the client's place",
});
const DELIVERY_MODE_OPTIONS = Object.entries(DELIVERY_MODE_LABEL).map(([value, label]) => ({ value, label }));

// ★ the maintainer, 29 Sep 2026 — "Calendar colour ... a row of preset swatches", replacing the native
//   `<input type="color">` (which rendered, per the ask, "stretched into a black bar" — an
//   unstyled native colour well at full container width with no swatch of its own). Twelve
//   named, high-contrast colours; a service's own colour (if it was set from outside this list,
//   e.g. imported data) still shows as a thirteenth "current" swatch so nothing is silently lost.
const COLOUR_SWATCHES = Object.freeze([
  { name: "Indigo", hex: "#4F46C9" }, { name: "Blue", hex: "#2563EB" },
  { name: "Teal", hex: "#0D9488" }, { name: "Green", hex: "#1C6B47" },
  { name: "Lime", hex: "#65A30D" }, { name: "Amber", hex: "#B45309" },
  { name: "Orange", hex: "#C2410C" }, { name: "Red", hex: "#B3261E" },
  { name: "Pink", hex: "#BE185D" }, { name: "Purple", hex: "#7E22CE" },
  { name: "Slate", hex: "#475569" }, { name: "Charcoal", hex: "#27272A" },
]);

const blankForm = () => ({
  name: "",
  description: "",
  categoryId: "",
  programId: "",
  imageId: "",
  colour: "",
  durationMinutes: null,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  bookingNoticeHours: null,
  bookingWindowDays: null,
  amountMinor: null,
  currency: "USD",
  taxCode: "",
  unitLabel: "",
  hostIds: [],
  deliveryModes: ["in_person"],
  capacity: 1,
  sku: "",
  invoiceWording: "",
  intakeFormId: "",
  internalNotes: "",
  addonOnly: false,
  agreementTemplateId: "",
  agreementHoldUntilSigned: false,
});

function snapshot(f) {
  return JSON.parse(JSON.stringify(f));
}

function resetFormFromRecord(rec) {
  const item = rec.item;
  const bp = rec.booking_policy;
  const next = blankForm();
  next.name = item.name ?? "";
  next.description = item.description ?? "";
  next.categoryId = item.category_id ?? "";
  next.programId = item.program_id ?? "";
  next.imageId = item.image_id ?? "";
  next.colour = item.colour ?? "";
  next.durationMinutes = item.duration_minutes ?? null;
  next.bufferBeforeMinutes = bp?.buffer_before_minutes ?? 0;
  next.bufferAfterMinutes = bp?.buffer_after_minutes ?? 0;
  next.bookingNoticeHours = Number.isInteger(bp?.minimum_notice_minutes)
    ? Math.round(bp.minimum_notice_minutes / 60)
    : null;
  next.bookingWindowDays = bp?.booking_window_days ?? null;
  next.taxCode = item.tax_code ?? "";
  next.unitLabel = item.unit_label ?? "";
  next.deliveryModes =
    Array.isArray(item.delivery_modes) && item.delivery_modes.length
      ? [...item.delivery_modes]
      : ["in_person"];
  next.capacity = item.capacity ?? 1;
  next.sku = item.sku ?? "";
  next.invoiceWording = item.invoice_wording ?? "";
  next.intakeFormId = item.intake_form_id ?? "";
  next.internalNotes = item.internal_notes ?? "";
  next.addonOnly = item.addon_only === true;
  next.agreementTemplateId = rec.agreement?.template_id ?? "";
  next.agreementHoldUntilSigned = rec.agreement?.hold_until_signed === true;
  // ★ the maintainer, 29 Sep 2026 — "Who delivers a saved service can't be changed... build it."
  next.hostIds = Array.isArray(rec.host_ids) ? [...rec.host_ids] : [];
  return next;
}

function present(v) {
  return v === "" || v === null || v === undefined ? undefined : v;
}

function buildCreateBody(form) {
  return {
    name: form.name.trim(),
    durationMinutes: Number.isInteger(form.durationMinutes) ? form.durationMinutes : undefined,
    amountMinor: form.amountMinor ?? undefined,
    currency: form.amountMinor != null ? form.currency : undefined,
    bookable: undefined,
    categoryId: present(form.categoryId),
    programId: present(form.programId),
    imageId: present(form.imageId),
    colour: present(form.colour),
    sku: present(form.sku),
    invoiceWording: present(form.invoiceWording),
    addonOnly: form.addonOnly,
    intakeFormId: present(form.intakeFormId),
    description: present(form.description),
    internalNotes: present(form.internalNotes),
    taxCode: present(form.taxCode),
    unitLabel: present(form.unitLabel),
    deliveryModes: form.deliveryModes.length ? form.deliveryModes : undefined,
    capacity: Number.isInteger(form.capacity) ? form.capacity : undefined,
    hostIds: form.hostIds.length ? form.hostIds : undefined,
  };
}

function buildUpdateBody(form, baseline) {
  const body = {};
  const put = (key, val, baseVal, eq = (a, b) => a === b) => {
    if (!eq(val, baseVal)) body[key] = val;
  };
  put("name", form.name.trim(), baseline.name);
  put("durationMinutes", form.durationMinutes, baseline.durationMinutes);
  put("categoryId", present(form.categoryId) ?? null, present(baseline.categoryId) ?? null);
  put("programId", present(form.programId) ?? null, present(baseline.programId) ?? null);
  put("imageId", present(form.imageId) ?? null, present(baseline.imageId) ?? null);
  put("colour", present(form.colour) ?? null, present(baseline.colour) ?? null);
  put("sku", present(form.sku) ?? null, present(baseline.sku) ?? null);
  put("invoiceWording", present(form.invoiceWording) ?? null, present(baseline.invoiceWording) ?? null);
  put("addonOnly", form.addonOnly, baseline.addonOnly);
  put("intakeFormId", present(form.intakeFormId) ?? null, present(baseline.intakeFormId) ?? null);
  put("description", present(form.description) ?? null, present(baseline.description) ?? null);
  put("internalNotes", present(form.internalNotes) ?? null, present(baseline.internalNotes) ?? null);
  put("taxCode", present(form.taxCode) ?? null, present(baseline.taxCode) ?? null);
  put("unitLabel", present(form.unitLabel) ?? null, present(baseline.unitLabel) ?? null);
  put("deliveryModes", form.deliveryModes, baseline.deliveryModes,
    (a, b) => JSON.stringify(a) === JSON.stringify(b));
  put("capacity", form.capacity, baseline.capacity);
  // ★ the maintainer, 29 Sep 2026 — "Who delivers a saved service can't be changed... build it." Order-
  //   independent: two host lists with the same people in a different order are not a change.
  put("hostIds", form.hostIds, baseline.hostIds,
    (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()));
  for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];
  return body;
}

function locationName(locationId, locations) {
  return locations.find((l) => l.id === locationId)?.name ?? "Unknown location";
}

export default function ServiceEditor({
  path = null,
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
  rail = undefined,
  onChangePrice = null,
  onAddVariation = null,
  testId = "service-editor",
}) {
  const id = params?.id && params.id !== "new" ? params.id : null;
  const mode = id ? "edit" : "create";
  const rank = app?.nav?.rank ?? null;
  const mayEdit = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  // ── LOAD STATE ────────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadErr, setLoadErr] = useState(null);
  const [record, setRecord] = useState(null);
  const [categories, setCategories] = useState([]);
  // The practice's programs come from the shared programs module (ProgramSelect reads it too).
  const { programs } = usePrograms();
  const [hosts, setHosts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contractTemplates, setContractTemplates] = useState([]);

  // ── FORM STATE ────────────────────────────────────────────────────────────────────────────────
  const [form, setForm] = useState(blankForm());
  const [baseline, setBaseline] = useState(blankForm());

  // ── PHOTO UPLOAD — react-dropzone (the maintainer, 29 Sep 2026, replacing FileDropZoneRoot's no-op onUpload)
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const onDropPhoto = useCallback(async (accepted) => {
    const file = accepted?.[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const prepared = await prepareImage(file);
      const res = await request("/api/items/images", {
        method: "POST",
        body: {
          name: nameFromFile(file),
          dataBase64: prepared.dataBase64,
          contentType: prepared.contentType,
          width: prepared.width,
          height: prepared.height,
        },
      });
      const newId = res?.data?.id ?? res?.id;
      if (newId) setForm((f) => ({ ...f, imageId: newId }));
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "That file didn't upload — try again.");
    } finally {
      setPhotoUploading(false);
    }
  }, []);
  const { getRootProps: photoRootProps, getInputProps: photoInputProps, open: openPhotoPicker, isDragActive } =
    useDropzone({ onDrop: onDropPhoto, accept: { "image/*": [] }, maxFiles: 1, maxSize: 10 * 1000 * 1000, disabled: !mayEdit || photoUploading, noClick: true, noKeyboard: true });

  // ── DERIVED READS ────────────────────────────────────────────────────────────────────────────
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const canSeeMoney = mode === "create" ? true : !!record && "price_history" in record;
  const currentBasePrice = (() => {
    if (mode !== "edit" || !canSeeMoney) return null;
    const rows = record?.price_history ?? [];
    return rows.find((r) => !r.effective_to && !r.location_id && !r.delivery_mode) ?? null;
  })();
  const variationRows = (() => {
    if (mode !== "edit" || !canSeeMoney) return [];
    const rows = record?.price_history ?? [];
    return rows.filter((r) => !r.effective_to && (r.location_id || r.delivery_mode));
  })();

  const isArchived = !!record?.item?.archived_at;

  // ── STATE ──────────────────────────────────────────────────────────────────────────────────────
  const [archivedOverlay, setArchivedOverlay] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [staleConflict, setStaleConflict] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [chargeGroupOpen, setChargeGroupOpen] = useState(false);
  const [lessCommonOpen, setLessCommonOpen] = useState(false);

  // ── BLOCKERS ───────────────────────────────────────────────────────────────────────────────────
  const blockers = (() => {
    const out = [];
    if (!form.name || !form.name.trim()) out.push("Name");
    if (!Number.isInteger(form.durationMinutes) || form.durationMinutes <= 0) out.push("Length");
    return out;
  })();
  const showBlockers = blockers.length > 0 && (attemptedSave || dirty);

  // ── LOAD ────────────────────────────────────────────────────────────────────────────────────────
  const loadOptions = async () => {
    const [catRes, hostRes, locRes, tplRes] = await Promise.allSettled([
      request("/api/items/categories"),
      request("/api/list/people/team"),
      request("/api/locations"),
      listAgreementTemplates(),
    ]);
    setCategories(catRes.status === "fulfilled" ? (catRes.value?.data ?? []) : []);
    setHosts(hostRes.status === "fulfilled" ? (hostRes.value?.rows ?? []) : []);
    setLocations(locRes.status === "fulfilled" ? (locRes.value?.locations ?? []) : []);
    setContractTemplates(tplRes.status === "fulfilled" ? (tplRes.value?.rows ?? []) : []);
  };

  const load = async () => {
    setPhase("loading");
    setLoadErr(null);
    await loadOptions();
    if (mode === "create") {
      setForm(blankForm());
      setBaseline(blankForm());
      setPhase("ready");
      return;
    }
    try {
      const res = await request(`/api/items/services/${encodeURIComponent(id)}/editor`);
      setRecord(res);
      const newForm = resetFormFromRecord(res);
      setForm(newForm);
      setBaseline(snapshot(newForm));
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setLoadErr(err);
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setPhase("notfound");
        setLoadErr(err);
        return;
      }
      setPhase("error");
      setLoadErr(err);
    }
  };

  useEffect(() => {
    load();
  }, [id, mode]);

  // New service: if the practice has exactly one program, default to it (form AND baseline, so the
  // editor does not open "dirty").
  const programDefaulted = useRef(false);
  useEffect(() => {
    if (mode !== "create" || programDefaulted.current || phase !== "ready") return;
    if (programs.length !== 1) return;
    programDefaulted.current = true;
    const only = programs[0].id;
    setForm((f) => (f.programId ? f : { ...f, programId: only }));
    setBaseline((b) => (b.programId ? b : { ...b, programId: only }));
  }, [mode, phase, programs]);

  // ── HANDLERS ────────────────────────────────────────────────────────────────────────────────────
  const applyFieldError = (err) => {
    const field = err.body?.error?.detail?.field ?? err.body?.error?.fields ?? null;
    if (typeof field === "string") {
      setFieldErrors((prev) => ({ ...prev, [field]: err.message }));
      return true;
    }
    return false;
  };

  const handleSaveError = (err) => {
    if (!(err instanceof ApiError)) {
      setSaveError({ message: "You're offline — nothing was saved. Try again when you're back." });
      return;
    }
    if (err.status === 403) {
      setSaveError({ message: "Ask an owner or admin to change the catalogue." });
      return;
    }
    if (err.status === 409 && err.body?.error?.detail?.kind === "stale") {
      setStaleConflict({ message: err.message, requestId: err.requestId });
      return;
    }
    if (err.status === 409 && err.body?.error?.detail?.field === "name") {
      setFieldErrors((prev) => ({ ...prev, name: err.message }));
      return;
    }
    if (err.status === 404) {
      setArchivedOverlay({ message: err.message });
      return;
    }
    if ((err.status === 400 || err.status === 422) && applyFieldError(err)) return;
    setSaveError({ message: err.message, requestId: err.requestId });
  };

  const handleSave = async () => {
    setAttemptedSave(true);
    if (!mayEdit || blockers.length > 0) return;
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    setStaleConflict(null);
    try {
      if (mode === "create") {
        const res = await request("/api/items/services", {
          method: "POST",
          body: buildCreateBody(form),
        });
        const newId = res?.data?.id ?? res?.id;
        onRefetch?.();
        if (newId) onNavigate?.(`/items/services/${newId}`);
      } else {
        const body = buildUpdateBody(form, baseline);
        if (Object.keys(body).length > 0) {
          await request("/api/items/services/update", {
            method: "POST",
            body: { id, expectedUpdatedAt: record.item.updated_at, ...body },
          });
        }
        onRefetch?.();
        await load();
      }
    } catch (err) {
      handleSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    onNavigate?.("/items/services");
  };

  const handleDuplicate = async () => {
    if (!id) return;
    try {
      const res = await request("/api/items/services/duplicate", {
        method: "POST",
        body: { id },
      });
      onRefetch?.();
      if (res?.id) onNavigate?.(`/items/services/${res.id}`);
    } catch (err) {
      setSaveError({
        message: err instanceof ApiError ? err.message : "You're offline — nothing was saved. Try again when you're back.",
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
  };

  const handleRestore = async () => {
    if (!id) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await request("/api/records/restore", {
        method: "POST",
        body: { object: "service", id },
      });
      setArchivedOverlay(null);
      onRefetch?.();
      await load();
    } catch (err) {
      setRestoreError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: "You're offline — nothing was saved. Try again when you're back." }
      );
    } finally {
      setRestoring(false);
    }
  };

  // ── HEADER ──────────────────────────────────────────────────────────────────────────────────────
  const headerTitle = mode === "create" ? "New service" : form.name || "Untitled service";
  const headerMeta =
    mode === "create"
      ? "New service — nothing is sellable until you save."
      : `Edited ${formatValue(record?.item?.updated_at, "date")}`;

  const headerVerbs = [];
  if (mayEdit && mode === "edit") {
    headerVerbs.push({
      label: "Duplicate",
      kind: "plain",
      onClick: handleDuplicate,
      disabled: false,
    });
  }
  if (mayEdit) {
    headerVerbs.push({
      label: mode === "create" ? "Create service" : "Save changes",
      kind: "primary",
      onClick: handleSave,
      disabled: saving,
    });
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <EditorPage
        header={{ title: "Loading…" }}
        loading={true}
        testId={testId}
      />
    );
  }

  if (phase === "denied") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-4" data-testid={`${testId}-denied`} role="alert">
        <p>{loadErr?.message ?? "You don't have permission to see this."}</p>
        <Button variant="outline" onClick={handleClose}>
          Back to services
        </Button>
      </div>
    );
  }

  if (phase === "notfound") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-4" data-testid={`${testId}-notfound`} role="alert">
        <p>{loadErr?.message ?? "No such service."}</p>
        <Button variant="outline" onClick={handleClose}>
          Back to services
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-4" data-testid={`${testId}-error`} role="alert">
        <p>{loadErr?.message ?? "Something went wrong."}</p>
        {loadErr?.requestId && (
          <p className="text-sm text-mute">
            Reference: <code>{loadErr.requestId}</code>
          </p>
        )}
        <Button variant="outline" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  // READY STATE — render full editor
  return (
    <div data-testid={testId} data-mode={mode} data-phase={phase}>
      <EditorPage
        header={{
          title: headerTitle,
          meta: headerMeta,
          verbs: headerVerbs,
          onClose: handleClose,
          dirty: dirty && !saving,
          objectNoun: "service",
          testId: `${testId}-header`,
        }}
        blocker={showBlockers ? { count: blockers.length, items: blockers } : null}
        rail={rail ? <EditorRail>{rail}</EditorRail> : null}
        loading={false}
        testId={`${testId}-page`}
      >
        {isArchived && (
          <div
            className="mb-4 flex items-center gap-3 rounded-lg border border-bad bg-bad-soft p-4"
            role="alert"
            data-testid={`${testId}-archived`}
          >
            <div className="flex-1">
              <p className="text-sm text-bad">
                {archivedOverlay?.message ?? "This service is archived."}
              </p>
            </div>
            {mayEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                disabled={restoring}
              >
                {restoring ? "Restoring…" : "Restore"}
              </Button>
            )}
          </div>
        )}

        {staleConflict && (
          <div
            className="mb-4 flex items-center gap-3 rounded-lg border border-bad bg-bad-soft p-4"
            role="alert"
            data-testid={`${testId}-stale`}
          >
            <div className="flex-1">
              <p className="text-sm text-bad">{staleConflict.message}</p>
              {staleConflict.requestId && (
                <p className="mt-1 text-xs text-mute">
                  Reference: <code>{staleConflict.requestId}</code>
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={load}>
              See what changed
            </Button>
          </div>
        )}

        {saveError && (
          <InlineValidation message={saveError.message} requestId={saveError.requestId} />
        )}

        {restoreError && (
          <InlineValidation message={restoreError.message} requestId={restoreError.requestId} />
        )}

        <EditorSection title="What it is">
          <div className={ROW}>
            <label className={LABEL} htmlFor="se-name">Name<span className="text-required" aria-hidden="true"> *</span></label>
            <div className="min-w-0 flex-1">
              <div className={CONTROL} data-err={showBlockers && blockers.includes("Name") ? "true" : undefined} data-disabled={!mayEdit ? "true" : undefined}>
                <input
                  id="se-name"
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!mayEdit}
                  aria-invalid={showBlockers && blockers.includes("Name")}
                  data-testid={`${testId}-name`}
                />
              </div>
              {fieldErrors.name && (
                <InlineValidation message={fieldErrors.name} testId={`${testId}-name-error`} />
              )}
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="se-description">Description</label>
            <div className="min-w-0 flex-1">
              <Textarea
                id="se-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={!mayEdit}
                data-testid={`${testId}-description`}
              />
              <p className={HINT}>Clients read this when they book.</p>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="se-category">Category <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                <select
                  id="se-category"
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-category`}
                >
                  <option value="">(no category)</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ★★★ the maintainer, 29 Sep 2026 — react-dropzone (MIT), replacing FileDropZoneRoot's no-op
              onUpload — real drag-and-drop, uploaded through the SAME POST /api/items/images
              path ImageLibraryPage.jsx already uses (prepareImage, shared now — see
              lib/items/prepareImage.js). "browse files" opens the native picker; "use one from
              your library" is a real destination (the Image Library screen), not a dead link. */}
          {/* ★ FIX, 1 Oct 2026 (Programs follow-up brief Part 2) — migration 0543 is live in
              production and every practice can create its own programs (Categories' own,
              already-established pattern: an empty list is normal, never a reason to fall back to
              a hard-coded choice). The life/recovery two-button fallback is retired outright —
              "grep proves nothing hard-codes life/recovery as a choice anymore". */}
          <div className={ROW}>
            <label className={LABEL} htmlFor="se-program">Program</label>
            <div className="min-w-0 flex-1">
              <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                <ProgramSelect
                  id="se-program"
                  value={form.programId}
                  onChange={(v) => setForm({ ...form, programId: v ?? "" })}
                  disabled={!mayEdit}
                  testId={`${testId}-program`}
                />
              </div>
              <p className={HINT}>Which program a client sees this under when they book or buy.</p>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="se-photo">Photo <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              {form.imageId ? (
                <div className="flex items-center gap-3">
                  <img src={`/api/items/images/${form.imageId}/raw`} alt="" className="h-22 w-22 rounded-lg border border-line object-cover" />
                  {mayEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, imageId: "" })} data-testid={`${testId}-photo-remove`}>
                      Remove
                    </Button>
                  )}
                </div>
              ) : (
                <div
                  {...photoRootProps()}
                  className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-white data-[active=true]:border-brand data-[active=true]:bg-brand-soft"
                  data-active={isDragActive ? "true" : undefined}
                  data-testid={`${testId}-photo-drop`}
                >
                  <input {...photoInputProps()} id="se-photo" />
                  <div className="text-ui font-medium text-ink">
                    {photoUploading ? "Uploading…" : "Drop a photo here"}
                  </div>
                  {!photoUploading && (
                    <div className="text-meta text-mute">
                      <button type="button" className="text-brand hover:underline" onClick={openPhotoPicker} disabled={!mayEdit}>browse files</button>
                      {" "}or{" "}
                      <button type="button" className="text-brand hover:underline" onClick={() => onNavigate?.("/items/images")} disabled={!mayEdit}>use one from your library</button>
                    </div>
                  )}
                </div>
              )}
              {photoError && <InlineValidation message={photoError} testId={`${testId}-photo-error`} />}
            </div>
          </div>

          {/* ★ the maintainer, 29 Sep 2026 — "a row of preset swatches", replacing the native colour well
              (which rendered "stretched into a black bar" — an unstyled input[type=color] at
              full container width). */}
          <div className={ROW}>
            <label className={LABEL} htmlFor="se-colour">Calendar colour <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Calendar colour" data-testid={`${testId}-colour`}>
                {COLOUR_SWATCHES.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.name}
                    aria-label={c.name}
                    aria-pressed={form.colour === c.hex}
                    disabled={!mayEdit}
                    onClick={() => setForm({ ...form, colour: c.hex })}
                    className="size-7 rounded-full border-2 outline-none disabled:opacity-60"
                    style={{ backgroundColor: c.hex, borderColor: form.colour === c.hex ? "var(--color-ink)" : "transparent" }}
                    data-testid={`${testId}-colour-${c.hex.slice(1)}`}
                  />
                ))}
                {form.colour && !COLOUR_SWATCHES.some((c) => c.hex === form.colour) && (
                  <span className="flex size-7 items-center justify-center rounded-full border-2" style={{ backgroundColor: form.colour, borderColor: "var(--color-ink)" }} title="Current colour" />
                )}
              </div>
            </div>
          </div>
        </EditorSection>

        {/* ★★★ the maintainer, 29 Sep 2026 — "Label every number box." Every number field below now names
            itself inline (an AFFIX, same idiom FieldDuration/FieldMoney already use for "min"),
            instead of a bare unlabeled 0. */}
        <EditorSection title="How long it takes">
          <div className={ROW}>
            <label className={LABEL}>Length<span className="text-required" aria-hidden="true"> *</span></label>
            <div className="min-w-0 flex-1">
              <div className="flex gap-2.5">
                <div className={CONTROL} data-err={showBlockers && blockers.includes("Length") ? "true" : undefined} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    type="number" min="0"
                    className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                    value={form.durationMinutes ?? ""}
                    onChange={(e) => setForm({ ...form, durationMinutes: e.target.value ? parseInt(e.target.value) : null })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-duration`}
                    placeholder="0"
                  />
                  <span className={AFFIX}><b>minutes</b></span>
                </div>
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    type="number" min="0"
                    className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                    value={form.bufferBeforeMinutes}
                    onChange={(e) => setForm({ ...form, bufferBeforeMinutes: parseInt(e.target.value) || 0 })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-buffer-before`}
                    placeholder="0"
                  />
                  <span className={AFFIX}><b>min before</b></span>
                </div>
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    type="number" min="0"
                    className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                    value={form.bufferAfterMinutes}
                    onChange={(e) => setForm({ ...form, bufferAfterMinutes: parseInt(e.target.value) || 0 })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-buffer-after`}
                    placeholder="0"
                  />
                  <span className={AFFIX}><b>min after</b></span>
                </div>
              </div>
              <p className={HINT}>Buffer is blocked around the session for travel, setup or writing notes.</p>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL}>Booking window <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <div className="flex gap-2.5">
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    type="number" min="0"
                    className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                    value={form.bookingNoticeHours ?? ""}
                    onChange={(e) => setForm({ ...form, bookingNoticeHours: e.target.value ? parseInt(e.target.value) : null })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-notice-hours`}
                    placeholder="0"
                  />
                  <span className={AFFIX}><b>hours notice</b></span>
                </div>
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    type="number" min="0"
                    className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                    value={form.bookingWindowDays ?? ""}
                    onChange={(e) => setForm({ ...form, bookingWindowDays: e.target.value ? parseInt(e.target.value) : null })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-window-days`}
                    placeholder="0"
                  />
                  <span className={AFFIX}><b>days ahead at most</b></span>
                </div>
              </div>
              <p className={HINT}>How close to the session someone can still book, and how far out your calendar opens.</p>
            </div>
          </div>
        </EditorSection>

        {/* ★★★ the maintainer, 29 Sep 2026 — "Change price doesn't work — wire it" (fixed: routes.js/
            PAGE_SURFACES now opens the same ModalChangePrice PackageEditor already uses) · "On a
            new service, just let them type the price instead of showing $0 and a Change price
            button" · "The $250.00 is in a different, oversized font — make it match the rest"
            (was raw `text-5xl font-serif` — HeroNumber/Figure, imported here since the last
            session that touched this file but never rendered, IS "the rest": every other money
            figure in the app already goes through `font-figure`/`text-figure-*`). */}
        {mode === "create" ? (
          <EditorSection title="Price">
            <FieldMoney
              valueMinor={form.amountMinor}
              onValueMinorChange={(minor) => setForm({ ...form, amountMinor: minor })}
              currency={form.currency}
              label="Price"
              helper="Per session, before tax. Leave it blank to price this later."
              disabled={!mayEdit}
              testId={`${testId}-price`}
            />
          </EditorSection>
        ) : canSeeMoney && (
          <div className="border-t border-line bg-paper py-8">
            <div className="px-11">
              <HeroNumber
                figure={currentBasePrice ? formatValue(currentBasePrice.amount_minor, "money", { currency: currentBasePrice.currency }) : null}
                label="per session, before tax"
                action={mayEdit ? { label: "Change price", onClick: () => onChangePrice?.({ service: record.item }) } : null}
                testId={`${testId}-price-hero`}
              />
              <p className="mt-4 text-ui leading-relaxed text-ink">
                Changing this starts a <strong>new price from today</strong>. Anything already invoiced keeps the price it was sold at, so your history stays true.
              </p>

              <div className="mt-8">
                <div className={ROW}>
                  <label className={LABEL}>Tax <span className="text-meta text-mute">optional</span></label>
                  <div className="min-w-0 flex-1">
                    <div className={`${CONTROL} text-mute`}>
                      No tax rates yet
                      <span className={AFFIX}><button type="button" className="font-medium text-brand hover:underline" onClick={() => onNavigate?.("/money/settings/tax")}>Set one up</button></span>
                    </div>
                  </div>
                </div>
              </div>

              {variationRows.length > 0 && (
                <div className="mt-8 border-t border-line pt-8">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-ink">Charge differently by place</div>
                      <div className="text-ui text-mute">Travelling to a client costs you more, so it costs them more.</div>
                    </div>
                    {mayEdit && (
                      <Button size="sm" onClick={() => onAddVariation?.({ service: record.item })}>
                        Add a variation
                      </Button>
                    )}
                  </div>
                  <ServiceEditorTable1Table
                    DELIVERY_MODE_LABEL={DELIVERY_MODE_LABEL}
                    variationRows={variationRows}
                    locationName={(locId) => locationName(locId, locations)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ★★★ the maintainer, 29 Sep 2026 — "Who delivers a saved service can't be changed... build it"
            (fixed: editors.mjs's updateService now writes keystone.service_host; editorRead now
            reads it back). "shadcn's own Combobox with multiple ... removable chips built in" for
            both this and Delivery modes, replacing the squashed native multi-selects. */}
        <EditorSection title="Who gives it, and where">
          <div className={ROW}>
            <label className={LABEL} htmlFor="se-hosts">Who can be booked <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <Combobox
                id="se-hosts"
                testId={`${testId}-hosts`}
                multiple
                disabled={!mayEdit}
                options={hosts.map((h) => ({ value: h.id, label: h.display_name }))}
                value={form.hostIds}
                onValueChange={(hostIds) => setForm({ ...form, hostIds })}
                placeholder="Search your team…"
                emptyText="Nobody on your team yet."
              />
              <p className={HINT}>Leave this empty and anyone on the team can be booked.</p>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="se-delivery">Delivery modes <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <Combobox
                id="se-delivery"
                testId={`${testId}-delivery-modes`}
                multiple
                disabled={!mayEdit}
                options={DELIVERY_MODE_OPTIONS}
                value={form.deliveryModes}
                onValueChange={(deliveryModes) => setForm({ ...form, deliveryModes })}
                placeholder="Search delivery modes…"
                emptyText="No delivery modes."
              />
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="se-capacity">People per session <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                <input
                  id="se-capacity"
                  type="number" min="1"
                  className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-capacity`}
                />
                <span className={AFFIX}><b>people</b></span>
              </div>
              <p className={HINT}>More than one turns this into a class, and the booking page starts showing places left.</p>
            </div>
          </div>
        </EditorSection>

        <EditorSection title="What happens when someone books">
          <div className={ROW}>
            <label className={LABEL} htmlFor="se-agreement">Send a document <span className="text-meta text-mute">optional</span></label>
            <div className="min-w-0 flex-1">
              <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                <select
                  id="se-agreement"
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                  value={form.agreementTemplateId}
                  onChange={(e) => setForm({ ...form, agreementTemplateId: e.target.value })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-agreement-template`}
                >
                  <option value="">None</option>
                  {contractTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL}>Wait for a signature</label>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.agreementHoldUntilSigned}
                  onCheckedChange={(checked) => setForm({ ...form, agreementHoldUntilSigned: checked })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-hold-until-signed`}
                />
                <span className="text-ui text-ink">Hold the session until it's signed</span>
              </div>
              <p className={HINT}>It stays pending, and the client is reminded once a day until they sign.</p>
            </div>
          </div>
        </EditorSection>

        <CollapsibleGroup
          label="Less common settings"
          intro="Internal notes, SKU, intake form, wording on the invoice, package-only."
          open={lessCommonOpen}
          onOpenChange={setLessCommonOpen}
        >
          <div className="flex flex-col gap-1">
            <div className={ROW}>
              <label className={LABEL} htmlFor="se-internal-notes">Internal notes</label>
              <div className="min-w-0 flex-1">
                <Textarea
                  id="se-internal-notes"
                  value={form.internalNotes}
                  onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-internal-notes`}
                />
              </div>
            </div>

            <div className={ROW}>
              <label className={LABEL} htmlFor="se-sku">SKU</label>
              <div className="min-w-0 flex-1">
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    id="se-sku"
                    className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-sku`}
                  />
                </div>
              </div>
            </div>

            <div className={ROW}>
              <label className={LABEL} htmlFor="se-intake">Intake form</label>
              <div className="min-w-0 flex-1">
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <select
                    id="se-intake"
                    className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                    value={form.intakeFormId}
                    onChange={(e) => setForm({ ...form, intakeFormId: e.target.value })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-intake-form`}
                  >
                    <option value="">None</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={ROW}>
              <label className={LABEL} htmlFor="se-invoice-wording">Wording on invoice</label>
              <div className="min-w-0 flex-1">
                <div className={CONTROL} data-disabled={!mayEdit ? "true" : undefined}>
                  <input
                    id="se-invoice-wording"
                    className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                    value={form.invoiceWording}
                    onChange={(e) => setForm({ ...form, invoiceWording: e.target.value })}
                    disabled={!mayEdit}
                    data-testid={`${testId}-invoice-wording`}
                  />
                </div>
              </div>
            </div>

            <div className={ROW}>
              <label className={LABEL}>Can only be added to packages</label>
              <div className="min-w-0 flex-1">
                <Checkbox
                  checked={form.addonOnly}
                  onCheckedChange={(checked) => setForm({ ...form, addonOnly: checked })}
                  disabled={!mayEdit}
                  data-testid={`${testId}-addon-only`}
                />
              </div>
            </div>
          </div>
        </CollapsibleGroup>
      </EditorPage>
    </div>
  );
}
