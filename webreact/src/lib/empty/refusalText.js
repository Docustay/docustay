// plainRefusal — the ONE place a server refusal reason becomes a sentence a person can read (F48).
// The server's reasons are codes and fragments ("refused: requires_admin", "section refused: requires_admin",
// "requires admin or higher"); the denial panel must never print them verbatim. Anything it does not know is
// returned unchanged, so a specific, already-readable server message still reaches the screen.
const BY_RANK = {
  owner: "Only the Owner can open this page.",
  admin: "Only an Admin or the Owner can open this page.",
};

/** F146 — platform pages are run by the platform operator, not by anyone in a practice. */
export const PLATFORM_ONLY = "These pages are for running Workbench itself. Open Platform from your account menu with the platform sign-in.";

export function plainRefusal(reason) {
  if (reason == null) return reason;
  const text = String(reason).trim();
  const body = text.replace(/^(section\s+)?refused:\s*/i, "").trim();
  const rank = /^requires[_\s](owner|super_admin(?:_\d)?|admin)(?:\s+or\s+higher)?$/i.exec(body);
  if (rank) return /^admin$/i.test(rank[1]) ? BY_RANK.admin : BY_RANK.owner;
  if (/^unknown_path$/i.test(body)) return "This page is not available to you.";
  // F146 — the platform namespace guard (src/superadmin/namespace.mjs) speaks in internal words
  if (/tenant session cannot access the platform namespace/i.test(body)) return PLATFORM_ONLY;
  // a verb refusal from assertMay: "requires edit on engagement" (F111)
  const verb = /^requires\s+(view|edit|delete|create)\s+on\s+([a-z_]+)$/i.exec(body);
  if (verb) return `Your role can't ${verb[1].toLowerCase()} ${verb[2].replace(/_/g, " ").toLowerCase()}s like this one. Ask an Admin or the Owner.`;
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(body)) return "Your role does not include this page.";
  return body === text ? text : body;
}
