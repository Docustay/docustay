// The public site's header and footer, as data (8 Oct 2026 structure). Every link here must be a page that exists (the site test checks it).
// Header: Product, Use cases, Developers (one big menu), Pricing, Trust. Right: Sign in, Get started. GitHub joins when the repository is public. NO Compare, ever.
const PRODUCT = [
  ["How it works", "/product", "From a file to a signed, sealed copy"], ["Templates", "/product/templates", "54 built-in, in 14 languages"], ["Forms", "/product/forms", "Collect and sign from a link"],
  ["Sending", "/product/sending", "Who signs, in what order, with reminders"], ["Signing order", "/product/signing-order", "One at a time or all at once"], ["Signing", "/product/signing", "From any device, no account"],
  ["Tracking", "/product/tracking", "Know where every document is"], ["Proof", "/product/proof", "A certificate with every signed copy"], ["Payments", "/product/payments", "Get paid inside the document"],
  ["Teams and roles", "/product/teams", "One flat price for the workspace"], ["Scribe", "/product/scribe", "Describe it. Scribe builds it."],
];
const USE = [["Contracts", "/use-cases/contracts"], ["NDAs", "/use-cases/ndas"], ["Waivers and consent", "/use-cases/waivers-and-consent"], ["HR and onboarding", "/use-cases/hr-and-onboarding"], ["Leases and rentals", "/use-cases/real-estate"], ["Patient intake", "/use-cases/healthcare-intake"], ["Education", "/use-cases/education"], ["Agencies", "/use-cases/agencies"]];
const DEV = [["Overview", "/developers"], ["REST API", "/developers/api"], ["SDKs", "/developers/sdks"], ["Webhooks", "/developers/webhooks"], ["Test mode", "/developers/test-mode"], ["Command line", "/developers/cli"], ["Embedding the signer", "/developers/embedding"], ["API keys and security", "/developers/keys-and-security"], ["Documentation", "/docs"], ["Changelog", "/changelog"]];
const AGENT = [["AI agents and MCP", "/developers/agents"], ["Templates and skills API", "/developers/plays"], ["Self-host", "/self-host"]];
const LANGS = [["JavaScript", "/sign-pdf/javascript"], ["TypeScript", "/sign-pdf/typescript"], ["Python", "/sign-pdf/python"]];
const TRUST = [["Trust centre", "/trust"], ["Legal validity", "/trust/legal-validity"], ["Verify a signed PDF", "/verify"]];   // Run 7: nine pages became three
export const MENUS = [
  { label: "Product", href: "/product", kind: "list", cols: [{ title: "Send and sign", items: PRODUCT.slice(0, 6) }, { title: "Follow it through", items: PRODUCT.slice(6) }], items: PRODUCT },
  { label: "Use cases", href: "/use-cases", kind: "plain", items: [...USE, ["All use cases", "/use-cases"]] },
  { label: "Developers", href: "/developers", kind: "dev", panel: { build: DEV, agents: AGENT, langs: LANGS, cards: [["Create an API key", "/developers/keys-and-security", "Test keys never email anyone but you."], ["Send a test document", "/developers/test-mode", "Five lines, any of five languages."]] }, items: [...DEV, ...AGENT, ["Sign documents from your code", "/sign-pdf"], ...LANGS] },
  { label: "Pricing", href: "/pricing" },
  { label: "Trust", href: "/trust", kind: "plain", items: TRUST },
];
export const FOOTER = [
  ["Product", PRODUCT.map(([t, h]) => [t, h])],
  ["Use cases", [...USE, ["Templates", "/document-templates"], ["Form templates", "/form-templates"]]],
  ["Developers", [["Overview", "/developers"], ["REST API", "/developers/api"], ["SDKs", "/developers/sdks"], ["Webhooks", "/developers/webhooks"], ["AI agents and MCP", "/developers/agents"], ["Self-host", "/self-host"], ["Documentation", "/docs"], ["Changelog", "/changelog"]]],
  ["Sign a PDF with…", [["All languages", "/sign-pdf"], ...LANGS]],
  ["Free tools", [["Signature generator", "/tools/signature-generator"], ["Sign a PDF", "/tools/sign-pdf"], ["Fill a PDF", "/tools/fill-pdf"], ["How to sign a PDF", "/guides/how-to-sign-a-pdf"], ["Verify a signed PDF", "/verify"], ["Document templates", "/document-templates"], ["Form templates", "/form-templates"]]],
  ["Trust and legal", [["Trust centre", "/trust"], ["Security", "/trust#security"], ["Legal validity", "/trust/legal-validity"], ["Sub-processors", "/trust#sub-processors"], ["Terms", "/legal/terms"], ["Privacy policy", "/legal/privacy-policy"], ["Cookies", "/legal/cookies"], ["Acceptable use", "/legal/acceptable-use"], ["Data processing addendum", "/legal/dpa"]]],
  ["Company", [["About", "/about"], ["Open source", "/open-source"], ["Licensing", "/licensing"], ["Pricing", "/pricing"], ["Contact", "/contact"], ["Status", "/status"]]],
];
