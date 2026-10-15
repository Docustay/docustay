// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.004 — BookingChannelsScreen — rebuild from specs/mockups/BookingChannels.frame.html on ConnectPage.
//
// ★★★ "A CHANNEL IS A WAY THE OUTSIDE WORLD REACHES THIS PRACTICE" — every row below states, in
//     one place (this header), WHAT MAKES IT ON OR OFF and WHO ENFORCES THAT, so a reader never
//     has to guess which rows are real:
//     · "Your own booking page" — ON when `GET /api/engagements/booking-settings`'s
//       `keys["booking.online_enabled"]` is true. ★ ENFORCED SERVER-SIDE, NOT BY THIS SCREEN:
//       13.20's public surface 404s the whole public door when this same key is false
//       (task header, MEASURED by 13.20) — this screen only DISPLAYS the same flag 13.20 already
//       gates on, never a second computation of it.
//     · "Reserve with Google" — always renders "Applying" (G10's ruled wording, the maintainer 25 Sep,
//       `GAP-LIST-TOUCHUP3.md:125`: "file the application in Wave 0... show 'applying' until
//       approved"). Nothing server-side can turn this row on today — there is no RwG partner
//       approval anywhere in this codebase (MEASURED: no `reserve-with-google`/`rwg` route exists)
//       — so the row carries NO button at all (field 4: "the application is filed, the row is not
//       a control"), never a button that would do nothing if pressed.
//     · Instagram / Meta / Apple Maps — always OFF. Each is `visible and disabled with its own
//       real reason` (doctrine 5) because none of the three has ANY backing route or column in
//       this codebase (MEASURED: no `instagram`/`meta`/`apple-maps` booking route exists anywhere
//       under `src/`) — never hidden, never a Connect button that would do nothing.
//     · Squarespace — always OFF, but its OWN reason: the frame draws it Live, but there is no
//       embed record anywhere (no column, no route) to say whether the button is really on the
//       practice's site, so this screen says exactly that ("We can't tell whether the button is
//       on your site") rather than claiming Live on no evidence (doctrine 3).
//     · "Your link" (Copy) — real: `GET /api/engagements/my-link` is READ HERE, never composed by hand
//       — `view.url` is the exact shareable URL `EngMyLinkScreen.svelte`/`PlatformLinksScreen.svelte`
//       already copy. Copy is disabled with a reason when the viewer has not set a slug yet (no URL to copy).
//     · "Your link" (QR) — ALWAYS disabled. ★★★ R-15 RESOLVED HERE, NOT GUESSED: field 4 calls
//       this "the existing EngMyLink QR generator", but `EngMyLinkScreen.svelte:195-197` (MEASURED)
//       shows there is no QR generator anywhere in this codebase — that button is itself disabled
//       with "Not available yet — no QR generator is built yet". This screen carries the SAME
//       honest gap, in the SAME words, rather than inventing a generator that does not exist.
//
// ★★★ NONE OF THESE FIVE ROWS OWN A SERVER-SIDE ENFORCEMENT SWITCH OF THEIR OWN. The one setting
//     this screen reads (`booking.online_enabled`) IS enforced server-side, but by 13.20's public
//     route, not by anything in this file — this screen computes nothing (field 5: "this screen
//     renders `GET /api/engagements/booking-settings` and computes nothing itself"). Turning any
//     channel on is out of this screen's scope entirely (13.36/13.39 own those routes); this
//     screen only ever reports what already is.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

// The not-yet channels — none has any backing route or column anywhere in this codebase.
// Squarespace's own reason is deliberately different (doctrine 3).
const NOT_YET = [
  { key: "instagram", name: "Instagram", description: "A Book button on your profile",
    reason: "Not connected — Instagram booking isn't built yet" },
  { key: "meta", name: "Meta", description: "A Book button on your Facebook page",
    reason: "Not connected — Meta booking isn't built yet" },
  { key: "apple-maps", name: "Apple Maps", description: "Book from Apple Maps",
    reason: "Not connected — Apple Maps booking isn't built yet" },
  { key: "squarespace", name: "Squarespace", description: "The booking button on your website",
    reason: "We can't tell whether the button is on your site" },
];

export default function BookingChannelsScreen({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [bookingSettings, setBookingSettings] = useState(null);
  const [onlineBooking, setOnlineBooking] = useState(null);
  const [myLink, setMyLink] = useState(null);
  const [copied, setCopied] = useState(false);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const onlineEnabled = bookingSettings?.keys?.["booking.online_enabled"] === true;
  const host = myLink?.domain ?? null;
  const linkShare = onlineBooking?.linkShare ?? null;
  const linkUrl = myLink?.url ?? null;

  /** Field 4's own detail line, built ONLY from real counts (`linkShare`) — never a fabricated
   *  share count. The "via a personal link" half is explicitly named as a best-effort match, never
   *  stated as fact. */
  function ownPageDetail(share) {
    const total = share?.total ?? 0;
    if (total === 0) return "No bookings from your booking page yet.";
    const bookingsWord = total === 1 ? "booking" : "bookings";
    let line = `${total} ${bookingsWord} from your booking page this year.`;
    const viaPersonal = share?.viaPersonalLinks ?? 0;
    if (viaPersonal > 0) {
      line += ` About ${viaPersonal} of ${total === viaPersonal ? "those" : "them"} look like they came ` +
        `through a coach's personal link — a best-effort match, not an exact count`;
      line += share?.topHostName ? `, most often ${share.topHostName}'s.` : ".";
    }
    return line;
  }

  function initial(name) {
    const s = String(name ?? "").trim();
    return s ? s.charAt(0).toUpperCase() : "?";
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // ★ Same silent-fallback shape as `EngMyLinkScreen.svelte#copyLink` — the field is still
      //   there to copy from by hand; no error state is worth a whole-screen interruption for this.
    }
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [bs, ob, ml] = await Promise.all([
        request("/api/engagements/booking-settings"),
        request("/api/engagements/online-booking"),
        api.myLink(),
      ]);
      setBookingSettings(bs);
      setOnlineBooking(ob);
      setMyLink(ml);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    }
  }

  useEffect(() => { load(); }, []);

  if (phase !== "ready") {
    return (
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={go}
        testIds={{ loading: "booking-channels-loading", error: "booking-channels-error", denied: "booking-channels-denied" }}
      />
    );
  }

  return (
    <div className="flex flex-col" data-testid="booking-channels-page">
      <div className="mb-4.5">
        <PageTitle testId="booking-channels-page-title">Where people can book you</PageTitle>
        <p className="mt-1.25 text-control text-mute">Every channel that can send someone to a real appointment, and what's not built yet.</p>
      </div>

      {/* ═══ Live ═══════════════════════════════════════════════════════════════════════════════════ */}
      <section className="mb-6" data-testid="booking-channels-section-live">
        <h2 className="m-0 mb-1 text-heading font-medium text-ink">Live</h2>
        <div className="rounded-card border border-line bg-surface px-5">
          <div className="flex items-center gap-3.75 border-b border-hair py-4.25 last:border-b-0" data-testid="booking-channels-row-own-page">
            <span className="flex size-(--size-control) shrink-0 items-center justify-center rounded-control bg-ink-2 text-heading font-semibold text-white" aria-hidden="true">{initial("your booking page")}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-field font-medium text-ink">
                Your own booking page{host && <span data-testid="booking-channels-own-page-host"> — {host}</span>}
              </b>
              <span className="mt-0.75 text-meta leading-normal text-mute" data-testid="booking-channels-own-page-detail">{ownPageDetail(linkShare)}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <StatusBadge tone={onlineEnabled ? "ok" : "neutral"} label={onlineEnabled ? "Live" : "Off"} testId="booking-channels-own-page-state" />
              <Button variant="outline" size="sm" onClick={() => go("/engagements/booking")} data-testid="booking-channels-own-page-manage">Manage</Button>
            </span>
          </div>
        </div>
      </section>

      {/* ═══ In progress ════════════════════════════════════════════════════════════════════════════ */}
      <section className="mb-6" data-testid="booking-channels-section-progress">
        <h2 className="m-0 mb-1 text-heading font-medium text-ink">In progress</h2>
        <div className="rounded-card border border-line bg-surface px-5">
          <div className="flex items-center gap-3.75 border-b border-hair py-4.25 last:border-b-0" data-testid="booking-channels-row-rwg">
            <span className="flex size-(--size-control) shrink-0 items-center justify-center rounded-control bg-ink-2 text-heading font-semibold text-white" aria-hidden="true">{initial("Reserve with Google")}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-field font-medium text-ink">Reserve with Google</b>
              <span className="mt-0.75 text-meta leading-normal text-mute">Book straight from Google Search and Maps</span>
            </span>
            <span className="flex items-center gap-2.5">
              <StatusBadge tone="warn" label="Applying" testId="booking-channels-rwg-state" />
            </span>
          </div>
        </div>
      </section>

      {/* ═══ Not yet ════════════════════════════════════════════════════════════════════════════════ */}
      <section className="mb-6" data-testid="booking-channels-section-notyet">
        <h2 className="m-0 mb-1 text-heading font-medium text-ink">Not yet</h2>
        <div className="rounded-card border border-line bg-surface px-5">
          {NOT_YET.map((ch) => (
            <div key={ch.key} className="flex items-center gap-3.75 border-b border-hair py-4.25 last:border-b-0" data-testid={`booking-channels-row-${ch.key}`}>
              <span className="flex size-(--size-control) shrink-0 items-center justify-center rounded-control bg-ink-2 text-heading font-semibold text-white" aria-hidden="true">{initial(ch.name)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-field font-medium text-ink">{ch.name}</b>
                <span className="mt-0.75 text-meta leading-normal text-mute">{ch.description}</span>
              </span>
              <span className="flex items-center gap-2.5">
                <DisabledWithReason disabled={true} reason={ch.reason} testId={`booking-channels-${ch.key}-connect`}>
                  {({ disabled, describedBy }) => (
                    <Button variant="outline" size="sm" disabled={disabled} aria-describedby={describedBy} data-testid={`booking-channels-${ch.key}-connect`}>Connect</Button>
                  )}
                </DisabledWithReason>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Your link ══════════════════════════════════════════════════════════════════════════════ */}
      <section className="mb-6" data-testid="booking-channels-section-link">
        <h2 className="m-0 mb-1 text-heading font-medium text-ink">Your link</h2>
        <div className="rounded-card border border-line bg-surface px-5">
          <div className="flex items-center gap-3.75 border-b border-hair py-4.25" data-testid="booking-channels-row-link-copy">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-field font-medium text-ink" data-testid="booking-channels-link-url">{linkUrl ?? "No link set yet"}</b>
              <span className="mt-0.75 text-meta leading-normal text-mute">Send it to anyone. It shows only the services you've made public.</span>
            </span>
            <span className="flex items-center gap-2.5">
              {linkUrl ? (
                <Button variant="outline" size="sm" onClick={copyLink} data-testid="booking-channels-link-copy-btn">
                  {copied ? "Copied" : "Copy"}
                </Button>
              ) : (
                <DisabledWithReason disabled={true} reason="Set your own link first" testId="booking-channels-link-copy">
                  {({ disabled, describedBy }) => (
                    <Button variant="outline" size="sm" disabled={disabled} aria-describedby={describedBy} onClick={() => go("/settings/booking-link")}>Copy</Button>
                  )}
                </DisabledWithReason>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3.75 border-b border-hair py-4.25 last:border-b-0" data-testid="booking-channels-row-link-qr">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-field font-medium text-ink">QR code</b>
              <span className="mt-0.75 text-meta leading-normal text-mute">A printable code for your own booking link.</span>
            </span>
            <span className="flex items-center gap-2.5">
              <DisabledWithReason disabled={true} reason="No QR generator is built yet" testId="booking-channels-link-qr">
                {({ disabled, describedBy }) => (
                  <Button variant="outline" size="sm" disabled={disabled} aria-describedby={describedBy}>QR code</Button>
                )}
              </DisabledWithReason>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
