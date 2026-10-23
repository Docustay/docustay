// src/http/apiKeyFirst.mjs — the public API checks the KEY before anything else (R13-D191, 23 Oct 2026).
// A request without a valid key of this deployment is a 401 before any body is read, so a caller without a key learns nothing about the body rules.
// It asks the same installed resolver the routes use (no scope), then the publishable-key resolver; each route still checks its own scope and key class afterwards.
import { unauthenticated } from "./errors.mjs";
import { recognizeApiToken, apiTokenResolverInstalled } from "../paths/index.mjs";

const OPEN = new Set(["/api/v1/openapi.json", "/api/v1/docs"]);

export async function apiKeyFirst(c, next) {
  if (OPEN.has(c.req.path)) return next();
  const auth = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (!m) throw unauthenticated("the API token is not valid");
  if (!apiTokenResolverInstalled()) return next();   // a bare test app: the routes' own check decides
  if (await recognizeApiToken(auth)) return next();
  const { withCredentialLookup } = await import("../db/index.mjs");
  const { resolveTenantForPublishableKey } = await import("../auth/apiToken.mjs");
  const pub = await withCredentialLookup((db) => resolveTenantForPublishableKey(db, m[1])).catch(() => null);
  if (!pub) throw unauthenticated("the API token is not valid");
  return next();
}
