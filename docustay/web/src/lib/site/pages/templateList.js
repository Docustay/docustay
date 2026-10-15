// The light list every gallery and use-case row draws: the new name, the starter folder, the card line and the page count (from starters.index.json).
import INDEX from "../starters.index.json" with { type: "json" };
import { TEMPLATES } from "./templates.js";
export const GROUPS = { contracts: "Contracts", legal: "Legal", waivers: "Waivers and consent", work: "Work and HR", property: "Property", payments: "Payments" };
const GROUP_OF = { "service-agreement-template": "contracts", "independent-contractor-agreement-template": "contracts", "vendor-agreement-template": "contracts", "statement-of-work-template": "contracts", "referral-agreement-template": "contracts", "change-order-template": "contracts",
  "nda-template": "legal", "non-solicitation-agreement": "legal", "mutual-release-agreement": "legal",
  "liability-waiver-template": "waivers", "photo-release-form": "waivers", "media-release-form": "waivers", "permission-slip-template": "waivers", "medical-consent-form": "waivers", "patient-intake-form": "waivers", "volunteer-agreement-template": "waivers",
  "offer-letter-template": "work", "new-hire-paperwork": "work",
  "rental-application-form": "property", "lease-addendum-template": "property", "deposit-agreement": "property", "equipment-loan-agreement": "property",
  "payment-plan-agreement-template": "payments", "invoice-approval-form": "payments" };
export const CARDS = TEMPLATES.map((m) => { const s = INDEX.find((x) => x.slug === m.old); return { slug: m.slug, starter: m.old, title: m.title, pages: s?.pages ?? 1, line: m.line, use: m.use, group: GROUP_OF[m.slug], seats: s?.seats ?? [] }; });
