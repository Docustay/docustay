// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FieldMoney — an amount in MINOR units. Ported from webui/src/lib/components/editor/FieldMoney.svelte:
// same props (valueMinor was $bindable → valueMinor + onValueMinorChange), testids, parsing and messages.
//   · undefined value (and no server message) → "Hidden" (the viewer may not see money — payload absence)
//   · no currency → disabled, "Set a currency before pricing this."
//   · typing parses live; a bad value shows its message after 500ms, or at once on blur
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useId, useRef, useState } from "react";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import InlineValidation from "./InlineValidation.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";
import { ROW, LABEL, CONTROL, HINT, AFFIX } from "./styles.js";

const CURRENCY_SYMBOLS = { USD: "$", CAD: "$", AUD: "$", GBP: "£", EUR: "€" };
const symbolFor = (code) => (code ? (CURRENCY_SYMBOLS[code] ?? null) : null);
function parseMoneyInput(raw, allowNegative) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return { ok: true, minor: null };
  let negative = false; let s = trimmed;
  if (s.startsWith("-")) { if (!allowNegative) return { ok: false, reason: "negative" }; negative = true; s = s.slice(1); }
  s = s.replace(/^[$€£¥]\s*/, "").replace(/,/g, "");
  if (s.startsWith("-")) return { ok: false, reason: "negative" };
  if ((s.match(/\./g) || []).length > 1) return { ok: false, reason: "format" };
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return { ok: false, reason: "format" };
  const [wholePart, fracPart = ""] = s.split(".");
  if (fracPart.length > 2) return { ok: false, reason: "precision" };
  let minor = (wholePart === "" ? 0 : Number(wholePart)) * 100 + (fracPart === "" ? 0 : Number(fracPart.padEnd(2, "0")));
  if (negative) minor = -minor;
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: "format" };
  return { ok: true, minor };
}
const PARSE_MESSAGES = { negative: "Enter a positive amount.", format: "Enter dollars and cents, like 12.50.", precision: "Enter at most two decimal places, like 12.50." };
function formatForDisplay(minor) {
  if (minor === null || minor === undefined) return "";
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export default function FieldMoney({ valueMinor, onValueMinorChange, currency = null, label, helper = null, error = null, required = false, disabled = false, describedBy = null, testId = "field-money", allowNegative = false }) {
  const uid = useId();
  const inputId = `${testId}-${uid}`;
  const errorId = `${testId}-error`;
  const [value, setValue] = useBindable(valueMinor, onValueMinorChange, undefined);
  const [text, setText] = useState(() => formatForDisplay(valueMinor));
  const [localError, setLocalError] = useState(null);
  const [focused, setFocused] = useState(false);
  const timer = useRef(null);
  const serverMessage = error == null ? null : (typeof error === "string" ? error : (error.message ?? String(error)));
  const serverRequestId = error && typeof error === "object" ? (error.requestId ?? error.request_id ?? null) : null;
  const displayed = serverMessage ?? localError;
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  function handleInput(e) {
    const t = e.target.value; setText(t); setLocalError(null); clear();
    const r = parseMoneyInput(t, allowNegative);
    if (r.ok) { setValue(r.minor); return; }
    timer.current = setTimeout(() => setLocalError(PARSE_MESSAGES[r.reason] ?? PARSE_MESSAGES.format), 500);
  }
  function handleBlur() {
    setFocused(false); clear();
    const r = parseMoneyInput(text, allowNegative);
    if (!r.ok) setLocalError(PARSE_MESSAGES[r.reason] ?? PARSE_MESSAGES.format);
    else if (required && r.minor === null) setLocalError("This is required.");
  }
  return (
    <Field orientation="horizontal" className={ROW} data-testid={testId}>
      <FieldLabel htmlFor={inputId} className={LABEL}>{label}{required && <span className="text-required" aria-hidden="true"> *</span>}</FieldLabel>
      <FieldContent className="min-w-0 flex-1">
        {/* ★ the maintainer, 29 Sep 2026 — FOUND LIVE: was `value === undefined`, but `value` is
            `useBindable`'s OWN `valueMinor ?? fallback` — `??` treats a real `null` (this
            docstring's own "no price yet, let them type one" case, ServiceEditor.jsx's create
            mode) exactly like `undefined` (the CT-F36 "the viewer may not see this" case), so a
            brand-new service with no price yet rendered "Hidden" instead of an empty, editable
            box. Checking the RAW prop restores the distinction the docstring above already
            describes, without changing useBindable (other callers may rely on its coalescing). */}
        {valueMinor === undefined && !serverMessage ? (
          <div className={`${CONTROL} bg-paper text-mute`} data-testid={`${testId}-locked`}>Hidden</div>
        ) : !currency ? (
          <>
            <div className={CONTROL} data-disabled="true" data-testid={`${testId}-nocurrency`}>
              <span className="text-mute" aria-hidden="true">—</span>
              <input id={inputId} className="min-w-0 flex-1 bg-transparent outline-none" type="text" value="" disabled readOnly data-testid={`${testId}-input`} />
            </div>
            <p className={HINT} data-testid={`${testId}-no-currency-hint`}>Set a currency before pricing this.</p>
          </>
        ) : (
          <>
            <div className={CONTROL} data-err={displayed ? "true" : undefined} data-focus={focused ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
              <span className="text-mute" aria-hidden="true">{symbolFor(currency) ?? currency}</span>
              <input id={inputId} className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none" type="text" inputMode="decimal" autoComplete="off" value={text} disabled={disabled}
                     aria-required={required} aria-invalid={!!displayed} aria-describedby={describedBy ?? (displayed ? errorId : undefined)}
                     data-testid={`${testId}-input`} data-value-minor={value === null || value === undefined ? "" : String(value)}
                     onChange={handleInput} onBlur={handleBlur} onFocus={() => setFocused(true)} />
            </div>
            {helper && !displayed && <p className={HINT} data-testid={`${testId}-helper`}>{helper}</p>}
            <InlineValidation message={displayed} requestId={serverMessage ? serverRequestId : null} testId={errorId} />
          </>
        )}
      </FieldContent>
    </Field>
  );
}
