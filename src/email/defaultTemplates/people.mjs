/**
 * PEOPLE-FAMILY EMAIL TEMPLATES
 * Catalogue keys: people.*, booking.first_agreement
 */

export const PEOPLE_TEMPLATES = Object.freeze([
  {
    key: "people.person_created",
    family: "people",
    subject: (v, t) => `${v.practiceName}: welcome`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been added to ${v.practiceName}.\n\n` +
      `Get started: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  {
    key: "people.person_invited",
    family: "people",
    subject: (v, t) => `${v.practiceName} invited you`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `${v.inviterName} has invited you to join ${v.practiceName} on Workbench.\n\n` +
      (v.personalLine ? `${v.personalLine}\n\n` : "") +
      `Accept the invitation here: ${v.acceptUrl}\n\n` +
      `This invitation expires on ${v.expiresOn}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "inviterName", "acceptUrl", "expiresOn"],
  },

  {
    key: "people.person_assigned",
    family: "people",
    subject: (v, t) => `${v.practiceName}: you have a new client`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been assigned to ${v.clientName}.\n\n` +
      `Their background: ${v.clientContext}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "clientContext"],
  },

  {
    key: "people.person_role_changed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: your role changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your role at ${v.practiceName} is now ${v.newRole}.\n\n` +
      `Your access has been updated.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "newRole"],
  },

  {
    key: "people.person_stage_changed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: ${v.stageName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.clientName} has moved to ${v.stageName}.\n\n` +
      `Next step: ${v.nextAction}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "stageName", "nextAction"],
  },

  {
    key: "people.person_lead_next_step_set",
    family: "people",
    subject: (v, t) => `${v.practiceName}: follow up with ${v.clientName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Next step for ${v.clientName}: ${v.nextStep}\n\n` +
      `Due: ${v.dueDate}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "nextStep", "dueDate"],
  },

  {
    key: "people.person_consent_status_changed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: consent status changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Consent status for ${v.clientName} is now ${v.consentStatus}.\n\n` +
      `Communications have been updated.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "consentStatus"],
  },

  {
    key: "people.person_archived",
    family: "people",
    subject: (v, t) => `${v.practiceName}: ${v.clientName} archived`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.clientName} has been archived.\n\n` +
      (v.openSessions ? `Note: ${v.openSessions} sessions are still open.\n\n` : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName"],
  },

  {
    key: "people.person_merged",
    family: "people",
    subject: (v, t) => `${v.practiceName}: records merged`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.person1} and ${v.person2} have been merged into one record.\n\n` +
      `You have 30 days to undo this if needed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "person1", "person2"],
  },

  {
    key: "people.person_merge_undone",
    family: "people",
    subject: (v, t) => `${v.practiceName}: merge reversed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The merge has been reversed. The records are separate again.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "people.guardian_linked",
    family: "people",
    subject: (v, t) => `${v.practiceName}: parent linked`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A parent has been linked to your account.\n\n` +
      `They can see: ${v.whatTheyCanSee}\n` +
      `They cannot see: ${v.whatTheyCannotSee}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whatTheyCanSee", "whatTheyCannotSee"],
  },

  {
    key: "people.guardian_unlinked",
    family: "people",
    subject: (v, t) => `${v.practiceName}: parent access removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A parent's access to your account has been removed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "people.goal_created",
    family: "people",
    subject: (v, t) => `${v.practiceName}: new goal`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A goal has been created: ${v.goalTitle}\n\n` +
      `View it: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "goalTitle", "link"],
  },

  {
    key: "people.goal_updated",
    family: "people",
    subject: (v, t) => `${v.practiceName}: goal updated`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.goalTitle} has been updated.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "goalTitle"],
  },

  {
    key: "people.referral_received",
    family: "people",
    subject: (v, t) => `${v.practiceName}: referral received`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.referrerName} sent you a client: ${v.referralName}.\n\n` +
      `Contact info: ${v.contactInfo}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "referrerName", "referralName", "contactInfo"],
  },

  {
    key: "people.referral_sent",
    family: "people",
    subject: (v, t) => `${v.practiceName}: referral sent`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your referral to ${v.referralName} has been sent to ${v.recipientName}.\n\n` +
      `We'll follow up in 14 days for the outcome.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "referralName"],
  },

  {
    key: "people.referral_outcome_set",
    family: "people",
    subject: (v, t) => `${v.practiceName}: referral outcome`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `The outcome for your referral of ${v.referralName} has been recorded: ${v.outcome}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "referralName", "outcome"],
  },

  {
    key: "people.referral_blocked_no_release",
    family: "people",
    subject: (v, t) => `${v.practiceName}: get the release signed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Before we can refer ${v.clientName}, we need their release signed.\n\n` +
      `Send it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "link"],
  },

  {
    key: "people.role_granted",
    family: "people",
    subject: (v, t) => `${v.practiceName}: new role granted`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been granted the role: ${v.roleName}.\n\n` +
      `Your access has been updated immediately.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "roleName"],
  },

  {
    key: "people.role_revoked",
    family: "people",
    subject: (v, t) => `${v.practiceName}: role removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your role has been removed: ${v.roleName}.\n\n` +
      `Your access has been updated immediately.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "roleName"],
  },

  {
    key: "people.role_permission_changed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: permissions changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Permissions for the ${v.roleName} role have been changed:\n\n` +
      `${v.changesSummary}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "roleName", "changesSummary"],
  },

  {
    key: "people.team_member_added",
    family: "people",
    subject: (v, t) => `${v.practiceName}: welcome to the team`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You're now part of the ${v.practiceName} team.\n\n` +
      `You can see: ${v.whatTheyCanSee}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whatTheyCanSee"],
  },

  {
    key: "people.team_member_removed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: you've been removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You've been removed from the ${v.practiceName} team. Your access is gone.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "people.person_removed_from_team",
    family: "people",
    subject: (v, t) => `${v.practiceName}: team member removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.memberName} has been removed from the team.\n\n` +
      `Their sessions have been reassigned.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "memberName"],
  },

  {
    key: "people.shift_created",
    family: "people",
    subject: (v, t) => `${v.practiceName}: new availability block`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A new availability block has been created for you:\n\n` +
      `${v.shiftDetails}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "shiftDetails"],
  },

  {
    key: "people.shift_changed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: availability changed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your availability has changed.\n\n` +
      `New times: ${v.newShiftDetails}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "newShiftDetails"],
  },

  {
    key: "people.time_off_added",
    family: "people",
    subject: (v, t) => `${v.practiceName}: time off scheduled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Time off has been scheduled:\n\n` +
      `${v.timeOffDetails}\n\n` +
      (v.conflictingBookings ? `Note: ${v.conflictingBookings} bookings are affected.\n\n` : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "timeOffDetails"],
  },

  {
    key: "people.time_off_removed",
    family: "people",
    subject: (v, t) => `${v.practiceName}: time off cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Time off has been removed. You're available again.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "people.quiet_flag",
    family: "people",
    subject: (v, t) => `${v.practiceName}: check in on ${v.clientName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.clientName} has gone quiet. Last session was ${v.lastSessionDate}.\n\n` +
      `Consider reaching out.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "clientName", "lastSessionDate"],
  },

  {
    key: "people.win_back",
    family: "people",
    subject: (v, t) => `${v.practiceName}: we miss you`,
    html_body: "",
    text_body: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        `It's been a while since your last session at ${v.practiceName}. We'd love to help you get back on track.` +
        (v.link ? `\n\nBook your next appointment: ${v.link}` : "") +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "booking.first_agreement",
    family: "people",
    subject: (v, t) => `${v.practiceName}: agreement required to book`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Before your first session at ${v.practiceName}, we need you to sign an agreement.\n\n` +
      `Review and sign it: ${v.link}\n\n` +
      `It only takes a minute.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },
]);
