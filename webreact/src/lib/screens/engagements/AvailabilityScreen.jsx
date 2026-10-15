// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AvailabilityScreen — availability & limits screen for a coach or all staff
// Ported from webui/src/lib/screens/engagements/AvailabilityScreen.svelte:1-325
// Uses SideSheet archetype for the day-editor sheet at lines 306-324
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import AvailabilityScreenAvailabilityDaySheet from "./AvailabilityScreenAvailabilityDaySheet.jsx";

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

function label12(m) {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 && h < 24 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC"
  });
}

const NOTICE = [[0, "No notice"], [30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [720, "12 hours"], [1440, "1 day"], [2880, "2 days"]];
const INTERVAL = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const WINDOW = [7, 14, 30, 60, 90, 180, 365];

export default function AvailabilityScreen({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [hostId, setHostId] = useState(null);
  const [week, setWeek] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [limitError, setLimitError] = useState(null);

  const [day, setDay] = useState(null);
  const [daySaving, setDaySaving] = useState(false);
  const [dayError, setDayError] = useState(null);

  const [explain, setExplain] = useState({ date: "", time: "14:00", serviceId: "" });
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);

  const go = (href) => {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  };

  const load = async () => {
    setPhase("loading");
    setError(null);
    try {
      const q = hostId ? `?hostId=${encodeURIComponent(hostId)}` : "";
      const v = await request(`/api/engagements/availability/overview${q}`);
      setView(v);
      setHostId(v.hostId);
      const newWeek = ORDER.map((dow) => {
        const d = v.week.find((x) => x.dayOfWeek === dow);
        return {
          dayOfWeek: dow,
          ranges: (d?.ranges ?? []).map((r) => ({
            start: toHHMM(r.startMinute),
            end: toHHMM(r.endMinute)
          }))
        };
      });
      setWeek(newWeek);
      setDirty(false);
      setPhase("ready");

      // Set default service if needed
      if (!explain.serviceId && v.services?.length) {
        setExplain(e => ({ ...e, serviceId: v.services[0].id }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) }
        );
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addRange = (dayIdx) => {
    const d = week[dayIdx];
    const last = d.ranges[d.ranges.length - 1];
    const newRanges = [...d.ranges];
    if (!last) {
      newRanges.push({ start: "09:00", end: "17:00" });
    } else {
      const s = Math.min(toMin(last.end) + 60, 22 * 60);
      newRanges.push({ start: toHHMM(s), end: toHHMM(Math.min(s + 120, 23 * 60 + 45)) });
    }
    const newWeek = [...week];
    newWeek[dayIdx] = { ...d, ranges: newRanges };
    setWeek(newWeek);
    setDirty(true);
  };

  const removeRange = (dayIdx, rangeIdx) => {
    const d = week[dayIdx];
    const newRanges = d.ranges.filter((_, i) => i !== rangeIdx);
    const newWeek = [...week];
    newWeek[dayIdx] = { ...d, ranges: newRanges };
    setWeek(newWeek);
    setDirty(true);
  };

  const updateRange = (dayIdx, rangeIdx, field, value) => {
    const d = week[dayIdx];
    const newRanges = [...d.ranges];
    newRanges[rangeIdx] = { ...newRanges[rangeIdx], [field]: value };
    const newWeek = [...week];
    newWeek[dayIdx] = { ...d, ranges: newRanges };
    setWeek(newWeek);
    setDirty(true);
  };

  const copyToWorkingDays = (dayIdx) => {
    const sourceDay = week[dayIdx];
    const newWeek = week.map((d, i) => {
      if (i === dayIdx || d.ranges.length === 0) return d;
      return { ...d, ranges: sourceDay.ranges.map((r) => ({ ...r })) };
    });
    setWeek(newWeek);
    setDirty(true);
  };

  const saveWeek = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await request("/api/engagements/hours", {
        method: "POST",
        body: {
          hostId,
          days: week.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            ranges: d.ranges.map((r) => ({
              startMinute: toMin(r.start),
              endMinute: toMin(r.end)
            }))
          }))
        },
      });
      setSaved(true);
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const setPractice = async (key, value) => {
    setLimitError(null);
    try {
      await api.setSetting({ key, value });
      await load();
    } catch (err) {
      setLimitError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  };

  const setCap = async (v) => {
    setLimitError(null);
    try {
      await request("/api/engagements/availability/limit", {
        method: "POST",
        body: { hostId, maxPerDay: v === "" ? null : Number(v) }
      });
      await load();
    } catch (err) {
      setLimitError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  };

  const openDay = (o = null) => {
    setDayError(null);
    if (o) {
      setDay({
        onDate: o.onDate,
        isAvailable: o.isAvailable,
        start: o.startMinute != null ? toHHMM(o.startMinute) : "09:00",
        end: o.endMinute != null ? toHHMM(o.endMinute) : "17:00",
        reason: o.reason ?? ""
      });
    } else {
      setDay({
        onDate: "",
        isAvailable: true,
        start: "09:00",
        end: "17:00",
        reason: ""
      });
    }
  };

  const saveDay = async () => {
    if (daySaving) return;
    setDaySaving(true);
    setDayError(null);
    try {
      await api.setDateOverride({
        hostId,
        onDate: day.onDate,
        isAvailable: day.isAvailable,
        ...(day.isAvailable ? { startMinute: toMin(day.start), endMinute: toMin(day.end) } : {}),
        reason: day.reason || undefined
      });
      setDay(null);
      await load();
    } catch (err) {
      setDayError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setDaySaving(false);
    }
  };

  const removeDay = async (onDate) => {
    try {
      await request("/api/engagements/date-overrides/remove", {
        method: "POST",
        body: { hostId, onDate }
      });
      await load();
    } catch (err) {
      setLimitError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  };

  const ask = async () => {
    if (!explain.date || !explain.time) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const p = new URLSearchParams({ hostId, date: explain.date, time: explain.time });
      if (explain.serviceId) p.set("serviceId", explain.serviceId);
      const a = await request(`/api/engagements/availability/explain?${p}`);
      setAnswer(a);
    } catch (err) {
      setAskError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex flex-col w-full" data-testid="availability-page">
      <div className="flex items-end gap-3 mb-4.5">
        <div className="flex-1">
          <h1 className="m-0 text-title font-medium tracking-tight text-ink">
            Availability
          </h1>
          <p className="mt-1.25 m-0 text-ui text-mute">
            When people can book {view?.hosts ? `this coach` : "you"}. Changes apply from today; sessions already booked stay put.
          </p>
        </div>
        {view?.hosts && (
          <select
            value={hostId}
            onChange={(e) => {
              setHostId(e.target.value);
              load();
            }}
            className="px-2.5 py-2.25 border border-line rounded-control bg-surface text-ink text-ui"
            data-testid="availability-host"
          >
            {view.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.displayName}
              </option>
            ))}
          </select>
        )}
        <Button
          onClick={saveWeek}
          disabled={!dirty || saving}
          data-testid="availability-save"
        >
          {saving ? "Saving…" : saved && !dirty ? "Saved" : "Save the week"}
        </Button>
      </div>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={go}
        testIds={{
          loading: "availability-loading",
          error: "availability-error",
          denied: "availability-denied"
        }}
      >
        {view && (
          <div className="flex flex-col">
            {/* Limits strip */}
            <div className="flex bg-surface border border-line rounded-card mb-4.5" data-testid="availability-limits">
              <div className="flex-1 px-4 py-3 border-l border-hair first:border-l-0">
                <div className="text-xs text-mute">Earliest someone can book</div>
                <select
                  value={view.limits.minimumNoticeMinutes}
                  onChange={(e) => setPractice("booking.notice_minutes", Number(e.currentTarget.value))}
                  className="mt-0.75 border-0 bg-none text-ui font-medium text-ink p-0 cursor-pointer"
                >
                  {NOTICE.map(([v, l]) => (
                    <option key={v} value={v}>{l} ahead</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 px-4 py-3 border-l border-hair">
                <div className="text-xs text-mute">Start times</div>
                <select
                  value={view.limits.startIntervalMinutes}
                  onChange={(e) => setPractice("booking.start_interval_minutes", Number(e.currentTarget.value))}
                  className="mt-0.75 border-0 bg-none text-ui font-medium text-ink p-0 cursor-pointer"
                  data-testid="availability-interval"
                >
                  {INTERVAL.map((v) => (
                    <option key={v} value={v}>Every {v} minutes</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 px-4 py-3 border-l border-hair">
                <div className="text-xs text-mute">Most sessions in a day</div>
                <select
                  value={view.limits.maxPerDay ?? ""}
                  onChange={(e) => setCap(e.currentTarget.value)}
                  className="mt-0.75 border-0 bg-none text-ui font-medium text-ink p-0 cursor-pointer"
                  data-testid="availability-cap"
                >
                  <option value="">No limit</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 px-4 py-3 border-l border-hair">
                <div className="text-xs text-mute">Furthest ahead</div>
                <select
                  value={view.limits.bookingWindowDays}
                  onChange={(e) => setPractice("booking.window_days", Number(e.currentTarget.value))}
                  className="mt-0.75 border-0 bg-none text-ui font-medium text-ink p-0 cursor-pointer"
                >
                  {WINDOW.map((v) => (
                    <option key={v} value={v}>{v} days</option>
                  ))}
                </select>
              </div>
            </div>
            {limitError && <p className="text-xs text-bad mb-3" role="alert">{limitError}</p>}

            <div className="flex gap-5.5 items-start">
              <div className="flex-1">
                {/* Week grid */}
                <div className="bg-surface border border-line rounded-card overflow-hidden mb-4.5" data-testid="availability-week">
                  {week.map((d, dayIdx) => (
                    <div
                      key={d.dayOfWeek}
                      className="flex items-center gap-3.5 min-h-13 py-2 px-4 border-b border-hair last:border-b-0"
                      data-testid={`availability-day-${d.dayOfWeek}`}
                    >
                      <div className={`w-23 flex-shrink-0 text-ui font-medium ${d.ranges.length === 0 ? "text-mute font-normal" : "text-ink"}`}>
                        {NAMES[d.dayOfWeek]}
                      </div>
                      <div className="flex-1 flex flex-wrap gap-2 items-center">
                        {d.ranges.length === 0 && <span className="text-xs text-mute">Not working</span>}
                        {d.ranges.map((r, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-xs text-mute">break</span>}
                            <span className="inline-flex items-center gap-1.5 h-8.5 px-2 border border-line rounded-control text-xs font-variant-numeric tabular-nums">
                              <input
                                type="time"
                                step="300"
                                value={r.start}
                                onChange={(e) => updateRange(dayIdx, i, "start", e.target.value)}
                                className="border-0 bg-none text-ink p-0 text-xs"
                                aria-label={`${NAMES[d.dayOfWeek]} from`}
                              />
                              <span>–</span>
                              <input
                                type="time"
                                step="300"
                                value={r.end}
                                onChange={(e) => updateRange(dayIdx, i, "end", e.target.value)}
                                className="border-0 bg-none text-ink p-0 text-xs"
                                aria-label={`${NAMES[d.dayOfWeek]} to`}
                              />
                              <button
                                type="button"
                                onClick={() => removeRange(dayIdx, i)}
                                className="border-0 bg-none text-mute cursor-pointer text-base leading-none"
                                aria-label="Remove these hours"
                              >
                                ×
                              </button>
                            </span>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addRange(dayIdx)}
                          className="text-xs text-brand bg-none border-0 p-0 cursor-pointer whitespace-nowrap"
                        >
                          + {d.ranges.length ? "Add hours after a break" : "Add hours"}
                        </button>
                      </div>
                      {d.ranges.length > 0 && (
                        <button
                          type="button"
                          onClick={() => copyToWorkingDays(dayIdx)}
                          className="text-xs text-brand bg-none border-0 p-0 cursor-pointer whitespace-nowrap"
                          title="Copy these hours to every day you work"
                        >
                          Copy to working days
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {saveError && <p className="text-xs text-bad mb-3" role="alert">{saveError}</p>}

                {/* Days that are different */}
                <section className="bg-surface border border-line rounded-card mb-4.5" data-testid="availability-exceptions">
                  <div className="flex items-center gap-2.5 px-4 py-3 border-b border-hair">
                    <b className="text-ui font-medium">Days that are different</b>
                    <span className="flex-1"></span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDay()}
                      data-testid="availability-change-day"
                    >
                      Change one day
                    </Button>
                  </div>
                  <div>
                    {view.overrides.map((o) => (
                      <div key={o.onDate} className="flex items-center gap-3.5 h-10 px-4 border-b border-hair last:border-b-0 text-ui">
                        <span className="w-37.5 font-medium text-ink">{fmtDate(o.onDate)}</span>
                        <span className="flex-1 text-ink-2">
                          {o.isAvailable ? `${label12(o.startMinute)} – ${label12(o.endMinute)} only` : "Not working"}
                          {o.reason ? ` — ${o.reason}` : ""}
                        </span>
                        <span className={`inline-flex items-center h-5.25 px-2.25 rounded-sm text-xs font-medium ${
                          o.isAvailable ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn"
                        }`}>
                          {o.isAvailable ? "Custom hours" : "Closed"}
                        </span>
                        <button
                          type="button"
                          onClick={() => openDay(o)}
                          className="text-xs text-brand bg-none border-0 p-0 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDay(o.onDate)}
                          className="text-xs text-brand bg-none border-0 p-0 cursor-pointer"
                        >
                          Back to usual
                        </button>
                      </div>
                    ))}
                    {view.timeOff.map((t) => (
                      <div key={t.id} className="flex items-center gap-3.5 h-10 px-4 border-b border-hair last:border-b-0 text-ui">
                        <span className="w-37.5 font-medium text-ink">
                          {t.startsOn === t.endsOn ? fmtDate(t.startsOn) : `${fmtDate(t.startsOn)} – ${fmtDate(t.endsOn)}`}
                        </span>
                        <span className="flex-1 text-ink-2">
                          Time off{t.reason ? ` — ${t.reason}` : ""}
                        </span>
                        <span className="inline-flex items-center h-5.25 px-2.25 rounded-sm text-xs font-medium bg-mute/10 text-mute">
                          Time off
                        </span>
                        <button
                          type="button"
                          onClick={() => go("/people/scheduling")}
                          className="text-xs text-brand bg-none border-0 p-0 cursor-pointer"
                        >
                          In Scheduling
                        </button>
                      </div>
                    ))}
                    {view.overrides.length === 0 && view.timeOff.length === 0 && (
                      <div className="py-5.5 px-4 text-ui text-mute text-center">
                        No days are different. Every week runs as above.
                      </div>
                    )}
                  </div>
                </section>
              </div>

              {/* Why isn't a time showing */}
              <aside className="w-80 flex-shrink-0">
                <section className="bg-surface border border-line rounded-card" data-testid="availability-why">
                  <div className="px-4 py-3 border-b border-hair">
                    <b className="text-ui font-medium">Why isn't a time showing?</b>
                  </div>
                  <div className="flex flex-col gap-2 p-3.5">
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={explain.date}
                        onChange={(e) => setExplain({ ...explain, date: e.target.value })}
                        aria-label="Date"
                        className="flex-1 px-2.25 py-2 border border-line rounded-control text-ui text-ink bg-surface"
                        data-testid="availability-why-date"
                      />
                      <input
                        type="time"
                        step="300"
                        value={explain.time}
                        onChange={(e) => setExplain({ ...explain, time: e.target.value })}
                        aria-label="Time"
                        className="flex-1 px-2.25 py-2 border border-line rounded-control text-ui text-ink bg-surface"
                        data-testid="availability-why-time"
                      />
                    </div>
                    {view.services?.length > 0 && (
                      <select
                        value={explain.serviceId}
                        onChange={(e) => setExplain({ ...explain, serviceId: e.target.value })}
                        aria-label="Service"
                        className="px-2.25 py-2 border border-line rounded-control text-ui text-ink bg-surface"
                      >
                        {view.services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {s.durationMinutes} min
                          </option>
                        ))}
                      </select>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={ask}
                      disabled={!explain.date || asking}
                      data-testid="availability-why-ask"
                    >
                      {asking ? "Checking…" : "Check"}
                    </Button>
                    {answer && (
                      <div className="bg-brand-soft rounded-control px-3.5 py-3 text-xs text-ink leading-relaxed" data-testid="availability-why-answer">
                        <b>
                          {answer.offered ? `${explain.time} is offered.` : `${explain.time} isn't offered.`}
                        </b>
                        {!answer.offered && answer.detail && <div className="mt-1">{answer.detail}</div>}
                        {!answer.offered && answer.nextOffered && (
                          <div className="mt-1">The next start that day is {answer.nextOffered}.</div>
                        )}
                      </div>
                    )}
                    {askError && <p className="text-xs text-bad" role="alert">{askError}</p>}
                    <p className="text-xs text-mute leading-relaxed m-0 mt-2">
                      The answer is always one of: outside the hours, a day that is different, time off, already booked, blocked time, too soon, the day is full, or not on a start time.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        )}
      </ScreenState>

      {/* Day editor sheet - rendered conditionally */}
      {day && (
        <AvailabilityScreenAvailabilityDaySheet
          error={error}
          day={day}
          daySaving={daySaving}
          dayError={dayError}
          saveDay={saveDay}
          onCancel={() => setDay(null)}
        />
      )}
    </div>
  );
}
