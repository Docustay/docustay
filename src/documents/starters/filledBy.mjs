// Run 9 Part 4.2 (R8-57) — WHO FILLS EACH BOX OF THE STARTERS. Pure data, no imports. index.mjs writes `filled=sender` (and `from=…`) into these boxes' tags when the starters load,
// so the template a workspace gets, the site's pictures and manifest, and the test (test/r9_starter_sender.test.mjs) all read this one table.
//
// ★ THE RULE (Ruling, 12 Oct 2026): the organization that sends a starter is the party the document is written for — the first party of an agreement (Provider, Party A, Company, Agency,
//   Employer, Landlord, Lender, Business), the practice on a consent form, the school on a permission slip. ITS OWN DETAILS AND THE TERMS IT SETS are filled in by the Sender before
//   anyone signs: its name and address, dates of its own event, fees, deadlines, governing law, what the service is. A signer fills only what is theirs: their own name and details, the
//   choices the document gives them (which uses of a photo they allow, which sessions they attend), and their own printed name and title beside their signature.
//   Why: a signer cannot know the organization's facts, and in a document sent to everyone at once a signer could otherwise sign before the terms were written in.
//
// Each entry: the box's label (as the starter prints it) → true (the sender types it) or where its first value comes from (org.name · org.email · sender.name · sender.email).
// A label that appears twice (Milestone 1 in a statement of work) is the sender's both times.

const terms = (...labels) => Object.fromEntries(labels.map((l) => [l, true]));
const law = { "Governing law (state)": true };

export const FILLED_BY_SENDER = Object.freeze({
  // ── agreements: the first party is the organization ──
  "services-agreement": { "Provider’s name": "org.name", "Provider’s legal name": "org.name", "Provider’s email": "org.email",
    ...terms("Date of this Agreement", "Provider’s address", "Time to review", "Days to pay an invoice", "Notice to end for convenience", "Include the non-solicitation section", "Services start date",
      "Describe the Services in a few sentences", "Deliverable 1", "Due date 1", "How it is accepted, 1", "Deliverable 2", "Due date 2", "How it is accepted, 2", "Deliverable 3", "Due date 3", "How it is accepted, 3",
      "Fee basis", "Total, rate or monthly amount, in US dollars", "Installment 1 due", "Installment 1 amount", "Installment 2 due", "Installment 2 amount", "Installment 3 due", "Installment 3 amount", "How the Client pays (bank, card or other)"), ...law },
  "mutual-nda": { "First party’s name": "org.name", "Party A’s legal name": "org.name", ...terms("Effective date", "Party A’s address", "the purpose, in a sentence or two", "Sharing period", "Protection period"), ...law },
  "contractor-agreement": { "Company name": "org.name", "Company’s legal name": "org.name",
    ...terms("Start date", "Company address", "Describe the services", "How the Contractor is paid", "Amount, in US dollars", "How often the Contractor invoices", "Days to pay", "Notice period", "Include the non-solicitation section"), ...law },
  "vendor-agreement": { "Company name": "org.name", "Company’s legal name": "org.name",
    ...terms("Date of this Agreement", "Company address", "Inspection period", "Payment terms", "a fixed amount, in US dollars", "Initial term", "Notice not to renew"), ...law },
  "statement-of-work": { "Agency’s legal name": "org.name",
    ...terms("Project name", "Date of this SOW", "Date of the master agreement, if any", "State the objective in a few sentences", "Start date", "End date", "List what the Agency is assuming", "the Agency’s project lead",
      "How often the sides check in", "Review period", "Rounds of revisions included", "Days to pay",
      "Deliverable 1", "Description 1", "Due 1", "Milestone 1", "Deliverable 2", "Description 2", "Due 2", "Milestone 2", "Deliverable 3", "Description 3", "Due 3", "Milestone 3", "Deliverable 4", "Description 4", "Due 4", "Milestone 4",
      "Fee basis", "Hourly rate, in US dollars", "Invoice date 1", "Amount 1", "Invoice date 2", "Amount 2", "Invoice date 3", "Amount 3", "Total fees, in US dollars",
      "Phase 1: what happens", "Phase 1 starts", "Phase 1 ends", "Phase 2: what happens", "Phase 2 starts", "Phase 2 ends", "Phase 3: what happens", "Phase 3 starts", "Phase 3 ends", "Phase 4: what happens", "Phase 4 starts", "Phase 4 ends"), ...law },
  "lease-addendum": { "Landlord’s name": "org.name",
    ...terms("Date of this addendum", "Date of the original lease", "What it is about", "Write the new terms", "Effective date", "Pet deposit or fee, in US dollars", "Extra amount, in US dollars", "When it is due", "Space number or area",
      "Monthly charge, in US dollars", "Notice before entering"), ...law },
  "invoice-approval": terms("Invoice number", "Supplier", "Invoice date", "Amount, with currency", "Due date", "Cost center or project", "What the invoice is for"),
  "change-order": { "Provider": "org.name",
    ...terms("Project name", "Date of this change order", "Date of the original agreement", "Change order number", "Describe what is changing", "Reason for the change", "Price before", "Change in cost, with currency", "Price after",
      "Finish date before", "New finish date", "Explain how the extra cost or time was worked out", "When it is invoiced", "Other effects, such as changes to staffing, materials or dependencies") },
  "equipment-loan": { "Lender’s name": "org.name",
    ...terms("Date of this agreement", "Item and make", "Serial number or tag", "Accessories, such as cables and cases", "Estimated replacement value, in US dollars", "Condition", "Notes on condition", "Lend date", "Return by",
      "Where to return it", "the purpose, such as a project or event", "its location, if it must stay in one place"), ...law },
  "referral-agreement": { "Company": "org.name", ...terms("Start date", "Time to confirm a Referral", "Time to become a customer", "The reward, such as a percentage or a fixed amount", "Reward paid within"), ...law },
  "mutual-release": { "First party’s name": "org.name", ...terms("Date of this Release", "Describe what is being settled", "Settlement terms, if any", "Payment and when it is due, if any", "What either side may say", "Days to consider this Release"), ...law },
  "payment-plan-agreement": { "Business name": "org.name",
    ...terms("Date of this agreement", "The balance, with currency", "what it is for", "Any agreed reduction, such as a discount for paying on time", "Number of installments", "How often", "First payment due",
      "Installment 1 due", "Installment 1 amount", "Installment 2 due", "Installment 2 amount", "Installment 3 due", "Installment 3 amount", "Installment 4 due", "Installment 4 amount",
      "Days of grace", "Days to put it right", "Late fee, if any, and how it is calculated"), ...law },
  "deposit-agreement": { "Business name": "org.name",
    ...terms("Date of this agreement", "What the deposit holds", "How the deposit is held", "Refund within", "the condition for a refund", "Date after which the deposit is kept", "Remaining balance and when it is due"), ...law },
  // ── HR: the employer ──
  "volunteer-agreement": { "Organization name": "org.name", "Organization’s legal name": "org.name", ...terms("Role", "Start date", "Hours or schedule", "Supervisor’s name", "Expenses covered, if any") },
  "offer-letter": { "Company name": "org.name", "Company’s legal name": "org.name",
    ...terms("Date of this letter", "Job title", "Manager’s name", "Start date", "Place of work, or remote", "Pay, with how often", "How often you are paid", "Classification", "Paid time off", "Hours or schedule", "Background check",
      "Notice requested", "Introductory period", "HR contact", "Offer open until"), ...law },
  "non-solicitation-acknowledgement": { "Company name": "org.name", "Company’s legal name": "org.name", ...terms("Date", "Employee’s role", "Period after leaving"), ...law },
  "onboarding-pack": { "Company name": "org.name",
    ...terms("Start date", "Role", "Manager’s name", "the people team contact", "the IT contact", "the person for raising concerns", "Item 1", "Serial or tag 1", "Condition 1", "Item 2", "Serial or tag 2", "Condition 2",
      "Item 3", "Serial or tag 3", "Condition 3", "who to contact about equipment problems", "How often you are paid", "First-day details", "Documents to bring", "Contact name and phone") },
  // ── one person signs; the organization's facts are the sender's ──
  "photo-release": { "Organization or photographer": "org.name", "Organization’s email": "org.email", ...terms("Event or occasion", "Date") },
  "permission-slip": { "School or group": "org.name", ...terms("Trip or activity", "Date", "How the group travels", "Cost per child", "What to bring") },
  "event-waiver": { "Organizer": "org.name", ...terms("Event name", "Date"), ...law },
  "media-consent-minors": { "Organization": "org.name", "Organization’s email": "org.email", ...terms("Event or activity") },
  "consent-to-treatment": { "Provider or practice name": "org.name",
    ...terms("Describe the service", "Where sessions take place", "How long each session is", "How long records are kept", "Possible benefits", "Possible risks or side effects", "Where to send a complaint", "Fees and how they are paid", "Notice needed to cancel") },
  "rental-application": terms("Property address", "Monthly rent, if listed", "Income criterion", "number of days", "Application fee, if any"),
  // ── forms: the owner sets these before the form goes live ──
  "policy-acknowledgement": terms("Policy name", "Version"),
});

/** Starters with nothing for the sender: every box is the signer's own (checked by the test, so a new starter must be put in one list or the other). */
export const NOTHING_FOR_THE_SENDER = Object.freeze(["intake-form",
  "contact-and-inquiry", "event-registration", "rsvp", "volunteer-application", "job-application", "new-hire-information", "emergency-contact", "customer-feedback-survey", "order-form", "change-of-contact-details",
  "appointment-request", "facility-booking-request", "suggestions-and-ideas", "vehicle-inspection-checklist", "incident-report", "time-off-request", "expense-reimbursement", "purchase-request", "vendor-information",
  "membership-application", "donation-pledge", "service-request-work-order", "return-and-refund-request", "maintenance-request", "move-in-move-out-checklist", "class-or-course-registration", "reference-check", "exit-interview",
  "visitor-sign-in"]);
