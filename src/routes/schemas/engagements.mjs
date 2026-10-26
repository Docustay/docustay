// src/routes/schemas/engagements.mjs — L1.5.engagements (RECONCILE de-code, 27 Sep 2026): body schemas for the
// engagements write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
//
// ★ THE L1 RULE (specs/de-code/build/respec/L1-money.md): a schema is the handler's destructured parameter
//   list with a TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules
//   stay in the handler — frozen test/c_required_fields asserts the handler's own 422s); unknown keys are
//   stripped (Zod's default) EXCEPT on a row whose handler takes `...rest` (z.looseObject — they pass
//   through, as today); `tenantId`, `actorUserId`, `principal` are never listed (the runner stamps them
//   after the parse); a key the handler only passes through, or wraps in String(), is
//   `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const ENGAGEMENT_SCHEMAS = Object.freeze({
  // createAvailabilityRule — src/booking/writes.mjs:52
  "/api/engagements/availability": z.object({
    hostId: id.nullish(),
    dayOfWeek: z.number().nullish(),
    startMinute: z.number().nullish(),
    endMinute: z.number().nullish(),
    effectiveFrom: z.string().nullish(),
    effectiveTo: z.string().nullish(),
  }),
  // endAvailabilityRule — src/booking/writes.mjs:107
  "/api/engagements/availability/end": z.object({
    ruleId: id.nullish(),
    onDate: z.string().nullish(),
  }),
  // upsertDateOverride — src/booking/writes.mjs:137
  "/api/engagements/date-overrides": z.object({
    hostId: id.nullish(),
    onDate: z.string().nullish(),
    isAvailable: z.boolean().nullish(),
    startMinute: z.number().nullish(),
    endMinute: z.number().nullish(),
    reason: z.string().nullish(),
  }),
  // setBookingPolicy — src/booking/writes.mjs:254 (takes `...rest`: unknown keys PASS THROUGH — z.looseObject)
  "/api/engagements/booking-policy": z.looseObject({
    serviceId: id.nullish(),
  }),
  // createBooking — src/booking/createBooking.mjs:100 (positional row: startsAt/endsAt become Dates AFTER this parse; `capacity` and `priceId` keep absent≠null, which Zod preserves)
  "/api/engagements/bookings": z.object({
    hostId: id.nullish(),
    serviceId: id.nullish(),
    startsAt: z.string().nullish(),
    endsAt: z.string().nullish(),
    bufferBeforeMinutes: z.number().nullish(),
    bufferAfterMinutes: z.number().nullish(),
    inviteeTimezone: z.string().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    locationKind: z.string().nullish(),
    locationDetail: z.string().nullish(),
    recurrenceCadence: z.string().nullish(),
    recurrenceGroupId: id.nullish(),
    creditForUserId: id.nullish(),
    reminderMinutesBefore: z.number().nullish(),
    capacity: z.number().nullish(),
    source: z.string().nullish(),
    priceId: id.nullish(),
    personId: id.nullish(),
    tellClient: z.boolean().nullish(),
  }),
  // createRecurringBookings — src/booking/createRecurringBookings.mjs (BOOKING OVERHAUL, 29 Sep 2026)
  "/api/engagements/bookings/recurring": z.object({
    hostId: id.nullish(),
    serviceId: id.nullish(),
    startsAt: z.string().nullish(),
    endsAt: z.string().nullish(),
    bufferBeforeMinutes: z.number().nullish(),
    bufferAfterMinutes: z.number().nullish(),
    inviteeTimezone: z.string().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    locationKind: z.string().nullish(),
    locationDetail: z.string().nullish(),
    recurrenceCadence: z.string().nullish(),
    recurrenceEnd: z.unknown().optional(),
    creditForUserId: id.nullish(),
    reminderMinutesBefore: z.number().nullish(),
    capacity: z.number().nullish(),
    source: z.string().nullish(),
    priceId: id.nullish(),
    personId: id.nullish(),
    tellClient: z.boolean().nullish(),
  }),
  // cancelRecurringSeries — src/booking/createRecurringBookings.mjs
  "/api/engagements/bookings/recurring/cancel": z.object({
    recurrenceGroupId: id.nullish(),
  }),
  // cancelBookingByRequest — src/booking/reschedule.mjs:81
  "/api/engagements/bookings/cancel": z.object({
    bookingId: id.nullish(),
    skipVisibilityCheck: z.boolean().nullish(),
  }),
  // rescheduleBooking — src/booking/reschedule.mjs:204
  "/api/engagements/bookings/reschedule": z.object({
    bookingId: id.nullish(),
    startsAt: z.string().nullish(),
    endsAt: z.string().nullish(),
    skipVisibilityCheck: z.boolean().nullish(),
    tellClient: z.boolean().nullish(),
    note: z.string().nullish(),
  }),
  // addBookingParticipant — src/booking/writes.mjs:343
  "/api/engagements/participants": z.object({
    bookingId: id.nullish(),
    party: z.string().nullish(),
    displayName: z.string().nullish(),
    appUserId: id.nullish(),
    email: z.string().nullish(),
  }),
  // settleBooking — src/booking/settleBooking.mjs (BOOKING OVERHAUL, 29 Sep 2026). Always the
  // {bookingId, outcome, participants} shape — never the ambiguous single-participant shape
  // setAttendance's own schema below has to allow for, so `subject: "bookingId"` is safe here.
  "/api/engagements/attendance/settle": z.object({
    bookingId: id.nullish(),
    outcome: z.string().nullish(),
    participants: z.unknown().optional(),
    paymentMethod: z.string().nullish(),
  }),
  // setAttendance — src/booking/writes.mjs:455 → recordAttendance (src/booking/attendance.mjs:154)
  "/api/engagements/attendance": z.object({
    participantId: id.nullish(),
    attended: z.boolean().nullish(),
    outcome: z.string().nullish(),
    bookingId: id.nullish(),
    participants: z.unknown().optional(),
  }),
  // addToWaitlist — src/booking/waitlist.mjs:107
  "/api/engagements/waitlist": z.object({
    serviceId: id.nullish(),
    hostId: id.nullish(),
    bookingId: id.nullish(),
    personId: id.nullish(),
    displayName: z.string().nullish(),
    email: z.unknown().optional(),
    phone: z.string().nullish(),
    preference: z.string().nullish(),
    preferenceNote: z.string().nullish(),
    preferenceDays: z.number().nullish(),
    kind: z.string().nullish(),
  }),
  // removeFromWaitlist — src/booking/waitlist.mjs:200
  "/api/engagements/waitlist/remove": z.object({
    entryId: id.nullish(),
  }),
  // offerTime — src/booking/waitlist.mjs:312
  "/api/engagements/waitlist/offer": z.object({
    entryId: id.nullish(),
    startsAt: z.string().nullish(),
    hostId: id.nullish(),
  }),
  // createBlock — src/booking/blocks.mjs:239 (positional row: the runner turns startsAt/endsAt into Dates AFTER this parse, so they are strings here)
  "/api/engagements/blocks": z.object({
    hostId: id.nullish(),
    label: z.unknown().optional(),
    startsAt: z.string().nullish(),
    endsAt: z.string().nullish(),
    repeat: z.string().nullish(),
    repeatUntil: z.string().nullish(),
  }),
  // stopBlock — src/booking/blocks.mjs:352
  "/api/engagements/blocks/stop": z.object({
    blockId: id.nullish(),
    fromDate: z.unknown().optional(),
  }),
  // skipBlockDay — src/booking/blocks.mjs:401
  "/api/engagements/blocks/skip": z.object({
    blockId: id.nullish(),
    date: z.unknown().optional(),
  }),
  // setWeekHours — src/booking/hours.mjs:160
  "/api/engagements/hours": z.object({
    hostId: id.nullish(),
    days: z.unknown().optional(),
    fixGoogle: z.boolean().nullish(),
  }),
  // setBookingFlag — src/booking/writes.mjs:524
  "/api/engagements/bookings/flag": z.object({
    bookingId: id.nullish(),
    flag: z.string().nullish(),
    note: z.string().nullish(),
  }),
});
