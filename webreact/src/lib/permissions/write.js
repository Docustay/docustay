// ═══════════════════════════════════════════════════════════════════════════════════════════════
// write.js — THE ONE PLACE A WRITE IS SENT (R-34). No React here, so the app store can use it too.
//   writeDecision(permissions, name)  → { route, decl, hidden } from the route's OWN declaration
//   performWrite(permissions, name, args) → refuses (WriteRefused) what the viewer may not do, else sends
// ★ useWrite (the hook every component uses) and lib/app/appState.js (the shell's writes) both call this.
// ★ gate react_code_rules.mjs K6a: api.js write methods are called from this file and api.js, nowhere else.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { api, request } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import apiRoutes from "./apiRoutes.json";
import routePermissions from "./routePermissions.json";
import { routeAllowed } from "./can.js";

export function resolveRoute(nameOrKey) {
  if (/^(POST|PUT|PATCH|DELETE) \//.test(nameOrKey)) return nameOrKey;
  const r = apiRoutes[nameOrKey];
  if (!r) throw new Error(`useWrite: "${nameOrKey}" is not an api.js method with a known route`);
  return Array.isArray(r) ? r[0] : r;
}

/** Decide, from the route's own declaration, whether this viewer may make this write. */
export function writeDecision(permissions, nameOrKey, { ownerId, viewerId = null } = {}) {
  const route = resolveRoute(nameOrKey);
  if (route.startsWith("GET ")) throw new Error(`useWrite: "${nameOrKey}" is a read (${route}), not a write`);
  const decl = routePermissions[route];
  if (!decl) throw new Error(`useWrite: ${route} has no permission declaration (RP.9 gate should have failed)`);
  return { route, decl, hidden: !routeAllowed(permissions, decl, { ownerId, viewerId }) };
}

export async function send(nameOrKey, args) {
  if (/^(POST|PUT|PATCH|DELETE) \//.test(nameOrKey)) {
    const [{ params = {}, body, idempotencyKey } = {}] = args;
    const [method, pattern] = nameOrKey.split(" ");
    const path = pattern.replace(/:([A-Za-z_]\w*)/g, (_, k) => {
      if (params[k] == null) throw new Error(`useWrite: missing path param ${k} for ${nameOrKey}`);
      return encodeURIComponent(params[k]);
    });
    return await request(path, { method, body, idempotencyKey: idempotencyKey ?? newIdempotencyKey() });
  }
  return await api[nameOrKey](...args);
}

export class WriteRefused extends Error {
  constructor(route) { super(`not permitted: ${route}`); this.name = "WriteRefused"; this.route = route; }
}

/**
 * The NON-HOOK path, for the app store (lib/app/appState.js) — its writes are the shell's (mark read,
 * see-as, sign out), made from a class, not a component. Same declaration, same check; a write the viewer
 * may not make is REFUSED here rather than sent (the control that would call it rendered nothing).
 */
export async function performWrite(permissions, nameOrKey, args = [], opts = {}) {
  const { route, hidden } = writeDecision(permissions, nameOrKey, opts);
  if (hidden) throw new WriteRefused(route);
  return await send(nameOrKey, args);
}

