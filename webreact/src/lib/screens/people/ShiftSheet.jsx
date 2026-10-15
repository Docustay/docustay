// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 12.30 — SHIFTSHEET. The one right-hand sheet SchedulingScreen opens for three jobs: add a shift,
// edit a shift (Delete inside, per field 4), and add time off. `SideSheet` (11.12) owns the chrome;
// this file owns only the three field sets and the outgoing body shape.
//
// ★★★ TIME. `startMinute`/`endMinute` are MINUTES FROM MIDNIGHT, the PRACTICE's own wall clock
//     (`src/people/scheduling.mjs`'s own header) — never a `Date`, never a browser-zone
//     conversion. The From/To options below are built by pure integer arithmetic on `MINUTE_STEP`
//     and rendered with `clockLabel`, which does the same h/mm split `minutesToLabel` does
//     server-side, plus AM/PM so a 15-minute-stepped list of 96 values reads unambiguously in a
//     dropdown (the grid itself, SchedulingScreen's own concern, matches the frame's shorter
//     "8:00 – 5:00" instead — a display choice, not a second clock).
//
// ★ `select` VALUES ARE ALWAYS STRINGS ON THE ROUND TRIP (native `<option value>` is an HTML
//   attribute) — `NativeSelect` spreads `value` onto a plain `<option>`, not inside the SAME
//   component, so Svelte's non-string option-value optimisation does not apply. Every select-backed
//   value here is kept as a STRING in local state and converted at the one place it leaves this
//   file (`buildBody`).
//
// ★ NO `FieldDuration` COMPONENT (12.30 field 13: "there is no FieldDuration component
//   (EXECUTED: zero hits)") — the From/To duration control is two plain `NativeSelect`s, built
//   inline, exactly as the task names it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

const MINUTE_STEP = 15;
const MINUTE_OPTIONS = Array.from({ length: (24 * 60) / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP));

/** `total` minutes-from-midnight → "8:00 AM" / "5:30 PM". Pure arithmetic — no `Date`, no zone. */
function clockLabel(total) {
  const totalNum = Number(total);
  const h24 = Math.floor(totalNum / 60);
  const mm = String(totalNum % 60).padStart(2, "0");
  const period = h24 < 12 ? "AM" : "PM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12}:${mm} ${period}`;
}

/** `YYYY-MM-DD` → "Monday 22". `Date.UTC` + `timeZone: "UTC"` throughout — the calendar date
 *  never passes through the browser's own zone, so it cannot drift a day either way. */
function dayLabel(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${d}`;
}

export default function ShiftSheet({
  // ★★ "create" | "edit" | "timeoff".
  mode = "create",
  // ★ `[{appUserId, displayName}]` — ONLY people the viewer `canEdit` (field 4: "Who ⌄ (only
  //   people canEdit)"). Create mode's Who select.
  people = [],
  // ★ `[{id, name, timezone, city, archivedAt}]` — `api.locations()`'s own rows.
  locations = [],
  // ★ The 7 week dates, `YYYY-MM-DD`, from `schedule.days` — create mode's Day select.
  days = [],
  // ★ The existing shift being edited — `{id, appUserId, onDate, startMinute, endMinute,
  //   locationId, locationName, videoOnly, label}` — `null` in create/timeoff mode.
  shift = null,
  // ★ Preset person/day for a cell-triggered "Add a shift" — `null` when opened from the header
  //   button (the Who/Day selects then default to the first option).
  presetAppUserId = null,
  presetOnDate = null,
  // ★ The person's display name, for the timeoff-mode title/subtitle.
  timeOffPersonName = null,
  busy = false,
  // ★ The server's own message, never re-worded — `SideSheet`'s own `error` prop.
  error = null,
  onCancel,
  // ★ `(body) => void` — `body`'s shape depends on `mode` (see `buildBody`).
  onSave,
  // ★ `() => void` | `null` — edit mode's "Delete shift", rendered INSIDE the sheet body per
  //   field 4 ("clicking a cell opens ShiftSheet in edit (Delete inside)").
  onDelete = null,
  testId = "shift-sheet",
}) {
  const isShiftMode = mode === "create" || mode === "edit";

  const [appUserId, setAppUserId] = useState(
    mode === "edit" ? (shift?.appUserId ?? "") : (presetAppUserId ?? people[0]?.appUserId ?? "")
  );
  const [onDate, setOnDate] = useState(
    mode === "edit" ? (shift?.onDate ?? "") : (presetOnDate ?? days[0] ?? "")
  );
  const [startMinuteStr, setStartMinuteStr] = useState(mode === "edit" ? String(shift?.startMinute ?? 480) : "480");
  const [endMinuteStr, setEndMinuteStr] = useState(mode === "edit" ? String(shift?.endMinute ?? 1020) : "1020");
  const [locationChoice, setLocationChoice] = useState(
    mode === "edit" ? (shift?.videoOnly ? "video" : String(shift?.locationId ?? "")) : ""
  );
  const [label, setLabel] = useState(mode === "edit" ? (shift?.label ?? "") : "");

  // ── time off (mode === "timeoff") ────────────────────────────────────────────────────────────
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");

  const title = mode === "timeoff"
    ? "Add time off"
    : mode === "edit" ? "Edit shift" : "Add a shift";
  const subtitle = mode === "timeoff" && timeOffPersonName ? timeOffPersonName : null;

  function buildBody() {
    if (mode === "timeoff") {
      return { startsOn, endsOn, reason: reason.trim() ? reason.trim() : null };
    }
    return {
      appUserId,
      onDate,
      startMinute: Number(startMinuteStr),
      endMinute: Number(endMinuteStr),
      locationId: locationChoice && locationChoice !== "video" ? locationChoice : null,
      videoOnly: locationChoice === "video",
      label: label.trim() ? label.trim() : null,
    };
  }

  function handleSave() {
    onSave?.(buildBody());
  }

  return (
    <SideSheet title={title} subtitle={subtitle} onCancel={onCancel} onSave={handleSave} busy={busy} error={error} testId={testId}>
      {mode === "timeoff" ? (
        <>
          <Field orientation="horizontal" data-testid={`${testId}-row-starts`}>
            <FieldLabel htmlFor={`${testId}-starts`}>Starts</FieldLabel>
            <FieldContent>
              <Input
                id={`${testId}-starts`}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                data-testid={`${testId}-starts`}
                required
              />
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-ends`}>
            <FieldLabel htmlFor={`${testId}-ends`}>Ends</FieldLabel>
            <FieldContent>
              <Input
                id={`${testId}-ends`}
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                data-testid={`${testId}-ends`}
                required
              />
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-reason`}>
            <FieldLabel htmlFor={`${testId}-reason`}>Reason <span className="text-meta text-mute">optional</span></FieldLabel>
            <FieldContent>
              <Input
                id={`${testId}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid={`${testId}-reason`}
              />
            </FieldContent>
          </Field>
        </>
      ) : isShiftMode ? (
        <>
          <Field orientation="horizontal" data-testid={`${testId}-row-who`}>
            <FieldLabel htmlFor={`${testId}-who`}>Who</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-who`}
                value={appUserId}
                onChange={(e) => setAppUserId(e.target.value)}
                data-testid={`${testId}-who`}
                required
              >
                {people.map((p) => (
                  <NativeSelectOption key={p.appUserId} value={p.appUserId}>
                    {p.displayName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-day`}>
            <FieldLabel htmlFor={`${testId}-day`}>Day</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-day`}
                value={onDate}
                onChange={(e) => setOnDate(e.target.value)}
                data-testid={`${testId}-day`}
                required
              >
                {days.map((d) => (
                  <NativeSelectOption key={d} value={d}>
                    {dayLabel(d)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-from`}>
            <FieldLabel htmlFor={`${testId}-from`}>From</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-from`}
                value={startMinuteStr}
                onChange={(e) => setStartMinuteStr(e.target.value)}
                data-testid={`${testId}-from`}
                required
              >
                {MINUTE_OPTIONS.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {clockLabel(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-to`}>
            <FieldLabel htmlFor={`${testId}-to`}>To</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-to`}
                value={endMinuteStr}
                onChange={(e) => setEndMinuteStr(e.target.value)}
                data-testid={`${testId}-to`}
                required
              >
                {MINUTE_OPTIONS.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {clockLabel(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-where`}>
            <FieldLabel htmlFor={`${testId}-where`}>Where</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-where`}
                value={locationChoice}
                onChange={(e) => setLocationChoice(e.target.value)}
                data-testid={`${testId}-where`}
                required
              >
                <NativeSelectOption value="">Select a place</NativeSelectOption>
                {locations.map((loc) => (
                  <NativeSelectOption key={loc.id} value={loc.id}>
                    {loc.name}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value="video">Video only</NativeSelectOption>
              </NativeSelect>
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid={`${testId}-row-label`}>
            <FieldLabel htmlFor={`${testId}-label`}>Label <span className="text-meta text-mute">optional</span></FieldLabel>
            <FieldContent>
              <Input
                id={`${testId}-label`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                data-testid={`${testId}-label`}
                placeholder="evening"
              />
            </FieldContent>
          </Field>

          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="mx-5.5 mt-2 mb-1 h-8.5 rounded-control border border-bad-border bg-bad-bg px-3.5 text-sm font-medium text-bad disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`${testId}-delete`}
              disabled={busy}
              onClick={() => onDelete?.()}
            >
              Delete shift
            </button>
          )}
        </>
      ) : null}
    </SideSheet>
  );
}
