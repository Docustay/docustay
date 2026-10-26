// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BOOK A SESSION — the right-hand sheet, openable from anywhere (R3.005, BookSessionDialog.svelte).
// ★ Pickers load on open (clients, services, team, and who is signed in); slots reload on host/date/service change.
// ★ Four different things can be true under "Date and time", four sentences — no host yet · loading · none free ·
//   here they are. A 409 that is not a capacity refusal re-reads the slots and names the next free time.
// ★ The booking goes through useWrite("createBooking"): hidden for a viewer who may not book (renders nothing).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { Button } from "@/lib/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select";
import { Switch } from "@/lib/components/ui/switch";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { Input } from "@/lib/components/ui/input";

const LOCATION_KIND_OPTIONS = [
  { value: "", label: "Not specified" }, { value: "in_person", label: "In person" }, { value: "video", label: "Video" },
  { value: "phone", label: "Phone" }, { value: "other", label: "Other" },
];
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// F107: slots arrive as "13:00"; the rest of the app says "1:00 PM".
const to12h = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
};
const Note = ({ testId, role, bad = false, children }) => <p className={`m-0 text-meta ${bad ? "text-bad" : "text-mute"}`} data-testid={testId} role={role}>{children}</p>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ BOOKING OVERHAUL, 29 Sep 2026 — RECURRING SESSIONS. The cadence vocabulary matches
//   src/booking/createRecurringBookings.mjs's own closed set exactly: "every N weeks" (1-52) or
//   specific weekdays, every week — never a third pattern the backend would refuse.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const REPEAT_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "every_1_weeks", label: "Every week" },
  { value: "every_2_weeks", label: "Every 2 weeks" },
  { value: "weekdays", label: "On specific days" },
];
const WEEKDAY_OPTIONS = [
  { code: "MO", label: "Mon" }, { code: "TU", label: "Tue" }, { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" }, { code: "FR", label: "Fri" }, { code: "SA", label: "Sat" }, { code: "SU", label: "Sun" },
];

export default function BookSessionDialog({ open: openProp = false, onOpenChange = null, onBooked = null }) {
  const [open, setOpen] = useBindableOpen(openProp, onOpenChange);
  const book = useWrite("createBooking");
  const bookRecurring = useWrite("POST /api/engagements/bookings/recurring");
  const [date, setDate] = useState(todayISO());
  // ★ BOOKING OVERHAUL, 29 Sep 2026 — recurring sessions.
  const [repeatMode, setRepeatMode] = useState("none");
  const [repeatWeekdays, setRepeatWeekdays] = useState(new Set());
  const [endMode, setEndMode] = useState("count");
  const [endCount, setEndCount] = useState("12");
  const [endDate, setEndDate] = useState("");
  const [recurringSummary, setRecurringSummary] = useState(null);
  const [pickers, setPickers] = useState({ clients: [], services: [], hosts: [], meId: null, meName: null });
  const [pickersLoading, setPickersLoading] = useState(false);
  const [pickersError, setPickersError] = useState(null);
  const [personId, setPersonId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [withHostId, setWithHostId] = useState("");
  const [locationKind, setLocationKind] = useState("");
  const [locationDetail, setLocationDetail] = useState("");
  const [selectedTimeIso, setSelectedTimeIso] = useState("");
  const [tellClient, setTellClient] = useState(true);
  const [slots, setSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(null);
  const [problem, setProblem] = useState(null);
  const [slotTaken, setSlotTaken] = useState(null);
  const [hold, setHold] = useState(null);
  const busy = book.busy || bookRecurring.busy;

  // F107: no pronoun — "Tell them" until someone is chosen, then their first name.
  const clientFirstName = (() => {
    const c = pickers.clients.find((x) => x.id === personId);
    const first = String(c?.display_name ?? c?.name ?? "").trim().split(/\s+/)[0];
    return first || "them";
  })();

  const resolvedHostId = withHostId || pickers.meId || "";
  const { clients, services, hosts } = pickers;
  const selectedSlot = (slots?.slots ?? []).find((s) => s.startsAt === selectedTimeIso) ?? null;
  const host = hosts.find((h) => h.id === withHostId);
  const hostLabel = withHostId ? host?.display_name ?? host?.name ?? null : pickers.meName;
  const repeatValid = repeatMode === "none"
    || ((repeatMode !== "weekdays" || repeatWeekdays.size > 0)
        && (endMode === "count" ? Number(endCount) >= 1 : Boolean(endDate)));
  const canSubmit = Boolean(personId) && Boolean(serviceId) && Boolean(selectedSlot) && !busy && !pickersLoading && repeatValid;

  useEffect(() => {
    if (!open) return undefined;
    setProblem(null); setSlotTaken(null); setHold(null); setPickersError(null); setPickersLoading(true);
    let live = true;
    (async () => {
      try {
        const [c, s, t, nav] = await Promise.all([api.view("/people/clients"), api.view("/items/services"), api.view("/people/team"), api.nav()]);
        if (live) setPickers({ clients: c?.data?.rows ?? [], services: s?.data?.rows ?? [], hosts: t?.data?.rows ?? [], meId: nav?.me?.appUserId ?? null, meName: nav?.me?.displayName ?? null });
      } catch (err) { if (live) setPickersError(err); }
      finally { if (live) setPickersLoading(false); }
    })();
    return () => { live = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !resolvedHostId || !date) { setSlots(null); return undefined; }
    let live = true;
    setSlotsLoading(true); setSlotsError(null); setSelectedTimeIso("");
    (async () => {
      try { const r = await api.slots({ hostId: resolvedHostId, date, serviceId: serviceId || null }); if (live) setSlots(r); }
      catch (err) { if (live) { setSlotsError(err); setSlots(null); } }
      finally { if (live) setSlotsLoading(false); }
    })();
    return () => { live = false; };
  }, [open, resolvedHostId, date, serviceId]);

  const offerNextAfterConflict = async () => {
    try {
      const r = await api.slots({ hostId: resolvedHostId, date, serviceId: serviceId || null });
      setSlots(r);
      const next = (r.slots ?? [])[0] ?? null;
      setSlotTaken(next ? `That slot went while this was open — the next free is ${to12h(next.localTime)}.` : "That slot went while this was open, and nothing else is free that day.");
      setSelectedTimeIso("");
    } catch (err) { setProblem(err); }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setProblem(null); setSlotTaken(null); setHold(null); setRecurringSummary(null);
    const common = {
      hostId: resolvedHostId, serviceId, personId,
      locationKind: locationKind || undefined, locationDetail: locationDetail.trim() ? locationDetail.trim() : undefined, tellClient,
    };
    try {
      if (repeatMode === "none") {
        const result = await book.run({
          ...common, startsAt: selectedSlot.startsAt, endsAt: selectedSlot.endsAt,
        });
        onBooked?.();
        if (result?.state === "pending_consent") setHold("Booked, pending parent's consent — it's on hold until they respond.");
        else setOpen(false);
        return;
      }

      // ★ BOOKING OVERHAUL, 29 Sep 2026 — a recurring series. The cadence string matches
      //   src/booking/createRecurringBookings.mjs's own closed vocabulary exactly.
      const recurrenceCadence = repeatMode === "weekdays"
        ? `weekdays:${[...repeatWeekdays].join(",")}`
        : repeatMode; // "every_1_weeks" / "every_2_weeks" already match the backend's own shape
      const recurrenceEnd = endMode === "count"
        ? { afterCount: Number(endCount) }
        : { byDate: endDate };

      // ★ `bookRecurring` is a RAW "METHOD /path" write (no api.js method registered for it), and
      //   write.js's send() for that form expects `{ body }`, not the fields directly — unlike
      //   `book.run(...)` above, which calls the named api.js method that wraps its own body.
      const result = await bookRecurring.run({
        body: {
          ...common, startsAt: selectedSlot.startsAt, endsAt: selectedSlot.endsAt,
          inviteeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          recurrenceCadence, recurrenceEnd,
        },
      });
      onBooked?.();
      const n = result?.created?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      setRecurringSummary(
        skipped > 0
          ? `Booked ${n} session${n === 1 ? "" : "s"} — ${skipped} could not be booked (a time was already taken).`
          : `Booked ${n} session${n === 1 ? "" : "s"}.`);
      if (skipped === 0) setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.error?.detail?.field !== "capacity") await offerNextAfterConflict();
      else setProblem(err);
    }
  };

  if (!open) return null;
  const footer = (
    <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
      <Button type="button" variant="outline" data-testid="book-cancel" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      {!book.hidden ? <Button type="submit" data-testid="book-submit" disabled={busy || !canSubmit}>{busy ? "Booking…" : "Book it"}</Button> : null}
    </footer>
  );

  let body;
  if (pickersLoading) {
    body = <div className="flex flex-col gap-3 pt-4" data-testid="book-pickers-loading"><Skeleton className="h-(--size-control-field)" /><Skeleton className="h-(--size-control-field)" /><Skeleton className="h-(--size-control-field)" /></div>;
  } else if (pickersError) {
    body = pickersError instanceof ApiError && pickersError.status === 403
      ? <p className="mt-4 text-meta text-bad" data-testid="book-denied" role="alert">{pickersError.message}</p>
      : <ErrorPanel error={pickersError} subject="This" variant="band" testId="book-pickers-error" />;
  } else if (services.length === 0) {
    body = <EmptyState kind="blocked" testId="book-empty-services" icon="IconCalendarPlus" headline="No services are bookable yet" line="A session needs a service before it can be booked." action={{ label: "Add a service first", href: "/items/services" }} />;
  } else {
    body = (
      <>
        <SheetSection title="Who and what">
          <SheetRow label="Who" htmlFor="book-who" required>
            <Combobox id="book-who" testId="book-who" options={clients.map((c) => ({ value: c.id, label: c.display_name ?? c.name ?? c.id }))} value={personId} onValueChange={setPersonId} placeholder="Search people" emptyText="No clients yet." />
          </SheetRow>
          <SheetRow label="What" htmlFor="book-what" required>
            <NativeSelect id="book-what" data-testid="book-what" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <NativeSelectOption value="">Choose a service</NativeSelectOption>
              {services.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.name}{s.duration_minutes ? ` — ${s.duration_minutes} min` : ""}</NativeSelectOption>)}
            </NativeSelect>
          </SheetRow>
          <SheetRow label="With" htmlFor="book-with" optional>
            <NativeSelect id="book-with" data-testid="book-with" value={withHostId} onChange={(e) => setWithHostId(e.target.value)}>
              <NativeSelectOption value="">Anyone free</NativeSelectOption>
              {hosts.map((h) => <NativeSelectOption key={h.id} value={h.id}>{h.display_name ?? h.name}</NativeSelectOption>)}
            </NativeSelect>
          </SheetRow>
          <SheetRow label="Where" htmlFor="book-where" optional>
            <div className="flex flex-col gap-2">
              <NativeSelect id="book-where" data-testid="book-where" value={locationKind} onChange={(e) => setLocationKind(e.target.value)}>
                {LOCATION_KIND_OPTIONS.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}
              </NativeSelect>
              {locationKind === "in_person" || locationKind === "other"
                ? <Input data-testid="book-where-detail" placeholder="Where, exactly?" value={locationDetail} onChange={(e) => setLocationDetail(e.target.value)} autoComplete="off" />
                : null}
              {/* ★ Video sessions store their Zoom/Meet link in the same `location_detail` column —
                  it already means "the detail of the location", and a URL is exactly that for a video
                  session. No new column, and the confirmation email already renders this field. */}
              {locationKind === "video"
                ? <Input data-testid="book-where-video-link" type="url" placeholder="Zoom or Google Meet link" value={locationDetail} onChange={(e) => setLocationDetail(e.target.value)} autoComplete="off" />
                : null}
            </div>
          </SheetRow>
        </SheetSection>
        <SheetSection title="When">
          <SheetRow label="Date and time" htmlFor="book-date" required>
            <div className="flex flex-col gap-2">
              <DatePicker id="book-date" testId="book-date" value={date} onValueChange={setDate} />
              {!resolvedHostId ? <Note testId="book-no-host">Choose who this is with, or wait a moment while we check who's signed in.</Note>
                : slotsLoading ? <Note testId="book-slots-loading" role="status">Loading times…</Note>
                  : slotsError ? <Note testId="book-slots-error" role="alert" bad>{slotsError.message}</Note>
                    : slots && (slots.slots ?? []).length === 0 ? <Note testId="book-no-slots">No free times on this date. Check availability under Engagements → Online booking.</Note>
                      : slots ? (
                        <div className="flex flex-col gap-1.5" data-testid="book-slots">
                          {slots.zone_detail ? <Note testId="book-zone">{slots.zone_detail}</Note> : null}
                          <NativeSelect data-testid="book-time" value={selectedTimeIso} onChange={(e) => setSelectedTimeIso(e.target.value)}>
                            <NativeSelectOption value="">Choose a time</NativeSelectOption>
                            {(slots.slots ?? []).map((s) => <NativeSelectOption key={s.startsAt} value={s.startsAt}>{to12h(s.localTime)}</NativeSelectOption>)}
                          </NativeSelect>
                        </div>
                      ) : null}
            </div>
          </SheetRow>
          {selectedSlot ? (
            <p className="my-2 text-meta text-ink-2" data-testid="book-availability-sentence">
              <strong className="font-medium text-ink">{hostLabel ?? "They"} is free then.</strong> Nothing else is booked, it's inside their hours, and the buffer after doesn't clash with anything.
            </p>
          ) : null}
          <SheetRow label="Repeats" htmlFor="book-repeat" optional>
            <div className="flex flex-col gap-2">
              <NativeSelect id="book-repeat" data-testid="book-repeat" value={repeatMode} onChange={(e) => setRepeatMode(e.target.value)}>
                {REPEAT_OPTIONS.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}
              </NativeSelect>
              {repeatMode === "weekdays" ? (
                <div className="flex flex-wrap gap-1.5" data-testid="book-repeat-weekdays">
                  {WEEKDAY_OPTIONS.map((w) => {
                    const checked = repeatWeekdays.has(w.code);
                    return (
                      <button
                        key={w.code}
                        type="button"
                        data-testid={`book-repeat-weekday-${w.code}`}
                        aria-pressed={checked}
                        onClick={() => setRepeatWeekdays((prev) => {
                          const next = new Set(prev);
                          if (next.has(w.code)) next.delete(w.code); else next.add(w.code);
                          return next;
                        })}
                        className={`rounded-full border px-2.5 py-1 text-caption ${checked ? "border-brand bg-brand text-brand-fg" : "border-line text-ink-2"}`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {repeatMode !== "none" ? (
                <div className="flex items-center gap-2">
                  <NativeSelect data-testid="book-repeat-end-mode" value={endMode} onChange={(e) => setEndMode(e.target.value)} className="w-auto">
                    <NativeSelectOption value="count">After</NativeSelectOption>
                    <NativeSelectOption value="date">Until</NativeSelectOption>
                  </NativeSelect>
                  {endMode === "count" ? (
                    <>
                      <Input
                        data-testid="book-repeat-end-count" type="number" min="1" max="104" className="w-20"
                        value={endCount} onChange={(e) => setEndCount(e.target.value)}
                      />
                      <span className="text-caption text-mute">sessions</span>
                    </>
                  ) : (
                    <DatePicker id="book-repeat-end-date" testId="book-repeat-end-date" value={endDate} onValueChange={setEndDate} />
                  )}
                </div>
              ) : null}
            </div>
          </SheetRow>
          <SheetRow label={`Tell ${clientFirstName}`} htmlFor="book-tell">
            <div className="flex items-center gap-3">
              <span className="flex flex-1 flex-col text-control text-ink">Send a confirmation now<span className="text-caption text-mute">And a reminder the day before, by email.</span></span>
              <Switch id="book-tell" data-testid="book-tell" checked={tellClient} onCheckedChange={setTellClient} />
            </div>
          </SheetRow>
        </SheetSection>
        {slotTaken ? <Note testId="book-slot-taken" role="alert" bad>{slotTaken}</Note> : null}
        {hold ? <Note testId="book-hold" role="status">{hold}</Note> : null}
        {recurringSummary ? <Note testId="book-recurring-summary" role="status">{recurringSummary}</Note> : null}
        {problem ? <p className="m-0 text-meta text-bad" data-testid="book-problem" role="alert">{problem.message ?? String(problem)}{problem.requestId ? <><br /><span className="text-caption text-mute">Reference: {problem.requestId}</span></> : null}</p> : null}
      </>
    );
  }
  return (
    <SideSheet title="Book a session" testId="book-dialog" onCancel={() => setOpen(false)} onSave={submit} busy={busy} footer={footer} hideHeaderSave>
      {body}
    </SideSheet>
  );
}
