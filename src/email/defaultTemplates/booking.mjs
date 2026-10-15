/**
 * BOOKING-FAMILY EMAIL TEMPLATES
 * Catalogue keys: booking.*, calendar.*, run.review_ask, tasks.session_writeup
 */

export const BOOKING_TEMPLATES = Object.freeze([
  {
    key: "booking.booking_created",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: you're booked for ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You're booked — ${v.whenLocal} (${v.timeZone}), ${v.serviceName}.\n\n` +
      `If you need to change it, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.booking_confirmed",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: confirmed for ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Confirmed — ${v.whenLocal} (${v.timeZone}).\n\n` +
      `${v.serviceName}.\n\n` +
      `Contact ${v.practiceName} if you need to reschedule.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.booking_rescheduled",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: your session moved to ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your session has moved to ${v.whenLocal} (${v.timeZone}):\n\n` +
      `  ${v.serviceName}\n\n` +
      `If this does not work for you, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.booking_cancelled",
    family: "booking",
    subject: (v, t) => v.whenLocal
      ? `${v.practiceName}: your session on ${v.whenLocal} was cancelled`
      : `${v.practiceName}: your session was cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      (v.whenLocal
        ? `Your session on ${v.whenLocal} (${v.timeZone}) has been cancelled.\n\n`
        : `Your session (${v.serviceName}) has been cancelled.\n\n`) +
      (v.reasonLine ? `${v.reasonLine}\n\n` : "") +
      `Questions? Contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.participant_added",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: you're added to a session`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been added to a session:\n\n` +
      `  ${v.serviceName}\n  ${v.whenLocal} (${v.timeZone})\n\n` +
      `Contact ${v.practiceName} with questions.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.waitlist_offered",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: a time just opened up`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A time has come up — ${v.whenLocal}, with ${v.hostName}.\n\n` +
      `  ${v.serviceName}\n\n` +
      (v.toldOthers ? `${v.toldOthers}\n\n` : "") +
      `Whoever takes it first gets it: ${v.link}\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whenLocal", "serviceName", "hostName", "link"],
  },

  {
    key: "booking.hold_expired",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: your reserved time was released`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The time you held has been released.\n\n` +
      `Reach out to ${v.practiceName} to book another.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "booking.entitlement_exhausted",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: your block is used up`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've used all the sessions in your package. Get another to keep going.\n\n` +
      `Contact ${v.practiceName} to renew.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "booking.entitlement_expiring",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: your block expires ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your session package expires ${v.whenLocal}. Book your remaining sessions or renew.\n\n` +
      `Contact ${v.practiceName} to renew or reschedule.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whenLocal"],
  },

  {
    key: "booking.availability_changed",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: availability changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.hostName}'s availability has changed.\n\n` +
      (v.affectedBookings
        ? `This affects ${v.affectedBookings}. Contact ${v.practiceName} if you need help rescheduling.\n\n`
        : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "hostName"],
  },

  {
    key: "booking.policy_changed",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: cancellation policy updated`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The cancellation policy at ${v.practiceName} has changed.\n\n` +
      `This applies to your future bookings. Review the new terms:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "booking.day_summary",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: your schedule for ${v.date}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Here's your schedule for ${v.date}:\n\n` +
      `${v.bookingsList}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "date", "bookingsList"],
  },

  {
    key: "calendar.connection_connected",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: calendar synced`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.calendarType} calendar is now synced. Sessions show up in both places.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "calendarType"],
  },

  {
    key: "calendar.connection_disconnected",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: calendar sync stopped`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your calendar sync has stopped. Double-booking is now possible.\n\n` +
      `Reconnect in Settings to stay in sync.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "calendar.connection_renewal_failed",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: reconnect your calendar`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `We can't reach your calendar. Reconnect in Settings to stay synced.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "calendar.remote_change_flagged",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: calendar change needs attention`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Something changed outside Workbench in your calendar. Review and confirm the change.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "run.review_ask",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: share your feedback`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} would love to hear what you think about your sessions.\n\n` +
      `Share your feedback: ${v.reviewLink}\n\n` +
      `It takes about a minute, and your thoughts help shape how ${v.practiceName} works.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "reviewLink", `userType.coach`],
  },

  {
    key: "tasks.session_writeup",
    family: "booking",
    subject: (v, t) => `${v.practiceName}: write up the session`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Session with ${v.clientName} on ${v.whenLocal} is done.\n\n` +
      `Write it up: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "whenLocal", "link"],
  },
]);
