// Run 9 Part 4R — THE BUILT-IN PACKS. A pack bundles skills (plays) and templates for one job; switched on (Playbooks page), its templates are offered first on the Templates page
// and its skills and templates are what Scribe reaches for first. Pure data, no imports: every template named is a library slug (checked by test/r9_template_library.test.mjs),
// every play a built-in add-on or house style.
const pack = (name, title, description, plays, templates) => Object.freeze({ name, title, description, plays: Object.freeze(plays), templates: Object.freeze(templates.map((t) => `builtin:${t}`)) });

export const BUILTIN_PACKS = Object.freeze([
  pack("new-tenant-pack", "New tenant pack", "Everything to take on a new tenant: the application, the deposit, a lease addendum and the move-in checklist.", ["payment-terms", "late-fee-addon"],
    ["rental-application", "deposit-agreement", "lease-addendum", "move-in-move-out-checklist", "maintenance-request"]),
  pack("new-hire-pack", "New hire pack", "Bring someone on: the offer letter, their details, an emergency contact and the policies they acknowledge.", ["confidentiality-addon", "plain-english-style"],
    ["offer-letter", "onboarding-pack", "new-hire-information", "emergency-contact", "policy-acknowledgement", "non-solicitation-acknowledgement"]),
  pack("new-client-pack", "New client pack", "Win and start work with a client: the services agreement, a statement of work, change orders and payment terms.", ["payment-terms", "late-fee-addon", "cancellation-policy"],
    ["services-agreement", "statement-of-work", "change-order", "mutual-nda", "invoice-approval"]),
  pack("events-pack", "Events pack", "Run an event: registration, RSVPs, the waiver and a photo release.", ["guardian-signature"],
    ["event-registration", "rsvp", "event-waiver", "photo-release", "volunteer-application", "volunteer-agreement"]),
  pack("school-trip-pack", "School trip pack", "A trip or activity for young people: the permission slip, media consent and emergency contacts, signed by a parent or guardian.", ["guardian-signature"],
    ["permission-slip", "media-consent-minors", "emergency-contact"]),
  pack("client-intake-pack", "Client intake pack", "Take on a new client of a practice: intake, consent, the cancellation policy and recurring payments.", ["cancellation-policy", "recurring-payments"],
    ["intake-form", "consent-to-treatment", "appointment-request", "payment-plan-agreement"]),
]);
