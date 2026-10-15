/**
 * DOCUMENTS-FAMILY EMAIL TEMPLATES
 * Catalogue keys: documents.*
 */

export const DOCUMENTS_TEMPLATES = Object.freeze([
  {
    key: "documents.document_sent",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: your ${v.documentTitle} is ready to sign`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} has sent you a document to review ` +
      `and sign: ${v.documentTitle}.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `Nothing is signed until you choose to sign it, and you can read the whole document first.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle", "link", `userType.coach`],
  },

  {
    key: "documents.document_opened",
    family: "documents",
    subject: (v, t) => `${v.documentTitle} opened`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.recipientName} has read ${v.documentTitle}.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "documentTitle"],
  },

  {
    key: "documents.document_reminder_due",
    family: "documents",
    subject: (v, t) => `Reminder — ${v.practiceName}: please read and sign ${v.documentTitle}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `This is a reminder from ${v.senderName && v.senderName !== v.practiceName ? `${v.senderName} at ${v.practiceName}` : v.practiceName}: ${v.documentTitle} is still ` +
      `waiting for your signature.\n\n` +
      `It takes about a minute to read and sign.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `No account needed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle", "link", "senderName"],
  },

  {
    key: "documents.document_signed",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.documentTitle} signed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.documentTitle} has been signed.\n\n` +
      `A copy is attached.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle"],
  },

  {
    key: "documents.document_executed",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.documentTitle} fully signed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.documentTitle} has been fully executed — all signatures are in.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle"],
  },

  {
    key: "documents.document_declined",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.documentTitle} declined`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.documentTitle} has been declined.\n\n` +
      (v.reason ? `Reason: ${v.reason}\n\n` : "") +
      `Let's discuss next steps.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle"],
  },

  {
    key: "documents.document_expired",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.documentTitle} expired`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.documentTitle} has expired and is no longer available to sign.\n\n` +
      `Contact ${v.practiceName} to send a new one.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle"],
  },

  {
    key: "documents.template_published",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.templateName} is now live`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.templateName} is now live. ${v.serviceNames} will include it.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "templateName", "serviceNames"],
  },

  {
    key: "documents.template_versioned",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${v.templateName} updated`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.templateName} has been updated.\n\n` +
      `Signed copies are unaffected — they stay as they were signed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "templateName"],
  },

  {
    key: "documents.disclosure_accepted",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: signing is now available`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your disclosure has been accepted. Signing is now available for this practice.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "documents.disclosure_withdrawn",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: signing is no longer available`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your disclosure has been withdrawn. Signing is no longer available for this practice.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "documents.note_shared",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: a note was shared with you`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A note from your session has been shared with you.\n\n` +
      `Review it: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "documents.pdf_imported",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: PDF ready to turn into a template`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The PDF ${v.fileName} has been imported and is ready to set up as a template.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "fileName"],
  },

  {
    key: "documents.ai_check_run",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: document check findings`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The document check has been run on ${v.documentTitle}.\n\n` +
      (v.findings ? `Findings:\n\n${v.findings}\n\n` : "No issues flagged.\n\n") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle"],
  },
]);
