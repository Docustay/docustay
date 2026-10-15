// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.24 — TODAY (AppStaffToday)
//
// ★★★ THE COACH'S DAILY VIEW. Displays:
//     · Month-taken figure from /api/home (owner's hero)
//     · Up to two prompts from CT-F01 surface `home`
//     · Today's bookings with state chips (Ready/Unsigned/Free)
//     · Free-slot gap row and demand count
//     · First 3 tasks from /api/tasks/mine
//
// ★★ EACH BAND LOADS AND FAILS INDEPENDENTLY — ErrorPanel for band failures while rest renders.
//     Bands fail when their source API returns an error; no band is required for the screen to show.
//
// ★ Built from `specs/mockups/AppStaffToday.frame.html`, band by band.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function StaffToday({
  data = null,
  promptsError = null,
  sessionsError = null,
  tasksError = null,
  slotsError = null,
  onRetryPrompts = null,
  onRetrySessions = null,
  onRetryTasks = null,
  onRetrySlots = null,
}) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // DERIVED VALUES
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ★ Extract day name
  const today = new Date();
  const dayName = useMemo(
    () => today.toLocaleDateString(undefined, { weekday: "long" }),
    []
  );
  const practiceName = useMemo(
    () => data?.practice?.name ?? "Example Practice Coaching",
    [data?.practice?.name]
  );

  // ★ Format currency
  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return null;
    return (amount / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  };

  // ★ Hero: month-taken figure from /api/home payload
  const heroAmount = useMemo(
    () => (data?.hero?.amountMinor ? formatCurrency(data.hero.amountMinor) : null),
    [data?.hero?.amountMinor]
  );
  const heroMessage = useMemo(
    () =>
      data?.hero?.deltaSentence
        ? `taken this month — ${data.hero.deltaSentence}`
        : "taken this month",
    [data?.hero?.deltaSentence]
  );

  // ★ Extract bands from data prop
  const prompts = useMemo(
    () => (data?.prompts?.items ?? []).slice(0, 2),
    [data?.prompts?.items]
  );
  const sessions = useMemo(
    () => data?.sessions ?? [],
    [data?.sessions]
  );
  const tasks = useMemo(
    () => (data?.tasks ?? []).slice(0, 3),
    [data?.tasks]
  );
  const slots = useMemo(
    () => data?.slots ?? null,
    [data?.slots]
  );

  // ★ Format a time value
  const formatTime = (iso) => {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "—";
    }
  };

  const formatDuration = (mins) => {
    if (!mins) return "";
    if (mins === 60) return "60 min";
    return `${mins} min`;
  };

  // ★ Determine chip variant for booking state
  const chipVariantFor = (booking) => {
    // State priority: Free > Unsigned > Ready
    if (!booking.clientId) return "mute"; // Gap row (no client)
    if (booking.state === "Unsigned") return "warn";
    return "ok"; // Ready
  };

  return (
    <div className="px-[18px] py-[2px] pb-[22px]">
      {/* ═══ HEADER ═════════════════════════════════════════════════════════════════════════ */}
      <div className="py-[4px] pb-[14px]">
        <Figure size="md" as="div" className="tracking-[-0.02em]">
          {dayName}
        </Figure>
        <div className="mt-[6px] text-[13.5px] text-structure-600 leading-[1.5]">
          {practiceName}
        </div>
      </div>

      {/* ═══ HERO FIGURE ═════════════════════════════════════════════════════════════════════ */}
      {heroAmount && (
        <div className="py-[4px] pb-[14px]">
          <Figure size="md" as="div" className="tracking-[-0.02em]">
            {heroAmount}
          </Figure>
          <div className="mt-[6px] text-[13.5px] text-structure-600 leading-[1.5]">
            {heroMessage}
          </div>
        </div>
      )}

      {/* ═══ PROMPTS BAND ═══════════════════════════════════════════════════════════════════ */}
      {promptsError && (
        <ErrorPanel
          error={promptsError}
          variant="band"
          testId="prompts-error"
          onRetry={onRetryPrompts}
        />
      )}
      {!promptsError && prompts.length > 0 && (
        <>
          {prompts.map((prompt) => (
            <PhoneCard
              key={prompt.id || prompt.headline}
              variant={
                prompt.tone === "warning"
                  ? "bad"
                  : prompt.tone === "success"
                    ? "warm"
                    : "plain"
              }
              label={prompt.headline}
            >
              <p className="m-0 mt-[5px] text-[13px] text-structure-600 leading-[1.55]">
                {prompt.why}
              </p>
              <div className="flex gap-2 mt-[13px]">
                {(prompt.actions ?? []).slice(0, 2).map((action) => (
                  <button
                    key={action.label}
                    className="flex-1 h-[32px] px-[13px] text-[13px] font-500 rounded-[7px] bg-action-600 text-white border border-action-600"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </PhoneCard>
          ))}
        </>
      )}

      {/* ═══ TODAY SESSIONS ═════════════════════════════════════════════════════════════════ */}
      <div className="font-500 text-[12.5px] text-structure-600 mt-[18px] mb-[6px]">
        Today
      </div>
      {sessionsError && (
        <ErrorPanel
          error={sessionsError}
          variant="band"
          testId="sessions-error"
          onRetry={onRetrySessions}
        />
      )}
      {!sessionsError && sessions.length === 0 && (
        <div className="flex gap-3 p-[13px] border-b border-structure-150 last:border-b-0">
          <span className="w-[54px] flex-shrink-0"></span>
          <span className="flex-1 text-[14px] leading-[1.45]">
            Nothing booked today
            <span className="block text-[12.5px] text-structure-600 mt-[3px]">
              Book someone in to fill your schedule
            </span>
          </span>
        </div>
      )}
      {!sessionsError && sessions.length > 0 && (
        <>
          {sessions.map((session) => (
            <div key={session.id || session.clientName} className="flex gap-3 items-start p-[13px] border-b border-structure-150 last:border-b-0">
              <span className="w-[54px] flex-shrink-0 text-[12.5px] text-structure-600 leading-[1.4] font-mono">
                <b className="block text-structure-900 font-500 text-[13.5px]">
                  {formatTime(session.startsAt)}
                </b>
                {formatDuration(session.durationMins)}
              </span>
              <span className="flex-1 text-[14px] leading-[1.45]">
                {session.clientName ?? "Unknown client"}
                <span className="block text-[12.5px] text-structure-600 mt-[3px]">
                  {session.serviceType ?? ""} · {session.location ?? ""}
                </span>
              </span>
              <span
                className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-500 text-[12px] flex-shrink-0 ${
                  chipVariantFor(session) === "ok"
                    ? "bg-ok-50 text-ok-600"
                    : chipVariantFor(session) === "warn"
                      ? "bg-warn-50 text-warn-600"
                      : "bg-mute-bg text-structure-600"
                }`}
              >
                {!session.clientId
                  ? "Free"
                  : session.state === "Unsigned"
                    ? "Unsigned"
                    : "Ready"}
              </span>
            </div>
          ))}
        </>
      )}

      {/* ═══ FREE SLOT GAP ═══════════════════════════════════════════════════════════════════ */}
      {slotsError && (
        <ErrorPanel
          error={slotsError}
          variant="band"
          testId="slots-error"
          onRetry={onRetrySlots}
        />
      )}
      {!slotsError && slots && (
        <div className="flex gap-3 items-start p-[13px] border-b border-structure-150 last:border-b-0">
          <span className="w-[54px] flex-shrink-0 text-[12.5px] text-structure-600 leading-[1.4] font-mono">
            <b className="block text-structure-900 font-500 text-[13.5px]">
              {formatTime(slots.nextGap?.time)}
            </b>
            —
          </span>
          <span className="flex-1 text-[14px] leading-[1.45]">
            Nobody booked it
            <span className="block text-[12.5px] text-structure-600 mt-[3px]">
              {slots.demand ?? 0} {slots.demand === 1 ? "person" : "people"}{" "}
              {slots.demand === 1 ? "has" : "have"} asked for{" "}
              {slots.dayPart ?? "evenings"} this month
            </span>
          </span>
          <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-500 text-[12px] flex-shrink-0 bg-mute-bg text-structure-600">
            Free
          </span>
        </div>
      )}

      {/* ═══ STILL TO DO ════════════════════════════════════════════════════════════════════ */}
      <div className="font-500 text-[12.5px] text-structure-600 mt-[18px] mb-[6px]">
        Still to do
      </div>
      {tasksError && (
        <ErrorPanel
          error={tasksError}
          variant="band"
          testId="tasks-error"
          onRetry={onRetryTasks}
        />
      )}
      {!tasksError && tasks.length > 0 && (
        <>
          {tasks.map((task) => (
            <div key={task.id || task.title} className="flex gap-3 items-start p-[13px] border-b border-structure-150 last:border-b-0">
              <span className="w-[54px] flex-shrink-0"></span>
              <span className="flex-1 text-[14px] leading-[1.45]">
                {task.title}
                <span className="block text-[12.5px] text-structure-600 mt-[3px]">
                  {task.detail}
                </span>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
