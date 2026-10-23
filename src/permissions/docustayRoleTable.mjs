// src/permissions/docustayRoleTable.mjs — THE ROLE TABLE FOR DOCUSTAY, READ FROM THE CODE (21 Oct 2026, the maintainer).
//
// Three roles: Owner, Admin, Member. Each row is one thing a person might want to do, and how the server decides it, using the SAME inputs the server uses:
//   · verb   — a grant on a permission object (`BUILTIN_ROLES[role].permissions[object]`), asked the way `keystone.user_may` asks it: the verb ladder (delete > edit > view) AND the scope on the same grant
//              (owned: only a row the person owns; everything: any row). `owner: "self" | "other" | null` says whose row it is (null: no row yet, a create or a bulk action: only `everything` can carry it).
//   · named  — a named action a role holds (`BUILTIN_ROLES[role].actions`, the `keystone.role_action` seed).
//   · rank   — a rank floor in the code (the nav floor `minRole` / `atLeastRank`): owner > admin > member.
//   · rankAction — `assertMay.mjs` RANK_ACTIONS (play.manage).
// `enforcedBy` names the file and the exact text that does the refusing, so the table cannot quietly drift from the code (test/s21_role_table.test.mjs reads every one).
// The screens' words (Settings → Team, the invite form) and specs/v1/ROLE-TABLE.md are written from `describeRole()` and `renderMarkdown()` below, never by hand.
import { BUILTIN_ROLES } from "./defaults.mjs";
import { RANK_ACTIONS } from "./assertMay.mjs";

export const ROLES = Object.freeze(["owner", "admin", "member"]);
const LADDER = ["none", "view", "edit", "delete"];
const FLOOR = { owner: 3, admin: 2, member: 1 };
const byKey = (k) => BUILTIN_ROLES.find((r) => r.key === k);

/** The question `keystone.user_may(user, object, verb, owner)` answers, for a built-in role. */
export function mayVerb(role, object, verb, owner = null) {
  const g = byKey(role)?.permissions?.[object];
  if (!g || LADDER.indexOf(g.verb) < LADDER.indexOf(verb)) return false;
  if (g.scope === "everything") return true;
  if (g.scope === "owned") return owner === "self";
  return false;
}
export const mayNamed = (role, action) => (byKey(role)?.actions ?? []).includes(action);
export const mayRank = (role, floor) => FLOOR[role] >= FLOOR[floor];
export const mayRankAction = (role, action) => (RANK_ACTIONS[action] ?? []).includes(role);

const R = (file, needle) => ({ file, needle });
/** area → rows. `id` is stable (tests and the spec use it); `words` is how the screens and the spec say it. */
export const ROWS = Object.freeze([
  // ── documents ──
  { id: "documents.own", area: "Documents", words: "Make, send, remind and void your own documents", check: { verb: "edit", object: "document", owner: "self" }, by: [R("src/routes/documentsPdf.mjs", 'path: "/api/documents/pdf/send"')] },
  { id: "documents.others", area: "Documents", words: "Open, change or send other people's documents", check: { verb: "edit", object: "document", owner: "other" }, by: [R("src/permissions/defaults.mjs", "document: EDIT_OWN")] },
  { id: "documents.sign", area: "Documents", words: "Sign a document as a team member", check: { named: "document.sign" }, by: [R("src/permissions/defaults.mjs", 'const COACH_ACTIONS = Object.freeze(["person.create", "template.author", "document.sign"])')] },
  { id: "documents.erase", area: "Documents", words: "Erase a person's data from documents, take a payment refund, delete", check: { verb: "delete", object: "document", owner: null }, by: [R("src/routes/documentsPdf.mjs", 'path: "/api/documents/pdf/data-erase"'), R("src/routes/documentsPdf.mjs", 'path: "/api/documents/pdf/refund-payment"')] },
  // ── templates ──
  { id: "templates.author", area: "Templates", words: "Create and edit templates", check: { named: "template.author" }, by: [R("src/routes/documentsEngine.mjs", 'path: "/api/documents/engine/templates"')] },
  { id: "templates.approve", area: "Templates", words: "Approve or reject a template for use", check: { verb: "delete", object: "document", owner: null }, by: [R("src/routes/documentsPdf.mjs", 'path: "/api/documents/pdf/templates/approve"')] },
  // ── people ──
  { id: "people.edit", area: "People", words: "Add and change people in the address book", check: { verb: "edit", object: "document", owner: null }, by: [R("src/routes/documentsForms.mjs", 'path: "/api/documents/people"')] },
  { id: "people.delete", area: "People", words: "Remove a person from the address book", check: { verb: "delete", object: "document", owner: null }, by: [R("src/routes/documentsForms.mjs", 'path: "/api/documents/people/delete"')] },
  // ── plays and playbooks ──
  { id: "plays.use", area: "Plays and playbooks", words: "Use the plays and playbooks that are switched on while drafting", check: { named: "template.author" }, by: [R("src/routes/documentsAi.mjs", 'path: "/api/documents/ai/draft"')] },
  { id: "plays.manage", area: "Plays and playbooks", words: "Create, publish, archive, import and switch on plays and playbooks", check: { rankAction: "play.manage" }, by: [R("src/routes/documentsPlays.mjs", 'path: "/api/documents/plays/save", section: SECTION, fn: save, object: "document", action: "play.manage"'), R("src/permissions/assertMay.mjs", '"play.manage": Object.freeze(["owner", "admin"])')] },
  // ── team ──
  { id: "team.see", area: "Team", words: "See the Team page", check: { rank: "admin" }, by: [R("src/nav/sections.mjs", "path: '/people/team', label: 'Team',               minRole: 'admin'")] },
  { id: "team.manage", area: "Team", words: "Invite and remove teammates and change their role", check: { named: "team.invite" }, by: [R("src/routes/writes.mjs", 'action: "team.invite"'), R("src/routes/writes.mjs", 'action: "staff_role.change"')] },
  { id: "team.reset", area: "Team", words: "Reset a teammate's two-step sign-in", check: { rank: "owner" }, by: [R("src/routes/securityPolicy.mjs", "canReset: isOwner(ctx)")] },
  // ── settings ──
  { id: "settings.edit", area: "Settings", words: "Change the workspace's settings (signing, sending, branding, email)", check: { verb: "edit", object: "setting", owner: null }, by: [R("src/routes/documentsSettings.mjs", 'path: "/api/documents/settings"'), R("src/nav/sections.mjs", "path: '/settings',    label: 'Settings',           minRole: 'admin'")] },
  { id: "settings.own", area: "Settings", words: "Your own profile, notifications, password, two-step sign-in and passkeys", check: { rank: "member" }, by: [R("src/nav/sections.mjs", "path: '/settings/sign-in',       label: 'Sign-in and devices', minRole: 'member'"), R("src/auth/twoStepRoutes.mjs", "app.post(\"/api/auth/password/change\"")] },
  // ── security rules ──
  { id: "security.rules", area: "Security rules", words: "Make two-step compulsory and set the idle sign-out", check: { rank: "admin" }, by: [R("src/routes/securityPolicy.mjs", "const admin = (ctx) => atLeastRank(ctx.principal.user, \"admin\")")] },
  { id: "security.see", area: "Security rules", words: "See the security rules that apply to you", check: { rank: "member" }, by: [R("src/routes/securityPolicy.mjs", "any staff member may read the rules that apply to them")] },
  // ── billing ──
  { id: "billing.manage", area: "Billing", words: "See and change the plan, invoices and billing email, and cancel", check: { rank: "admin" }, by: [R("src/routes/docustay.mjs", 'const SECTION = "/settings/plans"'), R("src/nav/sections.mjs", "path: '/settings',    label: 'Settings',           minRole: 'admin'")] },
  // ── API keys and webhooks ──
  { id: "keys.manage", area: "API keys", words: "Make, change and remove API keys", check: { rank: "admin" }, by: [R("src/routes/developer.mjs", 'app.post("/api/developer/api-keys", session(KEYS_ROW, "admin"')] },
  { id: "webhooks.manage", area: "Webhooks", words: "Add, change and remove webhooks", check: { rank: "admin" }, by: [R("src/routes/developer.mjs", 'app.get("/api/developer/webhook-topics", session(WEBHOOKS_ROW, "admin"')] },
  // ── the workspace itself ──
  { id: "workspace.delete", area: "Deleting the workspace", words: "Delete the whole workspace", check: { rank: "owner" }, by: [R("src/product/deletion.mjs", 'throw forbidden("Only an owner of this workspace can delete it.")')] },
]);

/** The cell: may this role do this row? */
export function cell(rowId, role) {
  const row = ROWS.find((r) => r.id === rowId);
  if (!row) throw new Error(`no such role-table row: ${rowId}`);
  const c = row.check;
  if (c.verb) return mayVerb(role, c.object, c.verb, c.owner);
  if (c.named) return mayNamed(role, c.named);
  if (c.rank) return mayRank(role, c.rank);
  if (c.rankAction) return mayRankAction(role, c.rankAction);
  throw new Error(`row ${rowId} has no check`);
}

export const ROLE_WORDS = Object.freeze({
  owner: { label: "Owner", short: "Everything, including deleting the workspace and resetting a teammate's two-step.", description: "Full access to the workspace: documents, templates, people, plays, the team, settings, security rules, billing, API keys, webhooks, and deleting the workspace." },
  admin: { label: "Admin", short: "Everything except deleting the workspace and resetting a teammate's two-step.", description: "Runs the workspace day to day: everyone's documents, templates, plays and playbooks, the team, settings, security rules, billing, API keys and webhooks. Cannot delete the workspace or reset a teammate's two-step." },
  member: { label: "Member", short: "Make, send and track their own documents; use templates and the plays that are switched on.", description: "Makes, sends and tracks their own documents, writes templates and uses the plays and playbooks that are switched on. Does not see other people's documents, and cannot manage plays, the team, settings, billing, API keys or webhooks." },
});

/** The table as Markdown, for specs/v1/ROLE-TABLE.md. */
export function renderMarkdown() {
  const yes = (b) => (b ? "yes" : "no");
  const lines = ["| Area | What | Owner | Admin | Member | Decided by |", "|---|---|---|---|---|---|"];
  for (const r of ROWS) lines.push(`| ${r.area} | ${r.words} | ${ROLES.map((x) => yes(cell(r.id, x))).join(" | ")} | ${r.by.map((b) => `\`${b.file}\``).join(", ")} |`);
  return lines.join("\n");
}
