// PLATFORM'S OWN BOOKING PAGES — native <select> dropdowns (they open the iPhone and Android pickers) and the Day / Time pair
// the booking form and the change page share.
import { forwardRef } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Label } from "@/lib/components/ui/label";
import { cn } from "@/lib/utils";
import { dayLabel, timeLabel, dateInZone } from "@/lib/booking/public/format.js";

export const inputClass = "h-(--size-control) w-full rounded-control border border-line bg-surface px-3 text-body text-ink outline-none placeholder:text-mute focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive max-sm:h-11 max-sm:text-base";

/** A labelled field with its own error line. */
export function Field({ id, label, error, hint, children, className }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-caption text-mute">{hint}</span> : null}
      {error ? <span className="text-caption text-bad" role="alert" data-testid={`${id}-error`}>{error}</span> : null}
    </div>
  );
}

export const Select = forwardRef(function Select({ id, value, onChange, disabled, children, invalid, testId }, ref) {
  return (
    <div className="relative w-full">
      <select ref={ref} id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid ? true : undefined} data-testid={testId}
        className={cn(inputClass, "appearance-none pr-9")}>{children}</select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mute" aria-hidden="true" />
    </div>
  );
});

/**
 * Day and Time. `days` = [{date,count}] in the practice's days; `slots` = [{startsAt}]; a day lists only its own free times.
 * The Time dropdown says "Pick a day first" until a day is chosen.
 */
export const DayTimeFields = forwardRef(function DayTimeFields({ idPrefix, days, slots, practiceTz, visitorTz, day, time, onDay, onTime, loading, errors = {}, dayLabelText = "Day", timeLabelText = "Time" }, timeRef) {
  const open = (days?.length ? days.filter((d) => d.count > 0) : []);
  const byDay = new Map();
  for (const s of slots ?? []) { const k = dateInZone(s.startsAt, practiceTz); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
  const dayOptions = open.length ? open : [...byDay].map(([date, list]) => ({ date, count: list.length })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const times = day ? byDay.get(day) ?? [] : [];
  return (
    <>
      <Field id={`${idPrefix}-day`} label={dayLabelText} error={errors.day}>
        <Select id={`${idPrefix}-day`} value={day} onChange={onDay} disabled={loading || dayOptions.length === 0} invalid={!!errors.day} testId={`${idPrefix}-day`}>
          <option value="">{loading ? "Loading days…" : "Choose a day"}</option>
          {dayOptions.map((d) => <option key={d.date} value={d.date}>{dayLabel(d.date, d.count)}</option>)}
        </Select>
      </Field>
      <Field id={`${idPrefix}-time`} label={timeLabelText} error={errors.time}>
        <Select ref={timeRef} id={`${idPrefix}-time`} value={time} onChange={onTime} disabled={!day} invalid={!!errors.time} testId={`${idPrefix}-time`}>
          <option value="">{day ? "Choose a time" : "Pick a day first"}</option>
          {times.map((s) => <option key={s.startsAt} value={s.startsAt}>{timeLabel(s.startsAt, visitorTz, practiceTz)}</option>)}
        </Select>
      </Field>
    </>
  );
});
