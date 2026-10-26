// THE FIXED ROUTE TABLE the assistant answers "where do I…" from. The model never invents a path: `findScreens` returns entries of THIS table only (test/chat_tools.test.mjs checks every path against the real Docustay routes).
// Pure data + one pure function. Phrases are lower-case words a person would use.
export const NAV = Object.freeze([
  { id: "documents", path: "/documents", title: "Documents", does: "All your documents: drafts, out for signature, signed. Open one to track who has signed, remind people or download the signed copy.", words: "documents list track status signed waiting remind reminder download copy find search folder" },
  { id: "create", path: "/create", title: "Make a document", does: "Start a document: upload a file, write one, start from a template, or have it written from a few questions.", words: "create new make start write upload file template library built-in describe ai draft" },
  { id: "who-signs", path: "/create/flow", title: "Who signs", does: "The first step of writing: add the people and what each does (signs, approves, gets a copy), and the signing order.", words: "who signs people signer add second person order role cc copy approve" },
  { id: "edit", path: "/documents/{id}/edit", title: "Edit a draft", does: "The steps of a draft: Who signs, then the words and fields, then Details, Check and Send.", words: "edit draft fields signature field place move words text sender only hide section label filled by read-only" },
  { id: "details", path: "/documents/{id}/edit?step=details", title: "Details", does: "The note the signer sees, the email subject and message, the internal note, deadlines and reminders.", words: "details subject message note description deadline expire expiry reminder reminders internal" },
  { id: "check", path: "/documents/{id}/edit?step=check", title: "Check", does: "What would stop this being sent, how it looks to the signer and how it looks signed, and the view as each person.", words: "check problems blocked cannot send preview view as signer certificate" },
  { id: "send", path: "/documents/{id}/edit?step=send", title: "Send", does: "Review who gets what and send, schedule or send a test to yourself.", words: "send schedule test email link sign now" },
  { id: "templates", path: "/templates", title: "Templates", does: "Reusable documents: the built-in Document and Form templates and your own. Send from one, or customize it into your own copy.", words: "templates template reusable built-in library document form customize save as template variables questions fill use" },
  { id: "billing", path: "/billing", title: "Billing", does: "Your plan, what has been used this month and your invoices.", words: "billing plan pro upgrade invoice invoices price subscription pay free" },
  { id: "settings-documents", path: "/settings?tab=documents", title: "Settings: Signing", does: "How signing works for everyone here: the default for how long a sent document stays open before it expires, reminders, certificate, download rules, test mode.", words: "settings signing reminders expiry certificate download records retention test mode" },
  { id: "settings-appearance", path: "/settings?tab=appearance", title: "Settings: Appearance", does: "Your logo, colours and how the signing page looks.", words: "appearance logo colour color brand look theme signing page" },
  { id: "settings-email", path: "/settings?tab=email", title: "Settings: Email", does: "Send from your own address or domain instead of ours.", words: "email domain smtp sender from address own domain dns verify" },
  { id: "settings-payments", path: "/settings?tab=payments", title: "Settings: Payments", does: "Connect Stripe so a document can ask for payment while it is signed.", words: "payments stripe connect payment field take payment currency fee" },
  { id: "settings-ai", path: "/settings?tab=ai", title: "Settings: AI writer", does: "Switch the AI writer on, who may use it, its name, house rules, limits, and what it has done.", words: "ai writer assistant scribe house rules limits provider key activity log" },
  { id: "settings-team", path: "/settings?tab=team", title: "Settings: Team", does: "Who is in your workspace and what they can do.", words: "team members invite owner admin roles people seats" },
  { id: "settings-security", path: "/settings?tab=security", title: "Settings: Security", does: "Sign-in and security options.", words: "security password sign in two factor 2fa session" },
  { id: "settings-audit", path: "/settings?tab=audit", title: "Settings: Audit", does: "A record of what happened in the workspace.", words: "audit log history who did what activity" },
  { id: "settings-keys", path: "/settings?tab=keys", title: "Settings: API keys", does: "Keys for the Docustay API, test or live.", words: "api keys key developer integration sdk token test live" },
  { id: "settings-webhooks", path: "/settings?tab=webhooks", title: "Settings: Webhooks", does: "Tell your own system when something happens to a document.", words: "webhooks webhook events callback integration" },
  { id: "settings-embedding", path: "/settings?tab=embedding", title: "Settings: Embedding", does: "Show a signing form inside your own website.", words: "embedding embed iframe website form" },
  { id: "settings-usage", path: "/settings?tab=usage", title: "Settings: Usage", does: "How much of your plan this workspace has used.", words: "usage limit quota plan used month sends" },
]);
const STOP = new Set(["the", "a", "an", "to", "do", "i", "how", "where", "can", "my", "is", "it", "of", "in", "on", "for", "and", "or", "what", "why", "me", "this", "that", "with", "find", "get", "go"]);
const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
/** The best three screens for a question, from the table above. `{id}` stays in a path that needs the open document; `documentId` fills it when there is one. */
export function findScreens(query, { documentId = null } = {}) {
  const q = new Set(words(query)); if (!q.size) return [];
  const scored = NAV.map((e) => { const hay = new Set(words(`${e.title} ${e.words}`)); let s = 0; for (const w of q) { if (hay.has(w)) s += 2; else for (const h of hay) if (h.length > 3 && (h.startsWith(w) || w.startsWith(h)) && w.length > 3) { s += 1; break; } } return { e, s }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id)).slice(0, 3);
  return scored.map(({ e }) => ({ id: e.id, title: e.title, path: e.path.includes("{id}") ? (documentId ? e.path.replace("{id}", documentId) : null) : e.path, needsDocument: e.path.includes("{id}") && !documentId, does: e.does }));
}
