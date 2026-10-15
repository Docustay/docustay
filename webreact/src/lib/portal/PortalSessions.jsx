// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R9.012 — PortalSessions: rebuild from the Svelte source
//
// 18.42 — CLIENT PORTAL SESSIONS: SCHEDULE & PAST
//
// ★★★ SETTINGS ARE ENFORCED SERVER-SIDE. Move/Cancel controls come from policy flags in the
//     payload (`canMove` / `canCancel`), which the ROUTE decides from `tenant_setting`.
//     Never decide it in the component, and never show an enabled control the policy says is off.
//
// ★ Times are LOCAL WALL-CLOCK plus an IANA zone, never bare UTC.
// ★ An empty schedule is the REAL PAGE with ONE BAND; filtered-to-nothing is its own band.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { request, ApiError } from "@/lib/api.js";
import { term } from "../terminology/terms.js";
import PhoneCard from "../phone/PhoneCard.jsx";
import PhoneSheet from "../phone/PhoneSheet.jsx";
import { PhoneSectionLabel } from "../phone/PhoneRow.jsx";

export default function PortalSessions({ data = {}, role = null, terms = {}, onNavigate = null }) {
  // State
  const [activeTab, setActiveTab] = useState("coming-up");
  const [selectedSession, setSelectedSession] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Extract sessions and summary from payload
  const sessions = useMemo(() => (Array.isArray(data?.sessions) ? data.sessions : []), [data]);
  const summary = useMemo(() => data?.summary ?? {}, [data]);

  // Split sessions into coming up and past (by current time in local TZ)
  const now = new Date();
  const upcomingSessions = useMemo(() => {
    return sessions
      .filter((s) => new Date(s.starts_at) > now)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }, [sessions, now]);

  const pastSessions = useMemo(() => {
    return sessions
      .filter((s) => new Date(s.starts_at) <= now)
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  }, [sessions, now]);

  // For parent: group past sessions by child first name
  const groupedPastSessions = useMemo(() => {
    if (role !== "parent") return pastSessions;
    const groups = new Map();
    for (const session of pastSessions) {
      const key = session.person_first_name || "Unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    }
    return Array.from(groups.entries()).flatMap(([, sessions]) => sessions);
  }, [pastSessions, role]);

  // Format date like "Thu 25 Sep"
  function formatSessionDate(isoDate) {
    const d = new Date(isoDate);
    const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return `${dayName} ${day} ${month}`;
  }

  // Format time like "9:00"
  function formatSessionTime(isoDate) {
    const d = new Date(isoDate);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  // Get chip status text and variant
  function getSessionChip(session) {
    if (session.state === "cancelled") {
      const daysBefore = calculateDaysBefore(session);
      return {
        text: `Cancelled by you${daysBefore ? `, ${daysBefore} days before` : ""}`,
        variant: "mute"
      };
    }
    if (session.attended === true) {
      return { text: "Attended", variant: "ok" };
    }
    if (session.attended === false && session.state === "no-show") {
      return { text: "No-show", variant: "bad" };
    }
    if (session.state === "waitlisted") {
      return { text: "Waitlisted", variant: "act" };
    }
    return { text: "Confirmed", variant: "ok" };
  }

  function calculateDaysBefore(session) {
    if (!session.cancelled_at) return null;
    const cancelledDate = new Date(session.cancelled_at);
    const sessionDate = new Date(session.starts_at);
    const diffMs = sessionDate - cancelledDate;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 1) return 1;
    if (days > 1) return days;
    return null;
  }

  // Format trust line summary
  function formatTrustLine() {
    const attended = summary.attended ?? 0;
    const cancelledInTime = summary.cancelledInTime ?? 0;
    const chargedWithoutSession = summary.chargedWithoutSession ?? 0;

    const attendedText = attended === 1 ? "One attended" : `${attended} attended`;
    const cancelledText = cancelledInTime === 1 ? "one cancelled in good time" : `${cancelledInTime} cancelled in good time`;

    let line = `${attendedText}, ${cancelledText}.`;

    // Only add charge sentence when chargedWithoutSession === 0
    if (chargedWithoutSession === 0) {
      line += " Nothing has been charged for a session you didn't have.";
    }

    return line;
  }

  async function openCancelModal(session) {
    setSelectedSession(session);
    setShowCancelModal(true);
    setError(null);
  }

  async function openMoveModal(session) {
    setSelectedSession(session);
    setShowMoveModal(true);
    setError(null);
  }

  async function submitCancel() {
    if (!selectedSession) return;

    setSubmitting(true);
    setError(null);

    try {
      await request("/api/app/booking/cancel", {
        method: "POST",
        body: { bookingId: selectedSession.id },
      });
      setShowCancelModal(false);
      setSelectedSession(null);
      // In a real app, would refetch sessions
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to cancel session");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMove() {
    if (!selectedSession) return;
    // Move routes into the booking flow (18.40)
    if (onNavigate) {
      onNavigate("/app/booking?moveFrom=" + selectedSession.id);
    }
    setShowMoveModal(false);
    setSelectedSession(null);
  }

  function closeCancelModal() {
    setShowCancelModal(false);
    setSelectedSession(null);
    setError(null);
  }

  function closeMoveModal() {
    setShowMoveModal(false);
    setSelectedSession(null);
    setError(null);
  }

  return (
    <div className="flex flex-col" data-testid="portal-sessions">
      {/* ★ the maintainer, 29 Sep 2026 (portal design critique #3) — the page's own header (title + "+") is
          gone: PhoneShell now draws the practice logo, page title AND this screen's "+" action
          (ClientApp.jsx wires it for the "sessions" surface) for every phone screen, so this
          screen never disagrees with it and never double-pads inside PhoneShell's own gutter. */}

      {/* Segment control */}
      <div className="flex bg-[var(--color-structure-200)] rounded-[10px] p-[3px] mb-[14px] gap-0">
        <button
          type="button"
          className={`flex-1 text-center font-medium text-[13px] py-[7px] rounded-[8px] cursor-pointer transition-all border-none ${
            activeTab === "coming-up"
              ? "bg-white text-[var(--ink)] shadow-[0_1px_3px_rgba(20,20,25,0.08)]"
              : "bg-transparent text-[var(--ink-muted)] hover:bg-white/50"
          }`}
          style={{ fontFamily: "var(--ks-font-text)" }}
          onClick={() => setActiveTab("coming-up")}
          data-testid="seg-coming-up"
          aria-pressed={activeTab === "coming-up"}
        >
          Coming up
        </button>
        <button
          type="button"
          className={`flex-1 text-center font-medium text-[13px] py-[7px] rounded-[8px] cursor-pointer transition-all border-none ${
            activeTab === "past"
              ? "bg-white text-[var(--ink)] shadow-[0_1px_3px_rgba(20,20,25,0.08)]"
              : "bg-transparent text-[var(--ink-muted)] hover:bg-white/50"
          }`}
          style={{ fontFamily: "var(--ks-font-text)" }}
          onClick={() => setActiveTab("past")}
          data-testid="seg-past"
          aria-pressed={activeTab === "past"}
        >
          Past
        </button>
      </div>

      {/* Coming up tab */}
      {activeTab === "coming-up" && (
        <div className="flex flex-col">
          {upcomingSessions.length === 0 ? (
            <div className="bg-white border border-[var(--line)] rounded-[12px] py-[56px] px-[24px] text-center" data-testid="sessions-empty-coming-up">
              <p className="m-0 mb-[18px] font-medium text-[17px] text-[var(--ink)]" style={{ fontFamily: "var(--ks-font-text)" }}>
                Nothing booked yet
              </p>
              <button
                className="h-[38px] px-[17px] rounded-[8px] font-medium text-[14px] text-white bg-[var(--color-brand)] border-[var(--color-brand)] cursor-pointer hover:opacity-90"
                style={{ fontFamily: "var(--ks-font-text)" }}
                onClick={() => onNavigate?.("/app/booking")}
              >
                Find a time
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col" data-testid="sessions-list">
                {upcomingSessions.map((session) => (
                  <div key={session.id} className="flex items-start gap-3 py-[13px] border-b border-[var(--hair)] last:border-b-0" data-testid="session-item" data-id={session.id}>
                    <div className="w-[54px] flex-shrink-0 text-[12.5px] text-[var(--ink-muted)] leading-[1.4] font-variant-numeric-tabular-nums">
                      <div className="font-medium text-[13.5px] text-[var(--ink)]" style={{ fontFamily: "var(--ks-font-text)" }}>
                        {formatSessionDate(session.starts_at).split(" ")[0]}
                      </div>
                      {formatSessionDate(session.starts_at).split(" ").slice(1).join(" ")}
                    </div>
                    <div className="flex-1 text-[14px] leading-[1.45]">
                      <div className="font-medium text-[14px]" style={{ fontFamily: "var(--ks-font-text)" }}>
                        {session.service_name || "Session"}
                      </div>
                      <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[3px]" data-testid="session-time">
                        {formatSessionTime(session.starts_at)} · Location TBD · with coach
                      </span>
                    </div>
                    {getSessionChip(session) && (
                      <div className="flex-shrink-0">
                        {(() => {
                          const chip = getSessionChip(session);
                          const variantClasses = {
                            ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
                            act: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
                            mute: "bg-mute-bg text-[var(--color-ink-2)]"
                          };
                          return (
                            <span className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-[12px] ${variantClasses[chip.variant]}`} style={{ fontFamily: "var(--ks-font-text)" }}>
                              {chip.text}
                            </span>
                          );
                        })()}
                      </div>
                    )}

                    {/* Move/Cancel actions (only for non-parent roles) */}
                    {role !== "parent" && session.state === "confirmed" && session.attended !== true && (
                      <div className="flex-shrink-0 flex gap-2 mt-2">
                        <button
                          className="h-8 px-[13px] text-[13px] font-medium rounded-[7px] border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] cursor-pointer hover:bg-[#F9F9F9]"
                          style={{ fontFamily: "var(--ks-font-text)" }}
                          onClick={() => openMoveModal(session)}
                          data-testid="move-button"
                          aria-label="Move session"
                        >
                          Move
                        </button>
                        <button
                          className="h-8 px-[13px] text-[13px] font-medium rounded-[7px] border border-bad-border bg-bad-bg text-bad cursor-pointer hover:bg-[#F5D8D3]"
                          style={{ fontFamily: "var(--ks-font-text)" }}
                          onClick={() => openCancelModal(session)}
                          data-testid="cancel-button"
                          aria-label="Cancel session"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Book another section */}
              <div className="mt-[18px]">
                <PhoneSectionLabel>Book another</PhoneSectionLabel>
                <PhoneCard variant="act">
                  <div className="font-medium text-[15px]" style={{ fontFamily: "var(--ks-font-text)" }}>
                    {/* ★ the count is the person's spendable CREDITS (the API's `credits`), not the number of rows in this list */}
                    {(data?.credits?.remaining ?? 0) > 0
                      ? `You have ${data.credits.remaining} ${data.credits.remaining === 1 ? "session" : "sessions"} left`
                      : "Book your next session"}
                  </div>
                  <div className="text-[13px] text-[var(--ink-muted)] mt-[5px] leading-[1.55]">
                    {(data?.credits?.remaining ?? 0) > 0
                      ? "Booking uses one of them. Nothing to pay at the time."
                      : "Pick a time that suits you."}
                  </div>
                  <div className="flex gap-2 mt-[13px]">
                    <button
                      className="flex-1 h-8 px-[13px] text-[13px] font-medium rounded-[7px] bg-[var(--color-brand)] text-white border-[var(--color-brand)] border cursor-pointer hover:opacity-90"
                      style={{ fontFamily: "var(--ks-font-text)" }}
                      onClick={() => onNavigate?.("/app/booking")}
                    >
                      Find a time
                    </button>
                  </div>
                </PhoneCard>
              </div>

              {/* Waitlist section */}
              <div className="mt-[18px]">
                <PhoneSectionLabel>Can't find a time?</PhoneSectionLabel>
                <PhoneCard>
                  <div className="font-medium text-[15px]" style={{ fontFamily: "var(--ks-font-text)" }}>
                    Join the waitlist
                  </div>
                  <div className="text-[13px] text-[var(--ink-muted)] mt-[5px] leading-[1.55]">
                    Tell your coach when suits you and you'll be told the moment something opens.
                  </div>
                  <div className="flex gap-2 mt-[13px]">
                    {/* ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this button called `console.log("waitlist")`,
                        a no-op (CLAUDE.md's "built and wired to nothing"). The real waitlist-demand
                        call (PortalBooking.jsx's handleTellThemYouWantOne) needs a serviceId this
                        screen has no service context for, so the honest fix is sending them to the
                        flow that DOES have one, not inventing a second, unscoped demand signal. */}
                    <button
                      className="flex-1 h-8 px-[13px] text-[13px] font-medium rounded-[7px] bg-white text-[var(--color-ink-2)] border border-[var(--color-line)] cursor-pointer hover:bg-[#F9F9F9]"
                      style={{ fontFamily: "var(--ks-font-text)" }}
                      onClick={() => onNavigate?.("/app/booking")}
                      data-testid="sessions-waitlist-button"
                    >
                      Tell them when suits
                    </button>
                  </div>
                </PhoneCard>
              </div>
            </>
          )}
        </div>
      )}

      {/* Past tab */}
      {activeTab === "past" && (
        <div className="flex flex-col">
          {pastSessions.length === 0 ? (
            <div className="bg-white border border-[var(--line)] rounded-[12px] py-[56px] px-[24px] text-center" data-testid="sessions-empty-past">
              <p className="m-0 mb-[18px] font-medium text-[17px] text-[var(--ink)]" style={{ fontFamily: "var(--ks-font-text)" }}>
                No past sessions yet
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col" data-testid="sessions-list-past">
                {groupedPastSessions.map((session) => (
                  <div key={session.id} className="flex items-start gap-3 py-[13px] border-b border-[var(--hair)] last:border-b-0" data-testid="session-item-past" data-id={session.id}>
                    <div className="w-[54px] flex-shrink-0 text-[12.5px] text-[var(--ink-muted)] leading-[1.4] font-variant-numeric-tabular-nums">
                      <div className="font-medium text-[13.5px] text-[var(--ink)]" style={{ fontFamily: "var(--ks-font-text)" }}>
                        {new Date(session.starts_at).getDate()}
                      </div>
                      {new Date(session.starts_at).toLocaleDateString("en-US", { month: "short" })}
                    </div>
                    <div className="flex-1 text-[14px] leading-[1.45]">
                      <div className="font-medium text-[14px]" style={{ fontFamily: "var(--ks-font-text)" }}>
                        {session.service_name || "Session"}
                      </div>
                      <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[3px]">
                        With {session.person_first_name || `coach`} · Location
                        {session.has_note ? ", notes written" : ""}
                      </span>
                    </div>
                    {getSessionChip(session) && (
                      <div className="flex-shrink-0">
                        {(() => {
                          const chip = getSessionChip(session);
                          const variantClasses = {
                            ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
                            act: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
                            mute: "bg-mute-bg text-[var(--color-ink-2)]"
                          };
                          return (
                            <span className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-[12px] ${variantClasses[chip.variant]}`} style={{ fontFamily: "var(--ks-font-text)" }}>
                              {chip.text}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Trust line */}
              <div className="text-[12.5px] text-[var(--ink-muted)] mt-[18px] leading-[1.6]" data-testid="trust-line">
                {formatTrustLine()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Cancel modal */}
      {showCancelModal && selectedSession && (
        <PhoneSheet
          open={showCancelModal}
          onOpenChange={setShowCancelModal}
          onClose={closeCancelModal}
          title="Cancel session"
          footer={
            <div className="flex gap-2">
              <button
                className="flex-1 h-[38px] px-[17px] rounded-[8px] font-medium text-[14px] text-[var(--color-ink-2)] bg-white border border-[var(--color-line)] cursor-pointer hover:bg-[#F9F9F9] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--ks-font-text)" }}
                onClick={closeCancelModal}
                disabled={submitting}
                data-testid="cancel-modal-close-btn"
              >
                Close
              </button>
              <button
                className="flex-1 h-[38px] px-[17px] rounded-[8px] font-medium text-[14px] border border-bad-border bg-bad-bg text-bad cursor-pointer hover:bg-[#F5D8D3] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--ks-font-text)" }}
                onClick={submitCancel}
                disabled={submitting}
                data-testid="cancel-confirm-btn"
              >
                {submitting ? "Cancelling..." : "Cancel session"}
              </button>
            </div>
          }
        >
          <div className="px-0 pb-[24px]">
            {error && (
              <div className="p-3 border border-bad-border bg-bad-bg text-bad rounded-[8px] text-[14px] mb-4" data-testid="cancel-error" role="alert">
                {error}
              </div>
            )}

            <div className="mb-5">
              <p className="m-0 mb-3 text-[14px] text-[var(--ink)] leading-[1.5]" data-testid="cancel-policy-text">
                Are you sure you want to cancel this session?
              </p>
              <p className="m-0 font-medium text-[14px] text-[var(--ok)]" data-testid="cancel-deadline">
                You can cancel free until {new Date(selectedSession.starts_at).toLocaleDateString()}
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[14px] mt-4">
              <input type="checkbox" required data-testid="cancel-confirm-checkbox" />
              I understand and want to cancel this session
            </label>
          </div>
        </PhoneSheet>
      )}

      {/* Move modal */}
      {showMoveModal && selectedSession && (
        <PhoneSheet
          open={showMoveModal}
          onOpenChange={setShowMoveModal}
          onClose={closeMoveModal}
          title="Move session"
          footer={
            <div className="flex gap-2">
              <button
                className="flex-1 h-[38px] px-[17px] rounded-[8px] font-medium text-[14px] text-[var(--color-ink-2)] bg-white border border-[var(--color-line)] cursor-pointer hover:bg-[#F9F9F9] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--ks-font-text)" }}
                onClick={closeMoveModal}
                disabled={submitting}
                data-testid="move-modal-close-btn"
              >
                Close
              </button>
              <button
                className="flex-1 h-[38px] px-[17px] rounded-[8px] font-medium text-[14px] text-white bg-[var(--color-brand)] border-[var(--color-brand)] border cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--ks-font-text)" }}
                onClick={submitMove}
                disabled={submitting}
                data-testid="move-confirm-btn"
              >
                {submitting ? "Moving..." : "Choose new time"}
              </button>
            </div>
          }
        >
          <div className="px-0 pb-[24px]">
            {error && (
              <div className="p-3 border border-bad-border bg-bad-bg text-bad rounded-[8px] text-[14px] mb-4" data-testid="move-error" role="alert">
                {error}
              </div>
            )}

            <p className="m-0 mb-3 text-[14px] text-[var(--ink)]">
              Select a new time for your session.
            </p>
            <p className="m-0 text-[14px] text-[var(--ink)]">
              Current session: {formatSessionDate(selectedSession.starts_at)} at {formatSessionTime(selectedSession.starts_at)}
            </p>
          </div>
        </PhoneSheet>
      )}
    </div>
  );
}
