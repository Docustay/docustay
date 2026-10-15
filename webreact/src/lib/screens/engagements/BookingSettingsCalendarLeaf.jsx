// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.008 — BookingSettingsCalendarLeaf — rebuild from specs/mockups/BookingSettingsCalendar.frame.html.
//
// ★★★ ONE SOURCE FOR "WHO CAN BOOK" / "HOW FAR AHEAD" / "GAPS" / "LET PEOPLE PICK" — the SAME
//     `GET /api/engagements/booking-settings` read `BookingSettingsPayingLeaf.jsx`
//     reads, never a second computation. `booking.notice_minutes` is STORED in minutes; this leaf
//     converts to/from whole hours for display only (the frame's own "24" hours-notice field) —
//     the write always sends whole minutes back.
//
// ★★★ "YOUR WORKING HOURS" — `HoursDialog` IS NOT TOUCHED, ONLY MOUNTED. Time here is
//     MINUTES FROM LOCAL MIDNIGHT, never a UTC instant, matching `HoursDialog`'s own storage form
//     (`src/booking/hours.mjs`'s header, §B4 STEP 3) — `clockLabel`/`summariseHours` below are a
//     small LOCAL re-implementation of the same pure arithmetic `HoursDialog.svelte:56-65` already
//     uses, duplicated rather than imported because nothing in that file is exported for reuse and
//     this task's file list does not include it.
//
// ★★★ `hostId` ARRIVES AS A PROP, NOT GUESSED — the SAME `app.me?.appUserId` pattern
//     `Screen.svelte:913,1383`/`EngMyLinkScreen.svelte:54-60` (F447) already establishes for every
//     other screen that needs `the signed-in coach's own id` and has no dedicated identity route
//     of its own. `null` until 13.44 wires it in (this task's own field 10 names 13.44 as later);
//     the hours row and its Edit stay honestly unavailable until then, never a fabricated id.
//
// ★ GOOGLE CALENDAR — `GET /api/engagements/calendar/connections` (13.27, MEASURED shape:
//   `{connections:[{id,provider,externalAccount,status,lastError,...}], subscribeLink}`). The
//   sub-line is R-13.5's TRUTHFUL sentence, never the frame's own "Anything in your own calendar
//   blocks a booking here" (13.20 does not read Google's calendar at all today — MEASURED, the
//   plan's own field 4 note).
//
// ★ THEY/THEM THROUGHOUT. TOKENS ONLY, all declared (see build report for the grep).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/ui/tabs.jsx";
import { FieldLabel, FieldDescription, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import HoursDialog from "./HoursDialog.jsx";

export default function BookingSettingsCalendarLeaf({ onNavigate = null, hostId = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [hours, setHours] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [hoursDialogOpen, setHoursDialogOpen] = useState(false);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const TABS = [
    { key: "calendar", label: "Calendar and booking", href: "/engagements/booking/settings/calendar" },
    { key: "team", label: "Team and website", href: "/engagements/booking/settings/team" },
    { key: "paying", label: "Paying and cancelling", href: "/engagements/booking/settings/paying" },
    { key: "sending", label: "What we send", href: "/engagements/booking/settings/sending" },
    { key: "history", label: "History", href: "/engagements/booking/settings/history" },
  ];

  function onTabChange(value) {
    const tab = TABS.find((t) => t.key === value);
    if (tab && tab.key !== "calendar") go(tab.href);
  }

  const keys = view?.keys ?? {};

  // ─── How far ahead — `notice_minutes` is stored in minutes, shown as whole hours. ──────────────
  const noticeHours = Math.round((keys["booking.notice_minutes"] ?? 0) / 60);

  function saveNoticeHours(hoursValue) {
    const n = Math.max(0, Math.round(Number(hoursValue) || 0));
    save("booking.notice_minutes", n * 60);
  }

  // ─── Your working hours — local re-implementation of HoursDialog's own pure arithmetic
  const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function clockLabel(total) {
    const totalNum = Number(total);
    const h24 = Math.floor(totalNum / 60);
    const mm = String(totalNum % 60).padStart(2, "0");
    const period = h24 < 12 ? "AM" : "PM";
    const h12raw = h24 % 12;
    const h12 = h12raw === 0 ? 12 : h12raw;
    return `${h12}:${mm} ${period}`;
  }

  function summariseHours(days) {
    if (!days || days.length === 0) return "No working hours set yet.";
    const byDow = new Map(days.map((d) => [d.dayOfWeek, d.ranges?.[0] ?? null]));
    const sig = (r) => (r ? `${r.startMinute}-${r.endMinute}` : null);
    const groups = [];
    let current = null;
    for (const dow of DISPLAY_ORDER) {
      const r = byDow.get(dow) ?? null;
      const s = sig(r);
      if (current && current.sig === s) current.dows.push(dow);
      else { current = { sig: s, range: r, dows: [dow] }; groups.push(current); }
    }
    const working = groups.filter((g) => g.sig !== null);
    if (working.length === 0) return "Not working any day this week.";
    return working.map((g) => {
      const names = g.dows.map((d) => DAY_ABBR[d]);
      const label = names.length > 1 ? `${names[0]} to ${names[names.length - 1]}` : names[0];
      return `${label}, ${clockLabel(g.range.startMinute)} to ${clockLabel(g.range.endMinute)}`;
    }).join(" · ");
  }

  const hoursSummary = hostId ? summariseHours(hours?.days) : null;

  // ─── Google Calendar ──────────────────────────────────────────────────────────────────────────
  const googleConnection = (calendar?.connections ?? []).find((c) => c.provider === "google") ?? null;

  // ─── Load data ────────────────────────────────────────────────────────────────────────────────
  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const reads = [request("/api/engagements/booking-settings")];
      reads.push(
        hostId
          ? request(`/api/engagements/hours?hostId=${encodeURIComponent(hostId)}`)
          : Promise.resolve(null)
      );
      reads.push(request("/api/engagements/calendar/connections"));
      const [bs, hrs, cal] = await Promise.all(reads);
      setView(bs);
      setHours(hrs);
      setCalendar(cal);
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

  useEffect(() => {
    load();
  }, [hostId]);

  // ─── Save handler ────────────────────────────────────────────────────────────────────────────
  async function save(key, value) {
    setWriteError(null);
    setSavingKey(key);
    try {
      await request("/api/settings", { method: "POST", body: { key, value } });
      await load();
    } catch (err) {
      setWriteError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSavingKey(null);
    }
  }

  function handleHoursSaved() {
    setHoursDialogOpen(false);
    load();
  }

  const WHO_CAN_BOOK_OPTIONS = [
    { value: "anyone", label: "Anyone — strangers included" },
    { value: "existing_clients", label: "Only people already on your books" },
  ];

  return (
    <div className="w-full" data-testid="booking-settings-calendar">
      <div className="mb-1.5">
        <h1 className="m-0 text-2xl font-medium tracking-tighter" style={{ fontSize: "var(--fs-title)" }}>Booking settings</h1>
        <p className="mt-1.25 mb-[18px] text-sm" style={{ color: "var(--ink-muted)" }}>How booking works for the whole practice. Any service can differ.</p>
      </div>

      <Tabs value="calendar" onValueChange={onTabChange} data-testid="booking-settings-tabs">
        <TabsList variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} data-testid={`booking-settings-tab-${tab.key}`}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        testIds={{ error: "calendar-error", denied: "calendar-denied" }}
      >
        {writeError && (
          <p className="mb-4 rounded-lg p-[10px_14px] text-sm" role="alert" data-testid="calendar-write-error" style={{ background: "var(--chip-bad-bg)", color: "var(--chip-bad-ink)" }}>
            {writeError}
          </p>
        )}

        <section className="rounded-lg border border-line bg-surface mb-[18px]" data-testid="calendar-block">
          <div className="p-[2px_17px_6px]">

            {/* Who can book */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-who-can-book">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel htmlFor="calendar-who-can-book" className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>Who can book with you</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>Anyone, or only people already on your books.</FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px] gap-2">
                <NativeSelect
                  id="calendar-who-can-book"
                  value={keys["booking.who_can_book"] ?? ""}
                  disabled={savingKey === "booking.who_can_book"}
                  data-testid="calendar-who-can-book"
                  onChange={(e) => save("booking.who_can_book", e.currentTarget.value)}
                >
                  {WHO_CAN_BOOK_OPTIONS.map((opt) => (
                    <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </FieldContent>
            </div>

            {/* How far ahead */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-notice">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel htmlFor="calendar-notice-hours" className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>How far ahead people can book</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>Past this, your calendar simply doesn't open.</FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px] flex-wrap">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    id="calendar-notice-hours"
                    value={noticeHours}
                    disabled={savingKey === "booking.notice_minutes"}
                    data-testid="calendar-notice-hours"
                    onChange={(e) => saveNoticeHours(e.currentTarget.value)}
                    style={{ width: "72px" }}
                  />
                  <span className="text-sm" style={{ color: "var(--ink-muted)" }}>hours notice</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    id="calendar-window-days"
                    value={keys["booking.window_days"] ?? ""}
                    disabled={savingKey === "booking.window_days"}
                    data-testid="calendar-window-days"
                    onChange={(e) => save("booking.window_days", Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))}
                    style={{ width: "72px" }}
                  />
                  <span className="text-sm" style={{ color: "var(--ink-muted)" }}>days ahead</span>
                </div>
              </FieldContent>
            </div>

            {/* Gaps between sessions */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-gaps">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel htmlFor="calendar-gap-before" className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>Gaps between sessions</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>Applied on top of anything a service sets for itself.</FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px] flex-wrap">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="240"
                    step="1"
                    id="calendar-gap-before"
                    value={keys["booking.gap_before_minutes"] ?? ""}
                    disabled={savingKey === "booking.gap_before_minutes"}
                    data-testid="calendar-gap-before"
                    onChange={(e) => save("booking.gap_before_minutes", Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
                    style={{ width: "72px" }}
                  />
                  <span className="text-sm" style={{ color: "var(--ink-muted)" }}>min before</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="240"
                    step="1"
                    id="calendar-gap-after"
                    value={keys["booking.gap_after_minutes"] ?? ""}
                    disabled={savingKey === "booking.gap_after_minutes"}
                    data-testid="calendar-gap-after"
                    onChange={(e) => save("booking.gap_after_minutes", Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
                    style={{ width: "72px" }}
                  />
                  <span className="text-sm" style={{ color: "var(--ink-muted)" }}>min after</span>
                </div>
              </FieldContent>
            </div>

            {/* Your working hours */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-hours">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>Your working hours</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>Bookable times sit inside these, never outside.</FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2">
                {!hostId ? (
                  <span className="text-sm" data-testid="calendar-hours-unavailable" style={{ color: "var(--ink)" }}>
                    Not available yet — no signed-in coach id has reached this screen.
                  </span>
                ) : (
                  <>
                    <span className="text-sm" data-testid="calendar-hours-summary" style={{ color: "var(--ink)" }}>
                      {hoursSummary}
                    </span>
                    <Button variant="link" size="sm" data-testid="calendar-hours-edit" onClick={() => setHoursDialogOpen(true)}>
                      Edit
                    </Button>
                  </>
                )}
              </FieldContent>
            </div>

            {/* Google Calendar */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-google">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>Google Calendar</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
                  Sessions booked here appear in your Google calendar. Events you create in Google do not block bookings here yet.
                </FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px] gap-2">
                {googleConnection ? (
                  <>
                    <span className="text-sm" data-testid="calendar-google-account" style={{ color: "var(--ink)" }}>
                      Connected as {googleConnection.externalAccount}
                    </span>
                    {googleConnection.status === "active" ? (
                      <Badge data-testid="calendar-google-state" className="h-5 text-xs font-medium px-2.5 py-0.5" style={{ background: "var(--chip-ok-bg)", color: "var(--chip-ok-ink)" }}>
                        In sync
                      </Badge>
                    ) : (
                      <Badge data-testid="calendar-google-state" className="h-5 text-xs font-medium px-2.5 py-0.5" style={{ background: "var(--chip-bad-bg)", color: "var(--chip-bad-ink)" }}>
                        {googleConnection.lastError ?? "Needs attention"}
                      </Badge>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm" data-testid="calendar-google-account" style={{ color: "var(--ink)" }}>
                      Not connected
                    </span>
                    <Button size="sm" data-testid="calendar-google-connect" onClick={() => { window.location.assign("/api/engagements/calendar/connect/google"); }}>
                      Connect
                    </Button>
                  </>
                )}
              </FieldContent>
            </div>

            {/* Let people pick who they see */}
            <div className="flex gap-5 items-start py-4 border-b border-line-soft last:border-b-0" data-testid="calendar-row-staff-choice">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <FieldLabel className="text-sm font-medium block" style={{ color: "var(--ink)", padding: 0 }}>Let people pick who they see</FieldLabel>
                <FieldDescription className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>Or let the system hand out whoever is free.</FieldDescription>
              </div>
              <FieldContent className="flex-1 max-w-[460px]">
                <div className="flex items-start gap-3 w-full">
                  <div className="flex-1">
                    <span className="text-sm block" style={{ color: "var(--ink)" }}>Show a choice of staff when booking</span>
                    <span className="text-xs block mt-0.75" style={{ color: "var(--ink-muted)" }}>Off means the first free person gets it.</span>
                  </div>
                  <Switch
                    checked={keys["booking.show_staff_choice"] ?? false}
                    disabled={savingKey === "booking.show_staff_choice"}
                    data-testid="calendar-staff-choice"
                    onCheckedChange={(v) => save("booking.show_staff_choice", v)}
                  />
                </div>
              </FieldContent>
            </div>

          </div>
        </section>
      </ScreenState>

      {hostId && (
        <HoursDialog open={hoursDialogOpen} onOpenChange={setHoursDialogOpen} hostId={hostId} onSaved={handleHoursSaved} />
      )}
    </div>
  );
}
