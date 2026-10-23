// R13-D230: the webhook topics a Docustay workspace can subscribe to — only events the product really sends, each with its emitter named. The catalogue (src/events/topics.mjs) also holds
// internal worker jobs (documents.ai.job_requested, documents.detect.job_requested), the platform-only facts (settings, notes, clauses, the record AI and PDF-import routes) and topics nothing emits yet; offering those made an
// endpoint look subscribed to something that would never arrive. Left out as the platform-only paths: documents.document.archived (records archive), documents.template.updated/published/versioned
// (HTML-template publish), type/category/disclosure facts. test/r13_webhook_topics.test.mjs fails when a topic here loses its emit() call.
export const DOCUSTAY_WEBHOOK_TOPICS = Object.freeze([
  "documents.document.created",            // src/documents/writes.mjs
  "documents.document.sent",               // src/queue/tasks.mjs
  "documents.document.opened",             // src/documents/pdfSigning.mjs
  "documents.document.signed",             // src/documents/pdfSigning.mjs
  "documents.document.declined",           // src/documents/pdfSigning.mjs
  "documents.document.changes_requested",  // src/documents/pdfSigning.mjs
  "documents.document.delegated",          // src/documents/pdfSigning.mjs
  "documents.document.executed",           // src/documents/pdfSigning.mjs
  "documents.document.voided",             // src/documents/pdfSend.mjs
  "documents.document.expired",            // src/queue/tasks.mjs
  "documents.document.reminder_due",       // src/documents/dueFacts.mjs (a scheduled reminder; a manual remind is not one)
  "documents.document.bounced",            // src/documents/emailIdentity.mjs
  "documents.document.downloaded",         // src/documents/downloads.mjs
  "documents.payment.hold_lapsed",         // src/documents/pdfSigning.mjs
  "documents.payment.received",            // src/documents/pdfPayments.mjs (markPaid)
  "documents.payment.failed",              // src/documents/pdfPayments.mjs (recordSubscriptionEvent: a plan invoice failed)
  "documents.template.created",            // src/documents/templateCap.mjs
  "documents.email.delivered",             // src/documents/emailLog.mjs (documents.email.${kind}, from the provider)
  "documents.email.bounced",               // src/documents/emailLog.mjs
  "documents.email.complained",            // src/documents/emailLog.mjs
  "documents.email.paused",                // src/documents/emailLog.mjs
  // from the workspace rather than one document (the webhooks page names the first three; the Teams panel makes the last three)
  "documents.template.fields_detected",    // src/documents/templateSources.mjs
  "documents.ai.allowance_low",            // src/documents/engine/ai/gateway.mjs
  "documents.usage.threshold",             // src/product/docustayUsage.mjs
  "documents.team.created",                // src/documents/teams.mjs
  "documents.team.updated",                // src/documents/teams.mjs
  "documents.team.deleted",                // src/documents/teams.mjs
]);
