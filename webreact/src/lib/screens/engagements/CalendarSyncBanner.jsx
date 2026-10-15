// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.015 — CalendarSyncBanner. Ported from webui/src/lib/screens/engagements/CalendarSyncBanner.svelte.
// Shows when Google Calendar sync is broken, listing bookings created during the outage.
//
// ★★★ DOCTRINE 3 — INTENTIONAL TEXT DEPARTURE FROM THE FRAME.
// See the Svelte source for full context on why the description differs from the frame.
// The code uses: "Sessions booked here are no longer appearing in your Google calendar..."
// NOT the frame's version about two-way blocking behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function CalendarSyncBanner({
  /** The payload — { sync, bookings, timezone } at minimum */
  data = null,
  /** Navigate to a URL, or fallback to window.location.assign */
  onNavigate = null,
  /** Opens the booking record for one flagged row */
  onOpen = null,
  /** Injected so "N days ago" is deterministic in a test — defaults to the real clock */
  now = new Date(),
}) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const broken = data?.sync?.status === "broken";

  // Calculate days since sync broke
  const daysAgo = (() => {
    const since = data?.sync?.brokenSince ? new Date(data.sync.brokenSince) : null;
    if (!since || Number.isNaN(since.getTime())) return null;
    return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
  })();

  const daysAgoText = daysAgo === null ? "" : (daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`);

  // Filter bookings created during the sync outage
  const flagged = (() => {
    const since = data?.sync?.brokenSince ? new Date(data.sync.brokenSince) : null;
    if (!since) return [];
    return (data?.bookings ?? []).filter((b) => {
      if (b.source === "staff" || !b.createdAt) return false;
      const created = new Date(b.createdAt);
      return !Number.isNaN(created.getTime()) && created.getTime() >= since.getTime();
    });
  })();

  // Format time for a booking row
  function rowTime(b) {
    const tz = data?.timezone ?? "UTC";
    const dt = new Date(b.startsAt);
    if (Number.isNaN(dt.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    }).format(dt);
  }

  if (!broken) return null;

  return (
    <>
      <Alert
        className="mb-5 border-destructive bg-destructive/10 text-destructive"
        data-testid="calendar-sync-banner"
        role="alert"
      >
        <AlertTitle data-testid="calendar-sync-banner-title">
          Google Calendar stopped talking to us {daysAgoText}.
        </AlertTitle>
        <AlertDescription data-testid="calendar-sync-banner-body">
          Sessions booked here are no longer appearing in your Google calendar. Nothing already
          booked has changed.
          <button
            type="button"
            className="ml-1 underline hover:opacity-80"
            data-testid="calendar-sync-banner-reconnect"
            onClick={() => go("/settings/calendar")}
          >
            Reconnect it
          </button>
        </AlertDescription>
      </Alert>

      {flagged.length > 0 && (
        <div
          className="rounded-lg border border-line bg-surface"
          data-testid="calendar-sync-banner-flagged"
        >
          <div className="border-b border-line-soft px-4 py-3">
            <b>Booked while sync was down</b>
          </div>
          <div className="px-4 py-1.5">
            {flagged.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 border-b border-line-soft py-2.75 last:border-b-0 text-sm"
                data-testid={`calendar-sync-banner-row-${b.id}`}
              >
                <span className="w-[74px] shrink-0 text-xs text-ink-muted tabular-nums">
                  {rowTime(b)}
                </span>
                <span className="flex-1 min-w-0">
                  {b.who ?? "—"}
                  <span className="block text-xs text-ink-muted mt-0.5">
                    These didn't reach your Google calendar.
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  data-testid={`calendar-sync-banner-check-${b.id}`}
                  onClick={() => onOpen?.(b.id)}
                >
                  Check
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
