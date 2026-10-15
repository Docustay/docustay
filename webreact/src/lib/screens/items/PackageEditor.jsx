// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.037 — PackageEditor.jsx — React port of webui/src/lib/screens/items/PackageEditor.svelte
// Props: { packageId, prefillService, onClose, onChangePrice, onAttachAgreement, onSeeCredits, onOpenBookingPage, testId }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { request, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { formatValue } from "@/lib/format.js";

import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import AfterSavePanel from "@/lib/components/editor/AfterSavePanel.jsx";
import PreviewPanel from "@/lib/components/editor/PreviewPanel.jsx";
import GeneratedSentence from "@/lib/components/editor/GeneratedSentence.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";

import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";

import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

import ProgramSelect from "@/lib/programs/ProgramSelect.jsx";
import { usePrograms } from "@/lib/programs/programs.js";
import PackageEditorTable1Table from "./PackageEditorTable1Table.jsx";

export default function PackageEditor({
  packageId = null,
  prefillService = null,
  onClose,
  onChangePrice,
  onAttachAgreement,
  onSeeCredits,
  onOpenBookingPage,
  testId = "package-editor",
}) {
  const isNew = packageId == null;

  // ── Verify required props ──────────────────────────────────────────────────────────
  useEffect(() => {
    const missing = [
      ["onClose", onClose],
      ["onChangePrice", onChangePrice],
      ["onAttachAgreement", onAttachAgreement],
      ["onSeeCredits", onSeeCredits],
      ["onOpenBookingPage", onOpenBookingPage],
    ]
      .filter(([, fn]) => typeof fn !== "function")
      .map(([name]) => name);

    if (missing.length) {
      throw new Error(
        `PackageEditor: ${missing.join(", ")} required — an action drawn with nothing behind it is a dead control, never a guess made here.`
      );
    }
  }, [onClose, onChangePrice, onAttachAgreement, onSeeCredits, onOpenBookingPage]);

  // ── Load state ─────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(isNew ? "ready" : "loading");
  const [loadError, setLoadError] = useState(null);

  // ── Form fields ────────────────────────────────────────────────────────────────────
  const [name, setName] = useState(
    prefillService ? `${prefillService.name} — 12 sessions` : ""
  );
  const [description, setDescription] = useState("");
  const [amountMinor, setAmountMinor] = useState(
    prefillService ? prefillService.unitPriceMinor * 12 : null
  );
  const [currency, setCurrency] = useState(prefillService?.currency ?? null);
  const [installmentsAllowed, setInstallmentsAllowed] = useState(false);
  const [expiryMonths, setExpiryMonths] = useState(null);
  const [warnAtRemaining, setWarnAtRemaining] = useState(2);
  const [portalSellable, setPortalSellable] = useState(false);
  const [publicSellable, setPublicSellable] = useState(false);
  // The package's program (null/"" = no program). The practice's list comes from the shared programs module.
  const [programId, setProgramId] = useState("");
  const { programs } = usePrograms();
  // ★ Programs follow-up brief Part 2 — category extended to package (migration 0544).
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState([]);
  const [lines, setLines] = useState(
    prefillService
      ? [{
          serviceId: prefillService.serviceId,
          name: prefillService.name,
          quantity: 12,
          unitPriceMinor: prefillService.unitPriceMinor,
          currency: prefillService.currency,
        }]
      : []
  );

  // ── Populated-mode-only facts ──────────────────────────────────────────────────────
  const [updatedAt, setUpdatedAt] = useState(null);
  const [stripeSync, setStripeSync] = useState(null);
  const [currentPriceMinor, setCurrentPriceMinor] = useState(undefined);

  // ── Services list + item defaults ──────────────────────────────────────────────────
  const [services, setServices] = useState([]);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [itemDefaults, setItemDefaults] = useState(null);
  const [startingUp, setStartingUp] = useState(false);

  // ── Rail disclosure state ──────────────────────────────────────────────────────────
  const [railStatusOpen, setRailStatusOpen] = useState(false);
  const [railWhoOpen, setRailWhoOpen] = useState(true);
  const [railPayingOpen, setRailPayingOpen] = useState(true);
  const [railStripeOpen, setRailStripeOpen] = useState(false);

  // ── Save flow ──────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [afterSave, setAfterSave] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Lines management ───────────────────────────────────────────────────────────────
  const [pickerServiceId, setPickerServiceId] = useState("");

  const availableServices = useMemo(
    () => services.filter((s) => !lines.some((l) => l.serviceId === s.id)),
    [services, lines]
  );

  // ── Money formatting ───────────────────────────────────────────────────────────────
  const formatMoney = useCallback((minor, cur) => {
    if (minor == null || !cur) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  }, []);

  // ── Dirty tracking ─────────────────────────────────────────────────────────────────
  const [baseline, setBaseline] = useState(null);

  const snapshot = useCallback(() => {
    return JSON.stringify({
      name,
      description,
      amountMinor,
      installmentsAllowed,
      expiryMonths,
      warnAtRemaining,
      portalSellable,
      publicSellable,
      programId,
      categoryId,
      lines: lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
    });
  }, [name, description, amountMinor, installmentsAllowed, expiryMonths, warnAtRemaining, portalSellable, publicSellable, programId, categoryId, lines]);

  const snapshotBaseline = useCallback(() => {
    setBaseline(snapshot());
  }, [snapshot]);

  const dirty = useMemo(
    () => baseline !== null && snapshot() !== baseline && !afterSave,
    [baseline, snapshot, afterSave]
  );

  // ── Price arithmetic (NEW mode only) ───────────────────────────────────────────────
  const totalQuantity = useMemo(
    () => lines.reduce((n, l) => n + (Number.isInteger(l.quantity) ? l.quantity : 0), 0),
    [lines]
  );

  const linesWorthUnknown = useMemo(
    () => lines.some((l) => l.unitPriceMinor === undefined),
    [lines]
  );

  const singleTotalMinor = useMemo(() => {
    if (linesWorthUnknown) return null;
    return lines.reduce((sum, l) => sum + (l.unitPriceMinor ?? 0) * l.quantity, 0);
  }, [lines, linesWorthUnknown]);

  const heroSentence = useMemo(() => {
    if (!isNew) return null;
    if (linesWorthUnknown || totalQuantity === 0 || amountMinor == null || singleTotalMinor == null) return null;
    if (amountMinor === singleTotalMinor) {
      return {
        parts: [
          "No discount at this size, which is deliberate: your time is worth the same whether someone buys one or twelve.",
        ],
      };
    }
    const perSessionPackage = Math.round(amountMinor / totalQuantity);
    const perSessionSingle = Math.round(singleTotalMinor / totalQuantity);
    const diff = perSessionSingle - perSessionPackage;
    const cmp = diff > 0 ? "under" : "over";
    return {
      parts: [
        `${formatMoney(amountMinor, currency)} for ${totalQuantity} — `,
        { text: `${formatMoney(perSessionPackage, currency)} each`, bold: true },
        `, ${formatMoney(Math.abs(diff), currency)} ${cmp} the single price.`,
      ],
    };
  }, [isNew, linesWorthUnknown, totalQuantity, amountMinor, singleTotalMinor, currency, formatMoney]);

  // ── Line management functions ──────────────────────────────────────────────────────
  const addLine = useCallback(() => {
    const svc = services.find((s) => s.id === pickerServiceId);
    if (!svc) return;
    setLines([
      ...lines,
      {
        serviceId: svc.id,
        name: svc.name,
        quantity: 1,
        unitPriceMinor: svc.price_amount_minor,
        currency: svc.price_currency ?? currency,
      },
    ]);
    setPickerServiceId("");
  }, [pickerServiceId, services, lines, currency]);

  const removeLine = useCallback((serviceId) => {
    setLines(lines.filter((l) => l.serviceId !== serviceId));
  }, [lines]);

  const setQuantity = useCallback((serviceId, raw) => {
    const q = Number(raw);
    setLines(
      lines.map((l) =>
        l.serviceId === serviceId
          ? { ...l, quantity: Number.isInteger(q) && q > 0 ? q : l.quantity }
          : l
      )
    );
  }, [lines]);

  // ── Start from three services ──────────────────────────────────────────────────────
  const startFromThreeServices = useCallback(async () => {
    if (!itemDefaults?.starter_services?.length) return;
    setStartingUp(true);
    try {
      const created = [];
      for (const starterName of itemDefaults.starter_services.slice(0, 3)) {
        const res = await request("/api/items/services", {
          method: "POST",
          body: {
            name: starterName,
            durationMinutes: itemDefaults["items.default_duration_minutes"] ?? 60,
            amountMinor: itemDefaults["items.default_price_minor"] ?? 0,
            currency: currency ?? "USD",
            bookable: itemDefaults["items.default_bookable_online"] ?? true,
          },
          idempotencyKey: newIdempotencyKey(),
        });
        created.push({
          id: res.id ?? res.data?.id,
          name: starterName,
          price_amount_minor: itemDefaults["items.default_price_minor"] ?? 0,
          price_currency: currency ?? "USD",
        });
      }
      setServices([...services, ...created]);
      setLines([
        ...lines,
        ...created
          .filter((c) => c.id)
          .map((c) => ({
            serviceId: c.id,
            name: c.name,
            quantity: 1,
            unitPriceMinor: c.price_amount_minor,
            currency: c.price_currency,
          })),
      ]);
    } catch (e) {
      setSaveError(
        e instanceof ApiError
          ? { message: e.message, requestId: e.requestId }
          : { message: String(e) }
      );
    } finally {
      setStartingUp(false);
    }
  }, [itemDefaults, currency, services, lines]);

  // ── Blockers ───────────────────────────────────────────────────────────────────────
  const blockers = useMemo(() => {
    const items = [];
    if (!name.trim()) items.push("Name");
    // ★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — matches the backend's own
    //   refusal (createPackage/updatePackage, src/items/writes.mjs and editors.mjs): "a package
    //   must contain at least one service line". Client-side now, so Save is disabled with a
    //   reason instead of a round trip that comes back refused.
    if (lines.length === 0) items.push("At least one service");
    return items;
  }, [name, lines]);

  // ── Load population ────────────────────────────────────────────────────────────────
  const loadPopulated = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      const res = await request(`/api/items/packages/${encodeURIComponent(packageId)}/editor`);
      const item = res.item;
      setName(item.name ?? "");
      setDescription(item.description ?? "");
      setAmountMinor(undefined);
      setCurrency(item.currency ?? null);
      setInstallmentsAllowed(item.installments_allowed ?? false);
      setExpiryMonths(item.expiry_months ?? null);
      setWarnAtRemaining(item.warn_at_remaining ?? 2);
      setPortalSellable(item.portal_sellable ?? false);
      setPublicSellable(item.public_sellable ?? false);
      setProgramId(item.program_id ?? "");
      setCategoryId(item.category_id ?? "");
      setUpdatedAt(item.updated_at ?? null);
      setStripeSync(res.stripe_sync ?? null);
      setCurrentPriceMinor(
        Array.isArray(res.price_history)
          ? res.price_history[0]?.amount_minor ?? null
          : undefined
      );
      // ★★★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — `res.lines` is the read
      //   that never existed before this fix (src/items/editors.mjs's `editorRead`). Mapped onto the
      //   SAME shape `addLine`/`PackageEditorTable1Table` already use for a new package;
      //   `unitPriceMinor`/`currency` are left undefined (package_line carries no per-line price —
      //   a package has ONE overall price, not one per service) and the table's own "—" fallback
      //   handles that, same as it always has for a service with no catalogue price.
      setLines(
        (res.lines ?? []).map((l) => ({
          serviceId: l.service_id,
          name: l.service_active === false ? `${l.service_name ?? "Retired service"} (retired)` : (l.service_name ?? "Retired service"),
          quantity: l.quantity,
        }))
      );
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPhase("denied");
      } else {
        setLoadError(
          e instanceof ApiError
            ? { message: e.message, requestId: e.requestId }
            : e
        );
        setPhase("error");
      }
    }
  }, [packageId]);

  const loadNewModeExtras = useCallback(async () => {
    try {
      const [svc, defaults, money, catRes] = await Promise.allSettled([
        request("/api/list/items/services?limit=200"),
        request("/api/items/defaults"),
        request("/api/settings/money"),
        request("/api/items/categories"),
      ]);
      const svcRes = svc.status === "fulfilled" ? svc.value : { rows: [] };
      setServices(svcRes.rows ?? []);
      setServicesLoaded(true);
      setItemDefaults(defaults.status === "fulfilled" ? defaults.value : null);
      setCategories(catRes.status === "fulfilled" ? (catRes.value?.data ?? []) : []);
      const moneyValue = money.status === "fulfilled" ? money.value : null;
      const defaultsValue = defaults.status === "fulfilled" ? defaults.value : {};
      if (!currency) {
        setCurrency(
          moneyValue?.fields?.find((f) => f.key === "money.currency")?.value ?? "USD"
        );
      }
      if (warnAtRemaining == null) {
        setWarnAtRemaining(defaultsValue["items.warn_at_remaining"] ?? 2);
      }
    } catch (e) {
      setServicesLoaded(false);
    }
  }, [currency, warnAtRemaining]);

  // New package: if the practice has exactly one program, default to it (value AND baseline, so the
  // editor does not open "dirty").
  const programDefaulted = useRef(false);
  useEffect(() => {
    if (!isNew || programDefaulted.current || programs.length !== 1) return;
    programDefaulted.current = true;
    const only = programs[0].id;
    setProgramId((cur) => cur || only);
    setBaseline((b) => (b === null ? b : JSON.stringify({ ...JSON.parse(b), programId: JSON.parse(b).programId || only })));
  }, [isNew, programs]);

  // ── Initialize load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) {
      snapshotBaseline();
      loadNewModeExtras();
    } else {
      // ★ FIX, 30 Sep 2026 — `loadNewModeExtras` loads the service picker list `addLine` needs;
      //   an existing package's contents are now editable too, so it runs here as well, AFTER
      //   `loadPopulated` has already set `currency` from the real record — `loadNewModeExtras`'s
      //   own `if (!currency)` default only fires for a package that somehow has none.
      loadPopulated().then(() => { snapshotBaseline(); loadNewModeExtras(); });
    }
  }, [isNew, packageId]);

  // ── Save ───────────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (blockers.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isNew) {
        const res = await request("/api/items/packages", {
          method: "POST",
          body: {
            name: name.trim(),
            description: description.trim() || null,
            amountMinor,
            currency,
            installmentsAllowed,
            expiryMonths,
            warnAtRemaining,
            portalSellable,
            publicSellable,
            programId: programId || undefined,
            categoryId: categoryId || undefined,
            lines: lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
          },
          idempotencyKey: newIdempotencyKey(),
        });
        setAfterSave({
          name: name.trim(),
          amountMinor,
          currency,
          lineCount: res.lineCount ?? lines.length,
          portalSellable,
          publicSellable,
        });
      } else {
        const res = await request("/api/items/packages/update", {
          method: "POST",
          body: {
            id: packageId,
            expectedUpdatedAt: updatedAt,
            name: name.trim(),
            description: description.trim() || null,
            expiryMonths,
            warnAtRemaining,
            portalSellable,
            publicSellable,
            installmentsAllowed,
            programId: programId || null,
            categoryId: categoryId || null,
            // ★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — the owner can now
            //   change what's inside; `updatePackage` (src/items/editors.mjs) replaces the whole
            //   set when this is present.
            lines: lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
          },
          idempotencyKey: newIdempotencyKey(),
        });
        setUpdatedAt(res.updated_at ?? updatedAt);
        setAfterSave({
          name: name.trim(),
          amountMinor: currentPriceMinor,
          currency,
          lineCount: null,
          portalSellable,
          publicSellable,
        });
      }
      snapshotBaseline();
    } catch (e) {
      setSaveError(
        e instanceof ApiError
          ? { message: e.message, requestId: e.requestId, field: e.body?.error?.field ?? null }
          : { message: String(e) }
      );
    } finally {
      setSaving(false);
    }
  }, [blockers.length, isNew, name, description, amountMinor, currency, installmentsAllowed, expiryMonths, warnAtRemaining, portalSellable, publicSellable, programId, categoryId, lines, packageId, updatedAt, currentPriceMinor, snapshotBaseline]);

  const keepEditing = useCallback(() => {
    setAfterSave(null);
  }, []);

  // ── After-save sentence ────────────────────────────────────────────────────────────
  const afterSaveSentence = useMemo(() => {
    if (!afterSave) return "";
    const where = afterSave.publicSellable
      ? "on your booking page"
      : afterSave.portalSellable
      ? "in the client portal"
      : "saved, not yet offered anywhere clients can buy it";
    const priceText = afterSave.amountMinor != null ? formatMoney(afterSave.amountMinor, afterSave.currency) : null;
    const parts = [
      "It's ",
      { text: where, bold: false },
      afterSave.lineCount ? ` now, ${afterSave.lineCount} session${afterSave.lineCount === 1 ? "" : "s"}` : " now",
      priceText ? { text: ` at ${priceText}`, bold: true } : "",
      ".",
    ];
    return parts;
  }, [afterSave, formatMoney]);

  const afterSaveNextActions = useMemo(
    () =>
      afterSave
        ? [
            {
              title: "Put it on your booking page",
              label: "Put it on your booking page",
              onClick: () =>
                onOpenBookingPage({ packageId: packageId ?? null, name: afterSave.name }),
            },
            {
              title: "Attach the agreement",
              label: "Attach the agreement",
              onClick: () =>
                onAttachAgreement({ itemType: "package", itemId: packageId ?? null }),
            },
            {
              title: "See who's mid-block",
              label: "See who's mid-block",
              onClick: () =>
                onSeeCredits({ packageId: packageId ?? null }),
            },
          ]
        : [],
    [afterSave, packageId, onOpenBookingPage, onAttachAgreement, onSeeCredits]
  );

  // ★ SAVE-SYSTEM BRIEF, 30 Sep 2026 — this read the literal string "Edited by the maintainer, 20 September" for
  //   EVERY package regardless of who actually edited it or when: a fabricated audit line that looks
  //   real. `updatedAt` (state, already set from the real load/save response two lines above) was
  //   sitting right there unused. There is no `updated_by`/similar column on `keystone.package` at
  //   all — ServiceEditor.jsx/PlanEditor.jsx show only "Edited <date>" for the same reason; matching
  //   that here rather than inventing a name this data cannot back up.
  const meta = isNew
    ? "New package — not sellable until you save"
    : updatedAt
      ? `Edited ${formatValue(updatedAt, "date")}`
      : "Edited";

  const headerVerbs = [
    {
      label: "Preview",
      kind: "plain",
      onClick: () => setPreviewOpen(true),
    },
    {
      label: saving ? "Saving…" : isNew ? "Save" : "Save changes",
      kind: "primary",
      disabled: saving || blockers.length > 0,
      onClick: save,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper" data-testid={testId}>
      {!isNew && (phase === "loading" || phase === "error" || phase === "denied") ? (
        <ScreenState phase={phase} error={loadError} subject="This package" onRetry={loadPopulated} />
      ) : (
        <>
          <EditorHeader
            title={name || "New package"}
            meta={meta}
            objectNoun="package"
            dirty={dirty}
            onClose={() => onClose()}
            testId={`${testId}-header`}
            verbs={headerVerbs}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden lg:flex-row">
            <main className="min-w-0 flex-1 overflow-auto">
              <EditorColumn>
                {afterSave ? (
                  <AfterSavePanel
                    headline="Saved."
                    sentence={afterSaveSentence
                      .map((p) => (typeof p === "string" ? p : p.text ?? ""))
                      .join("")}
                    nextActions={afterSaveNextActions}
                    onKeepEditing={keepEditing}
                    testId={`${testId}-aftersave`}
                  />
                ) : previewOpen ? (
                  <>
                    <PreviewPanel
                      title={name || "New package"}
                      subtitle="What clients see"
                      testId={`${testId}-preview`}
                    >
                      <p className="text-xl font-semibold text-ink mb-4">
                        {name || "Untitled package"}
                      </p>
                      {description && <p className="text-mute mb-6">{description}</p>}
                      <p className="text-lg font-medium text-ink">
                        {isNew
                          ? formatMoney(amountMinor, currency)
                          : formatMoney(currentPriceMinor, currency)}
                      </p>
                    </PreviewPanel>
                    <Button
                      variant="outline"
                      className="mt-6"
                      onClick={() => setPreviewOpen(false)}
                    >
                      Back to edit
                    </Button>
                  </>
                ) : (
                  <>
                    {blockers.length > 0 && (
                      <BlockerBanner count={blockers.length} items={blockers} testId={`${testId}-blocker`} />
                    )}
                    {saveError && saveError.field !== "name" && (
                      <div className="bg-chip-bad-bg rounded-lg p-4 mb-6" data-testid={`${testId}-save-error`} role="alert">
                        <p className="m-0 text-chip-bad-ink text-ui">{saveError.message}</p>
                        {saveError.requestId && (
                          <p className="m-0 mt-1 text-chip-bad-ink text-caption">
                            Reference: <code>{saveError.requestId}</code>
                          </p>
                        )}
                      </div>
                    )}

                    <EditorSection title="What's in it">
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor={`${testId}-name`}>
                          Name<span className="text-chip-bad-ink ml-1" aria-hidden="true"> *</span>
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id={`${testId}-name`}
                            data-testid={`${testId}-name`}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            aria-required="true"
                          />
                          <InlineValidation
                            message={
                              saveError?.field === "name" ? saveError.message : null
                            }
                            requestId={
                              saveError?.field === "name" ? saveError.requestId : null
                            }
                            testId={`${testId}-name-error`}
                          />
                        </FieldContent>
                      </Field>

                      {/* ★ ITEM 16 FIX, 30 Sep 2026 — this was `orientation="horizontal"` with the
                          textarea and the AI button sharing one row inside the narrow value column
                          that leaves for a horizontal field: the maintainer found the description box "squeezed
                          into a narrow column" with "the AI note positioned beside the box" eating
                          further into it. Vertical orientation gives the textarea the FULL width;
                          the AI action now sits on its own line under the box instead of splitting
                          that width with it. */}
                      <Field orientation="vertical">
                        <FieldLabel htmlFor={`${testId}-description`}>
                          Description
                          <span className="text-ink-muted text-caption ml-1">
                            optional
                          </span>
                        </FieldLabel>
                        <FieldContent>
                          <Textarea
                            id={`${testId}-description`}
                            data-testid={`${testId}-description`}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                          />
                          <div className="flex justify-end">
                            <DisabledWithReason
                              disabled
                              reason="Coming with AI drafting"
                              testId={`${testId}-ai`}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid={`${testId}-ai-button`}
                              >
                                ✦ Write with AI
                              </Button>
                            </DisabledWithReason>
                          </div>
                        </FieldContent>
                      </Field>

                      {/* ★ Programs follow-up brief Part 2 — category extended to package. */}
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor={`${testId}-category`}>Category <span className="text-caption text-ink-muted">optional</span></FieldLabel>
                        <FieldContent>
                          <NativeSelect
                            id={`${testId}-category`}
                            data-testid={`${testId}-category`}
                            value={categoryId}
                            onChange={(e) => setCategoryId(e.target.value)}
                          >
                            <option value="">(no category)</option>
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </NativeSelect>
                        </FieldContent>
                      </Field>

                      {/* ★ FIX, 1 Oct 2026 (Programs follow-up brief Part 2) — migration 0543 is
                          live; the life/recovery fallback is retired, same as ServiceEditor.jsx. */}
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor={`${testId}-program`}>Program</FieldLabel>
                        <FieldContent>
                          <ProgramSelect
                            id={`${testId}-program`}
                            testId={`${testId}-program`}
                            value={programId}
                            onChange={(v) => setProgramId(v ?? "")}
                          />
                          <p className="text-caption text-ink-muted mt-1.5">
                            Which program a client sees this under when they book or buy.
                          </p>
                        </FieldContent>
                      </Field>

                      <div className="border border-line rounded-lg p-4 mb-4 bg-surface" data-testid={`${testId}-sessions`}>
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex-1">
                            <div className="font-medium text-ui">Sessions included</div>
                            <span className="text-caption text-ink-muted">
                              Twelve of one service. Mix services if you want to.
                            </span>
                          </div>
                          {/* ★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — no
                              longer gated on `isNew`: the read/write for an EXISTING package's
                              contents now exists (src/items/editors.mjs), so the owner can add a
                              service here too, not only when first creating the package. */}
                          <NativeSelect
                            data-testid={`${testId}-add-service-select`}
                            value={pickerServiceId}
                            onChange={(e) => setPickerServiceId(e.target.value)}
                            size="sm"
                          >
                            <option value="">Add a service…</option>
                            {availableServices.map((svc) => (
                              <option key={svc.id} value={svc.id}>
                                {svc.name}
                              </option>
                            ))}
                          </NativeSelect>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`${testId}-add-service`}
                            disabled={!pickerServiceId}
                            onClick={addLine}
                          >
                            Add a service
                          </Button>
                        </div>

                        {lines.length === 0 ? (
                          <>
                            <p
                              className="text-caption text-ink-muted"
                              data-testid={`${testId}-lines-empty`}
                            >
                              Nothing here yet.
                            </p>
                            {servicesLoaded &&
                              services.length === 0 &&
                              itemDefaults?.starter_services?.length && (
                                <div className="flex items-center justify-between gap-3 mt-3">
                                  <p className="text-caption text-ink mb-0">
                                    Start from{" "}
                                    <b>three services most coaches start with</b>.
                                  </p>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    data-testid={`${testId}-starter-offer`}
                                    disabled={startingUp}
                                    onClick={startFromThreeServices}
                                  >
                                    {startingUp
                                      ? "Adding…"
                                      : "Start from three services"}
                                  </Button>
                                </div>
                              )}
                          </>
                        ) : (
                          <PackageEditorTable1Table
                            testId={testId}
                            currency={currency}
                            lines={lines}
                            formatMoney={formatMoney}
                            removeLine={removeLine}
                            setQuantity={setQuantity}
                          />
                        )}
                      </div>
                    </EditorSection>

                    <div className="bg-surface border-t border-b border-line my-6 -mx-11 px-11 py-6">
                      <div className="flex items-baseline gap-4">
                        {isNew ? (
                          <FieldMoney
                            valueMinor={amountMinor}
                            onValueMinorChange={setAmountMinor}
                            currency={currency}
                            label="Price"
                            required
                            testId={`${testId}-price`}
                          />
                        ) : (
                          <>
                            <Figure
                              size="lg"
                              testId={`${testId}-price-figure`}
                            >
                              {formatMoney(currentPriceMinor, currency)}
                            </Figure>
                            <Button
                              variant="outline"
                              data-testid={`${testId}-change-price`}
                              onClick={() =>
                                onChangePrice({
                                  subjectType: "package",
                                  subjectId: packageId,
                                })
                              }
                            >
                              Change price
                            </Button>
                          </>
                        )}
                      </div>
                      {heroSentence && (
                        <GeneratedSentence
                          parts={heroSentence.parts}
                          testId={`${testId}-hero-sentence`}
                        />
                      )}

                      <Field orientation="horizontal" className="mt-6">
                        <FieldLabel htmlFor={`${testId}-expiry`}>
                          Runs out after
                          <span className="text-ink-muted text-caption ml-1">
                            optional
                          </span>
                        </FieldLabel>
                        <FieldContent>
                          <NativeSelect
                            id={`${testId}-expiry`}
                            data-testid={`${testId}-expiry`}
                            value={expiryMonths == null ? "" : String(expiryMonths)}
                            onChange={(e) =>
                              setExpiryMonths(
                                e.target.value === "" ? null : Number(e.target.value)
                              )
                            }
                          >
                            <option value="">Never</option>
                            {[1, 3, 6, 9, 12, 18, 24].map((m) => (
                              <option key={m} value={String(m)}>
                                {m} months
                              </option>
                            ))}
                          </NativeSelect>
                          <p className="text-caption text-ink-muted mt-1.5 leading-relaxed">
                            Unused sessions expire then. Leave it empty and they never
                            do.
                          </p>
                        </FieldContent>
                      </Field>
                    </div>

                    <EditorSection title="How it behaves">
                      <div className="py-2.5">
                        <b className="block text-ui mb-1">Book against it</b>
                        <span className="text-caption text-ink-muted leading-relaxed">
                          Sessions draw down as they're booked. Not when they're
                          attended — a no-show still uses one.
                        </span>
                      </div>
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor={`${testId}-warn`}>
                          When it runs low
                        </FieldLabel>
                        <FieldContent>
                          <div className="flex items-center gap-1.5 text-ui text-ink">
                            Tell them at
                            <Input
                              id={`${testId}-warn`}
                              type="number"
                              min="0"
                              step="1"
                              className="w-14 mx-1"
                              data-testid={`${testId}-warn`}
                              value={String(warnAtRemaining)}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setWarnAtRemaining(
                                  Number.isInteger(v) && v >= 0 ? v : warnAtRemaining
                                );
                              }}
                            />
                            left.
                          </div>
                          <p className="text-caption text-ink-muted mt-1.5">
                            And tell you, so you can offer the next one.
                          </p>
                        </FieldContent>
                      </Field>
                    </EditorSection>
                  </>
                )}
              </EditorColumn>
            </main>

            <EditorRail objectNoun="package" testId={`${testId}-rail`}>
              <RailSection
                label="Status"
                summary={publicSellable || portalSellable ? "On sale" : "Not selling"}
                expanded={railStatusOpen}
                onToggle={setRailStatusOpen}
                testId={`${testId}-rail-status`}
              >
                <StatusBadge
                  label={
                    publicSellable || portalSellable ? "On sale" : "Not selling"
                  }
                  tone={publicSellable || portalSellable ? "ok" : "neutral"}
                />
              </RailSection>

              <RailSection
                label="Who can buy it"
                expanded={railWhoOpen}
                onToggle={setRailWhoOpen}
                testId={`${testId}-rail-who`}
                summary={
                  [
                    portalSellable && "Clients, from their portal",
                    publicSellable && "Anyone, from your booking page",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Nobody yet"
                }
              >
                <div className="flex items-center justify-between gap-3 py-2.5 text-caption text-ink">
                  <span>Clients, from their portal</span>
                  <Switch
                    checked={portalSellable}
                    onCheckedChange={setPortalSellable}
                    data-testid={`${testId}-portal-sellable`}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5 text-caption text-ink">
                  <span>Anyone, from your booking page</span>
                  <Switch
                    checked={publicSellable}
                    onCheckedChange={setPublicSellable}
                    data-testid={`${testId}-public-sellable`}
                  />
                </div>
              </RailSection>

              <RailSection
                label="Paying"
                expanded={railPayingOpen}
                onToggle={setRailPayingOpen}
                testId={`${testId}-rail-paying`}
                summary={
                  installmentsAllowed
                    ? "Can be paid in installments."
                    : "In full, up front."
                }
              >
                <div className="flex items-center justify-between gap-3 py-2.5 text-caption text-ink">
                  <span>Let clients pay in installments</span>
                  <Switch
                    checked={installmentsAllowed}
                    onCheckedChange={setInstallmentsAllowed}
                    data-testid={`${testId}-installments`}
                  />
                </div>
                {installmentsAllowed && (
                  <p
                    className="text-caption text-ink-muted mt-1"
                    data-testid={`${testId}-installments-note`}
                  >
                    Credits unlock as each payment lands.
                  </p>
                )}
              </RailSection>

              <RailSection
                label="Sold"
                summary="Not available yet"
                testId={`${testId}-rail-sold`}
              />

              <RailSection
                label="Stripe"
                summary={
                  stripeSync
                    ? stripeSync.state === "in_sync"
                      ? "One product, one price."
                      : "Not synced — we'll retry"
                    : "Not created yet"
                }
                expanded={railStripeOpen}
                onToggle={setRailStripeOpen}
                testId={`${testId}-rail-stripe`}
              >
                <StatusBadge
                  label={stripeSync?.state === "in_sync" ? "In sync" : "Not synced"}
                  tone={stripeSync?.state === "in_sync" ? "ok" : "neutral"}
                />
              </RailSection>
            </EditorRail>
          </div>
        </>
      )}
    </div>
  );
}
