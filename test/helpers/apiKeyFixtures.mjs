// test/helpers/apiKeyFixtures.mjs — Stage 7 task 7.28 ("four keys, four answers").
//
// ★★★ MINTS THROUGH THE REAL ROUTE. `mintKeyThroughRoute` drives `POST /api/developer/api-keys`
//     (`src/routes/developer.mjs`) over a real session cookie — never `createApiToken` directly —
//     so a key this fixture produces is a key the PRODUCT could actually issue: the same scope
//     vocabulary check (`GRANTABLE_SCOPES`), the same "you cannot grant what you do not hold" check
//     (`scopesGrantableBy`, 7.22), and the same `rank_ceiling = principal.user.staff_role` the real
//     route stamps. Task 7.28 field 2's own words: "so the fixture cannot create a key the product
//     could not." `editKeyScopesThroughRoute` is the same discipline applied to 7.25's toggle route.
//
// ★ THE ONE EXCEPTION — `mintCeilingOnlyKeyDirectly`, field 4's own note: a `rank_ceiling='coach'`
//   key carrying `money:write` cannot exist through the product at all (7.22's `OWNER_ONLY_SCOPES`
//   makes `money:write` Owner-only to grant, and a Coach session can never reach the mint route in
//   the first place — `authoriseSection` floors it at `admin`). It is written directly against
//   `createApiToken`, the exact definer the route itself calls, so the database-level CEILING check
//   under test (`assertKeyCeiling` / `keystone.role_may`) is exercised against a real row shaped
//   exactly like one that check reads. Only the ROUTE's OWN "may this caller grant this" gate is
//   bypassed, on purpose, because it is not what this fixture is proving — `test/
//   s7_api_key_principal.test.mjs` leg (c) does the identical thing for the identical reason.
//
// `mintKeyThroughRoute`'s return carries `tokenId`, even though the route's own JSON response does
// not: `POST /api/developer/api-keys` returns `{id, key, last_four, shown_once}` (`src/routes/
// developer.mjs:256` — no `token_id` field), so `tokenId` is derived by parsing the returned `key`
// with `parseToken` (`src/auth/apiToken.mjs`) — the same public 26-character Crockford id every
// other key-carrying fixture in this suite (`test/s7_key_rate_limit.test.mjs`, `test/
// s7_api_key_principal.test.mjs`) returns under that name.

import { randomUUID } from "node:crypto";
import { parseToken, createApiToken } from "../../src/auth/apiToken.mjs";
import { withTenant } from "../../src/db/index.mjs";

/**
 * Mint a key through `POST /api/developer/api-keys`, authenticated by an already-established
 * session cookie (the caller is responsible for minting that session — e.g. via `createSession`,
 * the same function `src/auth/login.mjs` calls). Throws, naming the response, on anything but a 201
 * carrying a `key` — a fixture that silently returned `undefined` on a refused mint would make every
 * later assertion in a test meaningless rather than loudly wrong.
 *
 * @returns {{id: string, presented: string, tokenId: string, lastFour: string, scopes: string[], environment: "live"|"test"}}
 */
export async function mintKeyThroughRoute(app, { cookie, scopes, environment = "live", name }) {
  const r = await app.request("/api/developer/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "idempotency-key": randomUUID() },   // STALE-FIXED: every write route requires an Idempotency-Key (8-200 chars)
    body: JSON.stringify({ name, scopes, environment }),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status !== 201 || typeof json?.key !== "string") {
    throw new Error(
      `mintKeyThroughRoute("${name}"): POST /api/developer/api-keys did not return a minted key ` +
      `(status ${r.status}): ${text.slice(0, 500)}`);
  }
  const parsed = parseToken(json.key);
  return {
    id: json.id, presented: json.key, tokenId: parsed.tokenId, lastFour: json.last_four,
    scopes, environment,
  };
}

/**
 * Edit an existing key's scopes through `POST /api/developer/api-keys/:id/scopes` (7.25's toggle
 * route) — the secret never changes, only the stored scope list. Returns the route's own
 * `{changed, scopes}`. Throws, naming the response, on anything but a 200.
 */
export async function editKeyScopesThroughRoute(app, { cookie, id, scopes }) {
  const r = await app.request(`/api/developer/api-keys/${id}/scopes`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "idempotency-key": randomUUID() },   // STALE-FIXED: every write route requires an Idempotency-Key (8-200 chars)
    body: JSON.stringify({ scopes }),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status !== 200) {
    throw new Error(
      `editKeyScopesThroughRoute(id=${id}): POST /api/developer/api-keys/${id}/scopes failed ` +
      `(status ${r.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

/**
 * ★★★ THE ONE FIXTURE-WRITTEN KEY IN THIS SUITE — see the file header. `createApiToken` is the same
 * definer `POST /api/developer/api-keys` calls; only the route's own authority check is skipped.
 *
 * @returns {{id: string, presented: string, tokenId: string, lastFour: string}}
 */
export const mintCeilingOnlyKeyDirectly = (tenantId, { scopes, rankCeiling, name }) =>
  withTenant(tenantId, (tx) => createApiToken(tx, { environment: "live", name, scopes, rankCeiling }));
