// Drafts Docustay's three legal pages from the repository's current policy text (src/legal/policies.mjs): names changed, the usage-ping paragraph added. Output: src/lib/legal.json. Sections whose the platform wording does not describe Docustay are replaced below by Docustay-written text (the `own` table); the audit of 10 Oct 2026 (specs/proofs/stage-t/run5/AUDIT-CLAIMS.md) lists why.
import fs from "node:fs";
import { PRIVACY_SECTIONS, TERMS_SECTIONS, DPA_SECTIONS } from "../../../src/legal/policies.mjs";
const swap = (h) => h
  .replace(/\(operated by the team behind Example Practice Coaching[^)]*\)\s*/g, "")
  .replace(/[^.<]*Example Practice Coaching[^.<]*direct Stripe account[^.<]*\.\s*/g, "")
  .replace(/privacy@examplecore\.com/g, "privacy@docustay.app")
  .replace(/software coaching and wellness practices use to run their business:\s*scheduling, documents, payments and client communication/g, "software organisations use to prepare, send, sign and keep documents")
  .replace(/Workbench/g, "Docustay").replace(/\bpractices\b/g, "organisations").replace(/\bPractices\b/g, "Organisations").replace(/\ba practice\b/g, "an organisation").replace(/\bA practice\b/g, "An organisation").replace(/\bpractice\b/g, "organisation").replace(/\bPractice\b/g, "Organisation")
  .replace(/\ban organisation's clients and leads/g, "an organisation's signers and contacts").replace(/href="\/legal\/privacy"/g, 'href="/legal/privacy-policy"').replace(/href="\/legal\/licensing(#[a-z-]*)?"/g, 'href="/licensing$1"');
const map = (secs) => secs.map((s) => ({ id: s.id, title: swap(s.title), bodyHtml: swap(s.bodyHtml) }));
const ping = { id: "usage-ping", title: "Self-hosted installs: usage ping and licence check", bodyHtml: `<p>If you run Docustay on your own server, the worker sends one anonymous usage ping a day to docustay.app: a random install identifier the install made for itself, the software version, and five whole numbers (documents sent this month, documents signed, workspaces, users, days running). It never includes document content, names, email addresses or your server's address, and the application does not store the request address for that route. Turn it off with <code>DOCUSTAY_TELEMETRY=off</code>, or send the same report by hand from Settings. If you use a Pro licence, the install also presents its licence key and install identifier to renew a signed note that lets it keep working for up to 30 days offline, and to download the Pro add-on the first time.</p>` };
const FEE = "Docustay charges a platform fee of 2% of each payment collected through a payment field on the Free plan, and no fee on Pro, on top of Stripe's own fees, which Stripe charges to your own Stripe account as usual.";
const payments = { id: "payments", title: "4. Payments", bodyHtml: `<p>When you add a payment field to a document, you connect Stripe: Docustay sends you to Stripe's own sign-up page, which creates a Stripe account for your business (if you already use Stripe you can sign in there and Stripe may offer to reuse your verified business details, but the account is a new, separate one, and the history of an account you already have does not move into it). You are the merchant: the payment goes to that Stripe account and Stripe's agreement with you applies. Docustay is not a party to the sale and does not hold the money. Docustay charges a platform fee of 2% of each payment collected through a payment field on the Free plan, and no fee on Pro, on top of Stripe's own fees, which Stripe charges to that Stripe account as usual. The fee is decided by your plan at the moment the payment is made and is recorded with the payment. If you refund a payment in full, the Docustay fee on it is refunded too. Card details are entered on Stripe's hosted page; Docustay never receives or stores them, only the amount, currency, status and Stripe's reference numbers. You can disconnect at any time: Docustay then stops using the account. Docustay never deletes it; it stays in your Stripe login, where you manage it in the normal Stripe Dashboard.</p>` };
// Docustay is a product of GLRS LLC (the legal name; no address or other company fact is invented here: those wait on the owner). Added as the first section of Terms, Privacy and the DPA.
const operator = { id: "operator", title: "Who runs Docustay", bodyHtml: `<p>Docustay is a product of GLRS LLC. In this document, “we”, “us” and “our” mean GLRS LLC. To reach us, use the <a href="/contact">Contact</a> page.</p>` };
const licenceTerms = { id: "licences", title: "12. Software licences and the Docustay name", bodyHtml: `<p>Docustay's server and app code is licensed under the GNU Affero General Public License, version 3 or later. The client pieces you put inside your own software (the SDKs, the signing element and its React, Vue and Angular wrappers, the OpenAPI file, the agent skills and the MCP server) are licensed under the MIT licence. Using Docustay through its API or those pieces does not make your own software AGPL. See <a href="/licensing">Licensing</a> for the plain-words explanation.</p><p>A Self-host Pro licence key is sold per install, for use in the buyer's own business only. It does not allow embedding Docustay in a product you sell or offer to others, white-labelling it, reselling it or keeping a private fork; those need a commercial licence from us. A key is checked by the install and keeps working for up to 30 days if our server cannot be reached.</p><p>The name “Docustay” and its logo are not licensed by the AGPL or the MIT licence. See <a href="/licensing#name">the note on the name</a>.</p>` };
const proPrice = { id: "pro-price", title: "Cloud Pro price and the founders price", bodyHtml: `<p>Cloud Pro costs $39 a month for the whole workspace, however many people use it. It is not charged per user.</p><p><strong>The founders price.</strong> If you subscribe to Cloud Pro on or before the founders cut-off date shown on the Pricing page (the end of that day, Pacific time), you pay $25 a month. You keep that price for as long as the subscription stays continuously active, through every renewal. The price is the one shown when you start checkout.</p><p><strong>When the founders price ends.</strong> If a subscription ends, because you cancel it or because a failed payment is not put right and the subscription is cancelled, and you subscribe again later, the new subscription is at the Cloud Pro price in force at that time. Cancelling at the end of a period leaves the subscription, and the price, in place until that period ends.</p><p>We tell you the price before you pay and in your receipt. Taxes, if any apply to you, are shown at checkout.</p>` };
// Docustay's own fees section (policy values the Pricing page also states; scripts/claims-gate.mjs checks that both say the same numbers). It lived only as a hand-edit of the generated file and was lost on the next regeneration (found 7 Oct 2026): it belongs here.
const fees = { id: "fees", title: "5. Fees and billing", bodyHtml: `
    <p>Your subscription fee and billing cycle are shown when you sign up or change plans. Fees are billed in advance. Docustay does not give refunds: you can cancel at any time, and Pro stays on until the end of the period you have paid for, with nothing further charged. Existing customers get at least 12 months' notice before a price change applies to them; founders keep their price as long as the subscription stays active.</p><p>You can cancel from the Billing page (Manage plan). Cancelling ends your paid plan at the end of the period you paid for, and the page shows the end date. After cancelling you keep read and download access to sent and signed documents on the Free plan, and you can export everything at any time.</p>` };
// Docustay-written sections. The the platform policy text this file is drafted from describes a coaching CRM (clients, leads, session notes, a client portal, SMS), a longer sub-processor list than Docustay uses and a deletion promise Docustay no longer keeps. These replace those sections whole, so the generator can never bring the old wording back. Audit: specs/proofs/stage-t/run5/AUDIT-CLAIMS.md rows 1, 2, 3, 8, 15, 16, 17, 19 and U1, U3, U4, U6, U8, U9.
const WHEN = "2026-10-10";   // the date this wording went live; the text on the Terms, Privacy and DPA pages is no older than this
const CHANGED = `<p><strong>What changed on 10 October 2026.</strong> The sub-processor list now matches what the service really uses (it adds the AI model provider and the bot check, and drops SMS). Two-step sign-in is described as the optional setting it is. Account and workspace deletion are described as they now work: in the app, with a cooling-off period, keeping a person's signed record when they delete their own account. Backups are described as they are. Wording about records Docustay does not hold was replaced with what it does hold. Earlier in October the Terms gained the 2% payment fee on the Free plan and the Cloud Pro price.</p>`;
const CHANGED_TERMS = `<p><strong>What changed on 10 October 2026.</strong> Cancelling and exporting are described as they work now: you can export at any time, an owner can delete the workspace in the app, and a deleted workspace's signed copies go with it. The promise of an email before an annual renewal was removed, because annual billing is not switched on. Wording about records Docustay does not hold was replaced with what it does hold. Earlier in October the Terms gained the 2% payment fee on the Free plan and the Cloud Pro price.</p>`;
const own = {
  privacy: {
    role: { bodyHtml: `
    <p>Docustay provides software organisations use to prepare, send, sign and keep documents. This policy covers two different
    roles, and which one applies depends on whose data it is.</p>
    <ul>
      <li><strong>The documents and signer details an organisation puts into Docustay (organisation data).</strong> The organisation is the
      <strong>data controller</strong>. Docustay is a <strong>data processor</strong>, acting only
      on the organisation's instructions, under the Data Processing Addendum (see our
      <a href="/legal/dpa">DPA</a>). If you were sent a document to sign, or an organisation using Docustay holds your name or
      email address, and you have a question about your information, contact that organisation directly: it decides what to ask
      you for and how long to keep it. Docustay does not decide that; the organisation does. Section 7 says how to reach us.</li>
      <li><strong>An organisation owner's or team member's own Docustay account.</strong> For this —
      your login, your account settings, your use of the software itself — Docustay is the
      <strong>data controller</strong>, and the rest of this policy describes that relationship.</li>
    </ul>` },
    "what-we-collect": (s) => ({ bodyHtml: s.bodyHtml
      .replace(/<li><strong>Account information:<\/strong>[\s\S]*?<\/li>/, `<li><strong>Account information:</strong> name, email, and sign-in details. On the hosted service we use Firebase for sign-in: your password goes from your browser to Firebase, and we never see or store it. A self-hosted install keeps salted password hashes in its own database.</li>`)
      .replace(/<li><strong>Organisation data, as a processor:<\/strong>[\s\S]*?<\/li>/, `<li><strong>Organisation data, as a processor:</strong> whatever your organisation puts into Docustay: documents and templates, the names and email addresses of signers, the record of each signing (time, address, browser and the wording agreed to), form responses, and payments made inside a document. We process this on the organisation's behalf and do not use it for our own purposes.</li>`) }),
    "sub-processors": { bodyHtml: `
    <p>We use the following companies to help provide Docustay. Each is bound by a contract to
    protect data at least as strictly as we do, and to use it only to provide their service to us.</p>
    <ul>
      <li><strong>Railway</strong> — hosting for the application, the database and the file store that keeps uploaded and signed files. All data you store.</li>
      <li><strong>Google Cloud / Firebase</strong> — sign-in and supporting infrastructure. Account email and sign-in identifiers.</li>
      <li><strong>Stripe</strong> — payment processing. Billing details and payment references; card numbers go to Stripe directly.</li>
      <li><strong>Resend</strong> — sending email. The recipient's email address and the message.</li>
      <li><strong>Anthropic</strong> — the AI model behind Scribe and Find fields with AI. It receives the text or page pictures of a document only when a person uses an AI feature, and only for that request.</li>
      <li><strong>Cloudflare</strong> — a bot check (Turnstile) on the sign-up page and public forms. It receives the visitor's address and browser.</li>
      <li><strong>A public time-stamp authority (DigiCert by default)</strong> — a trusted time on a signed file. It receives a hash of the file, never its contents.</li>
    </ul>
    <p>The file store runs as software of ours on Railway, so it is not a separate company. Services you connect yourself, such as your own AI key or endpoint, your own mail server or a mailbox you link, are your own choice and are not on this list. Only the AI model provider receives the contents of a document, and only for a request a person starts. We'll update this list if it changes, and changes are covered by section 9.</p>` },
    security: { bodyHtml: `
    <p>We use encryption in transit and at rest where supported by our providers, role-based
    access controls, optional two-step sign-in with an authenticator app (a workspace owner can require it for everyone), tenant isolation enforced at the database
    level (Postgres row-level security, applied to every table that holds organisation data — not an
    application-level check that could be bypassed by a bug elsewhere), backups to a separate location, and a
    dedicated signing certificate for documents signed through the platform. No system is
    perfectly secure.</p>` },
    retention: { bodyHtml: `
    <p>We keep personal information only as long as we need it to provide our services and meet
    legal obligations, and we delete it when you ask us to.</p>
    <p><strong>Your own account.</strong> Any signed-in member can delete their own account in Settings → My account. You type your email address, and you need to have signed in within the last 15 minutes. The deletion is scheduled with a 14-day cooling-off period, during which you can press "Keep my account". We email you when you ask, 2 days before, and when it is done. Then your name, email address and other details are erased, your sessions end, and your sign-in identity is removed when no other workspace uses it. Documents you signed stay as the signed record, with your name as you signed it, because they are evidence of an agreement with other people. Documents you were asked to sign but had not signed are removed. A sole owner must hand over ownership or delete the workspace first.</p>
    <p><strong>A whole workspace.</strong> An owner can delete the workspace in Workspace → Data. The owner types the workspace name, signs in again recently, and cancels any paid plan first. There is a 7-day cooling-off period, every owner is emailed, and any owner can keep the workspace. Then everything in it is removed, including signed copies and certificates. Before you delete, use Download everything: a zip with each sealed PDF and its audit log.</p>
    <p><strong>A signer's details.</strong> Staff can look up a person and remove their details from documents that are not signed yet in Workspace → Data → Privacy requests. A document the person already signed is kept as the signed record. A signer who wants their details removed asks the organisation that sent the document; for Docustay itself, write to privacy@docustay.app.</p>
    <p><strong>What we keep.</strong> A platform record that a deletion happened: a SHA-256 hash of the lower-cased email address (or the workspace id), the date and a request id. It holds no names or addresses. Stripe keeps its own billing records for a paid plan.</p>
    <p><strong>Backups.</strong> The database is backed up once a day to a separate storage location, and those backups are deleted after 30 days, so deleted data can remain in a backup for up to 30 days. When a backup is restored, we carry out the recorded deletions again so that deleted people and workspaces do not come back. We do not currently test restores on a schedule.</p>
    <p>For anything these screens do not cover, write to privacy@docustay.app. We'll complete a deletion request within 30
    days unless we're required to keep something by law (for example, financial records).</p>` },
    breach: { bodyHtml: `
    <p>If we become aware of a security incident affecting organisation data, we will notify the
    affected organisation without undue delay so they can meet their own notification obligations to
    the people concerned, consistent with our Data Processing Addendum.</p>` },
    rights: { bodyHtml: `
    <p>If an organisation using Docustay holds your name or email address, for example because it sent you a document to sign,
    direct requests about that information to the organisation — it controls it, and we help it fulfil requests
    when asked. The sender decides what to ask a signer for. A document you already signed is kept as the signed record. If you are an organisation owner or team member with your own Docustay account, you
    can ask us to see, correct, delete or export your account information, or to stop processing
    it for purposes you haven't agreed to, by emailing <a href="mailto:privacy@docustay.app">privacy@docustay.app</a>; you can also delete your own account in the app (section 5).
    California residents have rights under the CCPA/CPRA; we honour equivalent requests for
    everyone, not only California residents.</p>` },
    children: { bodyHtml: `
    <p>Docustay itself is not directed to children; organisation owners and team members using it must be
    adults. An organisation may use Docustay for documents that concern minors
    — that data is the organisation's, governed by their own policy and our DPA with them, not by this
    policy directly.</p>` },
    changes: (s) => ({ bodyHtml: s.bodyHtml + CHANGED }),
  },
  terms: {
    "acceptable-use": { bodyHtml: `
    <p>Use Docustay only for lawful business purposes related to running your organisation. Don't try
    to break into it, overload it, scrape it, reverse-engineer it, or use it to send unlawful or
    abusive content to the people you send documents to.</p>` },
    "your-data": { bodyHtml: `
    <p>You own the data you and your signers put into Docustay. We process it on your instructions
    as described in our <a href="/legal/dpa">Data Processing Addendum</a>. You can export it at any
    time from your account (Download everything), or ask us for a full export.</p>` },
    suspension: { bodyHtml: `
    <p>We may suspend or terminate an account for non-payment, a material breach of these terms, or
    conduct that puts other organisations or the people they send documents to at risk, with notice where practical. You
    can cancel your own account at any time, and an owner can delete the whole workspace in Workspace → Data (see section 5 of our Privacy Policy). On termination (by either of us), you can still export your data;
    ask us and we delete it within 30 days, as described in section 5 of our Privacy Policy.</p>` },
    indemnity: { bodyHtml: `
    <p>You agree to indemnify us against claims arising from your misuse of Docustay or your
    violation of these terms — for example, a claim brought by a signer or another person you sent a document to that arises from
    how you used the platform rather than from a defect in it.</p>` },
    changes: (s) => ({ bodyHtml: s.bodyHtml + CHANGED_TERMS }),
  },
  dpa: {
    intro: { bodyHtml: `
    <p>This Data Processing Addendum applies whenever Docustay processes personal data on your
    (the organisation's) behalf, as described in our <a href="/legal/privacy-policy">Privacy Policy</a>, and
    forms part of your agreement with us when you accept it at signup. You are the controller of
    the personal data you put into Docustay about your signers and contacts; we are the processor, acting only
    on your documented instructions as set out below.</p>` },
    instructions: { bodyHtml: `
    <p>We process personal data only to provide Docustay to you and in accordance with your use of
    its features — we don't use your signers' data for our own purposes, and we don't sell it.</p>` },
    security: { bodyHtml: `
    <p>We maintain the technical and organisational measures described in our Privacy Policy's
    Security section — encryption, access controls, database-level tenant isolation, optional two-step
    sign-in and backups — appropriate to the sensitivity of the data involved.</p>` },
    assistance: { bodyHtml: `
    <p>We'll help you respond to a data subject request from one of your signers or contacts (access, correction
    or deletion) using the tools in Docustay, or directly if asked. In the app, staff can look up a person and remove their details from documents that are not signed yet (Workspace → Data → Privacy requests); a document the person already signed is kept as the signed record. If we become aware of a security
    incident affecting your data, we'll notify you without undue delay so you can meet your own
    notification obligations.</p>` },
    deletion: { bodyHtml: `
    <p>You can export your data at any time. The owner can delete the whole workspace in Workspace → Data: a paid plan must be cancelled first, and there is a 7-day cooling-off period during which any owner can keep the workspace. Then everything in it, including signed copies and certificates, is removed. If an account ends in another way, write to us and we delete the data within 30 days, as described in our Privacy Policy's Retention section. Deleted data can remain in a backup for up to 30 days, and recorded deletions are carried out again if a backup is restored.</p>` },
  },
};
const mapDoc = (doc, secs) => map(secs).map((s) => { const o = own[doc][s.id]; return o ? { ...s, ...(typeof o === "function" ? o(s) : o) } : s; });
const termsSecs = mapDoc("terms", TERMS_SECTIONS).flatMap((s) => (s.id === "payments" ? [payments, proPrice] : s.id === "fees" ? [fees] : [s]));
termsSecs.splice(termsSecs.length - 1, 0, licenceTerms);   // before the last section (contact / changes)
termsSecs.unshift(operator);
for (const sec of termsSecs) if (/^12\. Changes/.test(sec.title)) sec.title = sec.title.replace(/^12\./, "13.");
const privNote = " If you collect payments through a payment field, Docustay keeps the amount, currency, payment status, Stripe session and payment references and a receipt link, and the fee charged. Card details stay with Stripe.";
const priv = mapDoc("privacy", PRIVACY_SECTIONS).map((s) => (s.id === "what-we-collect" ? { ...s, bodyHtml: s.bodyHtml.replace(/<\/ul>\s*$/, `<li><strong>Payment records:</strong>${privNote.trimStart()}</li><li><strong>Translation suggestions:</strong> if you use "Suggest a better translation", Docustay keeps the language, the sentence, the text you suggest, your note, and your email address only if you add one. We do not keep your IP address: a one-way code made from it and the date limits how many suggestions one address can send in a day, and the code is not used for anything else. Only the people Docustay names to review suggestions can read them. A suggestion that is approved can become part of the translation: only the text is used, never your email. You can ask us to delete a suggestion by writing to privacy@docustay.app.</li></ul>`) } : s)); priv.splice(priv.length - 1, 0, ping);
// Third-party notices: generated from src/lib/licences.json by scripts/licence-gate.mjs
const lic = JSON.parse(fs.readFileSync(new URL("../src/lib/licences.json", import.meta.url), "utf8"));
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const table = (rows) => `<table><thead><tr><th>Package</th><th>Version</th><th>Licence</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${p.repository ? `<a href="${esc(p.repository)}" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td><td>${esc(p.version)}</td><td>${esc(p.licence)}</td></tr>`).join("")}</tbody></table>`;
const notices = { title: "Third-party notices", version: "5 Oct 2026", sections: [
  { id: "about", title: "What this is", bodyHtml: `<p>Docustay's website is built from open-source software. This page lists it, with each package's licence, and the fonts and film footage used. The same list is available as plain text at <a href="/THIRD-PARTY-NOTICES.txt">/THIRD-PARTY-NOTICES.txt</a>.</p>` },
  { id: "shipped", title: `Software shipped with the site (${lic.shipped.length} packages)`, bodyHtml: table(lic.shipped) },
  { id: "fonts", title: "Fonts", bodyHtml: `<p>Geist, JetBrains Mono and Instrument Serif, under the SIL Open Font Licence 1.1. Licence texts: <a href="/fonts/LICENSE-OFL-Geist.txt">Geist</a>, <a href="/fonts/LICENSE-OFL-JetBrainsMono.txt">JetBrains Mono</a>, <a href="/fonts/LICENSE-OFL-InstrumentSerif.txt">Instrument Serif</a>.</p>` },
  { id: "film", title: "Film and clips", bodyHtml: `<p>The home-page film and use-case clips are edited from Pexels footage, used under the Pexels License (free to use; attribution not required, recorded here anyway). Clip ids: ${lic.media.clips.map((c) => `<a href="${esc(c.page)}" rel="noopener">${c.id}</a>`).join(", ")}.</p>` },
  { id: "dev", title: `Build and test tools, not shipped (${lic.devOnly.length} packages)`, bodyHtml: `<p>These are used to build and test the site. Nothing from them is in what visitors download.</p>${table(lic.devOnly)}` },
] };
const cookies = { title: "Cookies and analytics", version: "10 Oct 2026", sections: [
  { id: "short", title: "In short", bodyHtml: `<p>The Docustay website uses a few small files (cookies) to work, and, <strong>only if you press Accept</strong>, Google Tag Manager and Google Analytics to count visits. If you press Decline, or do nothing, no analytics code is loaded and nothing is sent to Google. The signed-in app and the signing pages never load analytics at all. The sign-up page and public forms do load a bot check from Cloudflare, described below.</p>` },
  { id: "needed", title: "Cookies the site needs", bodyHtml: `<ul><li><strong>Your choice about analytics</strong> (<code>docustay-consent</code>): remembers Accept or Decline for a year.</li><li><strong>Theme and language</strong> (<code>docustay-theme</code>, and a language choice): remember how you like the site to look.</li><li><strong>Sign-in</strong>: when you sign in to the app, a session cookie keeps you signed in. A short-lived cookie is used while a sign-in with an identity provider is in progress.</li></ul><p>These are needed for the site to do what you asked, so they are set without asking.</p>` },
  { id: "bot-check", title: "Bot check on sign-up and forms", bodyHtml: `<p>The sign-up page and public forms load a bot check from Cloudflare (Turnstile). Cloudflare receives your address and browser to tell people from programs. It loads before you make any choice about analytics, because its job is to protect the form, and it is not used for advertising or for counting visits.</p>` },
  { id: "analytics", title: "Analytics, only if you accept", bodyHtml: `<p>If you press Accept on the website, we load Google Tag Manager, which loads Google Analytics 4 to count page views and how people arrive. Google receives your address (IP), the page, your browser and an approximate region, and sets its own cookies (<code>_ga</code> and similar). We use it to learn which pages help people and which do not. We do not send document contents, names or email addresses to it, and we do not use it for advertising.</p>` },
  { id: "change", title: "Changing your mind", bodyHtml: `<p>Use the <strong>Cookie settings</strong> link in the footer to choose again. Declining deletes the analytics cookies Google set on this site where the browser lets us.</p>` },
] };
const licensing = { title: "Licensing", version: "5 Oct 2026", sections: [
  { id: "short", title: "In short", bodyHtml: `<p>Docustay's server and app code is licensed under the <strong>GNU Affero General Public License, version 3 or later (AGPL-3.0)</strong>. The pieces you put inside your own software are licensed under the <strong>MIT licence</strong>. If you want to embed, white-label or resell Docustay, or keep a private fork without publishing it, you can buy a <strong>commercial licence</strong>. Docustay is a product of GLRS LLC.</p><p>This page explains the licences in plain words. It is general information, not legal advice, and the licence texts themselves are what apply.</p>` },
  { id: "ways", title: "Three ways to use Docustay", bodyHtml: `<ol><li><strong>Hosted by us.</strong> Cloud Free is $0 with 15 documents a month, and Cloud Pro is $39 a month for the whole workspace with unlimited users, or $25 a month for the founders price described in the <a href="/legal/terms">Terms</a>. There is no code to license: you use the service under the <a href="/legal/terms">Terms</a>.</li><li><strong>Run it yourself under the AGPL-3.0.</strong> Self-host Community is free. Self-host Pro is $390 a year per install, for use in your own business only, and unlocks the Pro items on your server. It is not for embedding in a product or reselling.</li><li><strong>A commercial licence</strong>, from about $3,000 a year and quoted for your volume, for embedding, white-labelling, reselling, or keeping a private fork without publishing your changes. <a href="/contact">Contact us</a> and choose “Licensing”.</li></ol>` },
  { id: "agpl", title: "What the AGPL-3.0 asks of you", bodyHtml: `<p>You may run, study, change and share the code. If you <em>change</em> the code and let other people use your changed version over a network, you must offer those people the source of your version under the same licence. If you run the code unchanged for your own business, there is nothing to publish. If you share the code, you pass on the same rights. The AGPL-3.0 text in the file <code>LICENSE</code> is the authority; this paragraph is a summary.</p>` },
  { id: "mit", title: "What stays MIT, and why", bodyHtml: `<p>These pieces run inside your own application, so they are MIT, which asks almost nothing of you: the JavaScript SDK (<code>@docustay2026/sdk</code>), the Python SDK (<code>docustay</code>), the <code>&lt;docustay-sign&gt;</code> element and its React, Vue and Angular wrappers, the MCP server, the Claude Code plugin and the agent skills, and the OpenAPI file.</p>` },
  { id: "boundary", title: "The line between the two, in plain words", bodyHtml: `<p>A customer who calls the Docustay API over HTTP, or uses the SDKs, is <strong>not</strong> making a derivative work of the server, and their software does not become AGPL. A customer who <strong>copies or modifies server code</strong> and lets other people use it over a network is, and the AGPL applies to that code. Showing the Docustay signing page inside your site in a frame is using a service, not copying code.</p>` },
  { id: "selfhost-pro", title: "Self-host Pro", bodyHtml: `<p>A Pro licence key is $390 a year per install. It is for use in the buyer's own business. It does not cover embedding Docustay in something you sell or offer to others, white-labelling, resale or a private fork: those need a commercial licence. The key is checked by the install, keeps working for up to 30 days if our server cannot be reached, and the Pro features come from a closed add-on that your install downloads with its key; when the licence ends the install is the Community build again and nothing is deleted.</p>` },
  { id: "name", title: "The name “Docustay”", bodyHtml: `<p>“Docustay” and the Docustay logo are marks of GLRS LLC. The AGPL-3.0 and MIT licences give you the right to use the code, not the name or the logo. You may say that your product works with Docustay or uses the Docustay API. If you fork the code, choose your own name and logo. A commercial licence can include permission to use the name. This is a plain-language note about how the name is treated, not a claim of registration.</p>` },
  { id: "contributing", title: "Contributing", bodyHtml: `<p>People who send changes keep their copyright and give GLRS LLC a licence to use the change under any licence, including a commercial one. That is what lets us offer a commercial licence next to the open one. The short agreement is in the file <code>CONTRIBUTOR-AGREEMENT.md</code>.</p>` },
  { id: "third-party", title: "Third-party software", bodyHtml: `<p>Docustay includes other people's software under its own licences, all of them compatible with the AGPL-3.0. They are listed on the <a href="/legal/notices">third-party notices</a> page.</p>` },
] };
fs.writeFileSync(new URL("../src/lib/legal.json", import.meta.url), JSON.stringify({
  notices,
  terms: { title: "Terms of Service", version: WHEN, sections: termsSecs },
  privacy: { title: "Privacy Policy", version: WHEN, sections: [operator, ...priv] },
  dpa: { title: "Data Processing Addendum", version: WHEN, sections: [operator, ...mapDoc("dpa", DPA_SECTIONS)] },
  licensing,
  cookies,
}, null, 1));
console.log("legal.json written");
