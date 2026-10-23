/**
 * PLATFORM-FAMILY EMAIL TEMPLATES
 * Catalogue keys: reports.*, provisioning.*, platform.*, settings.*, tasks.*, messages.*, developer.*, network.*, forms.*, accounts.*
 */

export const WORKBENCH_TEMPLATES = Object.freeze([
  {
    key: "reports.monthly_writeup",
    family: "reports",
    subject: (v, t) => `${v.practiceName}: your monthly report is ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your monthly write-up${v.month ? ` for ${v.month}` : ""} is ready to review.\n\n` +
      (v.link ? `View it here: ${v.link}\n\n` : "") +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "provisioning.questions_answered",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: audit findings`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The setup audit has been completed. Here are the findings:\n\n` +
      `${v.findings}\n\n` +
      `Review them: ${v.link}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "findings", "link"],
  },

  {
    key: "provisioning.run_completed",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: you're all set`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your setup is complete. You're ready to go.\n\n` +
      `Here are five things to do next:\n\n` +
      `${v.nextSteps}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "nextSteps"],
  },

  {
    key: "provisioning.samples_created",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: sample data loaded`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Sample data has been created to explore Workbench.\n\n` +
      `Log in and see how it works. When you're ready, clear the samples and start with your real data.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "provisioning.step_failed",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: setup issue`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A setup step has failed:\n\n` +
      `${v.error}\n\n` +
      `Contact support to get unstuck.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "error"],
  },

  {
    key: "platform.tenant_provisioned",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: welcome to Workbench`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.practiceName} is now on Workbench.\n\n` +
      `Get started: ${v.link}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "platform.support_access_requested",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: Workbench asked to look at your account`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Workbench support asked to look at ${v.practiceName}'s account, read only, for ${v.duration} minutes.\n\n` +
      `Why: ${v.why}\n\n` +
      `Nothing happens unless you say yes. Answer it in Settings → Team and roles → Support access.\n\n` +
      `Whatever you decide, the request stays in your activity log.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "why", "duration"],
  },

  {
    key: "platform.support_access_answered",
    family: "platform",
    subject: (v, t) => `Support access: ${v.answer}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The support access request for ${v.practiceName} is ${v.answer}.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "practiceName", "answer"],
  },

  {
    key: "platform.support_access_ended",
    family: "platform",
    subject: (v, t) => `Support access ended`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Support access to ${v.practiceName} has ended.\n\n` +
      `What was done: ${v.actionsPerformed}\n\n` +
      `— Workbench`,
    variables: ["recipientName", "practiceName", "actionsPerformed"],
  },

  {
    key: "platform.impersonation_started",
    family: "platform",
    subject: (v, t) => `${v.practiceName}: Workbench support is using your account`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Workbench support is temporarily using your account to help you.\n\n` +
      `This will end in ${v.duration}.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "duration"],
  },

  {
    key: "platform.job_given_up",
    family: "platform",
    subject: (v, t) => `Something failed permanently`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `A background task has failed permanently:\n\n` +
      `${v.jobDescription}\n` +
      `Error: ${v.error}\n\n` +
      `This needs attention.\n\n` +
      `— Workbench`,
    variables: ["jobDescription", "error"],
  },

  {
    key: "tasks.task_assigned",
    family: "tasks",
    subject: (v, t) => `${v.practiceName}: task assigned`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A task has been assigned to you:\n\n` +
      `${v.taskTitle}\n\n` +
      `Due: ${v.dueDate}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "taskTitle", "dueDate"],
  },

  {
    key: "tasks.task_completed",
    family: "tasks",
    subject: (v, t) => `${v.practiceName}: task completed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.taskTitle} has been completed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "taskTitle"],
  },

  {
    key: "tasks.task_reassigned",
    family: "tasks",
    subject: (v, t) => `${v.practiceName}: task reassigned`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.taskTitle} has been reassigned to ${v.newAssignee}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "taskTitle", "newAssignee"],
  },

  {
    key: "messages.message_sent",
    family: "messaging",
    subject: (v, t) => `${v.practiceName}: new message`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `New message from ${v.senderName}:\n\n` +
      `${v.messageSnippet}\n\n` +
      `Reply: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "senderName", "messageSnippet", "link"],
  },

  {
    key: "network.party_created",
    family: "network",
    subject: (v, t) => `${v.practiceName}: new referral partner`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.partyName} has been added as a referral partner.\n\n` +
      (v.sendIntroUrl ? `Send them an intro: ${v.sendIntroUrl}\n\n` : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "partyName"],
  },

  {
    key: "network.referral_created",
    family: "network",
    subject: (v, t) => `${v.practiceName}: mutual referral opportunity`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A referral opportunity has been created between you and ${v.partnerName}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "partnerName"],
  },

  {
    key: "forms.lead_task",
    family: "legal",
    subject: (v, t) => `${v.practiceName}: form submitted`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A form has been submitted:\n\n` +
      `Name: ${v.submitterName}\n` +
      `Email: ${v.submitterEmail}\n\n` +
      `Message: ${v.message}\n\n` +
      `Review: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "submitterName", "submitterEmail", "message", "link"],
  },

  {
    key: "settings.terminology_changed",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: terminology renamed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The practice's terminology has been updated:\n\n` +
      `${v.changesSummary}\n\n` +
      `This affects all screens and emails.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "changesSummary"],
  },

  {
    key: "settings.policy_announced",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: policy update`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `${v.practiceName} has announced a policy:\n\n` +
      `${v.policyText}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "policyText"],
  },

  {
    key: "settings.data_export_requested",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: data export requested`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A data export for ${v.practiceName} has been requested.\n\n` +
      `It will be ready in a few minutes.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "settings.data_export_ready",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: your data is ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your data export is ready.\n\n` +
      `Download it here: ${v.link}\n\n` +
      `The link expires on ${v.expiresOn}.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "link", "expiresOn"],
  },

  {
    key: "settings.data_person_export_requested",
    family: "settings",
    subject: (v, t) => `Subject access request received`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A subject access request has been received for ${v.practiceName}.\n\n` +
      `Please fulfill within ${v.dayLimit} days.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "practiceName", "dayLimit"],
  },

  {
    key: "settings.data_person_removal_completed",
    family: "settings",
    subject: (v, t) => `Data removal completed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Data removal for ${v.practiceName} has been completed.\n\n` +
      `What was removed: ${v.removed}\n` +
      `What was kept: ${v.kept}\n\n` +
      `— Workbench`,
    variables: ["recipientName", "practiceName", "removed", "kept"],
  },

  {
    key: "settings.import_completed",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: import complete`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The import has been completed.\n\n` +
      `Imported: ${v.importedCount}\n` +
      `Failed: ${v.failedCount}\n\n` +
      `You have 30 days to undo if needed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "importedCount", "failedCount"],
  },

  {
    key: "settings.import_undone",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: import reversed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The import has been reversed. All imported records have been removed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "settings.push_device_registered",
    family: "settings",
    subject: (v, t) => `Push notifications enabled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Push notifications are now on for this device.\n\n` +
      `— Workbench`,
    variables: ["recipientName"],
  },

  {
    key: "settings.subscription_updated",
    family: "settings",
    subject: (v, t) => `${v.practiceName}: your Workbench plan changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your subscription has been updated to ${v.planName}.\n\n` +
      `New price: ${v.newPrice}\n` +
      `Effective: ${v.effectiveDate}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "planName", "newPrice", "effectiveDate"],
  },

  {
    key: "developer.api_key_created",
    family: "developer",
    subject: (v, t) => `${v.practiceName}: API key created`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `An API key has been created for ${v.practiceName}.\n\n` +
      `Scopes: ${v.scopes}\n\n` +
      `Keep this key safe.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "scopes"],
  },

  {
    key: "developer.api_key_revoked",
    family: "developer",
    subject: (v, t) => `${v.practiceName}: API key revoked`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `An API key for ${v.practiceName} has been revoked.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "developer.api_key_scopes_changed",
    family: "developer",
    subject: (v, t) => `${v.practiceName}: API key permissions changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Permissions for an API key have been updated:\n\n` +
      `${v.scopeChanges}\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "scopeChanges"],
  },

  {
    key: "developer.webhook_endpoint_created",
    family: "developer",
    subject: (v, t) => `${v.practiceName}: webhook created`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A webhook endpoint has been created.\n\n` +
      `URL: ${v.webhookUrl}\n` +
      `Events: ${v.events}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "webhookUrl", "events"],
  },

  {
    key: "developer.webhook_endpoint_removed",
    family: "developer",
    subject: (v, t) => `${v.practiceName}: webhook removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A webhook endpoint has been removed.\n\n` +
      `URL: ${v.webhookUrl}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "webhookUrl"],
  },

  {
    key: "accounts.account_created",
    family: "accounts",
    subject: (v, t) => `New account created`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A new account has been created: ${v.accountName}.\n\n` +
      `— Workbench`,
    variables: ["recipientName", "accountName"],
  },

  {
    key: "accounts.pipeline_advanced",
    family: "accounts",
    subject: (v, t) => `${v.accountName}: next step`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.accountName} has advanced to ${v.stageName}.\n\n` +
      `Next action: ${v.nextAction}\n\n` +
      `— Workbench`,
    variables: ["recipientName", "accountName", "stageName", "nextAction"],
  },
]);
