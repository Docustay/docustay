// src/ports/documentsVariables.mjs — PLATFORM'S MERGE-FIELD NAMESPACES, REGISTERED INTO THE DOCUMENTS ISLAND (QUEUE §23.3.3, the maintainer 3 Oct 2026: "the platform's person.*, booking.*, money.*, subscription.*, workbench.* are registered
// through the facts port, not hard-coded in the island"). The island's own catalogue is signer.*, sender.*, org.*, document.* and custom.*; everything below is a the platform concept the island never names.
//
// ★ PURE DATA, NO IMPORTS — so the server (src/ports/documents.mjs) and the browser (webreact/src/lib/host/documentsHost.js) register the SAME list, and a picker in the editor can show it.
// ★ Every name here is UNCHANGED from when it lived in the island: existing templates keep working (a body naming `person.first_name` resolves exactly as before — proved by test/s23_merge_fields.test.mjs).
// ★ The facts these read (`f.person`, `f.nextBooking`, `f.subscription`, `f.settings`, `f.tenant`…) are gathered by the host's `facts` port, in src/ports/documents.mjs.

export const HOST_VARIABLES = Object.freeze([
  // PERSON DOMAIN — staff and client fields
  {
    name: "person.first_name", label: "Client first name", sample: "Dana",
    why: "first name of the person — app_user.first_name",
    audience: "client", fallback: null, domain: "person",
    // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: the test client's own
    //   `first_name` column is null (display_name-only, the shape several callers leave a person
    //   in — e.g. src/routes/public.mjs's `/go/:pageSlug/lead` passes `firstName: displayName`
    //   rather than splitting it), so every message using `{{person.first_name}}` rendered blank
    //   — reported as "came back blank: bug or empty data?" Same fallback shape `person.name`
    //   already uses below (a real value beats an invented one, but a blank first name is worse
    //   than deriving one from the name everyone already has), never a made-up name.
    read: (f) => f.person?.first_name ?? f.person?.display_name?.trim()?.split(/\s+/)[0] ?? null,
  },
  {
    name: "person.name", label: "Client name", sample: "Dana Whitfield",
    why: "full name of the person — app_user.display_name",
    audience: "client", fallback: "there", domain: "person",
    read: (f) => f.person?.display_name ?? null,
  },
  {
    name: "person.email", label: "Client email", sample: "dana@example.com",
    why: "the person's email — app_user.email",
    audience: "client", fallback: null, domain: "person",
    read: (f) => f.person?.email ?? null,
  },
  {
    name: "person.phone", label: "Client phone", sample: "(555) 123-4567",
    why: "the person's phone number — app_user.phone",
    audience: "client", fallback: null, domain: "person",
    read: (f) => f.person?.phone ?? null,
  },
  {
    name: "person.role", label: "Client role", sample: "client",
    why: "the person's role in the system — app_user.role",
    audience: "staff", fallback: null, domain: "person",
    read: (f) => f.person?.role ?? null,
  },
  {
    name: "person.guardian_name", label: "Guardian name", sample: "Jane Whitfield",
    why: "name of the person's legal guardian — guardian.display_name",
    audience: "staff", fallback: null, domain: "person",
    read: (f) => f.guardian?.display_name ?? null,
  },
  {
    name: "person.payer_name", label: "Payer name", sample: "John Whitfield",
    why: "name of the person's account payer — payer.display_name",
    audience: "staff", fallback: null, domain: "person",
    read: (f) => f.payer?.display_name ?? null,
  },
  {
    name: "person.portal_status", label: "Portal status", sample: "active",
    why: "the person's portal account status — app_user.portal_status",
    audience: "staff", fallback: null, domain: "person",
    read: (f) => f.person?.portal_status ?? null,
  },
  {
    name: "person.stage", label: "Client stage", sample: "active",
    why: "the person's current stage in the system — app_user.stage",
    audience: "staff", fallback: null, domain: "person",
    read: (f) => f.person?.stage ?? null,
  },

  // BOOKING DOMAIN — client fields only
  {
    name: "booking.next.date", label: "Next appointment date", sample: "September 28, 2026",
    why: "date of the next scheduled booking — booking.starts_at (formatted in tenant timezone)",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.date ?? null,
  },
  {
    name: "booking.next.time", label: "Next appointment time", sample: "2:00 PM Pacific",
    why: "time of the next scheduled booking with timezone — booking.starts_at AT TIME ZONE (formatted)",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.time ?? null,
  },
  {
    name: "booking.next.service", label: "Next service", sample: "Coaching Session",
    why: "name of the service for the next booking — service.name",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.service ?? null,
  },
  {
    name: "booking.next.coach_first_name", label: `Coach name`, sample: "Sarah",
    why: `first name of the coach for the next booking — coach.first_name`,
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.coachFirstName ?? null,
  },
  {
    name: "booking.next.location", label: "Location", sample: "Bright Path, Suite 200",
    why: "location of the next booking — location.address (primary location, 0381)",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.location ?? null,
  },
  {
    name: "booking.last.date", label: "Last appointment date", sample: "September 21, 2026",
    why: "date of the most recent completed booking — booking.completed_at",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.lastBooking?.date ?? null,
  },
  {
    name: "booking.capacity_left", label: "Appointments available", sample: "3",
    why: "number of remaining appointments in the active package — package_credits remaining count",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.capacityLeft ?? null,
  },
  {
    name: "booking.waitlist_position", label: "Waitlist position", sample: "2",
    why: "position on the waitlist for the next available slot — booking_waitlist position",
    audience: "client", fallback: null, domain: "booking",
    read: (f) => f.nextBooking?.waitlistPosition ?? null,
  },

  // MONEY DOMAIN — admin (staff for invoice when recipient-anchored)
  {
    name: "money.invoice.number", label: "Invoice number", sample: "INV-2026-001234",
    why: "our generated invoice number — invoice.invoice_number (0086, invoiceNumbers.mjs)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.invoice?.invoice_number ?? null,
  },
  {
    name: "money.invoice.amount", label: "Invoice amount", sample: "$120.00",
    why: "total amount owed on the open invoice — invoice.subtotal_minor + tax − discount (0086)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.invoice?.amount ?? null,
  },
  {
    name: "money.invoice.due_date", label: "Invoice due date", sample: "October 5, 2026",
    why: "due date for the invoice — invoice.due_at (formatted in tenant timezone)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.invoice?.dueDate ?? null,
  },
  {
    name: "money.invoice.link", label: "Invoice link", sample: "https://app.example.com/invoice/abc123",
    why: "our public invoice URL — src/money/invoicePublic.mjs (never hosted_invoice_url)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.invoice?.link ?? null,
  },
  {
    name: "money.balance", label: "Account balance", sample: "$450.00",
    why: "total outstanding balance on the account — payment allocations and invoice totals",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.invoice?.balance ?? null,
  },
  {
    name: "money.last_payment.amount", label: "Last payment amount", sample: "$150.00",
    why: "amount of the most recent payment — payment.amount_minor (0015)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.paymentMethod?.lastPaymentAmount ?? null,
  },
  {
    name: "money.last_payment.method", label: "Last payment method", sample: "Visa ·4242",
    why: "payment method used for the last payment — payment_method.brand + last_four (0015:270)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.paymentMethod?.lastPaymentMethod ?? null,
  },
  {
    name: "money.credits.remaining", label: "Credits remaining", sample: "5",
    why: "number of credits available — entitlement_credit ledger SUM (0015, src/money/credits.mjs)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.credits?.remaining ?? null,
  },
  {
    name: "money.credits.expiry", label: "Credits expire", sample: "December 31, 2026",
    why: "date when unused credits expire — entitlement_credit.expires_at",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.credits?.expiry ?? null,
  },
  {
    name: "money.loyalty.points", label: "Loyalty points", sample: "250",
    why: "accumulated loyalty points — loyalty_entry ledger SUM (0414)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.loyalty?.points ?? null,
  },
  {
    name: "money.gift_card.balance", label: "Gift card balance", sample: "$75.00",
    why: "gift card balance on account — gift_card_entry ledger SUM (0415)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.giftBalance?.balance ?? null,
  },
  {
    name: "money.credit_balance", label: "Credit balance", sample: "$150.00",
    why: "customer credit balance — customer_credit_entry ledger SUM (0494, customer credit system)",
    audience: "admin", fallback: null, domain: "money",
    read: (f) => f.credits?.balance ?? null,
  },

  // PRACTICE DOMAIN — client fields
  {
    name: "practice.name", label: "Practice name", sample: "Bright Path Coaching",
    why: "the practice's DISPLAY name (setting practice.name) — the same brand name "
       + "publicBooking.mjs already prefers over the legal tenant.name; falls back to "
       + "tenant.name only when the setting is unset. FIX, 1 Oct 2026 — this used to read "
       + "tenant.name directly, so a signed agreement showed the LEGAL name "
       + "(\"Example Practice Recovery Services\") where the brand (\"Example Practice Coaching\") "
       + "was wanted; tenant.name is still the right read for anything legally required to name "
       + "the actual entity (invoices read it separately, untouched by this fix).",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.settings?.["practice.name"] || f.tenant?.name || null,
  },
  {
    name: "practice.address", label: "Practice address", sample: "123 Main St, Suite 200, Oakland, CA 94608",
    why: "primary location address — location.address (0381 primary location)",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.tenant?.address ?? null,
  },
  {
    name: "practice.phone", label: "Practice phone", sample: "(510) 555-0100",
    why: "tenant setting practice.support_phone — one value, read wherever it is quoted",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.settings?.["practice.support_phone"] ?? null,
  },
  {
    name: "practice.hours", label: "Practice hours", sample: "Monday–Friday, 9 AM–6 PM",
    why: "practice business hours — tenant_setting practice.hours",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.settings?.["practice.hours"] ?? null,
  },
  {
    name: "practice.booking_link", label: "Booking link", sample: "https://app.example.com/book",
    why: "client booking portal URL — tenant booking link (from tenant routing, portal URL)",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.tenant?.bookingLink ?? null,
  },
  {
    name: "practice.logo", label: "Practice logo", sample: "https://cdn.example.com/logo.png",
    why: "practice branding logo URL — tenant_setting practice.logo (0323 branding pointer)",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => f.settings?.["practice.logo"] ?? null,
  },

  // ★ F129 (23 Oct 2026) — the practice's ordinary paid session (facts port: the active, bookable, priced service, most-booked first), so the
  //   starter coaching agreements read the practice's own terms instead of a [[FILL IN]] blank. Price is never gathered for a staff audience.
  {
    name: "practice.session_length", label: "Session length", sample: "50 minutes",
    why: "the duration of the practice's ordinary paid session",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => (f.session?.minutes ? `${f.session.minutes} minutes` : null),
  },
  {
    name: "practice.session_price", label: "Session price", sample: "$150",
    why: "the current price of the practice's ordinary paid session",
    audience: "client", fallback: null, domain: "practice",
    read: (f) => {
      if (f.session?.priceMinor == null) return null;
      try {
        const n = f.session.priceMinor / 100;
        return new Intl.NumberFormat("en-US", { style: "currency", currency: f.session.currency || "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
      } catch { return null; }
    },
  },

  // SUBSCRIPTION DOMAIN — client fields
  {
    name: "subscription.plan", label: "Subscription plan", sample: "Premium Coaching",
    why: "name of the person's subscription plan — subscription.plan_name",
    audience: "client", fallback: null, domain: "subscription",
    read: (f) => f.subscription?.plan ?? null,
  },
  {
    name: "subscription.price", label: "Subscription price", sample: "$199.99/month",
    why: "price of the subscription — subscription.amount_minor and interval (never computed)",
    audience: "client", fallback: null, domain: "subscription",
    read: (f) => f.subscription?.price ?? null,
  },
  {
    name: "subscription.renews_on", label: "Subscription renews", sample: "October 15, 2026",
    why: "next renewal date for the subscription — subscription.current_period_end (0475 mirror)",
    audience: "client", fallback: null, domain: "subscription",
    read: (f) => f.subscription?.renews_on ?? null,
  },

  // PLATFORM DOMAIN — admin fields only
  {
    name: "workbench.plan", label: "Workbench plan", sample: "Enterprise",
    why: "the practice's workbench subscription plan — mainstay_subscription.plan",
    audience: "admin", fallback: null, domain: "mainstay",
    read: (f) => f.subscription?.workbenchPlan ?? null,
  },
  {
    name: "workbench.renews_on", label: "Workbench renews", sample: "November 1, 2026",
    why: "next renewal date for workbench subscription — mainstay_subscription.current_period_end (0475)",
    audience: "admin", fallback: null, domain: "mainstay",
    read: (f) => f.subscription?.workbenchRenews ?? null,
  },
  {
    name: "workbench.usage.metric_pct", label: "Usage percentage", sample: "45%",
    why: "usage as percentage of plan limit — mainstay_subscription usage calculation (0483)",
    audience: "admin", fallback: null, domain: "mainstay",
    read: (f) => f.subscription?.usageMetricPct ?? null,
  },

  // LEGACY ALIASES — client.* names map to person.* and practice.* and document.*
  {
    name: "client.name", label: "Client name", sample: "Dana Whitfield",
    why: "full name of the person — app_user.display_name",
    audience: "client", fallback: "there", domain: "person",
    aliasOf: "person.name",
    read: (f) => f.person?.display_name ?? null,
  },
  {
    name: "client.email", label: "Client email", sample: "dana@example.com",
    why: "the person's email — app_user.email",
    audience: "client", fallback: null, domain: "person",
    aliasOf: "person.email",
    read: (f) => f.person?.email ?? null,
  },
]);

/** Names that cannot resolve on a real send today, for the four reasons recorded in the island's history (QUEUE: documents "smart fields" brief, 30 Sep 2026): a hard-coded NULL, a fact key nothing sets, a wrong fact key, or a send-time caller that supplies no context. A picker offers only the rest. */
export const HOST_NEVER_RESOLVES = Object.freeze(new Set([
  "practice.address", "practice.booking_link",
  "person.guardian_name", "person.payer_name", "booking.last.date",
  "money.last_payment.amount", "money.last_payment.method",
  "money.credits.remaining", "money.credits.expiry", "money.loyalty.points",
  "money.gift_card.balance", "money.credit_balance",
  "workbench.plan", "workbench.renews_on", "workbench.usage.metric_pct",
  "booking.next.date", "booking.next.time", "booking.next.service",
  "booking.next.coach_first_name", "booking.next.location",
  "booking.capacity_left", "booking.waitlist_position",
  "money.invoice.number", "money.invoice.amount", "money.invoice.due_date",
  "money.invoice.link", "money.balance",
]));
