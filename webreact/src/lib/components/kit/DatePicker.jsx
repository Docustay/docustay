// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DatePicker — ported from webui/src/lib/components/ui/date-picker (bits-ui) onto Popover + the shadcn
// Calendar (react-day-picker). Same props and testids (`${testId}`, `${testId}-trigger`).
// ★ Ruling: the React value is an ISO date string "YYYY-MM-DD" — the form every caller already sent to the
//   server through toISO(). toISO() stays exported and accepts a string, a Date or a CalendarDate-like.
// Default value is today, as the Svelte component's was.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { Popover, PopoverTrigger, PopoverContent } from "@/lib/components/ui/popover.jsx";
import { Calendar } from "@/lib/components/ui/calendar.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";

export const toISO = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return isValid(v) ? format(v, "yyyy-MM-dd") : null;
  return String(v); // a CalendarDate-like: toString() is ISO
};
const todayISO = () => format(new Date(), "yyyy-MM-dd");

export default function DatePicker({ value, id = undefined, testId = undefined, disabled = false, minValue = undefined, maxValue = undefined, onValueChange = null }) {
  const [val, setVal] = useBindable(value === undefined ? undefined : toISO(value), undefined, todayISO());
  const [open, setOpen] = useState(false);
  const date = val ? parseISO(val) : undefined;
  const min = minValue ? parseISO(toISO(minValue)) : undefined;
  const max = maxValue ? parseISO(toISO(maxValue)) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex h-(--size-control-field) items-center rounded-control border border-line bg-surface">
        <input id={id} data-testid={testId} className="h-full min-w-0 flex-1 bg-transparent px-3 text-field tabular-nums text-ink outline-none" type="date" value={val ?? ""} min={min ? toISO(min) : undefined} max={max ? toISO(max) : undefined}
               disabled={disabled} onChange={(e) => { const v = e.target.value || null; setVal(v); onValueChange?.(v); }} />
        <PopoverTrigger asChild>
          <button type="button" className="px-3 text-mute" data-testid={testId ? `${testId}-trigger` : undefined} aria-label="Open the calendar" disabled={disabled}>📅</button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" sideOffset={6} align="end">
        <Calendar mode="single" selected={date} defaultMonth={date} disabled={[...(min ? [{ before: min }] : []), ...(max ? [{ after: max }] : [])]}
                  onSelect={(d) => { const v = d ? toISO(d) : null; setVal(v); onValueChange?.(v); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
}
