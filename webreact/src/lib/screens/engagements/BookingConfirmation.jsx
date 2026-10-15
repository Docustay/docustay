// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.005 — BookingConfirmation. Ported from webui/src/lib/screens/engagements/BookingConfirmation.svelte.
// Confirms a public booking with checkmark rows for email, reminder, sign, free.
//
// ★★★ DOCTRINE 3 — ONLY THE ✓ ROWS THAT ARE TRUE, EACH ONE A PROMISE TO A STRANGER.
// See the Svelte source for full context on which rows are drawn and why.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function BookingConfirmation({
  startsAt,
  timezone = "UTC",
  coachName = null,
  email = null,
  paymentMode = null,
  reminderMinutesBefore = null,
  agreementRequired = false,
  agreementLabel = null,
  supportPhone = null,
}) {
  // Format the booking time from startsAt and timezone
  const when = (() => {
    if (!startsAt) return null;
    const d = new Date(startsAt);
    const day = d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone,
    });
    const time = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    return `${day} at ${time}`;
  })();

  // Helper to format reminder time
  const leadTimeSentence = (minutes) => {
    if (Number.isInteger(minutes) && minutes % 60 === 0) {
      return `${minutes / 60} hours`;
    }
    return `${minutes} minutes`;
  };

  // Conditional flags
  const showReminder =
    Number.isFinite(reminderMinutesBefore) && reminderMinutesBefore > 0;
  const showSign = agreementRequired === true;
  const showFree = paymentMode === "free";

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="booking-confirmed"
    >
      <h1 className="text-[30px] font-medium text-structure-900">
        You're booked
      </h1>
      <p
        className="max-w-[62ch] text-[15px] text-structure-700"
        data-testid="confirm-when"
      >
        {when ? (
          <>
            {when}
            {coachName ? `, with ${coachName}` : ""}.
          </>
        ) : (
          <>Check your email for the details.</>
        )}
      </p>

      <div className="mt-4 flex max-w-[600px] flex-col divide-y divide-structure-150 rounded-[14px] border border-structure-200 bg-structure-0 p-6">
        {/* Email confirmation — always drawn */}
        <div
          className="flex gap-3.5 py-3.5"
          data-testid="confirm-row-email"
        >
          <span className="w-[22px] text-success-700">✓</span>
          <span className="text-sm text-structure-900">
            <b className="font-medium">We've emailed you a confirmation</b>
            <span className="mt-0.5 block text-[13px] text-structure-600">
              A confirmation has been sent to{" "}
              {email || "your email"}
              .
            </span>
          </span>
        </div>

        {/* Reminder — conditional */}
        {showReminder && (
          <div
            className="flex gap-3.5 py-3.5"
            data-testid="confirm-row-reminder"
          >
            <span className="w-[22px] text-success-700">✓</span>
            <span className="text-sm text-structure-900">
              <b className="font-medium">You'll get a reminder</b>
              <span className="mt-0.5 block text-[13px] text-structure-600">
                By email, {leadTimeSentence(reminderMinutesBefore)} before.
              </span>
            </span>
          </div>
        )}

        {/* Sign — conditional */}
        {showSign && (
          <div
            className="flex gap-3.5 py-3.5"
            data-testid="confirm-row-sign"
          >
            <span className="w-[22px] text-success-700">✓</span>
            <span className="text-sm text-structure-900">
              <b className="font-medium">One thing to sign</b>
              <span className="mt-0.5 block text-[13px] text-structure-600">
                {agreementLabel ?? "A coaching agreement"}. It takes a minute
                and you can do it now.
              </span>
            </span>
          </div>
        )}

        {/* Free — conditional */}
        {showFree && (
          <div
            className="flex gap-3.5 py-3.5"
            data-testid="confirm-row-free"
          >
            <span className="w-[22px] text-success-700">✓</span>
            <span className="text-sm text-structure-900">
              <b className="font-medium">Nothing has been charged</b>
              <span className="mt-0.5 block text-[13px] text-structure-600">
                This one's free. If you carry on, we'll talk about that then.
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Support phone — conditional */}
      {supportPhone && (
        <p
          className="mt-3 max-w-[62ch] text-[13.5px] text-structure-600"
          data-testid="confirm-call-us"
        >
          Need to change it? Call {supportPhone}.
        </p>
      )}
    </div>
  );
}
