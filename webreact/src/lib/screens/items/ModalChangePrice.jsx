// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalChangePrice — rebuild from webui/src/lib/screens/items/ModalChangePrice.svelte.
// A price is NEVER edited; a new price is a new row. keystone.price_is_append_only enforces it.
// This component POSTs to /api/items/prices, which CREATES a row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import { formatValue } from "@/lib/format.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import ModalChangePriceModal1Modal from "./ModalChangePriceModal1Modal.jsx";
import ModalChangePriceModal2Modal from "./ModalChangePriceModal2Modal.jsx";
import ModalChangePriceModal3Modal from "./ModalChangePriceModal3Modal.jsx";
import ModalChangePriceModal from "./ModalChangePriceModal.jsx";

const EDITOR_PATH_SEGMENT = Object.freeze({ service: "services", package: "packages", plan: "plans" });
const RECORD_TYPE_HAS_WHAT_KEEPS_WORKING = Object.freeze(["service", "plan"]);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseMoney(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const cleaned = s.replace(/^[$€£¥]\s*/, "").replace(/,/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".") return undefined;
  const [whole, frac = ""] = cleaned.split(".");
  return (whole === "" ? 0 : Number(whole)) * 100 + (frac === "" ? 0 : Number(frac.padEnd(2, "0")));
}

export default function ModalChangePrice({
  open = false,
  onOpenChange,
  subjectType = "service",
  subjectId,
  itemName = null,
  currentPrice = undefined,
  currency = null,
  onClose = null,
  onChanged,
  testId = "modal-change-price",
}) {
  if (open && typeof onChanged !== "function") {
    throw new Error(
      "ModalChangePrice: onChanged is required — a successful price change must always be " +
      "handed back to the caller, never drawn with nothing behind it."
    );
  }

  // ── PREFILL STATE ────────────────────────────────────────────────────────────────────────────
  const [prefillPhase, setPrefillPhase] = useState(
    itemName !== null && currentPrice !== undefined ? "ready" : "loading"
  );
  const [prefillError, setPrefillError] = useState(null);
  const [resolvedName, setResolvedName] = useState(itemName);
  const [resolvedCurrency, setResolvedCurrency] = useState(currency);
  const [resolvedPrice, setResolvedPrice] = useState(currentPrice);

  async function loadPrefill() {
    setPrefillPhase("loading");
    setPrefillError(null);
    try {
      const segment = EDITOR_PATH_SEGMENT[subjectType] ?? "services";
      const res = await request(`/api/items/${segment}/${encodeURIComponent(subjectId)}/editor`);
      setResolvedName(itemName ?? res.item?.name ?? "this item");
      setResolvedCurrency(currency ?? res.item?.currency ?? "USD");
      if (!("price_history" in res)) {
        setPrefillPhase("denied");
        return;
      }
      const rows = Array.isArray(res.price_history) ? res.price_history : [];
      setResolvedPrice(
        currentPrice !== undefined
          ? currentPrice
          : rows.find((r) => !r.effective_to && !r.location_id && !r.delivery_mode) ?? null
      );
      setPrefillPhase("ready");
    } catch (err) {
      setPrefillPhase(err instanceof ApiError && err.status === 403 ? "denied" : "error");
      setPrefillError(err instanceof ApiError ? err : String(err?.message ?? err));
    }
  }

  useEffect(() => {
    if (open && prefillPhase === "loading" && (itemName === null || currentPrice === undefined)) {
      loadPrefill();
    }
  }, [open, prefillPhase, itemName, currentPrice, subjectType, subjectId]);

  // ── "WHAT THIS TOUCHES" LOADING ──────────────────────────────────────────────────────────────
  const [touchesPhase, setTouchesPhase] = useState(
    RECORD_TYPE_HAS_WHAT_KEEPS_WORKING.includes(subjectType) ? "loading" : "unavailable"
  );
  const [touchesError, setTouchesError] = useState(null);
  const [whatKeepsWorking, setWhatKeepsWorking] = useState(null);

  async function loadTouches() {
    setTouchesPhase("loading");
    setTouchesError(null);
    try {
      const res = await request(`/api/records/${subjectType}/${encodeURIComponent(subjectId)}`);
      setWhatKeepsWorking(res.whatKeepsWorking ?? {});
      setTouchesPhase("ready");
    } catch (err) {
      setTouchesPhase("error");
      setTouchesError(err instanceof ApiError ? err : String(err?.message ?? err));
    }
  }

  useEffect(() => {
    if (open && touchesPhase === "loading" && RECORD_TYPE_HAS_WHAT_KEEPS_WORKING.includes(subjectType)) {
      loadTouches();
    }
  }, [open, touchesPhase, subjectType, subjectId]);

  // ── FORM STATE ───────────────────────────────────────────────────────────────────────────────
  const [newPriceText, setNewPriceText] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);

  const newPriceMinor = (() => {
    const p = parseMoney(newPriceText);
    return p === undefined ? null : p;
  })();

  const newPriceInvalid = newPriceText.trim() !== "" && parseMoney(newPriceText) === undefined;

  const oldMinor = resolvedPrice?.amount_minor ?? null;

  const sinceLabel = (() => {
    if (!resolvedPrice?.effective_from) return null;
    try {
      return new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(
        new Date(resolvedPrice.effective_from)
      );
    } catch {
      return null;
    }
  })();

  const deltaPct = oldMinor && newPriceMinor != null
    ? Math.round(((newPriceMinor - oldMinor) / oldMinor) * 100)
    : null;

  const title = (() => {
    if (oldMinor == null) return "Set a price";
    if (newPriceMinor != null && newPriceMinor > oldMinor) return "Put the price up";
    if (newPriceMinor != null && newPriceMinor < oldMinor) return "Bring the price down";
    return "Change the price";
  })();

  const subtitle = (() => {
    const name = resolvedName ?? "this item";
    if (oldMinor == null) return `${name} doesn't have a price yet.`;
    const money = formatValue(oldMinor, "money", { currency: resolvedCurrency ?? "USD" });
    return sinceLabel ? `${name} is ${money}. It has been since ${sinceLabel}.` : `${name} is ${money}.`;
  })();

  const confirmLabel = (() => {
    if (newPriceMinor == null) return "Set the new price";
    const money = formatValue(newPriceMinor, "money", { currency: resolvedCurrency ?? "USD" });
    let dateLabel = effectiveFrom;
    try {
      dateLabel = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(
        new Date(`${effectiveFrom}T00:00:00`)
      );
    } catch {
      /* keep raw ISO on a bad date */
    }
    return `Set ${money} from ${dateLabel}`;
  })();

  const touchesRows = (() => {
    if (touchesPhase !== "ready" || !whatKeepsWorking) return [];
    const rows = [];
    const money = (m) => formatValue(m, "money", { currency: resolvedCurrency ?? "USD" });
    if (subjectType === "service") {
      const fb = whatKeepsWorking.futureBookings ?? 0;
      rows.push({
        headline: `${fb} future booking${fb === 1 ? "" : "s"}`,
        detail: newPriceMinor != null
          ? `They have no price on them yet, so they'll be ${money(newPriceMinor)}.`
          : "They have no price on them yet, so they'll use the new price.",
      });
      const pk = whatKeepsWorking.activePackages ?? 0;
      rows.push({
        headline: `${pk} running package${pk === 1 ? "" : "s"} that include it`,
        detail: oldMinor != null
          ? `They keep ${money(oldMinor)} — they were sold at it.`
          : "They keep the price they were sold at.",
      });
      const pl = whatKeepsWorking.livePlanSubscribers ?? 0;
      rows.push({
        headline: `${pl} monthly plan${pl === 1 ? "" : "s"} billing off it`,
        detail: "They keep their price until you change the plan separately.",
      });
    } else if (subjectType === "plan") {
      const pl = whatKeepsWorking.livePlanSubscribers ?? 0;
      rows.push({
        headline: `${pl} ${pl === 1 ? "person" : "people"} already on this plan`,
        detail: oldMinor != null
          ? `They keep paying ${money(oldMinor)} until you change the plan separately.`
          : "They keep paying what they agreed to until you change the plan separately.",
      });
    }
    rows.push({ headline: "Everything already invoiced", detail: "Stays exactly as it is." });
    return rows;
  })();

  function handleCancel() {
    if (busy) return;
    onOpenChange?.(false);
    setIdempotencyKey(null);
    onClose?.();
  }

  async function handleSubmit() {
    if (busy || newPriceMinor == null || newPriceInvalid) return;
    setSubmitError(null);
    setBusy(true);
    const key = idempotencyKey ?? newIdempotencyKey();
    setIdempotencyKey(key);
    try {
      const res = await request("/api/items/prices", {
        method: "POST",
        body: {
          subjectType,
          subjectId,
          amountMinor: newPriceMinor,
          currency: resolvedCurrency ?? "USD",
          // ★ the maintainer, 29 Sep 2026 — FOUND LIVE while checking "create a service, change its price":
          //   `${effectiveFrom}T00:00:00.000Z` forces the date picker's LOCAL "today" (todayISO()
          //   above is built from getFullYear/getMonth/getDate — all local) to be read as UTC
          //   midnight. In any negative UTC offset (Pacific included), that lands BEFORE the
          //   just-created price row's own real timestamp — createPrice's "close the open row"
          //   UPDATE requires effective_from < the new date and matches nothing, so the OLD row
          //   never closes and the INSERT of the new one hits keystone.price's one-open-row
          //   constraint. A same-day re-price (the exact case this ask names) failed every time.
          //   No "Z": a bare `T00:00:00` is local time by spec, matching what todayISO() built.
          effectiveFrom: new Date(`${effectiveFrom}T00:00:00`).toISOString(),
        },
        idempotencyKey: key,
      });
      onChanged?.(res);
      onOpenChange?.(false);
      setIdempotencyKey(null);
      onClose?.();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {open && prefillPhase === "loading" && (
        <ModalChangePriceModal1Modal
          open={open}
          onOpenChange={onOpenChange}
          testId={testId}
        />
      )}
      {open && prefillPhase === "denied" && (
        <ModalChangePriceModal2Modal
          open={open}
          onOpenChange={onOpenChange}
          testId={testId}
        />
      )}
      {open && prefillPhase === "error" && (
        <ModalChangePriceModal3Modal
          open={open}
          onOpenChange={onOpenChange}
          testId={testId}
          prefillError={prefillError}
          loadPrefill={loadPrefill}
        />
      )}
      {open && prefillPhase === "ready" && (
        <ModalChangePriceModal
          open={open}
          onOpenChange={onOpenChange}
          testId={testId}
          resolvedCurrency={resolvedCurrency}
          touchesPhase={touchesPhase}
          touchesError={touchesError}
          whatKeepsWorking={whatKeepsWorking}
          loadTouches={loadTouches}
          newPriceText={newPriceText}
          setNewPriceText={setNewPriceText}
          effectiveFrom={effectiveFrom}
          setEffectiveFrom={setEffectiveFrom}
          busy={busy}
          submitError={submitError}
          newPriceMinor={newPriceMinor}
          newPriceInvalid={newPriceInvalid}
          deltaPct={deltaPct}
          title={title}
          subtitle={subtitle}
          confirmLabel={confirmLabel}
          touchesRows={touchesRows}
          cancel={handleCancel}
          submit={handleSubmit}
        />
      )}
    </>
  );
}
