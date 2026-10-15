/**
 * MONEY-FAMILY EMAIL TEMPLATES
 * Catalogue keys: money.*, package.running_low, invoice.late_chase, items.*, run.access_granted, run.item_blocked
 */

export const MONEY_TEMPLATES = Object.freeze([
  {
    key: "money.device_registered",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment reader is live`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Payment reader at ${v.locationName} is now live.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "locationName"],
  },

  {
    key: "money.dispute_evidence_submitted",
    family: "money",
    subject: (v, t) => `Payment dispute: evidence submitted`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Evidence on the dispute for ${v.amount} has been submitted. The bank will decide by ${v.answerBy}.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "amount", "answerBy"],
  },

  {
    key: "money.entitlement_granted",
    family: "money",
    subject: (v, t) => `${v.practiceName}: your sessions are ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your package of ${v.sessionCount} sessions is ready. Book your first one.\n\n` +
      `${v.bookLink}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "sessionCount", "bookLink"],
  },

  {
    key: "money.estimate_sent",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate for ${v.amount}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `An estimate for ${v.amount} is ready for you.\n\n` +
      `View it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "link"],
  },

  {
    key: "money.estimate_opened",
    family: "money",
    subject: (v, t) => `Estimate read`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The estimate for ${v.amount} has been read.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "amount"],
  },

  {
    key: "money.estimate_accepted",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate accepted`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The estimate for ${v.amount} has been accepted. The invoice is ready.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.estimate_declined",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate declined`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The estimate for ${v.amount} has been declined.\n\n` +
      (v.reason ? `Reason: ${v.reason}\n\n` : "") +
      `Let's discuss next steps.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.estimate_expired",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate expired`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The estimate for ${v.amount} has expired.\n\n` +
      `Contact ${v.practiceName} to send a new one.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.invoice_opened",
    family: "money",
    subject: (v, t) => `Invoice read`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} has been read.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "invoiceNumber", "amount"],
  },

  {
    key: "money.invoice_paid",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment received`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Thank you — ${v.amount} received.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.invoice_voided",
    family: "money",
    subject: (v, t) => `${v.practiceName}: invoice cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} has been cancelled.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "invoiceNumber"],
  },

  {
    key: "money.payment_retries_exhausted",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment paused`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `We couldn't charge your card after several tries. Your subscription is paused.\n\n` +
      `Update your payment method: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "money.payment_recorded_offline",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment recorded`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Payment of ${v.amount} has been recorded.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.payment_refunded",
    family: "money",
    subject: (v, t) => `${v.practiceName}: refund on the way`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.amount} is on its way back to your card. It takes 5 to 10 days to land.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.payment_plan_offered",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment plan option`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Instead of paying ${v.totalAmount} now, you can pay in installments.\n\n` +
      `Review the plan: ${v.link}\n\n` +
      `Decision needed by ${v.expiresOn}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "totalAmount", "link", "expiresOn"],
  },

  {
    key: "money.payment_plan_agreed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment plan confirmed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your payment plan is confirmed. You'll be charged ${v.installmentAmount} on these dates:\n\n` +
      `${v.installmentDates}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "installmentAmount", "installmentDates"],
  },

  {
    key: "money.payout_recorded",
    family: "money",
    subject: (v, t) => `Money landed in your bank`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A payout of ${v.amount} has been processed.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "amount"],
  },

  {
    key: "money.refund_approval_needed",
    family: "money",
    subject: (v, t) => `Refund request`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A refund of ${v.amount} is pending approval.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "amount"],
  },

  {
    key: "money.subscription_started",
    family: "money",
    subject: (v, t) => `${v.practiceName}: subscription confirmed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription is confirmed. You'll be charged ${v.amount} on ${v.nextChargeDate}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "nextChargeDate"],
  },

  {
    key: "money.subscription_paused",
    family: "money",
    subject: (v, t) => `${v.practiceName}: subscription paused`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription is paused. It will resume on ${v.resumeDate}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "resumeDate"],
  },

  {
    key: "money.subscription_resumed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: subscription active`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription is active. Next charge is ${v.nextChargeDate}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "nextChargeDate"],
  },

  {
    key: "money.subscription_cancel_scheduled",
    family: "money",
    subject: (v, t) => `${v.practiceName}: subscription ending on ${v.endDate}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription will end on ${v.endDate}.\n\n` +
      `If you change your mind, you can reactivate it in your settings.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "endDate"],
  },

  {
    key: "money.subscription_cancelled",
    family: "money",
    subject: (v, t) => `${v.practiceName}: subscription ended`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription has ended. Reach out if you'd like to reactivate.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "money.payer_group_created",
    family: "money",
    subject: (v, t) => `${v.practiceName}: you can now manage billing`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been set up to manage billing for one or more people.\n\n` +
      `Log in to see who and manage payments: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "money.payer_group_member_added",
    family: "money",
    subject: (v, t) => `${v.practiceName}: you're now billed for ${v.clientName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You'll now receive invoices for ${v.clientName}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName"],
  },

  {
    key: "money.payer_group_member_removed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: you're no longer billed for ${v.clientName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You will no longer receive invoices for ${v.clientName}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName"],
  },

  {
    key: "money.payer_group_member_moved",
    family: "money",
    subject: (v, t) => `${v.practiceName}: billing changed for ${v.clientName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Billing for ${v.clientName} has been moved.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName"],
  },

  {
    key: "money.tap_to_pay_activated",
    family: "money",
    subject: (v, t) => `${v.practiceName}: tap to pay is ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You can now take payments by tapping cards. Ready to go.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "package.running_low",
    family: "money",
    subject: (v, t) => `${v.practiceName}: your block is running low`,
    html_body: "",
    text_body: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        (v.sessionsRemaining
          ? `You're down to ${v.sessionsRemaining} ${v.sessionsRemaining === 1 ? "session" : "sessions"} in your package. Let ${v.practiceName} know if you'd like to renew.`
          : `Your session package is running low. Let ${v.practiceName} know if you'd like to renew.`) +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "invoice.late_chase",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment due`,
    html_body: "",
    text_body: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        (v.invoiceNumber && v.amount && v.daysPastDue
          ? `Invoice ${v.invoiceNumber} for ${v.amount} is waiting — it's been ${v.daysPastDue} days past due.`
          : `Payment for your invoice is due.`) +
        (v.link ? `\n\nPay it here: ${v.link}` : "") +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "items.gift_card_sold",
    family: "money",
    subject: (v, t) => `${v.practiceName}: gift card`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A gift card for ${v.amount} has been created.\n\n` +
      `Code: ${v.code}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "code"],
  },

  {
    key: "items.gift_card_nudged",
    family: "money",
    subject: (v, t) => `${v.practiceName}: you still have ${v.balanceRemaining}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You still have ${v.balanceRemaining} left on your gift card.\n\n` +
      `Book a session: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "balanceRemaining", "link"],
  },

  {
    key: "items.gift_card_voided",
    family: "money",
    subject: (v, t) => `${v.practiceName}: gift card cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The gift card for ${v.amount} has been cancelled.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "items.loyalty_points_earned",
    family: "money",
    subject: (v, t) => `${v.practiceName}: you earned ${v.points} points`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You earned ${v.points} loyalty points. Keep going.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "points"],
  },

  {
    key: "items.loyalty_reward_claimed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: reward claimed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your reward has been applied to your account.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "run.item_blocked",
    family: "money",
    subject: (v, t) => `${v.practiceName}: access temporarily paused`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your access is temporarily paused. ${v.reason}\n\n` +
      `Contact ${v.practiceName} to fix it.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "reason"],
  },

  {
    key: "run.access_granted",
    family: "money",
    subject: (v, t) => `${v.practiceName}: access restored`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your access has been restored. You can now:\n\n` +
      `${v.whatCanDo}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whatCanDo"],
  },
]);
