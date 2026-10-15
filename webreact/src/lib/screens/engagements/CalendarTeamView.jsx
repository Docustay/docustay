// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CalendarTeamView — team (day) view of calendar, showing who's free right now
// Ported from webui/src/lib/screens/engagements/CalendarTeamView.svelte:1-224
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo, Fragment } from "react";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";

export default function CalendarTeamView({
  data = null,
  phase = "ready",
  empty = null,
  error = null,
  reason = null,
  onNavigate = null,
  now = new Date(),
}) {
  const NUMBER_WORDS = [null, "one", "two", "three", "four", "five", "six",
    "seven", "eight", "nine", "ten", "eleven", "twelve"];

  function numberWord(n) {
    return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
  }

  const timezone = useMemo(() => data?.timezone ?? "UTC", [data]);
  const hosts = useMemo(() => data?.hosts ?? [], [data]);
  const todayISO = useMemo(() => wallClock(now, timezone)?.ymd ?? null, [now, timezone]);

  const weekdayName = useMemo(() => {
    if (!timezone) return "";
    return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(now);
  }, [timezone, now]);

  function clauseFor(host) {
    const name = host.displayName ?? "Someone";
    const s = host.status ?? {};
    switch (s.kind) {
      case "full": return `${name} is full`;
      case "gaps": return `${name} has ${numberWord(s.gaps)} gap${s.gaps === 1 ? "" : "s"}`;
      case "away": return `${name} is away`;
      case "free":
      default: return `${name} is wide open`;
    }
  }

  const summaryLine = useMemo(() => {
    if (hosts.length === 0) {
      return `${weekdayName}. Nobody is scheduled here yet.`;
    }
    return `${weekdayName}. ${hosts.map(clauseFor).join(", ")}.`;
  }, [hosts, weekdayName]);

  function statusLine(host) {
    const s = host.status ?? {};
    switch (s.kind) {
      case "full": return `Full — ${s.sessions} session${s.sessions === 1 ? "" : "s"}`;
      case "gaps": return `${s.gaps} gap${s.gaps === 1 ? "" : "s"}`;
      case "away": return s.awayUntil ? `Away until ${formatDate(s.awayUntil)}` : "Away";
      case "free":
      default: return "Wide open";
    }
  }

  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, d)));
  }

  const fromMinute = useMemo(
    () => Number.isInteger(data?.settings?.dayFromMinute) ? data.settings.dayFromMinute : 480,
    [data]
  );
  const toMinute = useMemo(
    () => Number.isInteger(data?.settings?.dayToMinute) ? data.settings.dayToMinute : 1080,
    [data]
  );

  const hourRows = useMemo(() => {
    const startHour = Math.floor(fromMinute / 60);
    const endHour = Math.ceil(toMinute / 60);
    const rows = [];
    for (let h = startHour; h < endHour; h++) rows.push(h);
    return rows;
  }, [fromMinute, toMinute]);

  function hourLabel(h) {
    if (h === 0) return "12am";
    if (h === 12) return "12pm";
    return h < 12 ? `${h}am` : `${h - 12}pm`;
  }

  const bookingsByHostHour = useMemo(() => {
    const m = new Map(); // `${hostId}:${hour}` -> booking[]
    for (const b of data?.bookings ?? []) {
      if (b.state === "cancelled") continue;
      const w = wallClock(b.startsAt, timezone);
      if (!w || w.ymd !== todayISO) continue;
      const key = `${b.hostId}:${w.hour}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(b);
    }
    return m;
  }, [data, timezone, todayISO]);

  function bookingsFor(hostId, hour) {
    return bookingsByHostHour.get(`${hostId}:${hour}`) ?? [];
  }

  return (
    <div className="w-full" data-testid="calendar-team">
      <ScreenState
        phase={phase}
        empty={empty}
        error={error}
        reason={reason}
        onNavigate={onNavigate}
        testIds={{
          loading: "calendar-team-loading",
          error: "calendar-team-error",
          denied: "calendar-team-denied",
          empty: "calendar-team-empty",
        }}
      >
        <div className="mb-4.5">
          <h1 className="m-0 text-page-title font-medium text-ink">Everyone</h1>
          <p className="m-0 mt-1.25 text-control text-mute" data-testid="calendar-team-summary">
            {summaryLine}
          </p>
        </div>

        <div
          className="grid w-full overflow-hidden rounded-card border border-line bg-surface max-[480px]:block max-[480px]:overflow-x-auto"
          data-testid="calendar-team-grid"
          style={{
            gridTemplateColumns: `62px repeat(${Math.max(hosts.length, 1)}, 1fr)`,
          }}
        >
          <div className="border-b border-line"></div>
          {hosts.map((host) => (
            <div key={host.id} className="flex h-11 flex-col justify-center border-b border-l border-hair pl-2.5" data-testid={`calendar-team-host-${host.id}`}>
              <b className="text-control font-medium text-ink">{host.displayName}</b>
              <span className="text-caption text-mute" data-testid={`calendar-team-status-${host.id}`}>{statusLine(host)}</span>
            </div>
          ))}

          {hourRows.map((h) => (
            <Fragment key={h}>
              <div className="h-13 pt-1 pr-2 text-right text-caption text-mute">{hourLabel(h)}</div>
              {hosts.map((host) => (
                <div key={`${host.id}-${h}`} className="relative h-13 border-b border-l border-hair">
                  {h === hourRows[0] && host.status?.kind === "away" ? (
                    <div
                      className="absolute inset-[3px_5px] overflow-hidden rounded-[7px] bg-mute-bg px-2 py-1.25 text-[11.5px] leading-tight text-mute"
                      data-testid={`calendar-team-away-${host.id}`}
                    >
                      <b className="block font-medium">Away</b>
                      {host.status.awayUntil ? `until ${formatDate(host.status.awayUntil)}` : ""}
                    </div>
                  ) : (
                    bookingsFor(host.id, h).map((b) => (
                      <div
                        key={b.id}
                        className="absolute inset-[3px_5px] overflow-hidden rounded-[7px] bg-brand-soft px-2 py-1.25 text-[11.5px] leading-tight text-brand"
                        data-testid={`calendar-team-ev-${b.id}`}
                      >
                        <b className="block font-medium">{b.who ?? "—"}</b>
                        {b.serviceName ?? ""}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </ScreenState>
    </div>
  );
}
