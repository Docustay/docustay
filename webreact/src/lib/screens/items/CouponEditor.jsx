// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.025 — CouponEditor.jsx — React port of webui/src/lib/screens/items/CouponEditor.svelte
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import { formatValue } from "@/lib/format.js";

import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import CollapsibleGroup from "@/lib/components/editor/CollapsibleGroup.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import AfterSavePanel from "@/lib/components/editor/AfterSavePanel.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import GeneratedSentence from "@/lib/components/editor/GeneratedSentence.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ProgramGate from "@/lib/components/ProgramGate.jsx";

const WHAT_TO_OPTIONS = Object.freeze([
  { value: "any", label: "Everything" },
  { value: "service", label: "Services only" },
  { value: "package", label: "Packages only" },
  { value: "plan", label: "Plans only" },
  { value: "category", label: "A category" },
  { value: "services", label: "Named services" },
]);

function appliesToFor(whatTo) {
  if (whatTo === "category" || whatTo === "services") return "service";
  return whatTo;
}

function targetIdsFor(whatTo, categoryId, serviceIds) {
  if (whatTo === "category") return categoryId ? [categoryId] : null;
  if (whatTo === "services") return serviceIds.length ? serviceIds : null;
  return null;
}

function parsePercentBp(raw) {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.round(n * 100);
}

function parsePositiveInt(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function dateInputToIso(raw) {
  return raw ? new Date(`${raw}T00:00:00Z`).toISOString() : null;
}

function isoToDateInput(raw) {
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export default function CouponEditor({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  // ── which coupon, or none ("new") ───────────────────────────────────────────────────
  const couponId = useMemo(() => {
    return params?.id && params.id !== "new" ? params.id : null;
  }, [params?.id]);
  const isNew = !couponId;

  // ── screen phase ───────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  // ── data this screen reads but never edits directly ────────────────────────────────
  const [record, setRecord] = useState(null);
  const [listRow, setListRow] = useState(null);
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [practiceCurrency, setPracticeCurrency] = useState(null);

  // ── the editable draft ─────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [descriptionClient, setDescriptionClient] = useState("");
  const [code, setCode] = useState("");
  const [kindDraft, setKindDraft] = useState("percent");
  const [percentDraft, setPercentDraft] = useState("");
  const [amountMinorDraft, setAmountMinorDraft] = useState(null);
  const [maxDiscountMinorDraft, setMaxDiscountMinorDraft] = useState(null);
  const [whatToDraft, setWhatToDraft] = useState("any");
  const [categoryTargetId, setCategoryTargetId] = useState("");
  const [serviceTargetIds, setServiceTargetIds] = useState([]);
  // ★ the maintainer, 29 Sep 2026 (life coaching brief) — "Named services" asks Life/Recovery first, same
  //   pattern as AddLineRow/NewSubscriptionSheet.
  const [serviceTargetGroup, setServiceTargetGroup] = useState(null);
  const [firstPurchaseOnly, setFirstPurchaseOnly] = useState(false);
  const [validFromDraft, setValidFromDraft] = useState("");
  const [validToDraft, setValidToDraft] = useState("");
  const [perPersonLimitDraft, setPerPersonLimitDraft] = useState("");
  const [maxRedemptionsDraft, setMaxRedemptionsDraft] = useState("");
  const [activeState, setActiveState] = useState(true);

  const [baselineJSON, setBaselineJSON] = useState("");
  const [limitsGroupOpen, setLimitsGroupOpen] = useState(false);
  const [codesGroupOpen, setCodesGroupOpen] = useState(true);

  const [railOpen, setRailOpen] = useState({ status: false, stack: false, used: false, shows: false, stripe: false });

  // ── save flow ──────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [savedResult, setSavedResult] = useState(null);

  // ── codes management (populated-only) ───────────────────────────────────────────────
  const [addingCode, setAddingCode] = useState(false);
  const [newCodeDraft, setNewCodeDraft] = useState("");
  const [addCodeError, setAddCodeError] = useState(null);
  const [addingCodeBusy, setAddingCodeBusy] = useState(false);
  const [codeActionId, setCodeActionId] = useState(null);
  const [codesActionError, setCodesActionError] = useState(null);

  // ── helper to create snapshot for dirty tracking ────────────────────────────────────
  const currentDraftSnapshot = () => {
    return JSON.stringify({
      name,
      descriptionClient,
      code: isNew ? code : undefined,
      kindDraft: isNew ? kindDraft : undefined,
      percentDraft: isNew ? percentDraft : undefined,
      amountMinorDraft: isNew ? amountMinorDraft : undefined,
      maxDiscountMinorDraft,
      whatToDraft,
      categoryTargetId,
      serviceTargetIds: [...serviceTargetIds].sort(),
      firstPurchaseOnly,
      validFromDraft,
      validToDraft,
      perPersonLimitDraft,
      maxRedemptionsDraft,
    });
  };

  const dirty = useMemo(() => {
    return phase === "ready" && !savedResult && currentDraftSnapshot() !== baselineJSON;
  }, [phase, savedResult, name, descriptionClient, code, kindDraft, percentDraft, amountMinorDraft, maxDiscountMinorDraft, whatToDraft, categoryTargetId, serviceTargetIds, firstPurchaseOnly, validFromDraft, validToDraft, perPersonLimitDraft, maxRedemptionsDraft, baselineJSON, isNew]);

  // ── blockers ───────────────────────────────────────────────────────────────────────
  const blockers = useMemo(() => {
    const list = [];
    if (!name.trim()) list.push({ id: "name", label: "Name" });
    if (isNew) {
      const shapeOk = kindDraft === "percent"
        ? parsePercentBp(percentDraft) !== null
        : (Number.isInteger(amountMinorDraft) && amountMinorDraft > 0 && !!practiceCurrency);
      if (!shapeOk) list.push({ id: "amount", label: "Amount off" });
    }
    return list;
  }, [name, isNew, kindDraft, percentDraft, amountMinorDraft, practiceCurrency]);

  // ── limits error ───────────────────────────────────────────────────────────────────
  const limitsError = useMemo(() => {
    if (fieldErrors.perPersonLimit) return fieldErrors.perPersonLimit;
    if (fieldErrors.maxRedemptions) return fieldErrors.maxRedemptions;
    if (parsePositiveInt(perPersonLimitDraft) === undefined) return "Enter a whole number greater than zero, or leave it empty.";
    if (parsePositiveInt(maxRedemptionsDraft) === undefined) return "Enter a whole number greater than zero, or leave it empty.";
    return null;
  }, [fieldErrors.perPersonLimit, fieldErrors.maxRedemptions, perPersonLimitDraft, maxRedemptionsDraft]);

  // Auto-open limits group if there's an error
  useEffect(() => {
    if (limitsError) setLimitsGroupOpen(true);
  }, [limitsError]);

  // ── derive whatTo from item ────────────────────────────────────────────────────────
  const deriveWhatTo = (item) => {
    if (!item) return "any";
    if (item.applies_to !== "service") return item.applies_to;
    const ids = item.target_ids;
    if (!ids || ids.length === 0) return "service";
    const catSet = new Set(categories.map((c) => c.id));
    const svcSet = new Set(services.map((s) => s.id));
    if (ids.every((id) => catSet.has(id))) return "category";
    if (ids.every((id) => svcSet.has(id))) return "services";
    return "services";
  };

  // ── hydrate form from record ───────────────────────────────────────────────────────
  const hydrateForm = (item) => {
    setName(item.name ?? "");
    setDescriptionClient(item.description_client ?? "");
    setMaxDiscountMinorDraft(item.max_discount_minor ?? null);
    setFirstPurchaseOnly(!!item.first_purchase_only);
    setValidFromDraft(isoToDateInput(item.valid_from));
    setValidToDraft(isoToDateInput(item.valid_to));
    setPerPersonLimitDraft(item.per_person_limit != null ? String(item.per_person_limit) : "");
    setMaxRedemptionsDraft(item.max_redemptions != null ? String(item.max_redemptions) : "");
    setActiveState(!!item.active);
    const whatTo = deriveWhatTo(item);
    setWhatToDraft(whatTo);
    if (whatTo === "category") {
      setCategoryTargetId(item.target_ids?.[0] ?? "");
      setServiceTargetIds([]);
    } else if (whatTo === "services") {
      setCategoryTargetId("");
      setServiceTargetIds([...(item.target_ids ?? [])]);
    } else {
      setCategoryTargetId("");
      setServiceTargetIds([]);
    }
    setBaselineJSON(currentDraftSnapshot());
  };

  // ── load reference data ────────────────────────────────────────────────────────────
  const loadReferenceData = async () => {
    const [catRes, svcRes, moneyRes] = await Promise.allSettled([
      request("/api/items/categories"),
      request("/api/list/items/services"),
      request("/api/settings/money"),
    ]);
    setCategories(catRes.status === "fulfilled" ? (catRes.value?.data ?? []) : []);
    setServices(svcRes.status === "fulfilled" ? (svcRes.value?.rows ?? []) : []);
    if (moneyRes.status === "fulfilled") {
      const f = (moneyRes.value?.fields ?? []).find((x) => x.key === "money.currency");
      setPracticeCurrency(f?.value ?? null);
    }
  };

  // ── main load function ─────────────────────────────────────────────────────────────
  const load = async () => {
    setPhase("loading");
    setLoadError(null);
    setSavedResult(null);
    await loadReferenceData();

    if (isNew) {
      setRecord(null);
      setListRow(null);
      setName("");
      setDescriptionClient("");
      setCode("");
      setKindDraft("percent");
      setPercentDraft("");
      setAmountMinorDraft(null);
      setMaxDiscountMinorDraft(null);
      setWhatToDraft("any");
      setCategoryTargetId("");
      setServiceTargetIds([]);
      setFirstPurchaseOnly(false);
      setValidFromDraft("");
      setValidToDraft("");
      setPerPersonLimitDraft("");
      setMaxRedemptionsDraft("");
      setActiveState(true);
      setBaselineJSON(currentDraftSnapshot());
      setPhase("ready");
      return;
    }

    try {
      const body = await api.couponEditor(couponId);
      setRecord(body);
      hydrateForm(body.item);
      try {
        const listBody = await request("/api/list/items/coupons");
        setListRow((listBody?.rows ?? []).find((r) => r.id === couponId) ?? null);
      } catch {
        setListRow(null);
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
  };

  // Load effect
  useEffect(() => {
    load();
  }, [couponId]);

  // ── helper to close editor ─────────────────────────────────────────────────────────
  const closeEditor = () => {
    onNavigate?.("/items/coupons");
  };

  const fieldNameFromDetail = (err) => {
    return err instanceof ApiError ? (err.body?.error?.detail?.field ?? null) : null;
  };

  // ── toggle active ──────────────────────────────────────────────────────────────────
  const toggleActive = async (next) => {
    if (!couponId) return;
    const previous = activeState;
    setActiveState(next);
    try {
      await api.setCouponActive(couponId, next);
      onRefetch?.();
    } catch (err) {
      setActiveState(previous);
      setSaveError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) }
      );
    }
  };

  // ── save handler ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || blockers.length > 0) return;
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      if (isNew) {
        const body = {
          name: name.trim(),
          code: code.trim() || null,
          kind: kindDraft,
          percentBp: kindDraft === "percent" ? parsePercentBp(percentDraft) : null,
          amountMinor: kindDraft === "fixed" ? amountMinorDraft : null,
          currency: kindDraft === "fixed" ? practiceCurrency : null,
          appliesTo: appliesToFor(whatToDraft),
          maxRedemptions: parsePositiveInt(maxRedemptionsDraft) || null,
          validFrom: dateInputToIso(validFromDraft),
          validTo: dateInputToIso(validToDraft),
          descriptionClient: descriptionClient.trim() || null,
          maxDiscountMinor: kindDraft === "percent" ? maxDiscountMinorDraft : null,
          firstPurchaseOnly,
          perPersonLimit: parsePositiveInt(perPersonLimitDraft) || null,
          targetIds: targetIdsFor(whatToDraft, categoryTargetId, serviceTargetIds),
        };
        const created = await api.createCoupon(body);
        setSavedResult({ id: created.id, name: created.name });
      } else {
        const applies = record?.item?.applies_to;
        const body = {
          id: couponId,
          expectedUpdatedAt: record.item.updated_at,
          name: name.trim(),
          descriptionClient: descriptionClient.trim() || null,
          maxDiscountMinor: record.item.kind === "percent" ? maxDiscountMinorDraft : null,
          firstPurchaseOnly,
          perPersonLimit: parsePositiveInt(perPersonLimitDraft) || null,
          maxRedemptions: parsePositiveInt(maxRedemptionsDraft) || null,
          validFrom: dateInputToIso(validFromDraft),
          validTo: dateInputToIso(validToDraft),
          targetIds:
            applies === "service"
              ? targetIdsFor(whatToDraft, categoryTargetId, serviceTargetIds)
              : record.item.target_ids ?? null,
        };
        const result = await api.updateCoupon(body);
        setRecord({ ...record, item: { ...record.item, ...body, updated_at: result.updated_at } });
        setBaselineJSON(currentDraftSnapshot());
        onRefetch?.();
      }
    } catch (err) {
      const field = fieldNameFromDetail(err);
      if (field) {
        setFieldErrors({ ...fieldErrors, [field]: err.message });
      } else {
        setSaveError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // ── after save keep editing ────────────────────────────────────────────────────────
  const afterSaveKeepEditing = async () => {
    if (!savedResult) return;
    const newId = savedResult.id;
    setSavedResult(null);
    setPhase("loading");
    try {
      const body = await api.couponEditor(newId);
      setRecord(body);
      hydrateForm(body.item);
      try {
        const listBody = await request("/api/list/items/coupons");
        setListRow((listBody?.rows ?? []).find((r) => r.id === newId) ?? null);
      } catch {
        setListRow(null);
      }
      setPhase("ready");
    } catch (err) {
      setPhase("error");
      setLoadError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) }
      );
    }
  };

  // ── toggle service target ──────────────────────────────────────────────────────────
  const toggleServiceTarget = (id, checked) => {
    if (checked) {
      setServiceTargetIds([...serviceTargetIds, id]);
    } else {
      setServiceTargetIds(serviceTargetIds.filter((x) => x !== id));
    }
  };

  // ── codes management ───────────────────────────────────────────────────────────────
  const codes = record?.codes ?? [];

  const reloadCodes = async () => {
    if (!couponId) return;
    try {
      const body = await api.couponEditor(couponId);
      setRecord({ ...record, codes: body.codes ?? [] });
    } catch {
      // best-effort
    }
  };

  const openAddCodeForm = () => {
    setAddingCode(true);
    setNewCodeDraft("");
    setAddCodeError(null);
  };

  const cancelAddCode = () => {
    setAddingCode(false);
    setNewCodeDraft("");
    setAddCodeError(null);
  };

  const submitAddCode = async () => {
    const trimmed = newCodeDraft.trim();
    if (!trimmed) {
      setAddCodeError("Enter a code, or generate one.");
      return;
    }
    setAddingCodeBusy(true);
    setAddCodeError(null);
    try {
      await api.addPromotionCode(couponId, trimmed);
      setAddingCode(false);
      setNewCodeDraft("");
      await reloadCodes();
    } catch (err) {
      setAddCodeError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setAddingCodeBusy(false);
    }
  };

  const codeDeactivateReason = (row) => {
    const n = row.redemption_count ?? 0;
    if (n > 0) {
      return `Redeemed ${n} time${n === 1 ? "" : "s"} — it can't be turned off now.`;
    }
    return null;
  };

  const deactivateCode = async (row) => {
    setCodeActionId(row.id);
    setCodesActionError(null);
    try {
      await api.deactivatePromotionCode(row.id);
      await reloadCodes();
    } catch (err) {
      setCodesActionError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setCodeActionId(null);
    }
  };

  // ── display helpers ────────────────────────────────────────────────────────────────
  const heroText = (item) => {
    if (!item) return "";
    if (item.kind === "percent") {
      const pct = item.percent_bp / 100;
      return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
    }
    return formatValue(item.amount_minor, "money", { currency: item.currency });
  };

  const title = isNew ? (name.trim() || "New coupon") : (record?.item?.name ?? "Coupon");
  const meta = useMemo(() => {
    if (isNew) return "New coupon — not usable until you save.";
    const uses = listRow?.uses ?? record?.item?.redemption_count ?? 0;
    const given = listRow?.given_minor;
    const givenCurrency = listRow?.given_currency;
    let text = `Used ${uses} time${uses === 1 ? "" : "s"}`;
    if (given != null && given > 0 && givenCurrency) {
      text += ` · ${formatValue(given, "money", { currency: givenCurrency })} given away`;
    }
    return text;
  }, [isNew, listRow, record?.item?.redemption_count]);

  const capDisabled = (isNew ? kindDraft : record?.item?.kind) === "fixed";
  const CAP_REASON = "Only for percentage coupons. A fixed amount is already capped.";
  const CHANGE_AMOUNT_REASON =
    "A coupon's amount can't change once saved — Stripe treats it as fixed. Stop offering this one (Status, in the rail) and create a new coupon.";

  const statusSummary = activeState ? "Live" : "Not offered";
  const stripeSummary = useMemo(() => {
    const s = record?.stripe_sync?.state;
    if (s === "in_sync") return "In sync";
    if (s === "never" || !s) return "Not synced";
    return s;
  }, [record?.stripe_sync?.state]);
  const stripeTone = record?.stripe_sync?.state === "in_sync" ? "ok" : "neutral";

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "error") {
    return (
      <ScreenState
        phase="error"
        error={loadError}
        subject="This coupon"
        onNavigate={onNavigate}
      />
    );
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        error={loadError}
        subject="This coupon"
        reason={loadError?.message ?? null}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div data-testid="coupon-editor">
      <EditorHeader
        title={title}
        meta={meta}
        objectNoun="coupon"
        verbs={[
          {
            label: isNew ? "Save" : "Save changes",
            kind: "primary",
            onClick: handleSave,
            disabled: saving || blockers.length > 0,
          },
        ]}
        onClose={closeEditor}
        dirty={dirty}
        testId="coupon-editor-header"
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {savedResult ? (
          <EditorColumn>
            <AfterSavePanel
              headline="Saved."
              sentence={`${savedResult.name} is saved and ready to apply.`}
              nextActions={[]}
              onKeepEditing={afterSaveKeepEditing}
              testId="coupon-after-save"
            />
          </EditorColumn>
        ) : (
          <main className="min-w-0 flex-1 overflow-auto">
            <EditorColumn>
              {saveError && (
                <ErrorPanel error={saveError} subject="Your changes" variant="band" testId="coupon-save-error" />
              )}
              {blockers.length > 0 && <BlockerBanner count={blockers.length} items={blockers.map((b) => b.label)} testId="coupon-blocker-banner" />}

              {/* What it is */}
              <EditorSection title="What it is">
                <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                  <FieldLabel htmlFor="coupon-name">Name</FieldLabel>
                  <FieldContent>
                    <Input
                      id="coupon-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength="200"
                      autoComplete="off"
                      data-testid="coupon-name"
                    />
                    <InlineValidation message={fieldErrors.name} testId="coupon-name-error" />
                  </FieldContent>
                </Field>

                <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                  <FieldLabel htmlFor="coupon-client-copy">
                    What clients see<span className="text-xs text-muted-foreground ml-1">optional</span>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="coupon-client-copy"
                      value={descriptionClient}
                      onChange={(e) => setDescriptionClient(e.target.value)}
                      maxLength="200"
                      autoComplete="off"
                      data-testid="coupon-client-copy"
                    />
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed" data-testid="coupon-client-copy-hint">
                      On the invoice and at checkout.
                    </p>
                  </FieldContent>
                </Field>

                {isNew && (
                  <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                    <FieldLabel htmlFor="coupon-code">
                      Code<span className="text-xs text-muted-foreground ml-1">optional</span>
                    </FieldLabel>
                    <FieldContent>
                      <div className="flex items-center gap-2">
                        <Input
                          id="coupon-code"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          maxLength="40"
                          autoComplete="off"
                          data-testid="coupon-code"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCode(generateCode())}
                          data-testid="coupon-code-generate"
                        >
                          Generate one
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed" data-testid="coupon-code-hint">
                        Leave it empty and add codes once the coupon is saved.
                      </p>
                      <InlineValidation message={fieldErrors.code} testId="coupon-code-error" />
                    </FieldContent>
                  </Field>
                )}
              </EditorSection>

              {/* Hero section */}
              <div className="bg-secondary border-y border-line my-2 px-0 py-3" data-testid="coupon-hero">
                {isNew ? (
                  <>
                    <div className="flex items-baseline gap-2 flex-wrap px-11">
                      <NativeSelect value={kindDraft} onChange={(e) => setKindDraft(e.target.value)} data-testid="coupon-kind" className="max-w-xs">
                        <option value="percent">Percent off</option>
                        <option value="fixed">Fixed amount off</option>
                      </NativeSelect>
                      {kindDraft === "percent" ? (
                        <>
                          <Input
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value={percentDraft}
                            onChange={(e) => setPercentDraft(e.target.value)}
                            data-testid="coupon-percent"
                            className="max-w-[100px]"
                          />
                          <span className="text-sm text-muted-foreground">% off</span>
                        </>
                      ) : (
                        <>
                          <FieldMoney
                            valueMinor={amountMinorDraft}
                            onValueMinorChange={setAmountMinorDraft}
                            currency={practiceCurrency}
                            label="Amount"
                            testId="coupon-amount"
                          />
                          <span className="text-sm text-muted-foreground">off</span>
                        </>
                      )}
                    </div>
                    <InlineValidation message={fieldErrors.amount} testId="coupon-amount-error" />
                  </>
                ) : (
                  <div className="flex items-baseline gap-2 flex-wrap px-11">
                    <span className="text-2xl font-bold" data-testid="coupon-hero-amt">
                      {heroText(record?.item)}
                    </span>
                    <span className="text-sm text-muted-foreground">off</span>
                    <DisabledWithReason disabled reason={CHANGE_AMOUNT_REASON}>
                      {({ disabled, describedBy }) => (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={disabled}
                          aria-describedby={describedBy}
                          data-testid="coupon-change-amount"
                        >
                          Change
                        </Button>
                      )}
                    </DisabledWithReason>
                  </div>
                )}

                <GeneratedSentence
                  parts={["Comes off the subtotal, before tax. If two coupons could apply, the bigger one wins and the other is ignored."]}
                  testId="coupon-hero-note"
                />

                <div className="px-11">
                  <DisabledWithReason disabled={capDisabled} reason={CAP_REASON}>
                    {({ disabled, describedBy }) => (
                      <FieldMoney
                        valueMinor={maxDiscountMinorDraft}
                        onValueMinorChange={setMaxDiscountMinorDraft}
                        currency={practiceCurrency}
                        label="Most it can take off"
                        helper={CAP_REASON}
                        disabled={disabled}
                        describedBy={describedBy}
                        error={fieldErrors.maxDiscountMinor}
                        testId="coupon-cap"
                      />
                    )}
                  </DisabledWithReason>
                </div>
              </div>

              {/* Where it applies */}
              <EditorSection title="Where it applies">
                <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                  <FieldLabel htmlFor="coupon-what-to">What to</FieldLabel>
                  <FieldContent>
                    {isNew || record?.item?.applies_to === "service" ? (
                      <NativeSelect
                        id="coupon-what-to"
                        value={whatToDraft}
                        onChange={(e) => setWhatToDraft(e.target.value)}
                        disabled={!isNew && record?.item?.applies_to !== "service"}
                        data-testid="coupon-what-to"
                      >
                        {(isNew ? WHAT_TO_OPTIONS : WHAT_TO_OPTIONS.filter((o) => o.value === "service" || o.value === "category" || o.value === "services")).map(
                          (opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.value === "service" && !isNew ? "Services (everything)" : opt.label}
                            </option>
                          )
                        )}
                      </NativeSelect>
                    ) : (
                      <div className="flex items-center min-h-8 px-2.5 border border-input rounded-lg bg-secondary text-secondary-foreground" data-testid="coupon-what-to-static">
                        {WHAT_TO_OPTIONS.find((o) => o.value === record?.item?.applies_to)?.label ?? record?.item?.applies_to}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed" data-testid="coupon-what-to-hint">
                      Everything, a category, or named services.
                    </p>

                    {whatToDraft === "category" && (
                      <NativeSelect value={categoryTargetId} onChange={(e) => setCategoryTargetId(e.target.value)} data-testid="coupon-target-category">
                        <option value="">Choose a category…</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}

                    {whatToDraft === "services" && !serviceTargetGroup && (
                      <div className="mt-2 border border-input rounded-lg bg-white p-2" data-testid="coupon-target-services-gate">
                        <ProgramGate onChoose={setServiceTargetGroup} testId="coupon-target-services-group-gate" />
                      </div>
                    )}

                    {whatToDraft === "services" && serviceTargetGroup && (
                      <div className="mt-2 border border-input rounded-lg bg-white p-2" data-testid="coupon-target-services">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground" data-testid="coupon-target-services-group-label">
                            {serviceTargetGroup.name}
                          </span>
                          <button
                            type="button"
                            className="text-xs text-brand underline"
                            onClick={() => setServiceTargetGroup(null)}
                            data-testid="coupon-target-services-group-change"
                          >
                            Change
                          </button>
                        </div>
                        <div className="max-h-56 overflow-auto flex flex-col gap-1.5">
                          {services.filter((svc) => svc.program_id === serviceTargetGroup.id).length === 0 ? (
                            <p className="text-xs text-muted-foreground">{serviceTargetGroup.id ? `No ${serviceTargetGroup.name.toLowerCase()} services yet.` : "No services without a program yet."}</p>
                          ) : (
                            services
                              .filter((svc) => svc.program_id === serviceTargetGroup.id)
                              .map((svc) => (
                                <label key={svc.id} className="flex items-center gap-2 text-xs cursor-pointer" data-testid={`coupon-target-service-${svc.id}`}>
                                  <Checkbox
                                    checked={serviceTargetIds.includes(svc.id)}
                                    onCheckedChange={(v) => toggleServiceTarget(svc.id, !!v)}
                                  />
                                  <span>{svc.name}</span>
                                </label>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                  <FieldLabel htmlFor="coupon-first-purchase">
                    Who to<span className="text-xs text-muted-foreground ml-1">optional</span>
                  </FieldLabel>
                  <FieldContent>
                    <div className="flex items-center gap-2 text-sm">
                      <Switch
                        id="coupon-first-purchase"
                        checked={firstPurchaseOnly}
                        onCheckedChange={setFirstPurchaseOnly}
                        data-testid="coupon-first-purchase"
                      />
                      <span>Anyone who has never bought before</span>
                    </div>
                  </FieldContent>
                </Field>

                <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                  <FieldLabel htmlFor="coupon-valid-from">
                    When<span className="text-xs text-muted-foreground ml-1">optional</span>
                  </FieldLabel>
                  <FieldContent>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          id="coupon-valid-from"
                          type="date"
                          value={validFromDraft}
                          onChange={(e) => setValidFromDraft(e.target.value)}
                          data-testid="coupon-valid-from"
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">from</p>
                      </div>
                      <div className="flex-1">
                        <Input
                          id="coupon-valid-to"
                          type="date"
                          value={validToDraft}
                          onChange={(e) => setValidToDraft(e.target.value)}
                          data-testid="coupon-valid-to"
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">until</p>
                      </div>
                    </div>
                    <InlineValidation message={fieldErrors.validTo ?? fieldErrors.validFrom} testId="coupon-window-error" />
                  </FieldContent>
                </Field>

                <CollapsibleGroup
                  label="How many times"
                  intro="Limit how often this can be used."
                  open={limitsGroupOpen}
                  onOpenChange={setLimitsGroupOpen}
                >
                  <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                    <FieldLabel htmlFor="coupon-per-person">Per person</FieldLabel>
                    <FieldContent>
                      <Input
                        id="coupon-per-person"
                        type="number"
                        min="1"
                        step="1"
                        value={perPersonLimitDraft}
                        onChange={(e) => setPerPersonLimitDraft(e.target.value)}
                        data-testid="coupon-per-person"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">Leave empty for no limit per person.</p>
                      <InlineValidation message={fieldErrors.perPersonLimit} testId="coupon-per-person-error" />
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal" className="border-b border-line pb-2.5 pt-2.5 last:border-0">
                    <FieldLabel htmlFor="coupon-max-redemptions">In total</FieldLabel>
                    <FieldContent>
                      <Input
                        id="coupon-max-redemptions"
                        type="number"
                        min="1"
                        step="1"
                        value={maxRedemptionsDraft}
                        onChange={(e) => setMaxRedemptionsDraft(e.target.value)}
                        data-testid="coupon-max-redemptions"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">Leave empty for no limit in total.</p>
                      <InlineValidation message={fieldErrors.maxRedemptions} testId="coupon-max-redemptions-error" />
                    </FieldContent>
                  </Field>
                </CollapsibleGroup>
              </EditorSection>

              {/* Codes section - populated only */}
              {!isNew && (
                <EditorSection title="Codes">
                  <CollapsibleGroup
                    label="Codes"
                    intro="A coupon is the rule. A code is what someone types."
                    addLabel="Add a code"
                    onAdd={openAddCodeForm}
                    open={codesGroupOpen}
                    onOpenChange={setCodesGroupOpen}
                  >
                    <div className="flex flex-col gap-3" data-testid="coupon-codes-list">
                      {addingCode && (
                        <div className="flex items-center gap-2 flex-wrap" data-testid="coupon-codes-add-form">
                          <Input
                            value={newCodeDraft}
                            onChange={(e) => setNewCodeDraft(e.target.value)}
                            maxLength="40"
                            autoComplete="off"
                            placeholder="SPRING20"
                            data-testid="coupon-codes-new-code-input"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setNewCodeDraft(generateCode())}
                            data-testid="coupon-codes-generate"
                          >
                            Generate one
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={addingCodeBusy}
                            onClick={submitAddCode}
                            data-testid="coupon-codes-submit"
                          >
                            Add
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelAddCode}
                            data-testid="coupon-codes-cancel"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      {addingCode && <InlineValidation message={addCodeError} testId="coupon-codes-add-error" />}

                      {codesActionError && <InlineValidation message={codesActionError} testId="coupon-codes-action-error" />}

                      {codes.length === 0 ? (
                        <p className="text-xs text-muted-foreground" data-testid="coupon-codes-empty">
                          No codes yet.
                        </p>
                      ) : (
                        codes.map((row) => {
                          const reason = codeDeactivateReason(row);
                          return (
                            <div key={row.id} className="flex items-center gap-2 py-2 border-b border-line last:border-0" data-testid={`coupon-code-row-${row.id}`}>
                              <span className="font-mono text-sm flex-1" title={row.code}>
                                {row.code}
                              </span>
                              <StatusBadge label={row.active ? "Active" : "Inactive"} tone={row.active ? "ok" : "neutral"} />
                              {row.active && (
                                <DisabledWithReason disabled={!!reason} reason={reason ?? ""}>
                                  {({ disabled, describedBy }) => (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={disabled}
                                      aria-describedby={describedBy}
                                      onClick={() => deactivateCode(row)}
                                      data-testid={`coupon-code-deactivate-${row.id}`}
                                    >
                                      {codeActionId === row.id ? "Deactivating…" : "Deactivate"}
                                    </Button>
                                  )}
                                </DisabledWithReason>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </CollapsibleGroup>
                </EditorSection>
              )}
            </EditorColumn>
          </main>
        )}

        {/* Rail */}
        <EditorRail objectNoun="coupon" testId="coupon-editor-rail">
          <RailSection
            label="Status"
            summary={statusSummary}
            expanded={railOpen.status}
            onToggle={(v) => setRailOpen({ ...railOpen, status: v })}
            testId="coupon-rail-status"
          >
            <div className="flex items-center gap-2">
              <StatusBadge label={statusSummary} tone={activeState ? "ok" : "neutral"} />
              {!isNew ? (
                <Switch
                  checked={activeState}
                  onCheckedChange={toggleActive}
                  disabled={saving}
                  data-testid="coupon-active-toggle"
                />
              ) : (
                <span className="text-xs text-muted-foreground">A new coupon goes live once it is saved.</span>
              )}
            </div>
          </RailSection>

          <RailSection
            label="If two could apply"
            expanded={railOpen.stack}
            onToggle={(v) => setRailOpen({ ...railOpen, stack: v })}
            testId="coupon-rail-stack"
          >
            <GeneratedSentence parts={["The bigger one wins. They never stack."]} testId="coupon-rail-stack-sentence" />
          </RailSection>

          {!isNew && (
            <RailSection
              label="Used"
              expanded={railOpen.used}
              onToggle={(v) => setRailOpen({ ...railOpen, used: v })}
              testId="coupon-rail-used"
            >
              <GeneratedSentence
                parts={[
                  { text: String(listRow?.uses ?? record?.item?.redemption_count ?? 0), bold: true },
                  record?.item?.max_redemptions ? ` of ${record.item.max_redemptions}.` : " times.",
                  listRow?.given_minor > 0 && listRow?.given_currency
                    ? { text: ` ${formatValue(listRow.given_minor, "money", { currency: listRow.given_currency })} given away.`, bold: false }
                    : null,
                ]}
                testId="coupon-rail-used-sentence"
              />
            </RailSection>
          )}

          <RailSection
            label="Where it shows"
            expanded={railOpen.shows}
            onToggle={(v) => setRailOpen({ ...railOpen, shows: v })}
            testId="coupon-rail-shows"
          >
            <GeneratedSentence parts={["Checkout, invoices, and your booking page."]} testId="coupon-rail-shows-sentence" />
          </RailSection>

          {!isNew && (
            <RailSection
              label="Stripe"
              summary={stripeSummary}
              expanded={railOpen.stripe}
              onToggle={(v) => setRailOpen({ ...railOpen, stripe: v })}
              testId="coupon-rail-stripe"
            >
              <StatusBadge label={stripeSummary} tone={stripeTone} />
              <GeneratedSentence parts={["A coupon, and its promotion codes."]} testId="coupon-rail-stripe-sentence" />
            </RailSection>
          )}
        </EditorRail>
      </div>
    </div>
  );
}
