// Batch B — the built-in email + password identity over HTTP, and the self-hosted first-run setup. Both are OFF unless the deployment turns them on:
//   POST /api/auth/local/signup · /api/auth/local/signin   (KEYSTONE_LOCAL_AUTH=1 + KEYSTONE_LOCAL_AUTH_SECRET) → {idToken} for the SAME /api/signup and /api/auth/login the Firebase flow ends in
//   GET  /api/setup/state · POST /api/setup/owner          (KEYSTONE_SELF_HOST=1) — a self-hosted install has no organisation until its owner creates it with the setup token
// The setup token is the install's own secret (KEYSTONE_SETUP_TOKEN, written by the installer into .env): whoever can read the server's configuration can create the first owner, nobody else.
import { timingSafeEqual, randomUUID } from "node:crypto";
import { withSignupConnection, withTenant } from "../db/index.mjs";
import { withCredentialLookup } from "../db/index.mjs";
import { createRun, runCriticalPrefix } from "../provisioning/prefix.mjs";
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { localAuthEnabled, signUpLocal, signInLocal } from "../auth/localIdentity.mjs";
import { activateWorkspace } from "../product/docustay.mjs";
import { previewInvite } from "../auth/invite.mjs";

export const selfHosted = (env = process.env) => env.KEYSTONE_SELF_HOST === "1";
/** R13-D280: a self-hosted install takes no PUBLIC sign-ups, but a teammate its owner invited must be able to choose a password. The permission is the invitation itself: live (the preview
 *  refuses a used, expired or cancelled one) and for this exact address. `preview` is previewInvite. → true when this sign-up may go ahead. */
export async function maySignUpLocally({ selfHost, email, inviteToken, preview }) {
  if (!selfHost) return true;
  if (typeof inviteToken !== "string" || !inviteToken) return false;
  const inv = await preview({ presented: inviteToken }).catch(() => null);
  return Boolean(inv?.email) && String(inv.email).trim().toLowerCase() === String(email ?? "").trim().toLowerCase();
}
const sameToken = (a, b) => typeof a === "string" && typeof b === "string" && a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const slugOf = (name) => (name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace");

export function registerLocalAuthRoutes(app) {
  const guard = (c) => { if (!localAuthEnabled()) throw notFound("no such route"); return c.get("clientIp") ?? null; };
  app.post("/api/auth/local/signup", async (c) => {
    const ip = guard(c);
    formSubmitLimiter("local-signup", ip, { limit: 20, windowMs: 3_600_000 });
    const body = await c.req.json().catch(() => null);
    // a self-hosted install does not take public sign-ups: its owner is created once, through the setup token, and everyone else arrives with an invitation
    if (!(await maySignUpLocally({ selfHost: selfHosted(), email: body?.email, inviteToken: body?.inviteToken, preview: previewInvite }))) throw forbidden("This install does not take public sign-ups.");
    return c.json(await signUpLocal({ email: body?.email, password: body?.password }), 201);
  });
  app.post("/api/auth/local/signin", async (c) => {
    const ip = guard(c);
    formSubmitLimiter("local-signin", ip, { limit: 30, windowMs: 900_000 });
    const body = await c.req.json().catch(() => null);
    return c.json(await signInLocal({ email: body?.email, password: body?.password }));
  });

  const needsSetup = () => withCredentialLookup(async (db) => (await db.query(`SELECT keystone.install_needs_setup() AS n`)).rows[0].n);
  app.get("/api/setup/state", async (c) => {
    if (!selfHosted()) throw notFound("no such route");
    c.header("Cache-Control", "no-store");
    return c.json({ selfHost: true, needsSetup: await needsSetup(), tokenConfigured: Boolean(process.env.KEYSTONE_SETUP_TOKEN) });
  });
  app.post("/api/setup/owner", async (c) => {
    if (!selfHosted()) throw notFound("no such route");
    formSubmitLimiter("setup-owner", c.get("clientIp") ?? null, { limit: 10, windowMs: 3_600_000 });
    const body = await c.req.json().catch(() => null);
    if (!sameToken(body?.setupToken, process.env.KEYSTONE_SETUP_TOKEN)) throw forbidden("That setup token is not right. It is the KEYSTONE_SETUP_TOKEN value in your .env file.");
    if (!(await needsSetup())) throw forbidden("This install is already set up. Sign in instead.");
    const name = String(body?.orgName ?? "").trim();
    if (!name) throw invalid("Enter your organisation's name.", { field: "orgName" });
    const { idToken } = await signUpLocal({ email: body?.email, password: body?.password });
    const { verifyIdToken } = await import("../auth/firebase.mjs");
    const decoded = await verifyIdToken(idToken);
    const slug = `${slugOf(name)}-${randomUUID().slice(0, 4)}`;
    const tenant = { slug, name, timezone: String(body?.timezone || "UTC") };
    const runId = await withSignupConnection((db) => createRun(db, { slug, name }));
    const result = await withSignupConnection((db) => runCriticalPrefix(db, {
      runId, tenant, admin: { email: decoded.email, displayName: name }, firebaseUid: decoded.uid, isPlatform: false, staffRole: "owner",
      policyAcceptance: { ip: c.get("clientIp") ?? null, userAgent: c.req.header("user-agent") ?? null },
    }));
    await withTenant(result.tenantId, (tx) => activateWorkspace(tx, { tenantId: result.tenantId, selfHosted: true }), { userId: null });
    return c.json({ tenantId: result.tenantId, slug }, 201);
  });
}
