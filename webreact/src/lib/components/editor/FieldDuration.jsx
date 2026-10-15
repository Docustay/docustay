// FieldDuration — minutes, as a select when the practice has standard lengths, else typed ("90" or "1h 30m").
// Ported from webui/src/lib/components/editor/FieldDuration.svelte: same props (minutes was $bindable →
// minutes + onMinutesChange), testids, parsing and messages.
import { useId, useRef, useState } from "react";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import InlineValidation from "./InlineValidation.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";
import { ROW, LABEL, CONTROL, HINT, AFFIX } from "./styles.js";

function formatMinutesLabel(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.trunc(mins / 60); const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function parseDurationInput(raw, allowNegative) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return { ok: true, minutes: null };
  let negative = false; let s = trimmed;
  if (s.startsWith("-")) { if (!allowNegative) return { ok: false, reason: "negative" }; negative = true; s = s.slice(1); }
  if (/^\d+$/.test(s)) { const n = Number(s); return { ok: true, minutes: negative ? -n : n }; }
  if (!negative) {
    const hm = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i.exec(s);
    if (hm && (hm[1] !== undefined || hm[2] !== undefined)) return { ok: true, minutes: (hm[1] ? Number(hm[1]) : 0) * 60 + (hm[2] ? Number(hm[2]) : 0) };
  }
  if (/^\d*\.\d+$/.test(s)) return { ok: false, reason: "fraction" };
  return { ok: false, reason: "format" };
}
const PARSE_MESSAGES = { negative: "Enter a positive number of minutes.", format: "Enter minutes, like 90 or 1h 30m.", fraction: "Enter a whole number of minutes." };

export default function FieldDuration({ minutes, onMinutesChange, options = null, label, helper = null, error = null, required = false, disabled = false, describedBy = null, testId = "field-duration", allowNegative = false }) {
  const uid = useId();
  const inputId = `${testId}-${uid}`;
  const errorId = `${testId}-error`;
  const [value, setValue] = useBindable(minutes, onMinutesChange, undefined);
  const [text, setText] = useState(() => (minutes === null || minutes === undefined ? "" : String(minutes)));
  const [localError, setLocalError] = useState(null);
  const [focused, setFocused] = useState(false);
  const timer = useRef(null);
  const clean = Array.isArray(options) ? options.filter((n) => Number.isFinite(n) && n >= 5 && n <= 600) : null;
  const selectOptions = !clean ? null : (value == null || clean.includes(value) ? clean : [...clean, value].sort((a, b) => a - b));
  const serverMessage = error == null ? null : (typeof error === "string" ? error : (error.message ?? String(error)));
  const serverRequestId = error && typeof error === "object" ? (error.requestId ?? error.request_id ?? null) : null;
  const displayed = serverMessage ?? localError;
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  function handleInput(e) {
    const t = e.target.value; setText(t); setLocalError(null); clear();
    const r = parseDurationInput(t, allowNegative);
    if (r.ok) { setValue(r.minutes); return; }
    timer.current = setTimeout(() => setLocalError(PARSE_MESSAGES[r.reason] ?? PARSE_MESSAGES.format), 500);
  }
  function handleBlur() {
    setFocused(false); clear();
    const r = parseDurationInput(text, allowNegative);
    if (!r.ok) setLocalError(PARSE_MESSAGES[r.reason] ?? PARSE_MESSAGES.format);
    else if (required && r.minutes === null) setLocalError("This is required.");
  }
  return (
    <Field orientation="horizontal" className={ROW} data-testid={testId}>
      <FieldLabel htmlFor={inputId} className={LABEL}>{label}{required && <span className="text-required" aria-hidden="true"> *</span>}</FieldLabel>
      <FieldContent className="min-w-0 flex-1">
        {selectOptions ? (
          <div className={CONTROL} data-disabled={disabled ? "true" : undefined}>
            <select id={inputId} className="min-w-0 flex-1 bg-transparent text-ink outline-none" value={value == null ? "" : String(value)} disabled={disabled}
                    data-testid={`${testId}-select`} aria-describedby={describedBy ?? undefined}
                    onChange={(e) => { const v = Number(e.target.value); setValue(Number.isFinite(v) ? v : null); }}>
              {value == null && <option value="">—</option>}
              {selectOptions.map((m) => <option key={m} value={String(m)}>{formatMinutesLabel(m)}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div className={CONTROL} data-err={displayed ? "true" : undefined} data-focus={focused ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
              <input id={inputId} className="min-w-0 flex-1 bg-transparent tabular-nums text-ink outline-none" type="text" inputMode="numeric" autoComplete="off" value={text} disabled={disabled}
                     aria-required={required} aria-invalid={!!displayed} aria-describedby={describedBy ?? (displayed ? errorId : undefined)}
                     data-testid={`${testId}-input`} data-minutes={value === null || value === undefined ? "" : String(value)}
                     onChange={handleInput} onBlur={handleBlur} onFocus={() => setFocused(true)} />
              <span className={AFFIX} aria-hidden="true">min</span>
            </div>
            {helper && !displayed && <p className={HINT} data-testid={`${testId}-helper`}>{helper}</p>}
            <InlineValidation message={displayed} requestId={serverMessage ? serverRequestId : null} testId={errorId} />
          </>
        )}
      </FieldContent>
    </Field>
  );
}
