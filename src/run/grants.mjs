/**
 * RUN GRANTS — P20.5. The three-table grant model's write path.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THE SHAPE OF THIS MODULE IS THE ARGUMENT FOR THE THREE TABLES, MADE EXECUTABLE:
 *       upsertGoogleIdentity()      — ONE consent, ONE token, ONE row. Called once per Google login.
 *       recordDiscoveredResources() — what that consent can SEE. Called on a cadence, never typed in.
 *       bindAccountGrant()          — a BINDING from one of OUR accounts to one discovered resource.
 *     If `account_grant` alone could do the job, these would be one function. They are three because
 *     the three facts have different lifetimes: a consent is granted once, resources come and go
 *     without the consent changing, and a binding is a decision we make and can withdraw.
 *
 * ★★ EVERY FUNCTION TAKES `tx`, NOT A POOL — the same contract `emit()` enforces (P15B.2a). A grant
 *    written outside the transaction that recorded the consent leaves a binding to an identity that
 *    may have rolled back.
 *
 * ★★★ AND NOTHING HERE EMITS AN OUTBOX EVENT, WHICH IS A DECISION AND NOT AN OVERSIGHT.
 *     `run.access.granted` (0054) is emitted by the RUN pipeline when a previously blocked schedule
 *     item becomes deliverable — that is the fact the `chase_the_grant` chain closes on. Emitting it
 *     here would fire on the binding, not on the recovery, and would close the task before the work
 *     could actually run. The two are a day apart in practice and the difference is the whole point of
 *     P20.9's "billed and not deliverable".
 *   ★ Recorded in write-census as INFRASTRUCTURE with that reason.
 */

import { sealSecret, CURRENT_KEK_VERSION as ENVELOPE_KEK_VERSION } from "../secrets/envelope.mjs";
// ★★★ P20.9 — a grant write is the ONLY moment a blocked item can legitimately be retried. `dueItems()`
//     excludes the not_deliverable states on purpose, so without this the loop never closes and a
//     recovery would need a hand-edited database. See rearmBlockedItems' header.
import { rearmBlockedItems } from "./schedule.mjs";

/**
 * ★★ P19.7a. `envelope.mjs` returns `v:1`, which is a FORMAT version, not a KEY version. Same pattern
 *    as `src/webhooks/outbound.mjs` — the KEK version is a column, and rotation means re-wrapping every
 *    row whose `kek_version` is below this and then bumping it.
 */
// ★ FOUND 6 Oct 2026 (Google Calendar push test): this was a literal `1` while `sealSecret` seals under the envelope module's CURRENT version (2),
//   so every row said it was sealed under a key that is NOT the one that sealed it — `openSecret(kekVersion: 1)` then reads the retired-key variable
//   and the token could never be opened. One source: the envelope module. (Production had 0 google_identity rows when this was changed.)
export const CURRENT_KEK_VERSION = ENVELOPE_KEK_VERSION;

/** ★ The purpose string is derived from the FACT THAT THIS IS THIS TABLE — never stored and read back.
 *    `envelope.mjs` requires tenantId and purpose from the caller's context, because an AAD read out of
 *    the record it authenticates is self-certifying and therefore useless. */
const REFRESH_TOKEN_PURPOSE = "google_refresh_token";

export const GOOGLE_SERVICES = Object.freeze(
  ["search_console", "google_ads", "analytics", "business_profile"]);

/**
 * UPSERT a Google identity: one consent, one refresh token, one row.
 *
 * ★★★ THE SCOPES ARE SORTED BEFORE STORAGE, AND THAT IS LOAD-BEARING, NOT TIDINESS. The table's
 *     UNIQUE is (tenant_id, google_subject, scopes); Postgres compares arrays element-wise, so
 *     {a,b} and {b,a} are DIFFERENT values. Without sorting, re-consenting with the scopes in a
 *     different order creates a SECOND row for the same consent — and a second row means a second
 *     live refresh token on the same Google account, walking straight into the 100-token eviction
 *     this whole design exists to avoid.
 *
 * ★★ ON CONFLICT UPDATES THE ENVELOPE, because re-consent legitimately issues a NEW refresh token and
 *    the old one may already be dead. It also resets `grant_state` to 'usable' and clears the failure
 *    columns — a successful re-consent is precisely the event that makes a `reconsent_required`
 *    identity usable again, and leaving the old failure behind would keep the screen shouting.
 */
export async function upsertGoogleIdentity(tx, {
  tenantId, googleSubject, googleEmail, scopes, refreshToken,
}) {
  if (!tenantId) throw new Error("upsertGoogleIdentity needs a tenantId");
  if (!googleSubject) {
    throw new Error(
      "upsertGoogleIdentity needs the OIDC `sub`, not the email. The sub is stable and never reused, " +
      "and it is the axis Google's 100-live-refresh-token cap is enforced on — keying on an email " +
      "would silently split one identity in two when the address is renamed.");
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("upsertGoogleIdentity needs at least one scope");
  }
  if (!refreshToken) throw new Error("upsertGoogleIdentity needs a refreshToken to seal");

  const sortedScopes = [...scopes].sort();
  const envelope = sealSecret(
    { plaintext: refreshToken, tenantId, purpose: REFRESH_TOKEN_PURPOSE });

  const { rows } = await tx.query(
    `INSERT INTO keystone.google_identity
       (tenant_id, google_subject, google_email, scopes, refresh_envelope, kek_version,
        token_fingerprint, granted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (tenant_id, google_subject, scopes) DO UPDATE
        SET google_email = EXCLUDED.google_email,
            refresh_envelope = EXCLUDED.refresh_envelope,
            kek_version = EXCLUDED.kek_version,
            token_fingerprint = EXCLUDED.token_fingerprint,
            granted_at = now(),
            grant_state = 'usable',
            grant_error = NULL,
            grant_failed_at = NULL,
            withdrawn_at = NULL
     RETURNING id, token_fingerprint, kek_version, grant_state`,
    [tenantId, googleSubject, googleEmail, sortedScopes, envelope, CURRENT_KEK_VERSION,
     envelope.fingerprint]);

  // ★★★ A RE-CONSENT IS A RECOVERY EVENT. Any item blocked as `not_deliverable_grant_lost` for accounts
  //     bound to this identity has just been given a reason to try again. Scoped by NOTHING here on
  //     purpose — this identity may serve several of our accounts, and all of them were blocked by the
  //     same refusal, so all of them are re-armed. The next pull decides per item.
  await rearmBlockedItems(tx, { tenantId });

  return Object.freeze({
    id: rows[0].id,
    fingerprint: rows[0].token_fingerprint,
    kekVersion: rows[0].kek_version,
    grantState: rows[0].grant_state,
  });
}

/**
 * RECORD what discovery found for an identity, and — just as importantly — what it did NOT find.
 *
 * ★★★ `disappeared_at` IS SET BY THE ABSENCE OF A RE-SIGHTING. That is the only signal available:
 *     when a client removes a property, the token keeps refreshing perfectly and the resource simply
 *     stops coming back from `sites.list` / `accountSummaries.list` / `listAccessibleCustomers` /
 *     `locations.list`. Nothing tells us; we notice by comparing.
 *   ★★ SO THIS FUNCTION TAKES THE **COMPLETE** LIST FOR A SERVICE, not a delta. A partial list would
 *      mark live resources as disappeared — which flips accounts to `not_deliverable_resource_lost`
 *      and stops work that was fine. Callers that cannot produce a complete list must pass
 *      `markMissing: false` and say so.
 *   ★ A resource that comes BACK is un-disappeared (disappeared_at → NULL), because a client
 *     re-granting access is a normal thing and a permanently-dead row would need manual repair.
 */
export async function recordDiscoveredResources(tx, {
  tenantId, identityId, service, resources, markMissing = true,
}) {
  if (!tenantId) throw new Error("recordDiscoveredResources needs a tenantId");
  if (!identityId) throw new Error("recordDiscoveredResources needs an identityId");
  if (!GOOGLE_SERVICES.includes(service)) {
    throw new Error(
      `recordDiscoveredResources: "${service}" is not one of ${GOOGLE_SERVICES.join(", ")}`);
  }
  if (!Array.isArray(resources)) throw new Error("recordDiscoveredResources needs a resources array");

  const seen = [];
  for (const r of resources) {
    const { rows } = await tx.query(
      `INSERT INTO keystone.google_resource
         (tenant_id, identity_id, service, external_id, display_name,
          login_customer_id, parent_account_id, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (tenant_id, identity_id, service, external_id) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              login_customer_id = EXCLUDED.login_customer_id,
              parent_account_id = EXCLUDED.parent_account_id,
              last_seen_at = now(),
              -- ★ un-disappear: seeing it again is the end of its absence
              disappeared_at = NULL
       RETURNING id, external_id`,
      [tenantId, identityId, service, r.externalId, r.displayName ?? null,
       r.loginCustomerId ?? null, r.parentAccountId ?? null]);
    seen.push(rows[0]);
  }

  let disappeared = 0;
  if (markMissing) {
    const ids = seen.map((s) => s.id);
    const { rowCount } = await tx.query(
      `UPDATE keystone.google_resource
          SET disappeared_at = now()
        WHERE tenant_id = $1 AND identity_id = $2 AND service = $3
          AND disappeared_at IS NULL
          AND NOT (id = ANY($4::uuid[]))`,
      [tenantId, identityId, service, ids]);
    disappeared = rowCount;
  }

  // ★★ A RE-SIGHTING IS ALSO A RECOVERY EVENT, but scoped to THIS SERVICE: a property coming back says
  //    nothing about a different service's grant. ★ Only when something was actually seen — an empty
  //    discovery list is the opposite of a recovery.
  if (seen.length > 0) await rearmBlockedItems(tx, { tenantId, service });

  return Object.freeze({ seen: seen.length, disappeared, markedMissing: markMissing });
}

/**
 * BIND one of our accounts to one discovered resource.
 *
 * ★ Idempotent through the table's UNIQUE (tenant_id, account_id, resource_id). Re-binding an already
 *   bound pair un-revokes it, because "we revoked it and then changed our mind" is a real sequence and
 *   the alternative is a row nobody can reuse.
 */
export async function bindAccountGrant(tx, { tenantId, accountId, resourceId, service }) {
  if (!tenantId) throw new Error("bindAccountGrant needs a tenantId");
  if (!accountId || !resourceId) throw new Error("bindAccountGrant needs an accountId and a resourceId");
  if (!GOOGLE_SERVICES.includes(service)) {
    throw new Error(`bindAccountGrant: "${service}" is not one of ${GOOGLE_SERVICES.join(", ")}`);
  }
  const { rows } = await tx.query(
    `INSERT INTO keystone.account_grant (tenant_id, account_id, resource_id, service, granted_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id, account_id, resource_id) DO UPDATE
        SET revoked_at = NULL, revoked_reason = NULL, granted_at = now()
     RETURNING id, revoked_at`,
    [tenantId, accountId, resourceId, service]);

  // ★★ BINDING IS THE `never_granted` RECOVERY. An item blocked as not_deliverable_no_grant has, by
  //    definition, been waiting for exactly this. Scoped to the account AND the service, because that
  //    is precisely what the binding changed.
  await rearmBlockedItems(tx, { tenantId, accountId, service });

  return Object.freeze({ id: rows[0].id, revokedAt: rows[0].revoked_at });
}

/**
 * REVOKE a binding — ★ meaning **WE** withdrew it.
 *
 * ★★ THE REASON IS REQUIRED, and the constraint agrees (`account_grant_revoked_shape` permits a null
 *    reason only when `revoked_at` is null). A binding that vanished with no reason is the same defect
 *    as a task that closed with no reason: the screen cannot answer "why did this stop".
 *  ★ This function must NEVER be used to record Google refusing the token (that is
 *    `google_identity.grant_state`) or Google dropping the property (that is
 *    `google_resource.disappeared_at`). Three facts, three columns.
 */
export async function revokeAccountGrant(tx, { tenantId, grantId, reason }) {
  if (!tenantId) throw new Error("revokeAccountGrant needs a tenantId");
  if (!grantId) throw new Error("revokeAccountGrant needs a grantId");
  if (!reason || !String(reason).trim()) {
    throw new Error(
      "revokeAccountGrant needs a reason. ★ A binding that vanished with no reason is the same defect " +
      "as a task that closed with no reason — the screen cannot answer \"why did this stop\". And this " +
      "function records only OUR withdrawal: Google refusing the token is google_identity.grant_state, " +
      "Google dropping the property is google_resource.disappeared_at.");
  }
  const { rows } = await tx.query(
    `UPDATE keystone.account_grant
        SET revoked_at = now(), revoked_reason = $3
      WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [tenantId, grantId, String(reason).trim()]);
  return Object.freeze({ revoked: rows.length === 1 });
}

/**
 * MARK an identity as needing re-consent.
 *
 * ★★★ IT IS CALLED `reconsent_required` AND NEVER `revoked`, AND THE ERROR STRING IS STORED VERBATIM.
 *     [DOC] `invalid_grant` covers at least SIX causes — the user revoked, six months idle, the 7-day
 *     expiry that applies while publishing status is Testing, the 100-token eviction, a Workspace admin
 *     restricting the service, and a Google security heuristic. **The only claim true of all six is
 *     that somebody has to consent again.** Parsing the string to guess which would produce a
 *     confident wrong answer, and "revoked" in particular sends an operator to argue with a client who
 *     did nothing.
 */
export async function markIdentityNeedsReconsent(tx, { tenantId, identityId, providerError }) {
  if (!tenantId) throw new Error("markIdentityNeedsReconsent needs a tenantId");
  if (!identityId) throw new Error("markIdentityNeedsReconsent needs an identityId");
  const { rows } = await tx.query(
    `UPDATE keystone.google_identity
        SET grant_state = 'reconsent_required',
            grant_error = $3,
            grant_failed_at = now(),
            last_refresh_try_at = now()
      WHERE tenant_id = $1 AND id = $2 AND grant_state <> 'withdrawn'
      RETURNING id, grant_state`,
    [tenantId, identityId, providerError ?? null]);
  return Object.freeze({ updated: rows.length === 1, grantState: rows[0]?.grant_state ?? null });
}

/**
 * ★★ DUPLICATE-TOKEN DETECTION, which is the only defence against a cap nobody warns you about.
 *    [DOC] Google evicts the OLDEST refresh token once a Google Account passes 100 live tokens on one
 *    OAuth client ID — silently, so the symptom is the longest-running (most-billed) client breaking
 *    first. `token_fingerprint` is a sha256 prefix of the PLAINTEXT, stable across tenants, so it is
 *    the correct key for "is this same token stored under more than one identity?".
 *  ★ It RETURNS the duplicates rather than refusing the write: the write already happened by the time
 *    anyone can ask, and a refusal would break a legitimate re-consent. This is a reporting surface.
 */
export async function findDuplicateTokenIdentities(tx, { tenantId, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT id, google_subject, google_email, grant_state
       FROM keystone.google_identity
      WHERE tenant_id = $1 AND token_fingerprint = $2
      ORDER BY granted_at ASC`,
    [tenantId, fingerprint]);
  return rows;
}
