// @ts-check
// src/legal/policies.mjs — PLATFORM'S OWN LEGAL PAGES. Site-readiness brief, Part 3, 1 Oct 2026.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NOTHING WAS HERE BEFORE THIS. [MEASURED] zero hits for "privacy policy"/"terms of service"/
//     "data processing addendum" anywhere in src/ or webreact/ before this file. example.com,
//     the signup flow, the client portal footer and the document-signing page linked to nothing.
//
// ★★ ONE CURRENT VERSION PER DOCUMENT, NOT A VERSION HISTORY IN THE DATABASE. The full text of a
//    PAST version lives in git history (this file, at whatever commit was live when a practice
//    accepted it) — the same way a past migration's exact SQL lives in db/migrations/ rather than
//    being re-derived. `keystone.policy_acceptance` (0556) records WHICH version a user accepted
//    and WHEN; it does not duplicate the document text itself.
// ★ Bumping a version: change the three *_VERSION constants AND the content, in the same commit.
//   `src/provisioning/prefix.mjs`'s signup acceptance write always uses the CURRENT constant, so a
//   version bump takes effect on the next signup immediately — there is no separate "publish" step.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const PRIVACY_VERSION = '2026-10-01';
const TERMS_VERSION = '2026-10-01';
const DPA_VERSION = '2026-10-01';

/** @typedef {{ id: string, title: string, bodyHtml: string }} LegalSection */

const esc = (s) => String(s);

function section(id, title, bodyHtml) {
  return { id, title, bodyHtml };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const PRIVACY_SECTIONS = [
  section('role', '1. Workbench’s role', `
    <p>Workbench (operated by the team behind Example Practice Coaching's own practice-management
    platform) provides software coaching and wellness practices use to run their business:
    scheduling, documents, payments and client communication. This policy covers two different
    roles, and which one applies depends on whose data it is.</p>
    <ul>
      <li><strong>Your clients' and leads' data (practice data).</strong> The practice is the
      <strong>data controller</strong>. Workbench is a <strong>data processor</strong>, acting only
      on the practice's instructions, under the Data Processing Addendum (see our
      <a href="/legal/dpa">DPA</a>). If you are a client or lead of a practice using Workbench and
      have a question about your information, contact that practice directly — their own privacy
      policy, linked from their client portal, explains their collection and use of it. Workbench
      does not decide what a practice collects or how long it keeps it; the practice does.</li>
      <li><strong>A practice owner's or staff member's own Workbench account.</strong> For this —
      your login, your account settings, your use of the software itself — Workbench is the
      <strong>data controller</strong>, and the rest of this policy describes that relationship.</li>
    </ul>`),
  section('what-we-collect', '2. What we collect', `
    <ul>
      <li><strong>Account information:</strong> name, email, and sign-in details (we use Firebase
      for authentication; we never see or store your password ourselves).</li>
      <li><strong>Practice information:</strong> your practice's name, address, timezone and the
      settings you configure.</li>
      <li><strong>Usage information:</strong> how you use the product, to fix problems and improve
      it — error logs, performance data, and which features you use.</li>
      <li><strong>Billing information:</strong> processed by Stripe; we store what plan you're on
      and your billing history, not your full card number.</li>
      <li><strong>Practice data, as a processor:</strong> whatever your practice and its clients
      enter into Workbench — client records, documents, messages, session notes, payments. We
      process this on the practice's behalf and do not use it for our own purposes.</li>
    </ul>`),
  section('sub-processors', '3. Sub-processors', `
    <p>We use the following companies to help provide Workbench. Each is bound by a contract to
    protect data at least as strictly as we do, and to use it only to provide their service to us.</p>
    <ul>
      <li><strong>Railway</strong> — application and database hosting.</li>
      <li><strong>Google Cloud / Firebase</strong> — authentication and supporting infrastructure.</li>
      <li><strong>Stripe</strong> — payment processing. Practices on our platform plan use Stripe
      Connect; Example Practice Coaching's own practice uses a direct Stripe account, not Connect.</li>
      <li><strong>Resend</strong> — transactional email delivery.</li>
      <li><strong>Twilio</strong> — SMS and phone-number verification.</li>
      <li><strong>SeaweedFS (self-hosted)</strong> — document and file storage, run on our own
      infrastructure rather than a third-party storage vendor.</li>
    </ul>
    <p>We'll update this list if it changes, and material changes are covered by section 8.</p>`),
  section('security', '4. Security', `
    <p>We use encryption in transit and at rest where supported by our providers, role-based
    access controls, two-step sign-in for staff accounts, tenant isolation enforced at the database
    level (Postgres row-level security, applied to every table that holds practice data — not an
    application-level check that could be bypassed by a bug elsewhere), automated backups, and a
    dedicated signing certificate for documents clients sign through the platform. No system is
    perfectly secure.</p>`),
  section('retention', '5. Retention and deletion', `
    <p>We keep personal information only as long as we need it to provide our services and meet
    legal obligations, and we delete it when you ask us to. A practice can request export or
    deletion of its data at any time by contacting us; we'll complete a deletion request within 30
    days unless we're required to keep something by law (for example, financial records).</p>`),
  section('breach', '6. Breach notice', `
    <p>If we become aware of a security incident affecting practice data, we will notify the
    affected practice without undue delay so they can meet their own notification obligations to
    their clients, consistent with our Data Processing Addendum.</p>`),
  section('rights', '7. Your rights', `
    <p>If you are a client or lead of a practice using Workbench, direct requests about your
    personal information to that practice — they control it, and we help them fulfil requests
    when asked. If you are a practice owner or staff member with your own Workbench account, you
    can ask us to see, correct, delete or export your account information, or to stop processing
    it for purposes you haven't agreed to, by emailing <a href="mailto:privacy@example.com">privacy@example.com</a>.
    California residents have rights under the CCPA/CPRA; we honour equivalent requests for
    everyone, not only California residents.</p>`),
  section('children', '8. Children', `
    <p>Workbench itself is not directed to children; practice owners and staff using it must be
    adults. A practice may use Workbench to hold records about minors (as clients of that practice)
    — that data is the practice's, governed by their own policy and our DPA with them, not by this
    policy directly.</p>`),
  section('changes', '9. Changes', `
    <p>We'll update the effective date above when this policy changes, and ask current practice
    owners to re-accept it on their next sign-in when a change is material (see our
    <a href="/legal/terms">Terms of Service</a>, section on changes).</p>`),
  section('contact', '10. Contact', `
    <p>Workbench · <a href="mailto:privacy@example.com">privacy@example.com</a></p>`)
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TERMS OF SERVICE (for practices)
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const TERMS_SECTIONS = [
  section('accounts', '1. Accounts and authorised users', `
    <p>You create a Workbench account for your practice and may invite staff as authorised users.
    You're responsible for what happens under your account, including actions by anyone you've
    given access to. Keep sign-in details private and tell us if you believe an account has been
    compromised.</p>`),
  section('acceptable-use', '2. Acceptable use', `
    <p>Use Workbench only for lawful business purposes related to running your practice. Don't try
    to break into it, overload it, scrape it, reverse-engineer it, or use it to send unlawful or
    abusive content to your clients.</p>`),
  section('your-data', '3. Your data is yours', `
    <p>You own the data you and your clients put into Workbench. We process it on your instructions
    as described in our <a href="/legal/dpa">Data Processing Addendum</a>. You can export it at any
    time from your account, or ask us for a full export.</p>`),
  section('payments', '4. Payments', `
    <p>Most practices on Workbench connect their own Stripe account (Stripe Connect) to collect
    payments from their clients directly — Workbench facilitates the connection but is not a party
    to those charges. A small number of practices (including Example Practice Coaching, Workbench's
    own operator) use a direct Stripe account rather than Connect. Either way, card data is held by
    Stripe, never by Workbench.</p>`),
  section('fees', '5. Fees and billing', `
    <p>Your subscription fee and billing cycle are shown when you sign up or change plans. Fees are
    billed in advance and are non-refundable except as required by law. We may change our pricing
    with notice before it applies to your next billing cycle.</p>`),
  section('availability', '6. Availability', `
    <p>We work to keep Workbench available and fast, but we don't guarantee uninterrupted uptime.
    We'll give notice of planned maintenance where practical.</p>`),
  section('suspension', '7. Suspension and termination', `
    <p>We may suspend or terminate an account for non-payment, a material breach of these terms, or
    conduct that puts other practices or their clients at risk, with notice where practical. You
    can cancel your own account at any time. On termination (by either of us), you have 30 days to
    export your data before it's deleted per section 5 of our Privacy Policy.</p>`),
  section('disclaimers', '8. Disclaimers', `
    <p>Workbench is provided "as is". We work to keep it accurate and reliable but can't promise
    it's error-free.</p>`),
  section('liability', '9. Limit on our liability', `
    <p>To the extent the law allows, our total liability to you for any claim is limited to the
    fees you paid us in the 12 months before the claim, and we aren't liable for indirect or
    consequential losses.</p>`),
  section('indemnity', '10. Indemnity', `
    <p>You agree to indemnify us against claims arising from your misuse of Workbench or your
    violation of these terms — for example, a claim brought by one of your clients that arises from
    how you used the platform rather than from a defect in it.</p>`),
  section('law', '11. Governing law', `
    <p>California law applies, and any dispute not resolved by talking it through first is brought
    in the courts of Santa Cruz County, California.</p>`),
  section('changes', '12. Changes', `
    <p>We may update these terms. We'll update the effective date, and for a material change we'll
    ask current practice owners to re-accept it on their next sign-in rather than applying it
    silently.</p>`)
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DATA PROCESSING ADDENDUM
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const DPA_SECTIONS = [
  section('intro', 'Overview', `
    <p>This Data Processing Addendum applies whenever Workbench processes personal data on your
    (the practice's) behalf, as described in our <a href="/legal/privacy">Privacy Policy</a>, and
    forms part of your agreement with us when you accept it at signup. You are the controller of
    your clients' and leads' data; we are the processor, acting only on your documented
    instructions as set out below.</p>`),
  section('instructions', '1. Processing on instructions', `
    <p>We process personal data only to provide Workbench to you and in accordance with your use of
    its features — we don't use your clients' data for our own purposes, and we don't sell it.</p>`),
  section('confidentiality', '2. Confidentiality', `
    <p>Everyone with access to practice data on our side is bound by confidentiality obligations,
    and access is limited to what's needed to provide and support the service.</p>`),
  section('security', '3. Security', `
    <p>We maintain the technical and organisational measures described in our Privacy Policy's
    Security section — encryption, access controls, database-level tenant isolation, two-step
    sign-in and backups — appropriate to the sensitivity of the data involved.</p>`),
  section('sub-processors', '4. Sub-processors', `
    <p>We use the sub-processors listed in our Privacy Policy. We'll give you reasonable notice (via
    email or in-product notice) before adding a new sub-processor that will handle your data, so you
    can raise an objection.</p>`),
  section('assistance', '5. Assisting with rights requests and breaches', `
    <p>We'll help you respond to a data subject request from one of your clients (access, correction
    or deletion) using the tools in Workbench, or directly if asked. If we become aware of a security
    incident affecting your data, we'll notify you without undue delay so you can meet your own
    notification obligations.</p>`),
  section('deletion', '6. Deletion or return at the end', `
    <p>When your account ends, you can export your data for 30 days, after which we delete it, as
    described in our Privacy Policy's Retention section.</p>`),
  section('contact', 'Contact', `
    <p>Questions about this Addendum: <a href="mailto:privacy@example.com">privacy@example.com</a></p>`)
];

const LEGAL_DOCS = Object.freeze({
  privacy: { slug: 'privacy', title: 'Workbench Privacy Policy', version: PRIVACY_VERSION, sections: PRIVACY_SECTIONS },
  terms:   { slug: 'terms',   title: 'Workbench Terms of Service', version: TERMS_VERSION, sections: TERMS_SECTIONS },
  dpa:     { slug: 'dpa',     title: 'Workbench Data Processing Addendum', version: DPA_VERSION, sections: DPA_SECTIONS }
});

/** The version string recorded against a signup's acceptance of all three documents at once. */
export const CURRENT_POLICY_VERSION = PRIVACY_VERSION === TERMS_VERSION && TERMS_VERSION === DPA_VERSION
  ? PRIVACY_VERSION
  : `privacy:${PRIVACY_VERSION};terms:${TERMS_VERSION};dpa:${DPA_VERSION}`;

function pageShell(doc) {
  const nav = doc.sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('');
  const body = doc.sections.map((s) => `<h2 id="${s.id}">${esc(s.title)}</h2>${s.bodyHtml}`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(doc.title)} | Workbench</title>
<meta name="robots" content="noindex" />
<link rel="preload" href="/fonts/Inter-400-normal.woff2" as="font" type="font/woff2" crossorigin />
<style>
  @font-face { font-family: "Inter"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/Inter-400-normal.woff2") format("woff2"); }
  @font-face { font-family: "Inter"; font-style: normal; font-weight: 600; font-display: swap; src: url("/fonts/Inter-600-normal.woff2") format("woff2"); }
  @font-face { font-family: "Fraunces"; font-style: normal; font-weight: 500; font-display: swap; src: url("/fonts/Fraunces-500-normal.woff2") format("woff2"); }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #FFFFFF; color: #141419; font-family: "Inter", system-ui, sans-serif; font-size: 16px; line-height: 1.65; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 56px 20px 96px; }
  h1 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: clamp(1.9rem, 4.5vw, 2.6rem); margin: 0 0 6px; color: #141419; }
  .eff { color: #6E7481; font-size: 14.5px; margin: 0 0 32px; }
  nav.toc { border: 1px solid #E8ECF2; border-radius: 12px; padding: 20px 24px; margin: 0 0 40px; }
  nav.toc p { font-size: 12.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6E7481; margin: 0 0 10px; }
  nav.toc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  nav.toc a { color: #5A56D6; text-decoration: none; font-size: 14.5px; }
  nav.toc a:hover { text-decoration: underline; }
  h2 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: 1.3rem; color: #141419; margin: 40px 0 12px; scroll-margin-top: 20px; }
  p, li { color: #41454F; font-size: 15.5px; }
  ul { padding-left: 22px; }
  li { margin: 6px 0; }
  a { color: #5A56D6; }
  footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #E8ECF2; font-size: 13px; color: #6E7481; }
  footer a { color: #6E7481; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(doc.title)}</h1>
  <p class="eff">Version ${esc(doc.version)}</p>
  <nav class="toc" aria-label="Sections"><p>On this page</p><ul>${nav}</ul></nav>
  ${body}
  <footer>
    Workbench · <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a> · <a href="/legal/dpa">Data Processing Addendum</a>
  </footer>
</div>
</body>
</html>`;
}

export function renderLegalPage(slug) {
  const doc = LEGAL_DOCS[slug];
  if (!doc) return null;
  return pageShell(doc);
}
