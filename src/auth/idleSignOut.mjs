// Run 7 part 6 — AUTOMATIC SIGN-OUT. A browser session that has gone longer than the workspace's idle limit without a request is ended (revoked, so it cannot come back) and the request is
// refused with code `idle_signed_out`; the web app sends the person to sign in again. The limit is `security.idle_minutes` (0 = never, the default; an optional workspace setting)
// (src/auth/requireTwoStep.mjs reads it, cached per workspace). Called on the request path BEFORE touchSession, so this request's own visit is not counted.
// An API key has no session and is never signed out here.
import { unauthenticated } from "../http/errors.mjs";
import { sessionIdleSeconds, revokeSession } from "./session.mjs";
import { workspaceSecurityRules } from "./requireTwoStep.mjs";

export async function enforceIdleSignOut(db, { tenantId, sessionId }, { idleOf = sessionIdleSeconds, revoke = revokeSession } = {}) {
  if (!sessionId) return;
  const { idleMinutes } = await workspaceSecurityRules(db, tenantId);
  if (!idleMinutes) return;
  const idle = await idleOf(sessionId);
  if (idle === null || idle <= idleMinutes * 60) return;
  await revoke(sessionId, "expired_sweep");
  const e = unauthenticated(`You were signed out after ${idleMinutes} minutes without activity. Sign in again to continue.`);
  e.detail = { code: "idle_signed_out" };
  throw e;
}
