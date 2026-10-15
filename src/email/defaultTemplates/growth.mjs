/**
 * GROWTH-FAMILY EMAIL TEMPLATES
 * Catalogue keys: growth.*, ads.keyword_pause, run.competitor_watch_recorded
 */

export const GROWTH_TEMPLATES = Object.freeze([
  {
    key: "growth.campaign_scheduled",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: campaign ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Campaign scheduled:\n` +
      `To: ${v.recipientCount}\n` +
      `When: ${v.sendDate}\n` +
      `Subject: ${v.subject}\n\n` +
      `Review and send: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "recipientCount", "sendDate", "subject", "link"],
  },

  {
    key: "growth.campaign_sent",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: campaign delivered`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Campaign sent to ${v.recipientCount}:\n\n` +
      `Delivered: ${v.deliveredCount}\n` +
      `Opened: ${v.openedCount}\n` +
      `Clicked: ${v.clickedCount}\n` +
      `Bounced: ${v.bouncedCount}\n\n` +
      `View results: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "recipientCount", "deliveredCount", "openedCount", "clickedCount", "bouncedCount", "link"],
  },

  {
    key: "growth.consent_unsubscribed",
    family: "growth",
    subject: (v, t) => `Unsubscribe recorded`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.personEmail} has unsubscribed from emails.\n\n` +
      `They will no longer receive campaigns.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "personEmail"],
  },

  {
    key: "growth.consent_resubscribed",
    family: "growth",
    subject: (v, t) => `Resubscribe recorded`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.personEmail} has resubscribed to emails.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "personEmail"],
  },

  {
    key: "growth.landing_page_lead",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: new lead from your site`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Someone filled out your form:\n\n` +
      `Name: ${v.leadName}\n` +
      `Email: ${v.leadEmail}\n` +
      `Message: ${v.leadMessage}\n\n` +
      `Respond quickly: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "leadName", "leadEmail", "leadMessage", "link"],
  },

  {
    key: "ads.keyword_pause",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: keyword paused`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A keyword has been automatically paused due to high spending:\n\n` +
      `"${v.keyword}"\n` +
      `Spend: ${v.spendAmount}\n` +
      `ROI: ${v.roiPercent}%\n\n` +
      `Review: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "keyword", "spendAmount", "roiPercent", "link"],
  },

  {
    key: "run.competitor_watch_recorded",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: monthly competitor summary`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Competitor activity for ${v.monthName}:\n\n` +
      `${v.activitySummary}\n\n` +
      `Review: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "monthName", "activitySummary", "link"],
  },
]);
