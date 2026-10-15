// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ItemsDefaultsPage — rebuild from specs/mockups/ItemsDefaults.frame.html on LedgerPage.
// Props: { onNavigate }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { request, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";

// R5.030.T1 — lazy-loaded since it's built separately
const ItemsDefaultsPageItemsDefaultsPageTable = lazy(() =>
  import("./ItemsDefaultsPageItemsDefaultsPageTable.jsx").catch(() => ({
    default: () => <div data-testid="items-defaults-page-table-mock" className="text-mute">Table will render once the subtask is built</div>
  }))
);

export default function ItemsDefaultsPage({ onNavigate = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else if (typeof window !== "undefined") window.location.assign(href);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE FETCH PHASE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [unitRows, setUnitRows] = useState([]);

  // ── Save state — tracking changed fields and save operations ─────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveKeys, setSaveKeys] = useState({});

  // ── draft state — the editable copy of the 7 real fields this screen owns. ─────────────────────
  const [durationInput, setDurationInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [unitInput, setUnitInput] = useState("");
  const [deliveryInput, setDeliveryInput] = useState("");
  const [bookableOnline, setBookableOnline] = useState(true);
  const [taxCodeInput, setTaxCodeInput] = useState("");
  const [agreementIdInput, setAgreementIdInput] = useState("");

  function resetDraft() {
    const d = defaults ?? {};
    setDurationInput(d["items.default_duration_minutes"] == null ? "" : String(d["items.default_duration_minutes"]));
    setPriceInput(d["items.default_price_minor"] == null ? "" : (d["items.default_price_minor"] / 100).toFixed(2));
    setUnitInput(d["items.default_unit"] ?? "");
    setDeliveryInput(d["items.default_delivery"] ?? "");
    setBookableOnline(d["items.default_bookable_online"] !== false);
    setTaxCodeInput(d["items.default_tax_code"] ?? "");
    setAgreementIdInput(d["items.default_agreement_template_id"] ?? "");
  }

  // ★ ABSENT, NOT ZERO — the three keys whose server fallback is `null`.
  const unitUnset = defaults ? defaults["items.default_unit"] == null : false;
  const taxCodeUnset = defaults ? defaults["items.default_tax_code"] == null : false;
  const agreementUnset = defaults ? defaults["items.default_agreement_template_id"] == null : false;

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [d, u] = await Promise.all([
        request("/api/items/defaults"),
        request("/api/items/units"),
      ]);
      setDefaults(d);
      setUnitRows(u?.data ?? []);
      setSaveKeys({});
      setSaveError(null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err instanceof ApiError
        ? { message: err.message, requestId: err.requestId }
        : { message: String(err?.message ?? err) });
    }
  }

  useEffect(() => {
    load();
    // Reset draft when defaults are loaded
    if (defaults) {
      resetDraft();
    }
  }, []);

  useEffect(() => {
    resetDraft();
  }, [defaults]);

  // ★ Restated closed set, matching src/settings/keys.mjs:517's oneOf([...])
  const DELIVERY_OPTIONS = [
    { value: "in_person", label: "In person" },
    { value: "video", label: "Video" },
    { value: "at_client", label: "At the client's location" },
    { value: "client_chooses", label: "In person or video — they choose" },
  ];

  const unitSelectOptions = (() => {
    const opts = unitRows.filter((u) => u.active).map((u) => ({ value: u.key, label: u.name }));
    if (unitInput && !opts.some((o) => o.value === unitInput)) {
      opts.push({ value: unitInput, label: unitInput });
    }
    return opts;
  })();

  // ── which of the 7 fields actually changed — the "per field" write list ──────────────────────────
  const changes = (() => {
    if (!defaults) return [];
    const out = [];

    const duration = durationInput.trim() === "" ? NaN : parseInt(durationInput, 10);
    if (Number.isInteger(duration) && duration !== defaults["items.default_duration_minutes"]) {
      out.push({ key: "items.default_duration_minutes", value: duration });
    }

    const priceMinor = priceInput.trim() === "" ? NaN : Math.round(parseFloat(priceInput) * 100);
    if (Number.isInteger(priceMinor) && priceMinor !== defaults["items.default_price_minor"]) {
      out.push({ key: "items.default_price_minor", value: priceMinor });
    }

    if (unitInput && unitInput !== (defaults["items.default_unit"] ?? "")) {
      out.push({ key: "items.default_unit", value: unitInput });
    }

    if (deliveryInput && deliveryInput !== (defaults["items.default_delivery"] ?? "")) {
      out.push({ key: "items.default_delivery", value: deliveryInput });
    }

    if (bookableOnline !== (defaults["items.default_bookable_online"] !== false)) {
      out.push({ key: "items.default_bookable_online", value: bookableOnline });
    }

    const taxCode = taxCodeInput.trim();
    if (taxCode && taxCode !== (defaults["items.default_tax_code"] ?? "")) {
      out.push({ key: "items.default_tax_code", value: taxCode });
    }

    const agreementId = agreementIdInput.trim();
    if (agreementId && agreementId !== (defaults["items.default_agreement_template_id"] ?? "")) {
      out.push({ key: "items.default_agreement_template_id", value: agreementId });
    }

    return out;
  })();

  // ── Save — one POST /api/settings {key, value} per changed field, in order ────────────────────
  const saveKeysRef = useRef({});

  function keyForSetting(k) {
    if (!saveKeysRef.current[k]) {
      saveKeysRef.current[k] = newIdempotencyKey();
    }
    return saveKeysRef.current[k];
  }

  async function handleSave() {
    const list = changes;
    if (list.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const c of list) {
        await request("/api/settings", {
          method: "POST",
          body: { key: c.key, value: c.value },
          idempotencyKey: keyForSetting(c.key),
        });
      }
      saveKeysRef.current = {};
      setSaveKeys({});
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError
        ? { message: err.message, requestId: err.requestId }
        : { message: String(err?.message ?? err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Suspense fallback={<div data-testid="items-defaults-page-loading">Loading…</div>}>
      <ItemsDefaultsPageItemsDefaultsPageTable
        onNavigate={go}
        go={go}
        phase={phase}
        error={phase === "error" ? error : null}
        defaults={defaults}
        durationInput={durationInput}
        priceInput={priceInput}
        unitInput={unitInput}
        deliveryInput={deliveryInput}
        bookableOnline={bookableOnline}
        taxCodeInput={taxCodeInput}
        agreementIdInput={agreementIdInput}
        unitUnset={unitUnset}
        taxCodeUnset={taxCodeUnset}
        agreementUnset={agreementUnset}
        load={load}
        DELIVERY_OPTIONS={DELIVERY_OPTIONS}
        unitSelectOptions={unitSelectOptions}
        changes={changes}
        saving={saving}
        saveError={saveError}
        handleSave={handleSave}
        setDurationInput={setDurationInput}
        setPriceInput={setPriceInput}
        setUnitInput={setUnitInput}
        setDeliveryInput={setDeliveryInput}
        setBookableOnline={setBookableOnline}
        setTaxCodeInput={setTaxCodeInput}
        setAgreementIdInput={setAgreementIdInput}
      />
    </Suspense>
  );
}
