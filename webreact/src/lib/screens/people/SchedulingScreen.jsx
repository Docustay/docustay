// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 12.30 — SCHEDULING: WHO'S WORKING (`/people/scheduling`). BUILT FROM `specs/mockups/
// Scheduling.frame.html`, PORTED STRUCTURALLY: title/subtitle + "Copy last week"/"Add a shift" ·
// a week switcher · the staff × Mon–Sun shift grid (`.shift`) · the two-column "How this decides
// what's bookable" explainer + "Coming up" prompt feed beneath it (`.cols`/`.colL`/`.colR`).
//
// ★★★ THE MOUNT DOES ITS OWN FETCH, DELIBERATELY — same reasoning `NetworkReleases.svelte`
//     (12.34) already records: this screen is not in 12.36's `DEDICATED_SCREENS` pre-fetch map
//     yet (that mount lands with 12.36), so loading/error/denied are owned HERE, via `ScreenState`
//     (field 14), not inherited from `Screen.svelte`.
//
// ★★★ EVERY ROUTE THIS SCREEN CALLS ANSWERS 403 `unknown_path` UNTIL 12.35 ADDS THE
//     `/people/scheduling` NAV ROW (`src/routes/scheduling.mjs`'s own header). That is the
//     described dependency order (field 10 "Needs"), not a defect in this file — a 403 here
//     today renders as this screen's own `phase="denied"`, same as any other refusal.
//
// ★★★ TIME IS THE TRAP. `startMinute`/`endMinute` from `readSchedule` are integer MINUTES FROM
//     MIDNIGHT — the PRACTICE's own wall clock (`src/people/scheduling.mjs`'s header), never a
//     UTC instant. `minutesToClock` below is pure integer arithmetic; it NEVER constructs a
//     `Date` from a shift's minutes, because doing so would silently apply the BROWSER's zone to
//     a number that was never an instant to begin with — the exact bug this rule exists to stop.
//     The `days` calendar dates (plain `YYYY-MM-DD`) are formatted the same way: `Date.UTC` +
//     `timeZone: "UTC"` throughout, so the calendar date on screen can never drift a day either
//     way against the server's own reading of it.
//
// ★ BOOKING/AVAILABILITY RULES ARE ENFORCED SERVER-SIDE. This screen shows and edits shifts and
//   time off; it decides nothing about what becomes bookable — that reading is
//   `src/booking/slots.mjs`'s (12.4), never duplicated here.
//
// ★ `mayEditHours` (server-side, `src/people/scheduling.mjs`) is surfaced here as `row.canEdit`.
//   A row a viewer may not edit renders its shift cells as plain, non-interactive `<div>`s — no
//   click handler, no button, nothing to press. The per-row "Add time off" action stays VISIBLE
//   but disabled-with-reason (`DisabledWithReason`, 11.13) — "you may not change these hours" is
//   a real, explained state there, never a vanished control.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ShiftSheet from "./ShiftSheet.jsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { ICON_STROKE } from "@/lib/empty/icons.js";
import { toast } from "sonner";

// ── pure calendar-date arithmetic — UTC throughout, never a wall-clock instant ────────────────
function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDateLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Monday of the week containing `d`, in the BROWSER's own local calendar — only ever used to
 *  pick the screen's INITIAL week; every week thereafter is reached by `shiftWeek`, which is
 *  pure UTC date-string arithmetic with no zone in it at all. */
function mondayOf(d) {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return isoDateLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
}

function addDaysToDateString(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
}

function formatDayHeader(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${d}`;
}

function formatMonthDay(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d}`;
}

/** `total` minutes-from-midnight → "8:00" / "5:00" — the frame's own short, unambiguous form
 *  (`Scheduling.frame.html`'s `.sh2 b`), never routed through a `Date`. */
function minutesToClock(total) {
  const h24 = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, "0");
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12}:${mm}`;
}

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
}

export default function SchedulingScreen({ onNavigate = null }) {
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [schedule, setSchedule] = useState({ weekStart, days: [], rows: [] });
  const [locations, setLocations] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [copyBusy, setCopyBusy] = useState(false);

  // ── the sheet: create | edit | timeoff ──────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("create");
  const [sheetShift, setSheetShift] = useState(null);
  const [sheetPresetAppUserId, setSheetPresetAppUserId] = useState(null);
  const [sheetPresetOnDate, setSheetPresetOnDate] = useState(null);
  const [sheetTimeOffAppUserId, setSheetTimeOffAppUserId] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  const weekRangeLabel = schedule.days.length
    ? `${formatMonthDay(schedule.days[0])} – ${formatMonthDay(schedule.days[schedule.days.length - 1])}`
    : "";

  // ★ field 4: "A solo practice never needs this screen" — emphasised when there is at most one
  //   staff member and nobody has a shift this week (field 14's own condition).
  const solo = schedule.rows.length <= 1 && schedule.rows.every((r) => r.shifts.length === 0);

  const editablePeople = schedule.rows
    .filter((r) => r.canEdit)
    .map((r) => ({ appUserId: r.appUserId, displayName: r.displayName }));

  const timeOffPersonName = schedule.rows.find((r) => r.appUserId === sheetTimeOffAppUserId)?.displayName ?? null;

  function go(href) {
    onNavigate?.(href);
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [sched, locRes, promptRes] = await Promise.all([
        api.schedule(weekStart),
        api.locations(),
        api.prompts("scheduling"),
      ]);
      setSchedule(sched ?? { weekStart, days: [], rows: [] });
      setLocations(locRes?.locations ?? []);
      setPrompts(promptRes?.prompts ?? []);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }

  // ★ `weekStart` is read synchronously inside `load()` (via `api.schedule(weekStart)`, before
  //   its first `await`), so this effect is ALSO `weekStart`'s own dependency — `shiftWeek` only
  //   ever needs to change the value, never to call `load()` itself, or every week-switch would
  //   fetch the schedule twice.
  useEffect(() => {
    load();
  }, [weekStart]);

  function shiftWeek(deltaDays) {
    setWeekStart(addDaysToDateString(weekStart, deltaDays));
  }

  function openCreate() {
    setSheetMode("create");
    setSheetShift(null);
    setSheetPresetAppUserId(null);
    setSheetPresetOnDate(null);
    setSheetError(null);
    setSheetOpen(true);
  }

  function openCreateForCell(row, onDate) {
    if (!row.canEdit) return;
    setSheetMode("create");
    setSheetShift(null);
    setSheetPresetAppUserId(row.appUserId);
    setSheetPresetOnDate(onDate);
    setSheetError(null);
    setSheetOpen(true);
  }

  function openEdit(row, shiftRow) {
    if (!row.canEdit) return;
    setSheetMode("edit");
    setSheetShift({ ...shiftRow, appUserId: row.appUserId });
    setSheetError(null);
    setSheetOpen(true);
  }

  function openTimeOff(row) {
    if (!row.canEdit) return;
    setSheetMode("timeoff");
    setSheetTimeOffAppUserId(row.appUserId);
    setSheetError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (sheetBusy) return;
    setSheetOpen(false);
  }

  function messageOf(err) {
    return err instanceof ApiError ? err.message : String(err?.message ?? err);
  }

  async function saveShift(body) {
    setSheetBusy(true);
    setSheetError(null);
    try {
      if (sheetMode === "edit" && sheetShift?.id) {
        await api.updateShift(sheetShift.id, body);
      } else {
        await api.createShift(body);
      }
      setSheetOpen(false);
      await load();
    } catch (err) {
      setSheetError(messageOf(err));
    } finally {
      setSheetBusy(false);
    }
  }

  async function deleteShiftNow() {
    if (!sheetShift?.id) return;
    setSheetBusy(true);
    setSheetError(null);
    try {
      await api.deleteShift(sheetShift.id);
      setSheetOpen(false);
      await load();
    } catch (err) {
      setSheetError(messageOf(err));
    } finally {
      setSheetBusy(false);
    }
  }

  async function saveTimeOff(body) {
    setSheetBusy(true);
    setSheetError(null);
    try {
      await api.addTimeOff({ appUserId: sheetTimeOffAppUserId, ...body });
      setSheetOpen(false);
      await load();
    } catch (err) {
      setSheetError(messageOf(err));
    } finally {
      setSheetBusy(false);
    }
  }

  async function copyLastWeekNow() {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
      const result = await api.copyLastWeek(weekStart);
      toast.success(`${result.copied} copied`);
      await load();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setCopyBusy(false);
    }
  }

  // ★ No dismiss route is in this task's api.js call list (field 5's "not to touch" reserves
  //   `api.js` to 12.19, and its own method list stops at `prompts`) — dismissal here is LOCAL to
  //   this mount, not persisted, so a reload can bring the same prompt back. That is a narrower
  //   behaviour than the shared engine's own persisted dismissal, not a silent no-op.
  function dismissPromptLocal(dismissKey) {
    setPrompts(prompts.filter((p) => p.dismissKey !== dismissKey));
  }

  return (
    <LedgerPage
      title="Who's working"
      summary="This is when people are at work. What's bookable sits inside it."
      headerAction={{ label: copyBusy ? "Copying…" : "Copy last week", onClick: copyLastWeekNow }}
      primary={{ label: "Add a shift", onClick: openCreate }}
      testId="scheduling-page"
      controls={
        <div className="flex items-center gap-1.5" data-testid="scheduling-week-switcher">
          <Button size="icon-sm" variant="outline" onClick={() => shiftWeek(-7)} data-testid="scheduling-week-prev" aria-label="Previous week">
            <ChevronLeft strokeWidth={ICON_STROKE} />
          </Button>
          <span className="text-sm text-mute min-w-fit text-center" data-testid="scheduling-week-label">{weekRangeLabel}</span>
          <Button size="icon-sm" variant="outline" onClick={() => shiftWeek(7)} data-testid="scheduling-week-next" aria-label="Next week">
            <ChevronRight strokeWidth={ICON_STROKE} />
          </Button>
        </div>
      }
    >
      <ScreenState phase={phase} error={phase === "error" ? error : null} reason={phase === "denied" ? (error?.message ?? null) : null} onNavigate={go}>
        {/* ★★★ frame vocabulary #1 — the grid ALWAYS renders, every cell a time range or "Off"; there
             is no `EmptyState` on this screen (field 13's own note) even with zero shifts. */}
        <div
          className="overflow-hidden rounded-card border border-line bg-surface"
          data-testid="scheduling-grid"
          style={{ display: "grid", gridTemplateColumns: `150px repeat(${schedule.days.length || 7}, 1fr)` }}
        >
          <div className="flex h-10 items-center border-b border-line bg-surface-sunken-2 px-3 text-xs font-medium text-mute" data-testid="scheduling-hd-who">
            Who
          </div>
          {schedule.days.map((day) => (
            <div key={day} className="flex h-10 items-center border-b border-line bg-surface-sunken-2 px-3 text-xs font-medium text-mute" data-testid={`scheduling-hd-${day}`}>
              {formatDayHeader(day)}
            </div>
          ))}

          {schedule.rows.map((row) => (
            // ★★★ FOUND LIVE, 1 Oct 2026 — this wrapper had no `display: contents`, so it was ONE
            //   grid cell (auto-placed into whatever column CSS Grid's left-to-right flow reached
            //   next), not a full row. Its own children — the name bar AND all 7 day cells — then
            //   stacked as ordinary block content INSIDE that single cell, and the NEXT person's
            //   wrapper auto-flowed into the column beside it rather than a new row underneath.
            //   That is exactly what was on screen: two people's name bars side by side on one row,
            //   then 14 "Off" blocks spilling down through unrelated day columns. `contents` makes
            //   this div invisible to layout — its children become direct grid items again, each
            //   taking the column its position in the DOM actually means.
            <div key={row.appUserId} className="contents">
              {/* ★ FOUND LIVE, 1 Oct 2026 — the mockup's own `.pn` cell (specs/mockups/Scheduling.
                  frame.html) holds only the avatar and name; "Add time off" isn't in the frame at
                  all. Squeezed onto one line beside the name it collided with it the moment the
                  grid actually rendered as a grid (the `contents` fix above). Stacked here instead
                  — name on its own line, the button on the next — so it reads cleanly at any name
                  length without widening the column past the frame's own 150px. */}
              <div className="flex flex-col gap-1.5 border-t border-line border-b border-line-soft px-3 py-3 text-sm font-normal min-h-fit" data-testid={`scheduling-row-${row.appUserId}`}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-chip-neutral-bg text-xs font-medium text-chip-neutral-ink">
                    {initials(row.displayName)}
                  </span>
                  <span className="flex-1 min-w-0 truncate" title={row.displayName}>{row.displayName}</span>
                </span>
                <DisabledWithReason
                  disabled={!row.canEdit}
                  reason="You can change only your own hours."
                  testId={`scheduling-timeoff-${row.appUserId}`}
                >
                  {({ disabled }) => (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => openTimeOff(row)}
                      className="h-7 w-full justify-center px-2 text-xs"
                      data-testid={`scheduling-timeoff-btn-${row.appUserId}`}
                    >
                      Add time off
                    </Button>
                  )}
                </DisabledWithReason>
              </div>

              {schedule.days.map((day) => {
                const dayShifts = row.shifts.filter((s) => s.onDate === day);
                if (row.canEdit) {
                  return (
                    <button
                      key={day}
                      type="button"
                      className="min-h-fit border-t border-line border-b border-line-soft border-l border-line-soft p-1.75 text-left text-sm flex flex-col gap-1 items-start bg-none cursor-pointer"
                      data-testid={`scheduling-cell-${row.appUserId}-${day}`}
                      onClick={() => (dayShifts.length ? openEdit(row, dayShifts[0]) : openCreateForCell(row, day))}
                    >
                      {dayShifts.length ? (
                        dayShifts.map((s) => (
                          <span
                            key={s.id}
                            className="bg-primary-subtle text-ink rounded-sm px-2 py-1.5 text-xs leading-snug w-full"
                            data-testid={`scheduling-shift-${s.id}`}
                          >
                            <b className="block font-medium">{minutesToClock(s.startMinute)} – {minutesToClock(s.endMinute)}</b>
                            {s.videoOnly ? "Video only" : (s.locationName ?? "")}{s.label ? ` · ${s.label}` : ""}
                          </span>
                        ))
                      ) : (
                        <span className="bg-surface-sunken text-ink-muted rounded-sm px-2 py-1.5 text-xs leading-snug w-full">
                          Off
                        </span>
                      )}
                    </button>
                  );
                } else {
                  // ★★★ NO EDIT AFFORDANCE — a plain, non-interactive cell. `row.canEdit` is false, so
                  //     there is nothing here to press; the row's own "Add time off" above is the ONE
                  //     explained-and-disabled control this row gets (DisabledWithReason).
                  return (
                    <div
                      key={day}
                      className="min-h-fit border-t border-line border-b border-line-soft border-l border-line-soft p-1.75 text-left text-sm flex flex-col gap-1 items-start bg-none"
                      data-testid={`scheduling-cell-${row.appUserId}-${day}`}
                    >
                      {dayShifts.length ? (
                        dayShifts.map((s) => (
                          <span
                            key={s.id}
                            className="bg-primary-subtle text-ink rounded-sm px-2 py-1.5 text-xs leading-snug w-full"
                            data-testid={`scheduling-shift-${s.id}`}
                          >
                            <b className="block font-medium">{minutesToClock(s.startMinute)} – {minutesToClock(s.endMinute)}</b>
                            {s.videoOnly ? "Video only" : (s.locationName ?? "")}{s.label ? ` · ${s.label}` : ""}
                          </span>
                        ))
                      ) : (
                        <span className="bg-surface-sunken text-ink-muted rounded-sm px-2 py-1.5 text-xs leading-snug w-full">
                          Off
                        </span>
                      )}
                    </div>
                  );
                }
              })}
            </div>
          ))}
        </div>

        <div className="flex gap-5.5 items-start mt-5" data-testid="scheduling-cols">
          <div className="flex-1 min-w-0">
            <div className="bg-surface border border-line rounded-card">
              <div className="px-4.25 py-3.5 border-b border-hair">
                <b className="font-medium">How this decides what's bookable</b>
              </div>
              <div className="px-4.25 py-3.5 flex flex-col gap-0">
                <div className="flex items-start gap-3 py-2.75 border-b border-hair text-sm">
                  <span className="text-mute text-sm w-5 flex-shrink-0">1</span>
                  <span className="flex-1 flex flex-col gap-0.5">
                    <b className="font-medium">The shift is the outer edge</b>
                    <span className="text-mute text-sm">Nobody can be booked outside the hours they're at work.</span>
                  </span>
                </div>
                <div className="flex items-start gap-3 py-2.75 border-b border-hair text-sm">
                  <span className="text-mute text-sm w-5 flex-shrink-0">2</span>
                  <span className="flex-1 flex flex-col gap-0.5">
                    <b className="font-medium">Their own availability narrows it</b>
                    <span className="text-mute text-sm">the maintainer keeps 12 to 1 for notes, so it never shows as bookable.</span>
                  </span>
                </div>
                <div className="flex items-start gap-3 py-2.75 border-b border-hair text-sm">
                  <span className="text-mute text-sm w-5 flex-shrink-0">3</span>
                  <span className="flex-1 flex flex-col gap-0.5">
                    <b className="font-medium">Time off beats both</b>
                    <span className="text-mute text-sm">Robin is away 6 to 13 October. Nothing can be booked, shift or not.</span>
                  </span>
                </div>
                <div className={`flex items-start gap-3 py-2.75 text-sm ${solo ? "font-medium text-ink" : ""}`} data-testid="scheduling-explainer-solo">
                  <span className="text-mute text-sm w-5 flex-shrink-0">—</span>
                  <span className="flex-1 flex flex-col gap-0.5">
                    <b className="font-medium">No shifts at all?</b>
                    <span className={solo ? "font-medium text-ink" : "text-mute text-sm"}>
                      Then availability alone decides it. <b>A solo practice never needs this screen.</b>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="w-80 flex-shrink-0">
            <div className="bg-surface border border-line rounded-card">
              <div className="px-4.25 py-3.5 border-b border-hair">
                <b className="font-medium">Coming up</b>
              </div>
              <div className="px-4.25 py-3.5 flex flex-col gap-0" data-testid="scheduling-coming-up">
                {prompts.length === 0 ? (
                  <p className="text-mute text-sm m-2" data-testid="scheduling-coming-up-empty">
                    Nothing needs you here right now.
                  </p>
                ) : (
                  prompts.map((p) => (
                    <PromptCard
                      key={p.dismissKey}
                      icon={p.icon}
                      tone={p.tone}
                      headline={p.headline}
                      why={p.why}
                      action={p.action}
                      kind={p.kind}
                      onDismiss={() => dismissPromptLocal(p.dismissKey)}
                      testId={`scheduling-prompt-${p.dismissKey}`}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScreenState>

      {sheetOpen && (
        <ShiftSheet
          mode={sheetMode}
          people={editablePeople}
          locations={locations}
          days={schedule.days}
          shift={sheetShift}
          presetAppUserId={sheetPresetAppUserId}
          presetOnDate={sheetPresetOnDate}
          timeOffPersonName={timeOffPersonName}
          busy={sheetBusy}
          error={sheetError}
          onCancel={closeSheet}
          onSave={sheetMode === "timeoff" ? saveTimeOff : saveShift}
          onDelete={sheetMode === "edit" ? deleteShiftNow : null}
          testId="shift-sheet"
        />
      )}
    </LedgerPage>
  );
}
