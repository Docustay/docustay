// The public site's header and footer, as data (V1, 17 Oct 2026). Every link here must be a page that exists (the site test checks it).
// Header: Features, Templates and Pricing on the left; Developers and Self-host on the right (each a mega menu: link columns left, ONE preview panel right that follows the link under the pointer or focus; see visuals/registry.js PREVIEW). Docs lives inside the Developers menu.
// Right of the menus: Sign in, Sign up and the Try the demo button. NO Compare, ever. Footer: 18 links in 4 columns.
const DEV = [["Developers", "/developers"], ["API and SDKs", "/developers/api"], ["Webhooks", "/developers/webhooks"], ["Embedded signing", "/developers/embedding"], ["Payments", "/developers/payments"], ["Test mode", "/developers/test-mode"], ["AI agents and MCP", "/developers/agents"], ["Command line", "/developers/cli"], ["Keys and scopes", "/developers/keys-and-security"]];
const LEARN = [["Docs", "/docs"], ["API reference", "/docs/api-reference"], ["Changelog", "/changelog"], ["Send a PDF from code", "/sign-pdf"], ["OpenAPI file", "/openapi.json"]];
// Features: three columns, then a small row below them (Overview, Who it is for, What is next). Every link has a preview card of its own (visuals/registry.js PREVIEW; plumb check MENUS).
const FEAT = [
  { title: "Send and sign", items: [["How it works", "/features/how-it-works"], ["Signing", "/features/signing"], ["Templates and sending", "/features/templates-and-sending"], ["Proof", "/features/proof"]] },
  { title: "Get paid and AI", items: [["Payments", "/features/payments"], ["Scribe", "/features/scribe"], ["AI agents", "/features/agent-ready"]] },
  { title: "Make it yours", items: [["Your brand", "/features/white-label"], ["Embedded signing", "/features/embedded-signing"], ["Team and roles", "/features/team-and-roles"], ["Test mode", "/features/test-mode"]] },
];
const FEAT_FOOT = [["Overview", "/features"], ["Who it is for", "/use-cases"], ["What is next", "/whats-next"]];
const LIB = [["All templates", "/free-templates"], ["Sign a PDF, free tool", "/tools/sign-pdf"], ["Fill a PDF, free tool", "/tools/fill-pdf"]];
export const COLLECTIONS = [["Contracts", "/use-cases/contracts"], ["NDAs", "/use-cases/ndas"], ["Waivers and consent", "/use-cases/waivers-and-consent"], ["HR and onboarding", "/use-cases/hr-and-onboarding"], ["Leases and rentals", "/use-cases/real-estate"], ["Education", "/use-cases/education"], ["Agencies", "/use-cases/agencies"]];
const RUN = [["Install and run", "/self-host"], ["Requirements", "/self-host/requirements"], ["Payments", "/self-host/payments"], ["Backups and upgrades", "/self-host/backups-and-upgrades"], ["SSO and hardening", "/self-host/sso-and-hardening"]];
const LICENCES = [["Self-host Pro, $390 a year", "/licensing#pro"], ["Open source", "/open-source"], ["Licences", "/licensing"], ["Commercial licence", "/licensing#commercial"]];
export const MENUS = [
  { label: "Features", href: "/features", kind: "mega", cols: FEAT, foot: FEAT_FOOT },
  { label: "Templates", href: "/free-templates", kind: "mega", cols: [{ title: "Library", items: LIB }, { title: "Collections", items: COLLECTIONS }] },   // R13-D034: the free browser tools were only in the footer
  { label: "Pricing", href: "/pricing" },
  { label: "Developers", href: "/developers", kind: "mega", side: "right", cols: [{ title: "Build", items: DEV }, { title: "Learn", items: LEARN }] },
  { label: "Self-host", href: "/self-host", kind: "mega", side: "right", cols: [{ title: "Run it", items: RUN }, { title: "Licences", items: LICENCES }] },
];
/** The phone menu: Features, Templates, Pricing, Developers, Self-host, Docs (Sign in and the demo button sit under it). */
// On a phone the small row becomes one more titled group, so the menu reads as a plain list.
export const MOBILE_MENUS = [...MENUS.map((m) => (m.foot ? { ...m, cols: [...m.cols, { title: "More", items: m.foot }] } : m)), { label: "Docs", href: "/docs" }];
export const FOOTER = [
  ["Product", [["Features", "/features"], ["Templates", "/free-templates"], ["Pricing", "/pricing"], ["What is next", "/whats-next"], ["Try the demo", "/demo"]]],
  ["Developers", [["Developers", "/developers"], ["Docs", "/docs"], ["Changelog", "/changelog"], ["Self-host", "/self-host"], ["Licensing", "/licensing"]]],
  ["Company", [["About", "/about"], ["Help", "/help"], ["Contact", "/contact"], ["Status", "/status"]]],
  ["Trust and legal", [["Trust centre", "/trust"], ["Legal", "/legal"], ["Verify a signed PDF", "/verify"], ["Open source", "/open-source"]]],
];
