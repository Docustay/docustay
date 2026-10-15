// Every public page as data: path, title, one-line description, and its text as Markdown. Used to write sitemap.xml, the .md copy of each page, llms.txt and the Open Graph images.
// The registry pages (lib/site/pages/*.js) are the source for everything they hold; the few pages with working parts (verify, status, contact, the tool, self-host, the language pages) are listed here with their words.
import { ALL } from "./pages/registry.js";
import { TEMPLATES } from "./pages/templates.js";
import { FORMS, formMeta } from "./pages/formTemplates.js";
import { FULL_TEMPLATES } from "./starterFull.js";
import { CHANGES } from "./changelog.js";
import { SIGNPDF } from "./signpdf.js";
import { plain } from "./desk/feat.js";
import { DEFAULT_PLANS, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR, dollars } from "./plans.js";

const list = (a) => a.map((x) => `- ${x}`).join("\n");
const P = plain;
function blockMd(b) {
  const h = b.h2 ? `## ${P(b.h2)}\n\n` : "";
  const sub = b.sub ? `${P(b.sub)}\n\n` : "";
  switch (b.t) {
    case "cols": return `${h}${sub}${b.cols.map((c) => `**${c.h}.** ${P(c.p)}`).join("\n\n")}\n`;
    case "cards": case "steps": return `${h}${sub}${b.items.map((c) => `**${c.h}.** ${P(c.p)}`).join("\n\n")}\n`;
    case "tiles": return `${h}${sub}${list(b.items.map((c) => `[${c.h}](${c.href}): ${P(c.p)}`))}\n`;
    case "flow": return `${h}${sub}${b.nodes.map((n, i) => `${i + 1}. **${n.label}**${n.sub ? `: ${n.sub}` : ""}`).join("\n")}\n`;
    case "flows": return `${h}${sub}${b.items.map((f) => `${f.nodes.map((n, i) => `${i + 1}. **${n.label}**${n.sub ? `: ${n.sub}` : ""}`).join("\n")}`).join("\n\n")}\n`;
    case "timeline": return `${h}${sub}${list(b.items.map((i) => `${i.d}: ${i.l}`))}\n`;
    case "twofig": return `${h}${sub}${[b.a, b.b].map((f) => list(f.rows.map(([k, v]) => `**${k}**: ${P(v)}`))).join("\n\n")}\n`;
    case "split": return `${h}${sub}${b.points ? list(b.points.map(P)) + "\n" : ""}`;
    case "code": return `${h}${sub}${(Array.isArray(b.tabs) ? b.tabs : []).slice(0, 1).map((t) => `\`\`\`\n${t.code}\n\`\`\``).join("\n")}\n`;
    case "limits": return `${list(b.items.map(([k, v]) => `**${k}**: ${P(v)}`))}\n`;
    case "spec": return `${h}${sub}${list(b.rows.map(([k, v]) => `**${k}**: ${P(v)}`))}\n`;
    case "prose": return `${h}${(b.paras ?? []).map(P).join("\n\n")}\n`;
    case "faq": return `## Questions\n\n${b.items.map(([q, a]) => `**${q}**\n\n${P(a)}\n`).join("\n")}`;
    case "templates": return `${h}${sub}${list(b.slugs.map((s) => { const t = TEMPLATES.find((x) => x.slug === s); return t ? `[${t.title}](/templates/${t.slug})` : s; }))}\n`;
    default: return "";
  }
}
const pageMd = (p) => `# ${p.h1}\n\n${P(p.sub ?? "")}\n\n${p.blocks.map(blockMd).filter(Boolean).join("\n")}\n${p.keep?.length ? `\n## Keep reading\n\n${list(p.keep.map(([l, h]) => `[${l}](${h})`))}\n` : ""}`;
const fromRegistry = ALL.map((p) => ({ path: p.path, title: p.seo, desc: p.meta, md: pageMd(p) }));
const templates = TEMPLATES.map((m) => { const t = FULL_TEMPLATES.find((x) => x.slug === m.old); return { path: `/templates/${m.slug}`, title: m.title, desc: m.meta, md: `# ${m.title}\n\n${t.summary}\n\n${m.when.join(" ")}\n\n## Who signs\n\n${list(t.seats.map((s) => s.role))}\n\n## Before you send\n\n${list(m.check)}\n\n## The facts\n\n${list([`${t.pages} ${t.pages === 1 ? "page" : "pages"}`, `${t.fieldList.length} fields`, `About ${t.minutes} minutes to fill in`])}\n` }; });
const forms = FORMS.map((f) => ({ path: `/form-templates/${f.slug}`, title: `${f.title} form template, free`, desc: formMeta(f), md: `# ${f.title}\n\n${f.summary}\n\n${f.purpose}\n\n${f.sections.map((s) => `## ${s.heading}\n\n${list(s.fields.map((x) => `${x.label} (${x.type}${x.required ? "" : ", optional"})`))}`).join("\n\n")}\n` }));
const single = [
  { path: "/", title: "Docustay", desc: "Send a document, get it signed on any device without an account, and keep one sealed copy with a certificate.", md: "# Docustay\n\nSend it. Get it signed. Keep the proof.\n\nDocustay sends a document to the people who sign it, lets them sign on any phone or computer with no account, and keeps one sealed copy with a certificate of who signed when. Start free: 15 documents a month.\n\n- [How it works](/product)\n- [Templates](/document-templates)\n- [Pricing](/pricing)\n- [Developers](/developers)\n- [Trust](/trust)\n" },
  { path: "/pricing", title: "Pricing", desc: "Free sends a limited number of documents a month. Pro is one flat price for the whole workspace. Self-host is free under the AGPL-3.0; Pro is billed per install.", md: `# Pricing\n\n- **Free**: ${DEFAULT_PLANS.free.docsPerMonth} documents and ${DEFAULT_PLANS.free.templatesPerMonth} new templates a month (documents and forms together). Forms, Scribe, API, webhooks and embedding included.\n- **Pro**: ${dollars(DEFAULT_PLANS.pro.monthlyMinor)} a month for the whole workspace, unlimited users, documents and templates. Founders who subscribe by the cut-off date shown on the pricing page pay ${dollars(DEFAULT_PLANS.pro.foundersMonthlyMinor)} a month while the subscription stays active.\n- **Self-host**: free under the AGPL-3.0. Self-host Pro is ${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install, for your own business.\n- **Commercial licence**: from about ${dollars(COMMERCIAL_FROM_MINOR)} a year, to embed, white-label, resell or keep a private fork.\n\nPayments in a document: 2% on Free and 0% on Pro, on top of Stripe's fees. See [licensing](/licensing) and [self-host](/self-host).\n` },
  { path: "/form-templates", title: "Free form templates: one link, many responses", desc: "Thirty free form templates: registrations, applications, requests, reports and sign-ins. Publish one link; every response is filled in, signed and kept as its own copy.", md: `# Free form templates\n\n${list(FORMS.map((f) => `[${f.title}](/form-templates/${f.slug}): ${f.summary}`))}\n` },
  { path: "/document-templates", title: "Free document templates, ready to send", desc: "Free document templates you can send today: contracts, NDAs, waivers, HR forms, leases and school forms. Each shows its real pages, its fields and who signs.", md: `# Free document templates\n\n${list(TEMPLATES.map((t) => `[${t.title}](/templates/${t.slug}): ${t.line}`))}\n` },
  { path: "/verify", title: "Verify a signed PDF", desc: "Check the seal on a signed PDF in your browser. The file is not uploaded.", md: "# Verify a signed PDF\n\nDrop a signed PDF into the page. The check runs in your browser and the file is not uploaded. It reads the seal and the fingerprint from the file and says whether it is intact.\n" },
  { path: "/tools/sign-pdf", title: "Sign a PDF", desc: "Add your signature, initials, a date or text to a PDF in your browser. The file is never uploaded.", md: "# Sign a PDF\n\nAdd your signature, initials, a date or text to a PDF. It happens in your browser and the file is never uploaded.\n" },
  { path: "/tools/fill-pdf", title: "Fill a PDF", desc: "Type into the fields of a PDF form, or add text, check marks and dates to any PDF, in your browser. The file is never uploaded.", md: "# Fill a PDF\n\nType into the fields of a PDF form, or add text, check marks and dates to any PDF. It happens in your browser and the file is never uploaded.\n" },
  { path: "/tools/signature-generator", title: "Signature generator", desc: "Draw or type a signature and save it as an image. Made in your browser, never uploaded.", md: "# Signature generator\n\nDraw or type a signature and save it as an image. It is made in your browser and nothing is uploaded.\n" },
  { path: "/contact", title: "Contact", desc: "Write to the Docustay team.", md: "# Contact\n\nUse the form on the page. Security reports: security@docustay.app. Privacy requests: privacy@docustay.app. Everything else: hello@docustay.app.\n" },
  { path: "/status", title: "Status", desc: "Whether Docustay is working right now, and what happened when it was not.", md: "# Status\n\nThe live status of the app and API, and past incidents with what happened.\n" },
  { path: "/changelog", title: "Changelog", desc: "What changed in Docustay, newest first.", md: `# Changelog\n\n${CHANGES.map((c) => `## ${c.title} (${c.date})\n\n${list(c.items)}\n`).join("\n")}` },
  { path: "/self-host", title: "Self-host", desc: "Run Docustay on your own server under the AGPL-3.0. Community is free; Self-host Pro is a yearly licence per install.", md: "# Run Docustay on your own server\n\nThe same software as the hosted service, on a machine you control. Licensed under the AGPL-3.0. Community is free. See [pricing](/pricing) for Self-host Pro and [licensing](/licensing).\n" },
  { path: "/legal/terms", title: "Terms", desc: "The terms of service.", md: "# Terms\n\nThe terms of service for Docustay.\n" },
  { path: "/legal/privacy-policy", title: "Privacy policy", desc: "The privacy policy.", md: "# Privacy policy\n\nWhat Docustay collects, who sees it and how long it stays.\n" },
  { path: "/legal/notices", title: "Third-party notices", desc: "The open-source software Docustay includes, with its licences.", md: "# Third-party notices\n\nDocustay includes other people's software under its own licences, all compatible with the AGPL-3.0. They are listed on the page.\n" },
  { path: "/legal/cookies", title: "Cookies", desc: "The cookies this site uses.", md: "# Cookies\n\nThe cookies this site uses and why.\n" },
  { path: "/legal/dpa", title: "Data processing addendum", desc: "The data processing addendum.", md: "# Data processing addendum\n\nThe terms for how Docustay processes data for a workspace.\n" },
  { path: "/sign-pdf", title: "Sign documents from your code", desc: "Send a document for signature from JavaScript, TypeScript or Python: a short program for each, run against Docustay with a test key.", md: `# Sign documents from your code\n\n${list(SIGNPDF.map((l) => `[${l.name}](/sign-pdf/${l.slug})`))}\n` },
  ...SIGNPDF.map((l) => ({ path: `/sign-pdf/${l.slug}`, title: `Send a document for signature from ${l.name}`, desc: `Send a document for signature from ${l.name}, with a program that was run against Docustay with a test key.`, md: `# Send a document for signature from ${l.name}\n\n\`${l.install}\`\n\n${l.notes}\n\n\`\`\`\n${l.code}\n\`\`\`\n` })),
];
export const allPages = () => [...single.slice(0, 1), ...fromRegistry, ...templates, ...forms, ...single.slice(1)];
export const SSR_ONLY = ["/signup", "/login"];
