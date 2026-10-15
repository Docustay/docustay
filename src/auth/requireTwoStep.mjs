// Part 30 item 5 — "REQUIRE TWO-STEP SIGN-IN FOR EVERYONE IN THE WORKSPACE". When an owner turns on `security.require_two_step`, every staff member of that workspace must have a confirmed second factor
// before anything but the screens that set it up will answer. The check runs where every tenant-scoped request already loads its person (src/http/app.mjs), so no route can forget it, and it reads the
// setting live (cached for 15 seconds so an owner's change takes effect almost at once without a query per request).
import { forbidden } from "../http/errors.mjs";
import { hasConfirmedFactor } from "./totp.mjs";
import { getSetting } from "../settings/writes.mjs";

const TTL_MS = 15_000;
export const DOCUSTAY_IDLE_MINUTES = 7 * 24 * 60;
const cache = new Map();   // tenantId → { on, at }

/** Paths a person still needs while enrolling: the shell's own "who am I / what can I see" call. (The /api/auth/* routes sit outside tenant scoping and are never blocked.) */
const ENROLMENT_PATHS = Object.freeze(["/api/nav", "/api/settings/security"]);   // Run 7: the Security panel reads why two-step is required while the person sets it up

// HOTFIX 11 Oct 2026 (the maintainer, replaces Run 7 decision 6): two-step sign-in is OPTIONAL for everyone, owners and admins included. Nobody is required unless an owner turns on
// `security.require_two_step` for the whole workspace. Run 7's "owners and admins always" rule refused every API call for an owner without a factor, and the web app turned that refusal
// into a redirect to the Security tab, so every page jumped back there (HOTFIX-2STEP.md).
async function workspaceRules(db, tenantId, { now = Date.now() } = {}) {
  const hit = cache.get(tenantId);
  if (hit && now - hit.at < TTL_MS) return hit;
  const everyone = (await getSetting(db, "security.require_two_step", false)) === true;
  // a Docustay workspace signs out after 7 days without a request unless an owner chose another limit (the maintainer, 13 Oct 2026; with the 30-day absolute maximum of migration 0738). the platform keeps `never` unless set.
  let idleSet = Number(await getSetting(db, "security.idle_minutes", 0)) || 0;
  if (!idleSet) { const { rows: [t] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]); if (t?.product === "docustay") idleSet = DOCUSTAY_IDLE_MINUTES; }
  const rules = { everyone, owners: false, idleMinutes: idleSet, at: now };
  cache.set(tenantId, rules);
  return rules;
}
export const workspaceSecurityRules = workspaceRules;
export const forgetTwoStepSetting = (tenantId) => cache.delete(tenantId);

/** Throws `two_step_required` (403) for a staff person with no confirmed factor in a workspace that requires one. A client, an API key and the enrolment paths are never refused here. */
export async function enforceRequiredTwoStep(db, { tenantId, person, path }, { hasFactor = hasConfirmedFactor } = {}) {
  if (!person || person.role !== "staff" || !person.firebase_uid) return;
  if (ENROLMENT_PATHS.includes(path)) return;
  const r = await workspaceRules(db, tenantId);
  if (!r.everyone) return;
  if (await hasFactor(person.firebase_uid)) return;
  const e = forbidden("Your workspace requires two-step sign-in. Set it up to continue.");
  e.detail = { code: "two_step_required" };
  throw e;
}
