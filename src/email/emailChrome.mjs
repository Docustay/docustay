// Which of the shared email frame's optional slots (one button, one big lead line and subtext) a template fills, and from which variables. Pure; split out of send.mjs so the proof fixture and the sender read the same function.
/**
 * ★ Part 3 invoice rebuild — see its call site's own comment for why this lives here. `vars` is
 *   whatever `renderTemplate`'s caller (deliverNotificationEmail, src/queue/tasks.mjs) already
 *   built for the liquid render; this reads the SAME object, never a second source of truth.
 */
export function emailChromeFor(templateKey, vars, env = process.env) {
  // the plan-limit notices point at the app's Billing page: a button, on an absolute address (nothing is shown when the app's address is not configured)
  if (templateKey === "workbench.owner_notice" && vars?.link === "/billing") {
    const base = String(env.KEYSTONE_DOCUSTAY_APP_URL || env.KEYSTONE_APP_URL || env.KEYSTONE_PUBLIC_URL || "").replace(/\/+$/, "");
    return { ctaLabel: /^https?:\/\//i.test(base) ? "Open Billing" : null, ctaLink: /^https?:\/\//i.test(base) ? `${base}/billing` : null, leadText: null, leadSubtext: null };
  }
  if (templateKey === "money.invoice_issued" || templateKey === "money.invoice_reminder" || templateKey === "automation.invoice_chase") {
    return {
      ctaLabel: vars.payUrl ? "Pay invoice" : null,
      ctaLink: vars.payUrl ?? null,
      leadText: vars.amount ? `${vars.amount} due` : null,
      leadSubtext: vars.standing ? `${vars.standing[0].toUpperCase()}${vars.standing.slice(1)}${vars.dueLocal ? ` · due ${vars.dueLocal}` : ""}` : (vars.dueLocal ? `Due ${vars.dueLocal}` : null),
    };
  }
  // Booking everywhere (22 Oct 2026, plan frame 20): the client's confirmation, moved and reminder emails carry the buttons "Add to calendar",
  // "Reschedule" and "Cancel" (absent for a cancelled, started or past booking, and the cancelled email never has them). Reschedule and Cancel
  // open the SAME manage link with `&do=move` / `&do=cancel`; "Add to calendar" is the .ics. The assigned person's emails open the booking in the platform.
  if (templateKey === "booking.confirmed" || templateKey === "booking.moved" || templateKey === "booking.reminder") {
    const buttons = [];
    if (vars?.manageUrl) {
      if (vars.icsUrl) buttons.push({ label: "Add to calendar", href: vars.icsUrl, variant: "secondary" });
      buttons.push({ label: "Reschedule", href: vars.rescheduleUrl || vars.manageUrl, variant: "primary" });
      buttons.push({ label: "Cancel", href: vars.cancelUrl || vars.manageUrl, variant: "secondary" });
    }
    return { ctaLabel: null, ctaLink: null, buttons, leadText: null, leadSubtext: null };
  }
  // The client's cancelled email offers a way back in: one button to the practice's booking page.
  if (templateKey === "booking.cancelled") {
    return { ctaLabel: vars?.bookUrl ? "Book a new time" : null, ctaLink: vars?.bookUrl ?? null, leadText: null, leadSubtext: null };
  }
  if (templateKey === "booking.host_new" || templateKey === "booking.host_moved" || templateKey === "booking.host_cancelled") {
    return { ctaLabel: vars?.bookingLink ? "Open in Workbench" : null, ctaLink: vars?.bookingLink ?? null, leadText: null, leadSubtext: null };
  }
  if (templateKey === "money.invoice_overdue") {
    return { ctaLabel: vars.link ? "Open the invoice" : null, ctaLink: vars.link ?? null, leadText: vars.amount ? `${vars.amount}` : null, leadSubtext: vars.standing ? `${vars.standing[0].toUpperCase()}${vars.standing.slice(1)}` : null };
  }
  if (templateKey === "money.receipt") {
    return {
      ctaLabel: vars.link ? "View receipt" : null,
      ctaLink: vars.link ?? null,
      leadText: vars.amount ? `${vars.amount} paid` : null,
      leadSubtext: vars.whenLocal ? `Paid ${vars.whenLocal}` : null,
    };
  }
  return { ctaLabel: null, ctaLink: null, leadText: null, leadSubtext: null };
}
