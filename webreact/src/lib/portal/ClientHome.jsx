// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.36 — CLIENT HOME AND FIRST VISIT SCREENS (AppClientHome, AppClientFirst)
//
// ★★★ TWO STATES, ONE COMPONENT. The adult client's Home as drawn, and the first-visit variant
//     when `firstVisit` is true. Data comes from 18.34's `GET /api/app/home`, dispatched through
//     18.33's ClientApp onto the phone shell's nav system.
//
// ★ Every control is wired to a real call: Directions (maps link from address), Move it (to
//   reschedule), Cancel (booking), Pay now (to payments), See invoice (to documents), Read and
//   sign (to documents), Open it (agreement), See times (booking), Write to host (messages).
//
// ★ the maintainer, 29 Sep 2026 (portal design critique) — restyled onto PhoneCard/PhoneRow/PhoneSectionLabel
//   (the kit every other rebuilt portal screen now shares) and PhoneShell's own gutter, in place
//   of this screen's own px-[18px] wrapper and one-off bordered divs.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { formatValue } from "@/lib/format.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";

function CardButton({ primary, children, ...props }) {
  return (
    <button
      className={`flex-1 h-8 px-[13px] rounded-[7px] text-[13px] font-medium transition-opacity hover:opacity-90 ${
        primary ? "text-white" : "border"
      }`}
      style={
        primary
          ? { background: "var(--color-brand)" }
          : { borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)", background: "var(--color-surface)" }
      }
      {...props}
    >
      {children}
    </button>
  );
}

export default function ClientHome({ data = null, role = null, onNavigate = null }) {
  // ★ All data flows through one source: 18.34's adultHome() payload.
  const payload = useMemo(() => data?.data ?? data ?? {}, [data]);
  const firstVisit = useMemo(() => !!payload.firstVisit, [payload]);
  const next = useMemo(() => payload.next ?? null, [payload]);
  const money = useMemo(() => payload.money ?? null, [payload]);
  const toSign = useMemo(() => payload.toSign ?? null, [payload]);
  const block = useMemo(() => payload.block ?? null, [payload]);
  const comingUp = useMemo(
    () => (Array.isArray(payload.comingUp) ? payload.comingUp : []),
    [payload]
  );
  const firstSteps = useMemo(() => payload.firstSteps ?? null, [payload]);

  // ★ Screen state: loading, error, ready. Determine phase from data structure.
  const phase = useMemo(
    () =>
      data?.error
        ? "error"
        : !data
          ? "loading"
          : "ready",
    [data]
  );

  // ★ NAVIGATE HELPERS — each button wires to its real surface via onNavigate.
  const goToSessions = () => {
    if (onNavigate) onNavigate("/app/sessions");
  };

  const goToPayments = () => {
    if (onNavigate) onNavigate("/app/payments");
  };

  const goToDocuments = (docId) => {
    if (onNavigate) onNavigate("/app/documents?id=" + docId);
  };

  const goToBooking = () => {
    if (onNavigate) onNavigate("/app/booking");
  };

  const goToMessages = (hostId) => {
    if (onNavigate) onNavigate("/app/messages?contact=" + hostId);
  };

  // ★ DIRECTIONS LINK — maps link from address.
  const directionsLink = (place) => {
    if (!place?.detail) return null;
    return `https://maps.google.com/?q=${encodeURIComponent(place.detail)}`;
  };

  // ★ FORMAT HELPERS.
  const formatSessionTime = (startsAt) => {
    const d = new Date(startsAt);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatSessionDate = (startsAt) => {
    const d = new Date(startsAt);
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    const date = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return `${day}${date} ${month}`;
  };

  const formatMoney = (amountMinor, currency) => {
    return formatValue(amountMinor, "money", { currency });
  };

  const formatDueDate = (dueAt) => {
    const d = new Date(dueAt);
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "long" });
    return `${day} ${month}`;
  };

  const formatExpiryDate = (expiresAt) => {
    return new Date(expiresAt).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
    });
  };

  const sessionsInWords = (n) => {
    const words = [
      "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    ];
    return words[Math.min(n, 10)] || String(n);
  };

  if (phase === "error") {
    return <ScreenState phase="error" error={data?.error} subject="Your home" />;
  }

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  // ★★★ TWO BRANCHES: first visit (new client) and established client.
  return (
    <>
      {firstVisit ? (
        // ═════════════════════════════════════════════════════════════════════════════════════════
        // FIRST VISIT STATE — brand-new client. Shows the two required steps and onboarding copy.
        // ═════════════════════════════════════════════════════════════════════════════════════════
        <div className="flex flex-col">
          <div className="mb-3.5 pt-0.5">
            {/* ★ each card is drawn only when the server named what it opens: an agreement card with no
                 agreement was a dead "Open it", and the "free call" copy promised a price no service had */}
            <h1
              className="m-0 text-[34px] font-normal leading-[1.05] text-ink"
              style={{ letterSpacing: "-0.02em" }}
            >
              {firstSteps?.agreementId ? "Two things first" : "Welcome"}
            </h1>
            {firstSteps?.agreementId && (
              <p className="m-0 mt-1.5 text-[13.5px] leading-[1.5]" style={{ color: "var(--color-structure-600)" }}>
                Then you can pick a time. About five minutes all in.
              </p>
            )}
          </div>

          {firstSteps?.agreementId && (
            <PhoneCard variant="act" label="1. Read and sign the agreement">
              <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                What you&rsquo;re agreeing to, in plain words &mdash; how long sessions are, what
                happens if you cancel, and what stays between you and{" "}
                {firstSteps?.hostFirstName ?? `your coach`}.
              </div>
              <div className="flex gap-2 mt-[13px]">
                <CardButton primary onClick={() => goToDocuments(firstSteps.agreementId)} data-testid="home-open-agreement">
                  Open it
                </CardButton>
              </div>
            </PhoneCard>
          )}

          <PhoneCard label={`${firstSteps?.agreementId ? "2. " : ""}Book your first session`}>
            <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
              {firstSteps?.freeServiceId
                ? "A free call so you both work out whether this is worth carrying on with. Nothing to pay, and no card needed."
                : "Pick a time that suits you."}
            </div>
            <div className="flex gap-2 mt-[13px]">
              <CardButton onClick={goToBooking} data-testid="home-see-times">
                See times
              </CardButton>
            </div>
          </PhoneCard>

          {/* ★ WHAT HAPPENS AFTER — three bullet-point rows */}
          <PhoneSectionLabel>What happens after</PhoneSectionLabel>
          <PhoneCard>
            {[
              ["You'll get a confirmation", "With the address, and where to park"],
              ["A reminder the day before", "By text, unless you'd rather have email"],
              ["Nothing is charged", "Not until you decide to carry on"],
            ].map(([title, detail], i, arr) => (
              <div
                key={title}
                className={`flex gap-3 py-[13px] ${i < arr.length - 1 ? "border-b" : ""}`}
                style={{ borderColor: "var(--color-structure-150)" }}
              >
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[7px]"
                  style={{ background: "var(--color-structure-400)" }}
                  aria-hidden="true"
                />
                <div>
                  <div className="text-[14px] leading-[1.45] text-ink">{title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-[1.4]" style={{ color: "var(--color-structure-600)" }}>
                    {detail}
                  </div>
                </div>
              </div>
            ))}
          </PhoneCard>

          {/* ★ MESSAGE CARD — if they have questions before proceeding */}
          <PhoneSectionLabel>If you&rsquo;d rather ask something first</PhoneSectionLabel>
          <PhoneCard label={`Message ${firstSteps?.hostFirstName ?? "your coach"}`}>
            <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
              {firstSteps?.hostFirstName ?? "They"} usually replies within a few hours. No
              question is a daft one at this stage.
            </div>
            <div className="flex gap-2 mt-[13px]">
              <CardButton onClick={() => goToMessages(null)} data-testid="home-write-to-coach">
                Write to {firstSteps?.hostFirstName ?? "them"}
              </CardButton>
            </div>
          </PhoneCard>
        </div>
      ) : (
        // ═════════════════════════════════════════════════════════════════════════════════════════
        // ESTABLISHED CLIENT HOME — standard view with sessions, money, documents, credits.
        // ═════════════════════════════════════════════════════════════════════════════════════════
        <div className="flex flex-col">
          {/* ★ NEXT SESSION CARD — the client's most important info */}
          {next ? (
            <PhoneCard variant="act" label={next.place?.detail}>
              <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                {next.serviceName}
                {next.hostName && ` with ${next.hostName.split(" ")[0]}`}
                &mdash; in {next.place?.detail ?? "your location"}, {next.durationMinutes} minutes
              </div>
              {next.place?.note && (
                <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                  {next.place.note}
                </div>
              )}
              <div className="flex gap-2 mt-[13px]">
                <a
                  href={directionsLink(next.place)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-8 px-[13px] rounded-[7px] border text-center text-[13px] font-medium flex items-center justify-center"
                  style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)", background: "var(--color-surface)" }}
                >
                  Directions
                </a>
                {next.canMove && (
                  <CardButton onClick={goToSessions} data-testid="home-move-session">Move it</CardButton>
                )}
                {next.canCancel && (
                  <CardButton onClick={goToSessions} data-testid="home-cancel-session">Cancel</CardButton>
                )}
              </div>
            </PhoneCard>
          ) : (
            <PhoneCard label="Nothing booked">
              <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                {/* ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this called the throwing `term()` helper with
                    "userType.coach", a key that has never existed in TERM_KEYS (only
                    userType.client/parent/member/admin do) — every client with no upcoming
                    session hit this branch and got a hard crash (blank white Home screen), not a
                    missing-word fallback. `term()` is designed to throw on an unrecognized key
                    rather than render one silently (terms.js's own header), so this was never
                    going to resolve to anything — hardcoded to match how every sibling portal
                    component (ClientTeenHome, ClientParentHome) already names this role: literal
                    "coach", never through the throwing global helper. */}
                Find a time to meet with your coach.
              </div>
              <div className="flex gap-2 mt-[13px]">
                <CardButton primary onClick={goToBooking} data-testid="home-find-a-time">Find a time</CardButton>
              </div>
            </PhoneCard>
          )}

          {/* ★ MONEY CARD — only when client has an open invoice */}
          {money && (
            <PhoneCard variant="warm" label={`${formatMoney(money.amountMinor, money.currency)} due on ${formatDueDate(money.dueAt)}`}>
              <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                {money.label}
              </div>
              {money.savedCard && (
                <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                  Your card ending {money.savedCard.lastFour} is saved, or pay by bank and it
                  costs nothing extra.
                </div>
              )}
              <div className="flex gap-2 mt-[13px]">
                <CardButton primary onClick={goToPayments} data-testid="home-pay-now">Pay now</CardButton>
                <CardButton onClick={() => goToDocuments(money.invoiceId)} data-testid="home-see-invoice">See the invoice</CardButton>
              </div>
            </PhoneCard>
          )}

          {/* ★ DOCUMENT TO SIGN CARD — when one is waiting */}
          {toSign && (
            <PhoneCard label="One thing to sign">
              <div className="text-[13px] leading-[1.55] mt-1.5" style={{ color: "var(--color-structure-600)" }}>
                An updated coaching agreement. It takes about a minute, and you can do it here.
              </div>
              <div className="flex gap-2 mt-[13px]">
                <CardButton primary onClick={() => goToDocuments(toSign.documentId)} data-testid="home-read-and-sign">
                  Read and sign
                </CardButton>
              </div>
            </PhoneCard>
          )}

          {/* ★ CREDITS BLOCK — when client has entitlements */}
          {block && (
            <>
              <PhoneSectionLabel>Your block</PhoneSectionLabel>
              <PhoneCard>
                <div className="flex items-center gap-3">
                  <span className="text-[28px] font-normal text-ink">{block.remaining}</span>
                  <div className="text-[13px] leading-[1.5]" style={{ color: "var(--color-structure-600)" }}>
                    sessions left of {sessionsInWords(block.total)}
                    {/* ★ a block that never expires has expiresAt = null; `new Date(null)` is 1 Jan 1970, which printed "they run out on December 31" */}
                    {block.expiresAt && (<><br />they run out on {formatExpiryDate(block.expiresAt)}</>)}
                  </div>
                </div>
                <div className="h-[7px] overflow-hidden rounded-full mt-[11px]" style={{ background: "var(--color-structure-150)" }}>
                  <div
                    className="h-full"
                    style={{ background: "var(--color-brand)", width: `${(block.remaining / block.total) * 100}%` }}
                  />
                </div>
                {block.pace && (
                  <div className="mt-2.5 text-[12.5px] leading-[1.5]" style={{ color: "var(--color-structure-600)" }}>
                    {block.pace}
                  </div>
                )}
              </PhoneCard>
            </>
          )}

          {/* ★ COMING UP — next 3 bookings */}
          {comingUp.length > 0 && (
            <>
              <PhoneSectionLabel>Coming up</PhoneSectionLabel>
              <PhoneCard>
                {comingUp.map((booking, idx) => (
                  <div
                    key={booking.id ?? booking.date}
                    className={`flex items-start gap-3 py-[13px] ${idx < comingUp.length - 1 ? "border-b" : ""}`}
                    style={{ borderColor: "var(--color-structure-150)" }}
                  >
                    <div className="flex-shrink-0 w-[54px] text-[12.5px] leading-[1.4] tabular-nums" style={{ color: "var(--color-structure-600)" }}>
                      <strong className="block text-[13.5px] font-medium text-ink">
                        {formatSessionDate(booking.date).split(" ")[0]}
                      </strong>
                      {formatSessionDate(booking.date).split(" ").slice(1).join(" ")}
                    </div>
                    <div className="flex-1">
                      <div className="text-[14px] leading-[1.45] text-ink">{booking.service}</div>
                      <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--color-structure-600)" }}>
                        {formatSessionTime(booking.time)} &middot; {booking.place?.detail || "TBA"}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Badge variant="outline">{booking.state}</Badge>
                    </div>
                  </div>
                ))}
              </PhoneCard>
            </>
          )}
        </div>
      )}
    </>
  );
}
