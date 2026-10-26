// THE ONE FLOW DEFINITION (6 Oct 2026) — the steps, field types, roles, dropdown choices, writer tabs, preview views, slash-menu items, the template library's categories and the AI wizard's question packs.
// Both portals read this and nothing else for these lists: Docustay's Svelte screens and the platform's React screens. IMPORT-FREE and plain data (like settingsSchema.mjs) so a browser can read it.
// The canonical copy is THIS file; `node scripts/sync-flow-definition.mjs` writes the two browser copies (docustay/web/src/lib/flow/flowDefinition.js, webreact/src/lib/flow/flowDefinition.js) and
// `db/gates/flow_parity.mjs` fails the build when a copy drifted or when either portal drops a step, a field type, a role, a preview view, a tab or a slash item listed here.
// Labels are English source strings: each portal passes them through its own translation (tl) where it draws them. Icons are Lucide icon names (ISC licence).

export const FLOW_VERSION = 1;

/** The steps of the flow, in order. `modes` says where each shows: a one-off document, a reusable document template, using a template, and (Run 7) a FORM template — a link many people fill in.
 *  The type is chosen where the flow is entered (Templates → Document templates / Form templates); nothing inside the flow switches it. */
export const STEPS = Object.freeze([
  { id: "start", label: "Start", modes: ["document", "template", "use", "form"] },
  { id: "people", label: "Who signs", templateLabel: "Roles", useLabel: "Who plays each part", formLabel: "Who fills it", modes: ["document", "template", "use", "form"] },
  { id: "fill", label: "Fill in the details", modes: ["use"] },   // only when the template asks questions (its variables)
  { id: "prepare", label: "Prepare", modes: ["document", "template", "use", "form"] },
  { id: "details", label: "Details", modes: ["document", "template", "use", "form"] },
  { id: "check", label: "Check", formLabel: "Check as a visitor", modes: ["document", "template", "use", "form"] },
  { id: "send", label: "Send", modes: ["document", "use"] },
  { id: "save", label: "Save", modes: ["template"] },
  { id: "publish", label: "Publish", modes: ["form"] },
]);

/** A form's Publish options (Run 7), in the order the step shows them. `key` is the stored form setting. */
export const FORM_PUBLISH_OPTIONS = Object.freeze([
  { key: "slug", label: "Link name", kind: "text" },
  { key: "expiresAt", label: "Closes on", kind: "date" },
  { key: "responseLimit", label: "Stop after this many responses", kind: "number" },
  { key: "verifyEmail", label: "Check each person's email before they sign", kind: "toggle" },
  { key: "copyTo", label: "Send a copy of every response to", kind: "email" },
  { key: "intro", label: "Introduction above the form", kind: "textarea" },
  { key: "thankYou", label: "Thank-you line when they finish", kind: "text" },
  { key: "fillAgain", label: "Offer to fill it in again", kind: "toggle" },
  { key: "embedSites", label: "Websites that may show the form", kind: "list" },
  { key: "notifyOwner", label: "Email me each new response", kind: "toggle" },
  { key: "confirmRespondent", label: "Email the person a confirmation", kind: "toggle" },
]);

/** The visitor preview widths on a form's Check step. */
export const VISITOR_PREVIEWS = Object.freeze([{ id: "phone", label: "Phone", width: 390 }, { id: "desktop", label: "Desktop", width: 1024 }]);

/** Who sees a section. Everyone is the default; Sender only is cut out of everything a signer gets (src/documents/engine/source.mjs#stripSenderOnly). */
export const AUDIENCES = Object.freeze([
  { id: "everyone", label: "Everyone" }, { id: "sender", label: "Sender only", hint: "Only you see this. It is not in what signers see, sign or receive." },
]);
/** "Filled in by" on a selected field. */
export const FILLED_BY = Object.freeze([
  { id: "signer", label: "Signer" }, { id: "sender", label: "Sender first", hint: "You fill it in before sending; signers see it but cannot change it." },
]);
/** The first row of Who signs: the sender, locked. */
export const SENDER_ROW = Object.freeze({ id: "sender", label: "You (Sender)", role: "Fills in details" });


export const FIELD_GROUPS = Object.freeze([
  { id: "sign", label: "Sign" }, { id: "fill", label: "Fill in" }, { id: "choose", label: "Choose" }, { id: "attach", label: "Attach" }, { id: "pay", label: "Pay" },
]);

/** Every field type. `id` is the engine's tag type (never shown); `label` is what a person reads. `who`: signer (the person it is assigned to fills it), sender (filled before sending), either. */
export const FIELD_TYPES = Object.freeze([
  { id: "signature", label: "Signature", icon: "pen-line", group: "sign", who: "signer", formats: [] },
  { id: "initials", label: "Initials", icon: "type", group: "sign", who: "signer", formats: [] },
  { id: "date_signed", label: "Date signed", icon: "calendar-check", group: "sign", who: "signer", formats: ["date"] },
  { id: "stamp", label: "Stamp", icon: "stamp", group: "sign", who: "signer", formats: [] },
  { id: "text", label: "Text", icon: "text-cursor-input", group: "fill", who: "either", formats: ["max_length"] },
  { id: "number", label: "Number", icon: "hash", group: "fill", who: "either", formats: ["number"] },
  { id: "date", label: "Date", icon: "calendar", group: "fill", who: "either", formats: ["date"] },
  { id: "email", label: "Email", icon: "mail", group: "fill", who: "either", formats: [] },
  { id: "phone", label: "Phone", icon: "phone", group: "fill", who: "either", formats: [] },
  { id: "zip", label: "ZIP code", icon: "map-pin", group: "fill", who: "either", formats: [] },
  { id: "checkbox", label: "Checkbox", icon: "square-check", group: "choose", who: "signer", formats: [] },
  { id: "dropdown", label: "Dropdown", icon: "square-chevron-down", group: "choose", who: "either", formats: ["options"] },
  { id: "select", label: "Choose one", icon: "circle-dot", group: "choose", who: "either", formats: ["options"] },
  { id: "multiselect", label: "Choose several", icon: "list-checks", group: "choose", who: "either", formats: ["options"] },
  { id: "image", label: "Image", icon: "image", group: "attach", who: "signer", formats: [] },
  { id: "file", label: "Attachment", icon: "paperclip", group: "attach", who: "signer", formats: [] },
  { id: "payment", label: "Payment", icon: "credit-card", group: "pay", who: "signer", formats: ["amount", "currency"] },
]);

/** Text fields that fill themselves from the person signing: the engine type is `text`; the preset names the value and pre-fills the label. */
export const AUTOFILL_PRESETS = Object.freeze([
  { id: "name", label: "Name", icon: "user", type: "text", fills: "signer.name" },
  { id: "email", label: "Email", icon: "at-sign", type: "text", fills: "signer.email" },
  { id: "company", label: "Company", icon: "building", type: "text", fills: "signer.company" },
  { id: "title", label: "Title", icon: "briefcase", type: "text", fills: "signer.title" },
]);

/** What a person does on a document. `id` is the stored action_role; `inPerson` is a separate switch on a signer ("signs on this device"). */
export const ACTION_ROLES = Object.freeze([
  { id: "signer", label: "Signs", signs: true },
  { id: "approver", label: "Approves", signs: false },
  { id: "viewer", label: "Views only", signs: false },
  { id: "assistant", label: "Fills in details", signs: false },
  { id: "cc", label: "Gets a copy", signs: false },
]);

export const SIGNING_ORDERS = Object.freeze([
  { id: "all", label: "Everyone at once" }, { id: "sequential", label: "One after another" },
]);

/** Dropdown choices that used to be typed boxes. `reminders` are days after sending; `expiry` is days to sign (0 = never). */
export const REMINDER_CHOICES = Object.freeze([
  { id: "off", label: "No reminders", days: [] }, { id: "3_7", label: "After 3 and 7 days", days: [3, 7] }, { id: "weekly", label: "Every week for three weeks", days: [7, 14, 21] },
  { id: "daily3", label: "Every day for three days", days: [1, 2, 3] }, { id: "2_5_10", label: "After 2, 5 and 10 days", days: [2, 5, 10] },
]);
export const EXPIRY_CHOICES = Object.freeze([
  { id: "never", label: "Never expires", days: 0 }, { id: "7", label: "In 7 days", days: 7 }, { id: "14", label: "In 14 days", days: 14 }, { id: "30", label: "In 30 days", days: 30 },
  { id: "60", label: "In 60 days", days: 60 }, { id: "90", label: "In 90 days", days: 90 },
]);
export const LANGUAGE_CHOICES = Object.freeze(["en", "es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"]);
export const PAPER_CHOICES = Object.freeze([{ id: "letter", label: "Letter" }, { id: "a4", label: "A4" }]);

/** The writer's side-panel tabs. */
export const WRITER_TABS = Object.freeze([
  { id: "fields", label: "Fields", icon: "text-cursor-input" }, { id: "clauses", label: "Clauses", icon: "library" }, { id: "settings", label: "Settings", icon: "settings" },
]);

/** The '/' menu in the writer, in order. */
export const SLASH_ITEMS = Object.freeze([
  { id: "heading", label: "Heading", hint: "A section title", icon: "heading-2" },
  { id: "field", label: "Field", hint: "A blank someone fills in", icon: "text-cursor-input" },
  { id: "clause", label: "Clause", hint: "A ready-made clause", icon: "library" },
  { id: "table", label: "Table", hint: "Rows and columns", icon: "table" },
  { id: "pagebreak", label: "Page break", hint: "Start a new page", icon: "separator-horizontal" },
]);

/** The three views of a document before it goes out. */
export const PREVIEW_VIEWS = Object.freeze([
  { id: "see_it", label: "As they will see it" }, { id: "as_signed", label: "As signed" }, { id: "after_signing", label: "After signing (certificate)" },
]);

/** Where a built-in Document template is shown (the template library, Run 9 Part 4R): its category chips, in order. Every starter appears in exactly one category (checked by db/gates/flow_parity.mjs against the starters). */
/** The library's groups for the built-in FORM templates (Run 7): each form template's `use` (src/documents/starters/forms.mjs FORM_CATEGORIES — flow_parity checks the two lists agree). */
export const FORM_TEMPLATE_CATEGORIES = Object.freeze([
  { id: "general", label: "General" }, { id: "events", label: "Events" }, { id: "people", label: "People and HR" }, { id: "money", label: "Orders and money" },
  { id: "operations", label: "Operations" }, { id: "property", label: "Property and facilities" }, { id: "education", label: "Education" },
]);
export const TEMPLATE_CATEGORIES = Object.freeze([
  { id: "business", label: "Business", slugs: ["services-agreement", "mutual-nda", "statement-of-work", "vendor-agreement", "referral-agreement", "change-order"] },
  { id: "people", label: "People", slugs: ["contractor-agreement", "offer-letter", "volunteer-agreement", "onboarding-pack", "non-solicitation-acknowledgement"] },
  { id: "property", label: "Property", slugs: ["lease-addendum", "rental-application", "equipment-loan", "deposit-agreement"] },
  { id: "consent", label: "Consent and release", slugs: ["photo-release", "permission-slip", "event-waiver", "media-consent-minors", "mutual-release"] },
  { id: "finance", label: "Finance", slugs: ["payment-plan-agreement", "invoice-approval"] },
  { id: "clients", label: "Client forms", slugs: ["intake-form", "consent-to-treatment"] },
]);

/** The AI wizard (asked BEFORE any model call). One structured brief comes out. `universal` questions are asked for every type; a type's `pack` adds its own; `skipIf` drops a question an earlier answer already settles. */
/** The wizard's payment questions (asked on any pack, after the pack's own). The amount is typed by the person and nothing else sets it. Two-decimal currencies only. */
export const PAYMENT_CURRENCIES = Object.freeze(["usd", "eur", "gbp", "cad", "aud", "nzd", "chf", "sek", "nok", "dkk"]);
export const WIZARD_PAYMENT = Object.freeze([
  { key: "amount", label: "How much is paid at signing?", type: "text", required: true, placeholder: "For example: 1500" },
  { key: "currency", label: "Currency", type: "currency", default: "usd" },
  { key: "payer_role", label: "Who pays?", type: "text", placeholder: "For example: Client" },
  { key: "description", label: "What is it for?", type: "text", required: true, placeholder: "For example: the first month of work" },
  { key: "schedule_note", label: "Anything about later payments? (written into the document as text)", type: "longtext" },
]);
export const WIZARD_FINAL_QUESTION = Object.freeze({ key: "must_and_never", label: "What must this document do, and what must it never do?", type: "longtext", required: true });
export const WIZARD_UNIVERSAL = Object.freeze([
  { key: "purpose", label: "What is this for, in plain words?", type: "longtext", required: true },
  { key: "parties", label: "Who are the parties, and who signs?", type: "longtext", required: true, placeholder: "For example: the studio (Maria Lopez signs) and the client (Dev Patel signs)" },
  { key: "order", label: "Who signs first?", type: "choice", options: [{ value: "any", label: "No order" }, { value: "sequential", label: "One after another, in the order listed" }], default: "any" },
  { key: "provides", label: "What does each side provide?", type: "longtext" },
  { key: "money", label: "Money terms and dates", type: "longtext", hint: "Amounts and dates come from you only. Anything you leave out becomes a blank someone fills in." },
  { key: "law", label: "Which state or country's law applies?", type: "text", hint: "Leave blank and it becomes a blank to fill in." },
  { key: "signer_fills", label: "What does the signer fill in, and what is already filled in?", type: "longtext" },
  { key: "timing", label: "How long do they have to sign, and when should we remind them?", type: "text" },
  { key: "language", label: "Language", type: "choice", options: LANGUAGE_CHOICES.map((l) => ({ value: l, label: l })), default: "en" },
]);
export const WIZARD_TYPES = Object.freeze([
  { id: "nda", label: "Non-disclosure agreement (NDA)", starter: "mutual-nda", pack: [
    { key: "nda_kind", label: "One-way or mutual?", type: "choice", options: [{ value: "mutual", label: "Mutual: both sides share" }, { value: "oneway", label: "One-way: one side shares" }], required: true },
    { key: "nda_confidential", label: "What counts as confidential?", type: "longtext" },
    { key: "nda_term", label: "How long does the duty last?", type: "text" },
    { key: "nda_end", label: "When it ends, return or destroy?", type: "choice", options: [{ value: "return", label: "Return" }, { value: "destroy", label: "Destroy" }, { value: "either", label: "Either" }] },
  ] },
  { id: "lease_addendum", label: "Lease addendum", starter: "lease-addendum", pack: [
    { key: "lease_property", label: "Which property?", type: "text", required: true },
    { key: "lease_tenant", label: "Tenant name or names", type: "text" },
    { key: "lease_change", label: "What changes?", type: "longtext", required: true },
    { key: "lease_effective", label: "Effective date", type: "text" },
    { key: "lease_fee", label: "Any fee?", type: "text" },
  ] },
  { id: "photo_release", label: "Photo and media release", starter: "photo-release", pack: [
    { key: "photo_use", label: "Where can the photos or video be used?", type: "longtext", required: true },
    { key: "photo_term", label: "For how long?", type: "text" },
    { key: "photo_minor", label: "Is a minor involved?", type: "choice", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes: add a guardian signer" }], required: true },
  ] },
  { id: "services", label: "Services agreement", starter: "services-agreement", pack: [
    { key: "svc_scope", label: "Scope of the work", type: "longtext", required: true },
    { key: "svc_deliverables", label: "Deliverables", type: "longtext" },
    { key: "svc_fees", label: "Fees and how they are paid", type: "longtext" },
    { key: "svc_ownership", label: "Who owns the work?", type: "text" },
    { key: "svc_end", label: "How does it end?", type: "longtext" },
  ] },
  { id: "contractor", label: "Independent contractor agreement", starter: "contractor-agreement", pack: [
    { key: "ic_work", label: "The work", type: "longtext", required: true }, { key: "ic_pay", label: "Pay", type: "text" }, { key: "ic_independence", label: "Independence (own tools, own hours)", type: "text" }, { key: "ic_ownership", label: "Ownership of what is made", type: "text" },
  ] },
  { id: "consent_waiver", label: "Consent or waiver form", starter: "event-waiver", pack: [
    { key: "cw_activity", label: "The activity", type: "text", required: true }, { key: "cw_risks", label: "The main risks", type: "longtext" }, { key: "cw_minors", label: "Minors and guardians?", type: "choice", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes: add a guardian signer" }] },
  ] },
  { id: "offer_letter", label: "Offer letter", starter: "offer-letter", pack: [
    { key: "ol_role", label: "Role and title", type: "text", required: true }, { key: "ol_pay", label: "Pay and benefits", type: "longtext" }, { key: "ol_start", label: "Start date", type: "text" },
  ] },
  { id: "payment_plan", label: "Payment plan or deposit", starter: "payment-plan-agreement", pack: [
    { key: "pp_total", label: "Total amount", type: "text", required: true }, { key: "pp_schedule", label: "Schedule", type: "longtext" }, { key: "pp_late", label: "What happens if a payment is late?", type: "text" },
  ] },
  { id: "other", label: "Something else", starter: null, pack: [] },
]);

/** The agent kinds a person chooses between: a preset of mindset and checks. The workspace names its agent (setting `ai.agent_name`, placeholder default below; the maintainer decides). */
export const AGENT_KINDS = Object.freeze([
  { id: "plain", label: "Plain-language writer", hint: "Short sentences, no jargon." },
  { id: "careful", label: "Careful contract drafter", hint: "Precise terms, defined words, every risk named." },
  { id: "quick", label: "Quick forms", hint: "Short forms and notices, fast." },
]);
export const AGENT_DEFAULT_NAME = "Scribe";

/** Merge-field groups the writer offers; the platform adds Client. Only the first two resolve in a reusable typeset template at save time (the engine says so). */
export const MERGE_GROUPS = Object.freeze([
  { id: "org", label: "Your organisation", names: [{ name: "org.name", label: "Organisation name" }, { name: "org.address", label: "Organisation address" }] },
  { id: "sender", label: "Sender", names: [{ name: "sender.name", label: "Sender name" }, { name: "sender.email", label: "Sender email" }] },
  { id: "document", label: "Document", names: [{ name: "document.title", label: "Document title" }] },
]);

export const fieldType = (id) => FIELD_TYPES.find((f) => f.id === id) ?? null;
export const fieldLabel = (id) => fieldType(id)?.label ?? id;
export const roleLabel = (id) => ACTION_ROLES.find((r) => r.id === id)?.label ?? id;
