// Which visual speaks for which page (VISUAL-DIRECTION-V3 section 3) and what the mega menu previews for each link (section 2).
// A visual is { still?: object name (static/stills/hero-<name>.avif), ui?: a real-UI id from Visual.svelte, with?: a second real-UI id shown under the still, special?: a component of its own, alt, line }.
// RULE (enforced by scripts/check-visual.mjs): no two pages in the same section share a hero visual id. Legal pages, docs, about, facts, guides, tools and template pages have none (the page itself is the visual).
export const VISUALS = {
  // features
  "f-hub": { still: "pen-page", area: "home", alt: "A pen lying on a signed document", line: "From a blank page to a sealed copy" },
  "f-how": { ui: "track-steps", area: "home", alt: "Six steps on a track: create, send, sign, pay, prove, automate", line: "Create, send, sign, pay, prove, automate" },
  "f-scribe": { ui: "sentence-page", area: "home", alt: "A sentence turning into a lease addendum with fields placed", line: "Describe it in a sentence. Scribe builds the page." },
  "f-pay": { ui: "payment-card", area: "home", alt: "A payment field for a $250 deposit on a card, with a coin", line: "Paid inside the signature, into your own Stripe account" },
  "f-proof": { special: "exploded-scroll", area: "home", alt: "The layers of a sealed document separating as you scroll: page, fields, signatures, seal and certificate", line: "Every sealed copy carries its proof" },
  "f-embed": { ui: "browser-embed", area: "home", alt: "A product screen with the Docustay signing page inside it", line: "Signing inside your own product" },
  "f-test": { still: "test-paper", with: "test-toggle", area: "home", alt: "A paper stamped TEST next to a test mode switch that is on", line: "Test mode: nothing reaches a real inbox" },
  "f-agent": { ui: "assistant-card", area: "home", alt: "An assistant drafting a document and waiting for a person to approve the send", line: "An assistant drafts. A person approves the send." },
  "f-wl": { ui: "whitelabel", area: "home", alt: "The signing page with a slot for your logo and four colour swatches", line: "Your logo and your colours" },
  "f-sign": { ui: "signer-card", area: "home", alt: "The signing page: a document, a Sign here box, and the choices to draw, type or decline", line: "Open the link, sign, done. No account." },
  "f-tmpl": { ui: "tag-card", area: "home", alt: "A text tag in a document and the signature field it becomes", line: "A field is a line of text, or press Find fields" },
  "f-team": { ui: "roles-card", area: "home", alt: "Three roles: Owner, Admin and Member", line: "Owner, Admin and Member" },
  "x-proof": { ui: "cert-card", area: "home", alt: "A certificate of completion with the seal intact and a SHA-256 fingerprint", line: "Every sealed copy carries its proof" },
  "x-next": { ui: "next-card", area: "home", alt: "A short list of ideas being considered for later versions", line: "What we are looking at for later. Nothing is promised." },
  "d-pay": { ui: "payments-api", area: "developers", alt: "A request for the Stripe status and a refund request", line: "Status, list and refund over the API" },
  "h-pay": { ui: "stripe-env", area: "selfhost", alt: "Three Stripe settings for a self-hosted server", line: "Your keys, your account" },
  // developers
  "d-hub": { ui: "dev-hub", area: "developers", alt: "A terminal command that sends a document and the 201 answer", line: "One call in, one document out" },
  "d-api": { ui: "api-request", area: "developers", alt: "A POST request to create a document and its 201 Created answer with a document id", line: "A request and the 201 answer" },
  "d-sdks": { still: "package", area: "developers", alt: "A package box with five language labels: JS, PY, GO, PHP and C#", line: "Five languages, one call" },
  "d-hooks": { still: "envelope", with: "events-log", area: "developers", alt: "An envelope with signal arcs and an event log of signed webhook deliveries answering 200", line: "Signed events, delivered and logged" },
  "d-cli": { ui: "cli-terminal", area: "developers", alt: "A terminal running docustay send and showing the answer", line: "docustay send, docustay listen" },
  "d-keys": { still: "key", area: "developers", alt: "A key with three scope labels: documents:read, documents:write and webhooks:read", line: "A key carries only the scopes you tick" },
  "d-test": { still: "test-paper", area: "developers", alt: "A paper stamped TEST", line: "Test keys send practice documents" },
  "d-embed": { ui: "browser-code", area: "developers", alt: "A browser window with the Docustay signing element embedded in an app", line: "A web component and a session" },
  "d-agents": { ui: "assistant-card", with: null, area: "developers", alt: "An assistant request with a chip saying a person approves the send", line: "Agents can draft. They cannot send or refund." },
  "d-plays": { ui: "plays-fan", area: "developers", alt: "A fan of three playbook cards: onboarding, rental and waiver", line: "Plays and playbooks" },
  // sign a PDF
  "s-hub": { ui: "signpdf-langs", area: "developers", alt: "A signed page and the names of the five SDK languages", line: "A signed page, five languages" },
  "s-lang": { ui: "signpdf-lang", area: "developers", alt: "A signed page beside that language's real code", line: "The real code, run against the API" },
  // templates
  "t-hub": { special: "shelf", area: "templates", alt: "A shelf of real template pages: NDA, lease, offer letter and contractor agreement", line: "More than 50 free templates" },
  "t-all": { ui: "all-templates-grid", area: "templates", alt: "A grid of template pages with the words more than 50", line: "More than 50, all free" },
  "c-contracts": { still: "pen-page", area: "templates", alt: "A pen lying on a signed services agreement", line: "Contracts" },
  "c-ndas": { still: "padlock", area: "templates", alt: "A brass padlock on an NDA page", line: "NDAs" },
  "c-waivers": { still: "clipboard", area: "templates", alt: "A clipboard with a consent form and ticked boxes", line: "Waivers and consent" },
  "c-hr": { still: "badge", area: "templates", alt: "A new-hire badge in front of a signed offer letter", line: "HR and onboarding" },
  "c-lease": { still: "key-lease", area: "templates", alt: "A brass key beside a lease addendum", line: "Leases and rentals" },
  "c-edu": { still: "notebook", area: "templates", alt: "A school notebook and a permission slip", line: "Education" },
  "c-agency": { still: "briefcase", area: "templates", alt: "A briefcase with a statement of work", line: "Agencies" },
  // self-host
  "h-hub": { still: "containers", area: "selfhost", alt: "Six container blocks: web, app, worker, db, storage and gotenberg", line: "Six containers, about 1 GiB at rest" },
  "h-req": { ui: "req-table", area: "selfhost", alt: "A requirements table: six containers, about 1 GiB to run, more than 3.8 GB to build", line: "What it takes to run" },
  "h-backup": { still: "backup-folder", area: "selfhost", alt: "A backup folder dated 2026-10-14 with a database dump and a verified restore", line: "Back up three places, together" },
  "h-sso": { still: "lock-card", area: "selfhost", alt: "A padlock beside a sign-in card with a Continue with SSO button", line: "Single sign-on and hardening" },
  "h-cmds": { ui: "commands-terminal", area: "selfhost", alt: "A terminal with the three install commands", line: "Three commands" },
  "l-agpl": { still: "licence-agpl", area: "selfhost", alt: "A licence card: Community, AGPL-3.0", line: "Community, AGPL-3.0, free" },
  "l-pro": { still: "licence-pro", area: "selfhost", alt: "A licence card: Self-host Pro, $390 a year", line: "Self-host Pro, $390 a year" },
  "l-commercial": { still: "licence-commercial", area: "selfhost", alt: "A licence card: Commercial, from about $3,000 a year", line: "Commercial, from about $3,000 a year" },
  // pricing, trust, company
  "p-hub": { still: "price-cards", area: "pricing", alt: "Three cards of rising thickness: Free, Pro and Self-host", line: "Free, Pro and Self-host" },
  "tr-hub": { still: "magnifier", area: "trust", alt: "A magnifying glass over a sealed contract", line: "Every signature can be checked" },
  "tr-verify": { still: "seal", area: "trust", alt: "A round seal with a check mark and SHA-256", line: "Check a signed PDF" },
  "co-contact": { still: "envelope-neutral", area: "company", alt: "A closed envelope", line: "Talk to us" },
  "co-status": { ui: "status-pulse", area: "company", alt: "A pulse line showing live status", line: "Live status" },
  "co-changelog": { ui: "timeline", area: "company", alt: "A dated timeline of recent changes", line: "What changed" },
  "x-docs": { ui: "docs-thumb", area: "developers", alt: "A docs page with a sidebar and an article", line: "Guides and the API reference" },
  "x-changelog": { ui: "changelog-list", area: "developers", alt: "A dated list of changelog entries", line: "What changed, newest first" },
  "x-openapi": { ui: "openapi-json", area: "developers", alt: "An excerpt of openapi.json and the number of operations", line: "The whole API in one file" },
};
// First match wins. null = no hero visual on that page (the page itself is the visual).
const RULES = [
  [/^\/$/, "LIVE"],
  [/^\/(docs|legal|about|help|guides|tools|demo|404)(\/|$)/, null], [/^\/templates\/[^/]+$/, null], [/^\/trust\/.+/, null],
  [/^\/features$/, "f-hub"], [/^\/features\/how-it-works/, "f-how"], [/^\/features\/scribe/, "f-scribe"], [/^\/features\/payments/, "f-pay"], [/^\/features\/signing/, "f-sign"], [/^\/features\/templates-and-sending/, "f-tmpl"], [/^\/features\/team-and-roles/, "f-team"], [/^\/features\/proof/, "f-proof"], [/^\/features\/embedded-signing/, "f-embed"], [/^\/features\/test-mode/, "f-test"], [/^\/features\/agent-ready/, "f-agent"], [/^\/features\/white-label/, "f-wl"],
  [/^\/developers$/, "d-hub"], [/^\/developers\/api/, "d-api"], [/^\/developers\/sdks/, "d-sdks"], [/^\/developers\/webhooks/, "d-hooks"], [/^\/developers\/cli/, "d-cli"], [/^\/developers\/keys-and-security/, "d-keys"], [/^\/developers\/test-mode/, "d-test"], [/^\/developers\/embedding/, "d-embed"], [/^\/developers\/agents/, "d-agents"], [/^\/developers\/plays/, "d-plays"], [/^\/developers\/payments/, "d-pay"],
  [/^\/sign-pdf\/?$/, "s-hub"], [/^\/sign-pdf\//, "s-lang"],
  [/^\/free-templates/, "t-hub"], [/^\/use-cases\/?$/, "t-all"],
  [/^\/use-cases\/contracts/, "c-contracts"], [/^\/use-cases\/ndas/, "c-ndas"], [/^\/use-cases\/waivers-and-consent/, "c-waivers"], [/^\/use-cases\/hr-and-onboarding/, "c-hr"], [/^\/use-cases\/real-estate/, "c-lease"], [/^\/use-cases\/education/, "c-edu"], [/^\/use-cases\/agencies/, "c-agency"],
  [/^\/self-host\/?$/, "h-hub"], [/^\/self-host\/requirements/, "h-req"], [/^\/self-host\/payments/, "h-pay"], [/^\/self-host\/backups-and-upgrades/, "h-backup"], [/^\/self-host\/sso-and-hardening/, "h-sso"],
  [/^\/open-source/, "l-agpl"], [/^\/licensing/, "l-pro"], [/^\/pricing/, "p-hub"], [/^\/trust\/?$/, "tr-hub"], [/^\/verify/, "tr-verify"],
  [/^\/contact/, "co-contact"], [/^\/status/, "co-status"], [/^\/changelog/, "co-changelog"],
];
export function heroIdFor(path) { for (const [re, id] of RULES) if (re.test(path)) return id; return null; }
export const sectionOf = (path) => (path.split("/")[1] || "home") === "use-cases" || /^\/(free-templates|templates)/.test(path) ? "templates" : /^\/(open-source|licensing|self-host)/.test(path) ? "self-host" : (path.split("/")[1] || "home");

// The mega menu: one preview per link (V3 section 2). [visual id, short line]. Links that are not here have no preview of their own and keep the last one shown.
export const PREVIEW = {
  "/developers": "d-api", "/developers/api": "d-api", "/developers/webhooks": "d-hooks", "/developers/embedding": "f-embed", "/developers/test-mode": "f-test", "/developers/agents": "f-agent", "/developers/cli": "d-cli", "/developers/keys-and-security": "d-keys",
  "/docs": "x-docs", "/docs/api-reference": "x-docs", "/changelog": "x-changelog", "/sign-pdf": "s-hub", "/openapi.json": "x-openapi",
  "/features": "f-hub", "/features/how-it-works": "f-how", "/features/signing": "f-sign", "/features/templates-and-sending": "f-tmpl", "/features/proof": "x-proof",
  "/features/payments": "f-pay", "/features/scribe": "f-scribe", "/features/agent-ready": "f-agent", "/features/white-label": "f-wl", "/features/embedded-signing": "f-embed", "/features/team-and-roles": "f-team", "/features/test-mode": "f-test",
  "/use-cases": "t-all", "/whats-next": "x-next", "/developers/payments": "d-pay", "/self-host/payments": "h-pay",
  "/free-templates": "t-all", "/tools/sign-pdf": "t-all", "/tools/fill-pdf": "t-all",
  "/use-cases/contracts": "c-contracts", "/use-cases/ndas": "c-ndas", "/use-cases/waivers-and-consent": "c-waivers", "/use-cases/hr-and-onboarding": "c-hr", "/use-cases/real-estate": "c-lease", "/use-cases/education": "c-edu", "/use-cases/agencies": "c-agency",
  "/self-host": "h-cmds", "/self-host/requirements": "h-hub", "/self-host/backups-and-upgrades": "h-backup", "/self-host/sso-and-hardening": "h-sso",
  "/licensing": "p-hub", "/licensing#pro": "l-pro", "/licensing#commercial": "l-commercial", "/open-source": "l-agpl",
};
