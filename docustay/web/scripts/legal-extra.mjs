// Extra legal sections (13 Oct 2026, site rebuild). Imported by build-legal.mjs and spliced in after the section named by `after`.
// Every statement here is limited to what the code, the settings schema or the docs in this repository do. Where a fact could not be verified it is left out and listed in the run report as [CONFIRM].
// These pages are plain-language statements about what the product does. They are general information, not legal advice, and they promise no legal outcome.

const li = (a) => `<ul>${a.map((x) => `<li>${x}</li>`).join("")}</ul>`;
const p = (...a) => a.map((x) => `<p>${x}</p>`).join("");

export const COOKIES_EXTRA = [
  { after: "needed", id: "inventory", title: "Every cookie and stored item, by name", bodyHtml: p(
    "This is the complete list of what the Docustay website and app put in your browser. Cookies are sent back to our server with each request. Browser storage (localStorage and sessionStorage) stays in your browser and is read only by the page that wrote it. Where a name ends in a star, the rest of the name varies.",
  ) + `<table><thead><tr><th>Name</th><th>Kind</th><th>What it holds</th><th>How long</th></tr></thead><tbody>
<tr><td><code>docustay-consent</code></td><td>Cookie</td><td>Your analytics choice: <code>granted</code> or <code>denied</code></td><td>One year</td></tr>
<tr><td><code>docustay-theme</code></td><td>Cookie and localStorage</td><td>Light, dark or system appearance</td><td>One year (cookie); until cleared (storage)</td></tr>
<tr><td><code>ks_session</code></td><td>Cookie (HttpOnly, Secure, SameSite Lax)</td><td>The token that keeps you signed in to the app</td><td>12 hours for a normal sign-in</td></tr>
<tr><td><code>docustay_oidc</code></td><td>Cookie (HttpOnly, SameSite Lax)</td><td>Sealed state of a single sign-on attempt on a self-hosted install</td><td>10 minutes</td></tr>
<tr><td><code>ds_starter</code></td><td>Cookie</td><td>The slug of a built-in template you chose on the website, so it opens after sign-up</td><td>One hour</td></tr>
<tr><td><code>docustay-starter</code></td><td>sessionStorage</td><td>The same slug, for this tab</td><td>Until the tab closes</td></tr>
<tr><td><code>docustay-signed-in</code></td><td>localStorage</td><td>A timestamp that tells the website you probably have a session, so it can show the right buttons</td><td>Treated as stale after 14 days</td></tr>
<tr><td><code>docustay:signtoken</code></td><td>sessionStorage</td><td>The signing page's token for this tab, so a reload does not lose your place</td><td>Until the tab closes</td></tr>
<tr><td><code>docustay.saved.*</code></td><td>localStorage</td><td>A drawn signature or initials, only where the signing page offers to remember it and the box is ticked; the name is part of the key</td><td>Until cleared</td></tr>
<tr><td><code>ds-flow-draft:*</code></td><td>localStorage</td><td>An unsent document in the send flow, so a refresh does not lose it</td><td>Until cleared</td></tr>
<tr><td><code>docustay-docs-view</code></td><td>localStorage</td><td>Whether your document list is shown as a list or as cards</td><td>Until cleared</td></tr>
<tr><td><code>docustay-notrack</code>, <code>umami.disabled</code></td><td>localStorage</td><td>Flags that stop our own visit counter on this browser</td><td>Until cleared</td></tr>
<tr><td><code>ph_*</code>, <code>ph_phc_*_posthog</code></td><td>Cookie and localStorage set by PostHog</td><td>An anonymous visitor id, only after you press Accept. If you decline, PostHog keeps nothing on your device</td><td>One year; removed when you decline</td></tr>
<tr><td><code>_ga</code> and similar</td><td>Cookie set by Google</td><td>Google Analytics identifiers, only after you press Accept</td><td>Set by Google; removed when you decline</td></tr>
</tbody></table>` + p("Cloudflare's bot check on the sign-up page may set its own items in your browser; those belong to Cloudflare and are described in its documentation, not here.") },

  { after: "inventory", id: "storage", title: "Cookies and browser storage are not the same thing", bodyHtml: p(
    "A cookie travels to our server every time your browser asks for a page. That is how the app knows who you are after you sign in, and why the sign-in cookie is marked HttpOnly (a script on the page cannot read it), Secure (it is sent only over an encrypted connection) and SameSite Lax (it is not sent along with most requests that start on another website).",
    "Browser storage is different: the value stays on your device and is not sent to us on each request. We use it for conveniences that do not need our server, such as remembering a theme, the draft of a document you have not sent yet, or the language you chose. Clearing your site data in the browser removes both kinds.",
  ) },

  { after: "storage", id: "signing-pages", title: "Signers: what the signing page keeps", bodyHtml: p(
    "If you were sent a document to sign, you do not need an account and the signing page does not load analytics of any kind. It keeps the following in your browser so the page works:",
  ) + li([
    "A token for your signing session, in sessionStorage, so reloading the page does not lose your place. It is gone when you close the tab; if your browser blocks storage, you open the emailed link again.",
    "If the page offers to remember your signature and you leave the box ticked, the drawn signature or initials, in localStorage under your name. Untick the box, or clear site data, and nothing is kept.",
  ]) + p("The signing record that belongs to the document itself (the time, your address, your browser and the wording you agreed to) is not stored in your browser. It is kept by the organisation that sent the document, as described in the Privacy Policy.") },

  { after: "signing-pages", id: "app-cookies", title: "The signed-in app", bodyHtml: p(
    "When you sign in to the Docustay app, one session cookie (<code>ks_session</code>) is set. It lasts twelve hours for a normal sign-in, and signing out ends it at once. A workspace can also sign people out after a period without activity, and a signed-in person can list their sessions and end them (Two-step sign-in and sessions in the app's security settings). The app does not load Google Tag Manager, Google Analytics or our visit counter.",
    "On a self-hosted install that offers sign-in with your own identity provider, a second cookie (<code>docustay_oidc</code>) holds the state of the sign-in while you are at the provider. It lasts ten minutes, is limited to the sign-in path, and is cleared when the sign-in finishes.",
  ) },

  { after: "analytics", id: "no-ads", title: "What we do not do", bodyHtml: li([
    "We do not use Google Analytics for advertising.",
    "We do not send document contents, signer names or email addresses to any analytics service.",
    "We do not load Google code before you press Accept, and we load none at all if you press Decline or make no choice.",
    "We do not count visits inside the signed-in app or on a signing page.",
  ]) },

  { after: "umami", id: "signals", title: "Browser signals we honour", bodyHtml: p(
    "Our own visit counter checks the signals your browser sends before it loads. If your browser sends Do Not Track or Global Privacy Control, if you pressed Decline, or if you opened any page once with <code>?notrack=1</code> in the address, the counter does not load. Automated browsers are not counted either. The check runs in your browser, so the signal is honoured before anything is sent to our server.",
    "The Google tools are separate: they load only after you press Accept, and the Cookie settings link in the footer lets you reverse that choice.",
  ) },

  { after: "change", id: "how-to-clear", title: "Clearing it yourself", bodyHtml: p(
    "Every major browser lets you see and delete cookies and site data for one website. Clearing the data for docustay.app removes everything in the table above for that browser. The effects are the ones you would expect: you are signed out of the app, the site forgets your analytics choice and asks again, your theme and language go back to the defaults, and any unsent draft kept in your browser is gone. Documents you have sent or signed are not stored in your browser and are not affected.",
    "Blocking all cookies also works, with one cost: you cannot stay signed in to the app, because the session cookie is how the app recognises you.",
  ) },

  { after: "how-to-clear", id: "other-sites", title: "Embedded and self-hosted use", bodyHtml: p(
    "Organisations can show the signing form inside their own website, and they can run Docustay on their own server. The cookie list above describes the Docustay website and app. A website that embeds the signing form has its own cookies, which are its own responsibility. A self-hosted install sets the app cookies listed above on its own address, and the website analytics described on this page belong to docustay.app, not to the install.",
  ) },

  { after: "other-sites", id: "cookie-contact", title: "Questions and changes", bodyHtml: p(
    "Write to <a href=\"mailto:privacy@docustay.app\">privacy@docustay.app</a> with questions about this page. When a cookie is added, removed or changes purpose, we change the table above and the date at the top of this page. If the change adds a cookie that is not needed for the site to work, the analytics prompt asks again. This page is general information about what the site does and is not legal advice.",
  ) },
];

export const DPA_EXTRA = [
  { after: "intro", id: "scope", title: "Scope of the processing", bodyHtml: p(
    "<strong>Subject matter.</strong> Docustay prepares, sends, collects signatures on, seals and stores documents for the organisation that holds the workspace.",
    "<strong>Duration.</strong> For as long as the workspace exists, and afterwards for the periods in the Deletion or return section below.",
    "<strong>Nature and purpose.</strong> Storing documents and templates; emailing signing requests, reminders and signed copies to the people named on a document; presenting the signing page; recording the steps of each signing; applying the digital seal and certificate of completion; taking payments through the organisation's own Stripe account where a payment field is used; delivering signed webhook events to the organisation's own endpoints; and, only when a person uses an AI feature, sending that request to an AI model.",
  ) + p("<strong>Types of personal data.</strong> Names and email addresses of signers, contacts and team members; the content of documents, which is whatever the organisation chooses to put in them; the record of each signing (time, network address, browser and the wording agreed to); payment references, amounts and status for payments taken in a document; and the organisation's own account and sign-in details.") +
    p("<strong>Categories of people.</strong> The organisation's signers and contacts, and its own team members.") +
    p("Docustay is not for protected health information yet. Do not put it into a workspace.") },

  { after: "scope", id: "records", title: "What Docustay records about its own processing", bodyHtml: p(
    "So that you can see what happened to your data, the product keeps its own records and lets you read them:",
  ) + li([
    "An <strong>audit log</strong> of every step on a document, with reports that can be exported as CSV.",
    "An <strong>access log</strong> in every workspace of each view, download and export by your team, which owners and admins can list and download as CSV.",
    "An <strong>API log</strong> of each call an API key made, recording the route and the answer and never the contents of the request.",
    "An <strong>email log</strong> of the messages sent for a document, with delivered, bounced and complained statuses; the matching webhook events carry ids only, never an address.",
    "A <strong>delivery log</strong> for each webhook endpoint, showing every attempt and the answer your server gave.",
  ]) + p("These records are part of your workspace, so they are covered by the same export and deletion steps as the rest of it.") },

  { after: "security", id: "security-detail", title: "3A. The measures, one by one", bodyHtml: p(
    "Section 3 refers to the Security section of the Privacy Policy. In plain terms, the product does the following:",
  ) + li([
    "<strong>Isolation between workspaces</strong> is enforced in the database with row-level security on the tables that hold organisation data, so a query for one workspace cannot return another workspace's rows even if application code has a mistake.",
    "<strong>Sign-in.</strong> On the hosted service, passwords go from your browser to Firebase and are never seen or stored by us. A self-hosted install keeps salted password hashes. Two-step sign-in with an authenticator app or a passkey is offered to everyone, and an owner can require it for the whole team. Sessions can be listed and ended.",
    "<strong>API keys</strong> carry only the scopes ticked when they are made, can have an expiry and an address allowlist, and are shown once.",
    "<strong>Webhooks</strong> are signed with a per-endpoint secret using the Standard Webhooks headers, and the receiver is told to refuse a changed body, a wrong secret or a timestamp older than five minutes.",
    "<strong>Signed files</strong> are sealed with a digital signature over the whole PDF and end with a certificate of completion that carries a hash of the file. A public time-stamp authority receives only that hash, never the contents.",
    "<strong>Framing.</strong> The embedded signing form can be shown only by websites the organisation has listed, and an ordinary emailed signing link cannot be framed.",
    "<strong>Backups.</strong> The database is backed up once a day to a separate storage location, and those backups are deleted after 30 days.",
  ]) + p("No system is perfectly secure, and Docustay does not hold a security certification. This list describes the controls that exist; it is not a certification.") },

  { after: "sub-processors", id: "sub-detail", title: "4A. How the sub-processors are used", bodyHtml: p(
    "The Privacy Policy lists each sub-processor and what it receives. In summary: Railway hosts the application, the database and the file store; Google Cloud and Firebase provide sign-in on the hosted service; Stripe processes payments, and card numbers go to Stripe directly; Resend delivers email; Anthropic provides the model behind Scribe and Find fields with AI, and receives document text or page pictures only when a person uses one of those features, and only for that request; Cloudflare provides a bot check on the sign-up page; PostHog provides product analytics (events with an account number, never document contents or signer details); and a public time-stamp authority receives a hash of a signed file.",
    "Services the organisation connects itself, such as its own Stripe account, are the organisation's own choice and are not Docustay sub-processors. On a self-hosted install, the organisation's own mail server is its own choice too.",
  ) },

  { after: "assistance", id: "requests-howto", title: "5A. Handling a request from one of your signers", bodyHtml: p(
    "A signer who writes to you about their information is asking the controller, which is you. The tools for answering them are in the app:",
  ) + li([
    "<strong>Find the person.</strong> Workspace, Data, Privacy requests lets staff look a person up by name or email address.",
    "<strong>Remove their details</strong> from documents that are not signed yet. A document the person has already signed is kept as the signed record, because the signed copy and its certificate are the evidence of what was agreed.",
    "<strong>Export.</strong> The workspace's data can be downloaded at any time, and the audit and access logs export as CSV.",
  ]) + p("If a signer writes to Docustay instead, we point them to the organisation that sent the document, and we help the organisation answer when asked.") },

  { after: "deletion", id: "retention-detail", title: "6A. Retention and deletion, step by step", bodyHtml: p(
    "<strong>Whole workspace.</strong> An owner types the workspace name, signs in again recently and confirms that a paid plan ends at once, with no refund for the days left. There is a 7-day cooling-off period, every owner is emailed, and any owner can keep the workspace. After that, everything in it is removed, including signed copies and certificates.",
    "<strong>A team member's account.</strong> Deletion has a 14-day cooling-off period in which the person can press Keep my account.",
    "<strong>What we keep.</strong> A platform record that a deletion happened: a SHA-256 hash of the lower-cased email address (or the workspace id), the date and a request id. It holds no names or addresses.",
    "<strong>Backups.</strong> Daily backups are deleted after 30 days, so deleted data can remain in a backup for up to 30 days. If a backup is restored, the recorded deletions are carried out again so that deleted people and workspaces do not come back.",
    "<strong>Chat with the assistant.</strong> The Scribe chat keeps what was said for the number of days the workspace chooses (30 by default, from 0 to 365; 0 means do not keep). The record of what the assistant changed is kept as part of the activity log.",
  ) },

  { after: "retention-detail", id: "transfers-audit", title: "7. Records and checks", bodyHtml: p(
    "Docustay will give you the information reasonably needed to show that it follows this Addendum, mainly the logs described above and the sub-processor list. To ask for more, write to <a href=\"mailto:privacy@docustay.app\">privacy@docustay.app</a>.",
    "This Addendum is a plain-language statement of how Docustay processes data on your behalf. It is a template, not legal advice, and it does not promise any particular legal outcome.",
  ) },
];

export const TERMS_EXTRA = [
  { after: "accounts", id: "api-use", title: "Using the API and developer tools", bodyHtml: p(
    "The API, SDKs, command line, webhooks, embedded signing and MCP server are available to you within the permissions of the API key you create. You are responsible for what is done with your keys: keep them off public pages, give each integration only the scopes it needs, and revoke a key you think has leaked. Each key can make 600 requests a minute; past that the API answers with a retry time, and nothing is lost if you wait. Requests that create a document or template need an idempotency key so that a retry never sends twice.",
    "Test keys and test mode are for practice. A document made in test mode is emailed only to the person who sent it, carries a TEST watermark and is left out of your usage and billing. Do not use test documents as real agreements.",
  ) },
  { after: "your-data", id: "signatures", title: "What a Docustay signature is", bodyHtml: p(
    "A Docustay signature is a simple electronic signature with a strong record: the time, the signer's network address and browser and the wording they agreed to are recorded, and the finished PDF is sealed with a digital signature and ends with a certificate of completion. Docustay does not offer qualified signatures and does not check a signer's identity beyond sending the link to the email address you gave. Whether a particular document may be signed electronically is a question for you and your own advisers. Docustay does not give legal advice and does not promise that any document will be accepted for any purpose.",
    "Docustay is not for protected health information yet.",
  ) },
  { after: "availability", id: "limits", title: "Plan limits and fair use", bodyHtml: p(
    "Each plan has allowances for documents, different signers, new templates, emails a day, file size, team members and AI drafts. They are shown on the Pricing page and the same numbers are in the plan descriptions. On Free, a signer is anyone you send a document to, counted once a month by email address; Free includes 15 different signers a month, and sending again to someone you already sent to that month is always allowed. Pay as you go includes 25 new templates a month; going past that asks you to choose Pro and is never charged per template. These two limits start on 1 November 2026. Going over an allowance on Free stops the action and tells you which limit was reached; Free is never billed. On Pay as you go, usage beyond the included allowances is charged at the prices on the Pricing page, up to the workspace's budget. Pro and Lifetime have no monthly document, signer or template limit and are meant for one organisation's own documents. Fair use applies to Unlimited: if use becomes far above normal we will contact you before doing anything.",
    "Sending also pauses by itself for a workspace if its email bounces or is marked as spam at rates that would harm the sending domain; the workspace's Domains and email screen shows how close you are. Section 2 and the Acceptable Use page say what you may and may not send.",
  ) },
];
