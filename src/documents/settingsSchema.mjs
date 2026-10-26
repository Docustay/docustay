// src/documents/settingsSchema.mjs — THE ISLAND'S SETTINGS SCHEMA: every key, type, default, label and help text, with NO imports so the browser can read it too
// (the signed-copy preview and the document view use the same defaults as the server). Storage and writes live in settings.mjs.
import { PRICES, INTERNAL_MODEL } from "./engine/ai/prices.mjs";
import { AGENT_KINDS } from "./flowDefinition.mjs";   // pure, no imports of its own   // the model names live in one pure file (no imports of its own)
export const SETTING_GROUPS = Object.freeze([
  { key: "sending", label: "Sending and reminders" },
  { key: "teams", label: "Teams" },
  { key: "test_mode", label: "Test mode" },
  { key: "signing", label: "Signing rules" },
  { key: "download", label: "Download links" },
  { key: "embed", label: "Embedding" },
  { key: "templates", label: "Templates" },
  { key: "forms", label: "Forms" },
  { key: "ai", label: "AI drafting" },
  { key: "records", label: "Records" },
  { key: "signed_copy", label: "Signed copy" },
  { key: "certificate", label: "Certificate of completion" },
  { key: "email", label: "Email sending" },
  { key: "branding", label: "Signing page branding" },
]);

const FONTS = Object.freeze(["helvetica", "times", "inter"]);
const SIGNATURE_STYLES = Object.freeze(["both", "drawn", "typed"]);
const SIGNATURE_STYLE_LABELS = Object.freeze({ both: "Drawn, or typed when there is none", drawn: "Drawn only", typed: "Typed name only" });
const AI_PROVIDERS = Object.freeze(["anthropic", "openai_compatible", "own_endpoint", "test_double", "fake"]);
const AI_PROVIDER_LABELS = Object.freeze({ anthropic: "Anthropic (Claude)", openai_compatible: "An OpenAI-compatible service", own_endpoint: "Your own endpoint", test_double: "Built-in test answers (no real AI)", fake: "Test provider (sandbox only)" });
const AI_WHO = Object.freeze(["everyone", "admins", "owner"]);
const AI_WHO_LABELS = Object.freeze({ everyone: "Everyone who can write documents", admins: "Owners and admins", owner: "The owner only" });
const CERT_PARTS = Object.freeze(["ip", "device", "timeline", "hashes", "consent"]);
const FONT_LABELS = Object.freeze({ helvetica: "Helvetica", times: "Times", inter: "Inter" });
const CERT_PART_LABELS = Object.freeze({ ip: "Network address (IP)", device: "Device and browser", timeline: "Timeline of events", hashes: "Document fingerprints", consent: "Consent record" });
const HEX = /^#[0-9a-fA-F]{6}$/;
const PROVIDERS = Object.freeze(["platform", "domain", "smtp", "mailbox"]);
// D-057: what the person sees for each value (the stored value stays the short word)
const PROVIDER_LABELS = Object.freeze({ platform: "Docustay, on your behalf", domain: "Your own domain", smtp: "Your own mail server (SMTP)", mailbox: "Your connected mailbox" });
const SMTP_SECURITY_LABELS = Object.freeze({ starttls: "STARTTLS (usually port 587)", tls: "TLS (usually port 465)", none: "None (a trusted internal server only)" });
const SMTP_SECURITY = Object.freeze(["starttls", "tls", "none"]);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const emailOrEmpty = (v) => (typeof v === "string" && (v === "" || EMAIL.test(v)) ? null : "must be an email address like name@example.com");

const int = (min, max) => (v) => (typeof v !== "number" || !Number.isInteger(v) ? "must be a whole number" : v < min || v > max ? `must be between ${min} and ${max}` : null);
const str = (max) => (v) => (typeof v !== "string" ? "must be text" : v.length > max ? `must be ${max} characters or fewer` : null);
const bool = (v) => (typeof v === "boolean" ? null : "must be on or off");
/** One address per line (or comma): https://app.example.com, or http://localhost:3000 while developing. Origins only: no path. */
const ORIGIN = /^(https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/i;
export const parseOrigins = (v) => String(v ?? "").split(/[\s,]+/).map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
const origins = (v) => { if (typeof v !== "string") return "must be text"; if (v.length > 2000) return "must be 2000 characters or fewer"; const bad = parseOrigins(v).find((o) => !ORIGIN.test(o)); return bad ? `“${bad}” is not a website address like https://app.example.com (no path; http only for localhost)` : parseOrigins(v).length > 25 ? "at most 25 addresses" : null; };
const oneOf = (list) => (v) => (list.includes(v) ? null : `must be one of: ${list.join(", ")}`);

// ★ S-4 / S-5 (security audit run 5, 10 Oct 2026): a host an organisation names (its SMTP server, its AI endpoint) must be a PUBLIC one. This is the as-written half of the rule, pure so the
//   browser can show the same refusal; the authoritative half (the name is resolved and every address must be public, and the connection goes to the address that was judged) is
//   src/http/publicDestination.mjs, used where the server actually connects. Loopback is let through ONLY when KEYSTONE_ENVIRONMENT is "local" (the developer's own machine: Mailpit on 127.0.0.1).
const HOST_NOT_PUBLIC = "must be a public address — not localhost, an internal name or a private network";
const INTERNAL_NAME_SUFFIXES = Object.freeze([".internal", ".local", ".localdomain", ".lan", ".home.arpa", ".corp", ".intranet", ".private"]);
const onDevelopersMachine = () => typeof process !== "undefined" && process?.env?.KEYSTONE_ENVIRONMENT === "local";
// A SELF-HOSTED install (KEYSTONE_SELF_HOST=1) may name a server on its own network: RFC 1918, Tailscale's 100.64/10, IPv6 unique-local and internal names. Link-local (cloud metadata), unspecified and loopback stay refused. (Same rule as src/http/publicDestination.mjs and src/mail/destination.mjs.)
const onSelfHost = () => typeof process !== "undefined" && process?.env?.KEYSTONE_SELF_HOST === "1";
const lanV4 = ([a, b]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
const privateV4 = ([a, b, c]) => a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
/** null when `host` is acceptable as written; otherwise a sentence. `host` is a bare name or IP literal (no scheme, no port). */
function publicHostProblem(host) {
  const h = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "") return "must not be empty";
  const local = onDevelopersMachine();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return "is not a valid address";
    if (local && parts[0] === 127) return null;
    if (onSelfHost() && lanV4(parts)) return null;
    return privateV4(parts) ? HOST_NOT_PUBLIC : null;
  }
  if (h.includes(":")) {                                                   // an IPv6 literal
    if (local && h === "::1") return null;
    if (onSelfHost() && /^f[cd]/.test(h)) return null;
    if (h === "::" || h === "::1" || /^(f[cd]|fe[89abc]|ff)/.test(h) || h.startsWith("::ffff:") || h.startsWith("64:ff9b:") || h.startsWith("2002:") || h.startsWith("100::")) return HOST_NOT_PUBLIC;
    return null;
  }
  if (h === "localhost" || h.endsWith(".localhost")) return local ? null : HOST_NOT_PUBLIC;
  if (!h.includes(".") || INTERNAL_NAME_SUFFIXES.some((x) => h.endsWith(x))) return local || onSelfHost() ? null : HOST_NOT_PUBLIC;
  return null;
}
const smtpHost = (v) => {
  if (typeof v !== "string") return "must be text";
  if (v.length > 200) return "must be 200 characters or fewer";
  if (v.trim() === "") return null;                                         // empty = not set
  if (/[\s/@?#]/.test(v.trim()) || /^[a-z][a-z0-9+.-]*:\/\//i.test(v.trim())) return "must be just the host name of your mail server, for example smtp.yourprovider.com";
  return publicHostProblem(v);
};
const aiEndpoint = (v) => {
  if (typeof v !== "string") return "must be text";
  if (v === "") return null;
  // R13-D258: http://localhost is for a model on the same machine, so it is allowed on a self-hosted install (and a developer's); the hosted service would be calling itself
  const localOk = onDevelopersMachine() || (typeof process !== "undefined" && process?.env?.KEYSTONE_SELF_HOST === "1");
  if (!/^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[^\s]*)?)$/.test(v)) return localOk ? "must be an https address (or http://localhost)" : "must be an https address";
  if (v.startsWith("http://")) return localOk ? null : "must be an https address";
  const authority = v.slice("https://".length).split(/[/?#]/)[0];
  if (authority.includes("@")) return "must not contain a username or password";
  const host = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.replace(/:\d*$/, "");
  const problem = publicHostProblem(host);
  return problem === null ? null : `the address ${problem}`;
};

export const DOCUMENT_SETTINGS = Object.freeze({
  // ── sending and reminders ──
  reminder_days: {
    group: "sending", type: "days", default: [3, 7], label: "Reminder days",
    help: "Which days after sending to remind people who have not signed — 1 to 3 values, ascending.",
    validate: (v) => {
      if (!Array.isArray(v)) return "must be a list of days";
      if (v.length < 1 || v.length > 3) return "must have 1 to 3 values";
      for (const n of v) if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 60) return "each value must be a whole number between 1 and 60";
      for (let i = 1; i < v.length; i += 1) if (v[i] <= v[i - 1]) return "must be in ascending order";
      return null;
    },
  },
  signature_validity_days: {
    group: "sending", type: "number", default: 0, label: "Signature request expires after (days)",
    help: "How long a sent document stays open for signing. 0 means it never expires. The deadline is fixed when the document is sent.",
    validate: (v) => (typeof v !== "number" || !Number.isInteger(v) ? "must be a whole number of days" : v < 0 ? "must not be negative" : v > 365 ? "must be a year (365 days) or less" : null),
  },
  // ── teams (Part 30 item 8) ──
  "teams.restrict_visibility": {
    group: "teams", type: "bool", default: false, label: "Limit documents to their teams",
    help: "When this is on, a team member who is not an owner or admin sees only their own teams' documents and templates, the ones they made, and the ones that belong to no team. Owners and admins always see everything. Teams are part of Pro.",
    validate: (v) => (typeof v === "boolean" ? null : "must be on or off"),
  },
  // ── test mode (Part 30 item 8): documents sent while it is on are practice runs — emailed only to their sender, stamped TEST, left out of usage, billing and reports ──
  "test_mode.on": {
    group: "test_mode", type: "bool", default: false, label: "Test mode",
    help: "While this is on, every document you send is a practice run: all emails go only to you (the sender), the signed PDF carries a TEST watermark, and nothing is counted toward your plan, billing or reports. Turn it off to send for real. Documents sent with a test API key are always tests.",
    validate: (v) => (typeof v === "boolean" ? null : "must be on or off"),
  },
  // ── signing rules (Part 30 item 5): what a signer may and must do. The signing page reads these live (`signingPolicy`), so a change applies to documents already sent. ──
  "signing.require_reason": {
    group: "signing", type: "bool", default: false, label: "Ask every signer why they are signing",
    help: "Signers must write a short reason or capacity (for example “as director of Acme Ltd”) before they can sign. It is kept with their signature and printed on the certificate.",
    validate: bool,
  },
  "signing.allow_typed": {
    group: "signing", type: "bool", default: true, label: "Allow typed signatures",
    help: "When off, signers must draw their signature; the typed-name option is hidden. (The page says what the signer chose; a person using their own software could claim otherwise, so this is a rule for honest signers, not a security control.)",
    validate: bool,
  },
  "signing.allow_decline": {
    group: "signing", type: "bool", default: true, label: "Let signers decline",
    help: "When off, the Decline button is removed and the server refuses a decline. The sender can still void a document.",
    validate: bool,
  },
  "signing.allow_delegate": {
    group: "signing", type: "bool", default: false, label: "Let signers pass their turn to someone else",
    help: "A signer can name another person; the invitation moves to them, the first person's link stops working, and the certificate shows both.",
    validate: bool,
  },
  "signing.allow_resubmit": {
    group: "signing", type: "bool", default: false, label: "Let people fill a form in again",
    help: "After someone finishes a form from a public link, show them a link to fill it in again as a new response. A signed document is never reopened or changed.",
    validate: bool,
  },
  "signing.remember_signature": {
    group: "signing", type: "bool", default: false, label: "Offer to remember a signature on this device",
    help: "After signing, the signer's browser can keep their signature to fill it in next time. It stays on their device and is never sent to us.",
    validate: bool,
  },
  "signing.show_signature_id": {
    group: "signing", type: "bool", default: false, label: "Print a signature ID beside every signature",
    help: "Each signature on the signed copy carries a short ID that matches the certificate and the audit log.",
    validate: bool,
  },
  // ── download links (Part 30 item 5): how the signed copy reaches people ──
  "download.link_days": {
    group: "download", type: "number", default: 0, label: "Send the signed copy as a link that works for (days)",
    help: "0 attaches the signed PDF to the email, as before. A number of days replaces the attachment with a link that stops working after that many days; the sender can send a new one.",
    validate: int(0, 365),
  },
  "download.require_code": {
    group: "download", type: "bool", default: false, label: "Ask for an email code before a download",
    help: "Whoever opens a download link must first enter a code sent to their own email address. Links are tied to one person.",
    validate: bool,
  },
  // ── embedding (Part 30 item 4) ──
  "embed.allowed_origins": {
    group: "embed", type: "text", widget: "origins", default: "", label: "Websites that may show a signing form",
    help: "Type or paste website addresses, for example https://app.example.com. Only these sites can put a Docustay signing form in a frame, and the form only talks to them. Empty means embedding is off.",
    validate: origins,
  },
  // ── forms (Run 7): what every NEW form starts with on its Publish step; each form can change its own ──
  "forms.verify_email": { group: "forms", type: "bool", default: false, label: "Check each person's email before they sign", help: "New forms start with the email check on: the person gets a link by email first, so you know the address is theirs.", validate: bool },
  "forms.fill_again": { group: "forms", type: "bool", default: false, label: "Offer to fill a form in again", help: "New forms show a button to start another response after signing.", validate: bool },
  "forms.notify_owner": { group: "forms", type: "bool", default: true, label: "Email the owner about each new response", help: "One email per signed response.", validate: bool },
  "forms.confirm_respondent": { group: "forms", type: "bool", default: true, label: "Email each person a confirmation", help: "What they signed and the link to their copy. The email never shows the answers.", validate: bool },
  "forms.copy_to": { group: "forms", type: "text", default: "", label: "Send a copy of every response to", help: "Leave empty for no copy.", validate: emailOrEmpty },
  "forms.embed_sites": { group: "forms", type: "text", widget: "origins", default: "", label: "Websites that may show your forms", help: "New forms may be shown inside these websites' pages. Each form can change its own list.", validate: origins },
  // ── AI drafting (shared document engine, design §6) ──
  "ai.enabled": {
    group: "ai", type: "bool", default: false, label: "Let people describe a document and have a draft written",
    help: "On for a new hosted workspace, off by default on a self-hosted install. A draft is only ever a suggestion for a person to read; nothing is sent or published by it. What you type is sent to the AI service that writes the draft: the one this service uses, or your own key where you have set one.",
    validate: bool,
  },
  "ai.provider": {
    group: "ai", type: "select", options: AI_PROVIDERS.map((value) => ({ value, label: AI_PROVIDER_LABELS[value] })), default: "anthropic", label: "AI provider",
    help: "Anthropic (Claude) uses this service's key or your own. An OpenAI-compatible service is any service that speaks the OpenAI chat format. Your own endpoint is your own server that takes a prompt and returns a draft.",
    validate: oneOf(AI_PROVIDERS),
  },
  "ai.model": {
    group: "ai", type: "text", default: "", label: "Model name",
    help: "Leave empty to use the provider's default. Set it to pick a different model without waiting for a release.",
    validate: (v) => str(80)(v) ?? (/^[A-Za-z0-9._:/@-]*$/.test(v) ? null : "must be a model name: letters, digits and . _ - : / @ only, no spaces"),   // R13-D322
  },
  "ai.endpoint": {
    group: "ai", type: "text", default: "", label: "Endpoint address",
    help: "For an OpenAI-compatible service, the base address (for example https://api.openai.com/v1). For your own endpoint, the full address. Must be https, or http://localhost while developing.",
    validate: aiEndpoint,
  },
  "ai.agent_name": {
    group: "ai", type: "text", default: "", label: "Your AI writer's name",
    help: "What your drafting assistant is called on screen. Empty uses “Scribe”.",
    validate: str(40),
  },
  "ai.review": {
    group: "ai", type: "bool", default: true, label: "Have a second reader check each draft",
    help: "A smaller, cheaper model reads the draft against what you asked for and adds anything that looks wrong to the notes. Only used with the Anthropic provider.",
    validate: bool,
  },
  "ai.who_may_use": {
    group: "ai", type: "select", options: AI_WHO.map((value) => ({ value, label: AI_WHO_LABELS[value] })), default: "everyone", label: "Who may use the AI writer",
    help: "Choose who may use it: everyone who can write documents here, only owners and admins, or only the owner. This is checked on the server, not just hidden on screen.",
    validate: oneOf(AI_WHO),
  },
  "ai.allow_draft": {
    group: "ai", type: "bool", default: true, label: "Let it write a new document from a description",
    help: "Off: describing a document to get a first draft is refused. It can never send a document, take a payment or sign for anyone, whatever is set here.",
    validate: bool,
  },
  "ai.allow_edit": {
    group: "ai", type: "bool", default: true, label: "Let it propose changes to a document or template",
    help: "Off: asking for changes to an existing document or template is refused. Every change is a proposal a person accepts or rejects first.",
    validate: bool,
  },
  "ai.read_files": {
    group: "ai", type: "bool", default: true, label: "Let it read PDFs and pictures you attach in the chat",
    help: "On: when you attach a file to the chat, the assistant sees its pages for that one message, to summarise it, compare it or place fields on it. Off: an attached file only becomes a draft. The file is never kept in the chat history, and text inside a file is treated as content, never as instructions.",
    validate: bool,
  },
  "ai.require_review": {
    group: "ai", type: "bool", default: true, label: "Ask the sender to read what the assistant wrote before it can be sent",
    help: "On: a document that includes assistant-written text shows a line on the Check step asking the sender to read it. Nothing is ever sent for you.",
    validate: bool,
  },
  "ai.house_rules": {
    group: "ai", type: "text", default: "", label: "House rules for the AI writer",
    help: "Plain sentences it follows for every document in this workspace, for example: Use plain English. Always include a governing law line. Never promise a result. It can never be made to send, charge or sign by these.",
    validate: str(1500),
  },
  "ai.agent_kinds": {
    group: "ai", type: "text", widget: "styles", default: "", label: "Which writer styles are offered",
    help: "Empty offers all of them. Otherwise pick the styles to offer.",
    validate: (v) => { const e = str(200)(v); if (e) return e; const ids = AGENT_KINDS.map((k) => k.id), bad = v.split(",").map((x) => x.trim()).filter((x) => x && !ids.includes(x)); return bad.length ? `must be one or more of: ${ids.join(", ")} (not ${bad.join(", ")})` : null; },   // R13-D322: an unknown style was silently ignored
  },
  "ai.chat_retention_days": {
    group: "ai", type: "number", default: 30, label: "Keep chat conversations for (days, 0 = do not keep)",
    help: "How long the assistant chat keeps what was said. The record of what the assistant changed (not what was typed) is kept as part of the activity log.",
    validate: int(0, 365),
  },
  "ai.limit_per_month": {
    group: "ai", type: "number", default: 0, label: "Most drafts a month (0 = no limit)",
    help: "Counted for this workspace. When the limit is reached the screen says so and the guided builder, which needs no AI, still works.",
    validate: int(0, 100000),
  },
  "ai.limit_per_day": {
    group: "ai", type: "number", default: 0, label: "Most drafts a day (0 = no limit)",
    help: "Counted for this workspace per calendar day (UTC).",
    validate: int(0, 10000),
  },
  // ── uploaded documents (QUEUE §23.4.1 / §23.4.6): limits and the send step's starting values ──
  "upload.max_mb": {
    group: "sending", type: "number", default: 100, label: "Largest upload (MB)",
    help: "The biggest file that can be uploaded to send for signing. The most this system accepts is 100 MB; on the hosted service, Free and Pay as you go are held to 25 MB whatever is set here (Pro and Lifetime take up to 100 MB)." /* R13-D453 */,
    validate: int(1, 100),
  },
  "upload.expiry_days": {
    group: "sending", type: "number", default: 30, label: "Uploaded documents expire after (days)",
    help: "The starting deadline on the Send step for an uploaded document; the sender can change it for each send. 0 means it never expires.",
    validate: int(0, 365),
  },
  "upload.email_signed_copy": {
    group: "sending", type: "bool", default: true, label: "Email the signed copy to everyone",
    help: "When an uploaded document is fully signed, email the sealed PDF to every person on it and to the sender.",
    validate: bool,
  },
  "upload.template_approval": {
    group: "templates", type: "bool", default: true, label: "Members' templates need approval",
    help: "When on, a template a member makes — new, customized from a built-in, or a new version — cannot be sent until an owner or admin approves it. Owners and admins never wait for their own. Changing this does not affect templates that already exist. Built-in templates never wait.",
    validate: bool,
  },
  // Run 9 Part 4R: the built-in library (24 Document templates and 30 Form templates) on the Templates page
  "templates.library_shown": {
    group: "templates", type: "bool", default: true, label: "Show the built-in templates",
    help: "The Templates page lists the 54 built-in Document and Form templates beside your own. Off hides them from the page and from Scribe; a built-in already used by an automation or a published form keeps working.",
    validate: bool,
  },
  // the built-in packs switched on (Run 9 Part 4R): set from the Playbooks page's on/off switches, so it is not drawn on the settings form (`elsewhere`)
  "packs.enabled": {
    group: "templates", type: "list", default: [], label: "Built-in packs switched on", elsewhere: "/plays?tab=packs",
    help: "The built-in packs whose templates and skills are offered first. Switch them on and off on the Playbooks page.",
    validate: (v) => (Array.isArray(v) && v.length <= 24 && v.every((x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]{2,60}$/.test(x)) ? null : "must be a list of pack names"),
  },
  "plays.off": {
    group: "templates", type: "list", default: [], label: "Skills switched off", elsewhere: "/plays",
    help: "The skills (add-ons, house styles and your own) Scribe does not use here. Switch them on and off on the Plays page.",
    validate: (v) => (Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]{2,60}$/.test(x)) ? null : "must be a list of skill names"),
  },
  "upload.save_as_template": {
    group: "templates", type: "bool", default: false, label: "Offer to save uploads as templates",
    help: "Tick \"Also keep this as a template\" by default on the Details step so the same document and its fields can be sent again.",
    validate: bool,
  },
  // ── records ──
  retention_years: {
    group: "records", type: "number", default: null, label: "Keep signed documents for (years)",
    help: "Signed documents are kept at least this long. Leave it empty to keep them indefinitely.",
    validate: (v) => (typeof v !== "number" || !Number.isInteger(v) ? "must be a whole number" : v < 7 ? "must be 7 or more" : null),
  },
  resign_months: {
    deprecated: true,   // F924: nothing ever read this value, so a switch that did nothing is hidden until the renewal feature is built (a stored value is kept)
    group: "records", type: "number", default: null, label: "Re-sign after (months)",
    help: "How many months before a signed agreement needs a fresh signature. Leave it empty and nothing expires.",
    validate: int(1, 60),
  },
  // ── signed copy ──
  "signed_copy.letterhead": { group: "signed_copy", type: "bool", default: true, label: "Letterhead", help: "Put the organisation's logo and name at the top of the first page.", validate: bool },
  "signed_copy.address_line": { group: "signed_copy", type: "text", default: "", label: "Address line", help: "One line under the organisation's name, for example a street address and phone number.", validate: str(160) },
  "signed_copy.header_text": { group: "signed_copy", type: "text", default: "", label: "Header text", help: "Small text at the top of every page after the first. Leave empty to show the document title.", validate: str(120) },
  "signed_copy.footer_text": { group: "signed_copy", type: "text", default: "", label: "Footer text", help: "Small text at the bottom of every page.", validate: str(160) },
  "signed_copy.show_document_id": { group: "signed_copy", type: "bool", default: true, label: "Document ID on every page", help: "Print the document's unique ID in the footer so any page can be traced back to it.", validate: bool },
  "signed_copy.page_numbers": { group: "signed_copy", type: "bool", default: true, label: "Page numbers", help: "Print \"Page 2 of 5\" in the footer.", validate: bool },
  "signed_copy.font": { group: "signed_copy", type: "select", options: FONTS.map((value) => ({ value, label: FONT_LABELS[value] })), default: "helvetica", label: "Font", help: "Helvetica is the plain sans-serif, Times is the serif, Inter is a modern face that also covers accented letters.", validate: oneOf(FONTS) },
  "signed_copy.body_size": { group: "signed_copy", type: "number", default: 10, label: "Text size (points)", help: "Body text size, 8 to 14.", validate: int(8, 14) },
  "signed_copy.margin": { group: "signed_copy", type: "number", default: 56, label: "Page margin (points)", help: "Space around the text, 36 to 90. 72 points is one inch.", validate: int(36, 90) },
  "signed_copy.accent": { group: "signed_copy", type: "text", default: "#1f2937", label: "Accent colour", help: "A six-digit colour such as #1f2937. Used for headings and rules.", validate: (v) => (typeof v === "string" && HEX.test(v) ? null : "must be a six-digit colour like #1f2937") },
  "signed_copy.signature_style": { group: "signed_copy", type: "select", options: SIGNATURE_STYLES.map((value) => ({ value, label: SIGNATURE_STYLE_LABELS[value] })), default: "both", label: "Signature style", help: "The first choice shows the drawn signature when there is one and the typed name in a signature font when there is not. The second shows only drawn signatures. The third always uses the typed name.", validate: oneOf(SIGNATURE_STYLES) },
  "signed_copy.show_signer_email": { group: "signed_copy", type: "bool", default: false, label: "Show signer's email under the signature", help: "Print each signer's email address in the signature block.", validate: bool },
  "signed_copy.show_signer_ip": { group: "signed_copy", type: "bool", default: false, label: "Show signer's IP address under the signature", help: "Print each signer's IP address in the signature block. The certificate page always records it.", validate: bool },
  "signed_copy.combine_audit": {
    group: "signed_copy", type: "bool", default: true, label: "Put the audit log inside the signed PDF",
    help: "On: the certificate of completion (the audit log) is the last pages of the signed PDF. Off: the signed PDF holds only the document, and the certificate is a second sealed PDF alongside it.",
    validate: bool,
  },
  "signed_copy.closing_line": { group: "signed_copy", type: "text", default: "", label: "Closing line", help: "A line of text at the end of the document, before the signatures.", validate: str(300) },
  // ── certificate ──
  "certificate.enabled": { group: "certificate", type: "bool", default: true, label: "Certificate of completion", help: "Add a certificate page to every signed copy: who signed, when, from where, and the document's fingerprint.", validate: bool },
  "certificate.includes": {
    group: "certificate", type: "list", options: CERT_PARTS.map((value) => ({ value, label: CERT_PART_LABELS[value] })), default: [...CERT_PARTS], label: "What the certificate shows",
    help: "Which facts to print on the certificate.",
    validate: (v) => (Array.isArray(v) && v.every((x) => CERT_PARTS.includes(x)) ? null : `must be a list drawn from: ${CERT_PARTS.join(", ")}`),
  },
  "certificate.statement": {
    group: "certificate", type: "text", label: "Closing statement",
    default: "This certificate records the electronic signing of the document above. The signers agreed to do business electronically, and the document was sealed with a digital signature when the last party signed.",
    help: "The legal sentence printed at the bottom of the certificate.", validate: str(600),
  },
  // ── email sending (QUEUE §23.3.4): who the signing, reminder and signed-copy emails come from ──
  // ── branding of the page a signer sees and the button in their email (QUEUE §23.5.9) ──
  "brand.accent": { group: "branding", type: "text", default: "", label: "Accent colour", help: "A six-digit colour such as #4f46e5 for the signing page's header line and the buttons in the signing email. Leave empty to use the standard colour.", validate: (v) => (typeof v === "string" && (v === "" || HEX.test(v)) ? null : "must be a six-digit colour like #4f46e5, or empty") },
  "brand.show_logo": { group: "branding", type: "bool", default: true, label: "Show my logo on the signing page", help: "Shows your organisation's logo at the top of the page a person signs on.", validate: bool },
  "brand.hide_footer": { group: "branding", type: "bool", default: false, label: "Remove the Docustay footer", help: "Takes the small “Sent with Docustay” line off the signing page, the signing emails and every signed copy. Part of the Pro plan.", validate: bool },
  "brand.welcome_note": { group: "branding", type: "text", default: "", label: "Note under the title", help: "One line shown to every signer under the document's title — for example “Questions? Call 555-0100.” Leave empty for none.", validate: str(200) },
  "email.provider": { group: "email", type: "select", options: PROVIDERS.map((value) => ({ value, label: PROVIDER_LABELS[value] })), default: "platform", label: "Send from", help: "Docustay, on your behalf: sent from the platform address, replies come to you. Your own domain: sent from your own domain (verify it below). Your own mail server (SMTP): sent through your own mail server. Your connected mailbox: sent through your own Google or Microsoft mailbox (connect it below).", validate: oneOf(PROVIDERS) },
  "email.from_name": { group: "email", type: "text", default: "", label: "From name", help: "Who the email is from, for example your company name. Leave empty to use your organisation's name.", validate: str(120) },
  "email.from_address": { group: "email", type: "text", default: "", label: "From address", help: "For your own domain or SMTP: the address the email comes from, such as contracts@yourdomain.com. With your own domain it must be on the domain you verified.", validate: emailOrEmpty },
  "email.reply_to": { group: "email", type: "text", default: "", label: "Reply-to address", help: "Where replies go. Always used when you send from the platform address.", validate: emailOrEmpty },
  "email.smtp_host": { group: "email", type: "text", default: "", label: "SMTP server", help: "The host name of your mail server, for example smtp.yourprovider.com.", validate: smtpHost },
  "email.smtp_port": { group: "email", type: "number", default: 587, label: "SMTP port", help: "Usually 587 (STARTTLS) or 465 (TLS).", validate: int(1, 65535) },
  "email.smtp_user": { group: "email", type: "text", default: "", label: "SMTP user name", help: "The login for your mail server. The password is saved separately and never shown again.", validate: str(200) },
  "email.smtp_security": { group: "email", type: "select", options: SMTP_SECURITY.map((value) => ({ value, label: SMTP_SECURITY_LABELS[value] })), default: "starttls", label: "SMTP security", help: "STARTTLS for port 587, TLS for port 465, None only for a trusted internal server.", validate: oneOf(SMTP_SECURITY) },

});

export const SETTING_KEYS = Object.freeze(Object.keys(DOCUMENT_SETTINGS));

export function validateDocumentSetting(key, value) {
  const def = DOCUMENT_SETTINGS[key];
  if (!def) return `"${key}" is not a document setting`;
  if (value === null) return null;   // null = reset to the default
  return def.validate(value);
}

/** Every key with its default (a fresh copy each call). */
export const settingDefaults = () => Object.fromEntries(SETTING_KEYS.map((k) => [k, structuredClone(DOCUMENT_SETTINGS[k].default)]));

/** Overlay stored values on the defaults — unknown keys ignored. */
export function withSettingDefaults(stored = {}) {
  const out = settingDefaults();
  for (const k of Object.keys(stored ?? {})) if (k in out && stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
  return out;
}

// ★ QUEUE §23.2.8 — the settings a TEMPLATE may override for its own signed copies (the rest — margins, retention, reminders — stay practice-wide).
export const TEMPLATE_OVERRIDABLE = Object.freeze([
  "signed_copy.letterhead", "signed_copy.header_text", "signed_copy.footer_text", "signed_copy.show_document_id", "signed_copy.page_numbers",
  "signed_copy.font", "signed_copy.body_size", "signed_copy.accent", "signed_copy.signature_style", "signed_copy.closing_line",
  "certificate.enabled", "certificate.statement",
]);

/** Problem with a template override object, or null. Unknown keys and invalid values are refused (never silently dropped). */
export function validateTemplateOverride(o) {
  if (o === null || o === undefined) return null;
  if (typeof o !== "object" || Array.isArray(o)) return "must be an object of settings";
  for (const [k, v] of Object.entries(o)) {
    if (!TEMPLATE_OVERRIDABLE.includes(k)) return `"${k}" cannot be set per template`;
    const p = DOCUMENT_SETTINGS[k].validate(v);
    if (p) return `${DOCUMENT_SETTINGS[k].label}: ${p}`;
  }
  return null;
}

/** The practice's settings with a template's override laid over them (an invalid stored override is ignored key by key, never thrown at render time). */
export function mergeTemplateOverride(settings, override) {
  if (!override || typeof override !== "object") return settings;
  const out = { ...settings };
  for (const [k, v] of Object.entries(override)) if (TEMPLATE_OVERRIDABLE.includes(k) && DOCUMENT_SETTINGS[k].validate(v) === null) out[k] = v;
  return out;
}


// Settings whose value is one of a short, known set are picked from a list on screen, never typed. A value saved earlier that is not in the list is still shown (as "Current"). `null` stands for "none".
const days = (zero, ...n) => [{ value: 0, label: zero }, ...n.map((d) => ({ value: d, label: d === 1 ? "1 day" : `${d} days` }))];
export const SETTING_CHOICES = Object.freeze({
  signature_validity_days: days("Never expires", 1, 3, 7, 14, 30, 60, 90, 180, 365),
  "download.link_days": days("Attach the PDF to the email", 1, 3, 7, 14, 30, 90),
  "ai.chat_retention_days": days("Do not keep", 7, 30, 90, 180, 365),
  "ai.limit_per_month": [{ value: 0, label: "No limit" }, ...[5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000].map((n) => ({ value: n, label: `${n} drafts` }))],
  "ai.limit_per_day": [{ value: 0, label: "No limit" }, ...[1, 3, 5, 10, 25, 50, 100, 500].map((n) => ({ value: n, label: `${n} ${n === 1 ? "draft" : "drafts"}` }))],
  "upload.max_mb": [5, 10, 25, 50, 100].map((n) => ({ value: n, label: `${n} MB` })),
  "upload.expiry_days": days("Never expires", 7, 14, 30, 60, 90, 180, 365),
  retention_years: [{ value: null, label: "Keep indefinitely" }, ...[7, 10, 25].map((n) => ({ value: n, label: `${n} years` }))],
  resign_months: [{ value: null, label: "Never" }, ...[6, 12, 24, 36, 60].map((n) => ({ value: n, label: `${n} months` }))],
  "signed_copy.body_size": [8, 9, 10, 11, 12, 13, 14].map((n) => ({ value: n, label: `${n} pt` })),
  "signed_copy.margin": [{ value: 36, label: "36 pt, narrow" }, { value: 45, label: "45 pt" }, { value: 56, label: "56 pt, standard" }, { value: 64, label: "64 pt" }, { value: 72, label: "72 pt, one inch" }, { value: 90, label: "90 pt, wide" }],
});
// The model picker (AI-COST-AND-USAGE-SPEC §3). Every id comes from the price table (engine/ai/prices.mjs): a hosted workspace sees only the approved models, a self-host or a workspace with its own provider key sees every priced model.
export const modelChoicesFor = ({ hosted }) => ({
  anthropic: hosted
    ? [{ value: "", label: "Claude Sonnet 5.5, high effort (recommended)" }, { value: INTERNAL_MODEL, label: "Claude Haiku 5.5: faster and lighter; may need more editing" }]
    : [{ value: "", label: "Provider default" }, ...Object.keys(PRICES).map((id) => ({ value: id, label: PRICES[id].label }))],
});
export const MODEL_CHOICES = Object.freeze(modelChoicesFor({ hosted: false }));
const COLOUR_KEYS = new Set(["signed_copy.accent", "brand.accent"]);
export const settingWidget = (key, d) => d.widget ?? (COLOUR_KEYS.has(key) ? "color" : key === "ai.model" ? "model" : null);
