// Stage 8 task 8.6 — INVITATIONS: create, accept, list/preview and revoke.
// CT-055 · CCR-1..4, CCR-11, CCR-16 · F612 (resolved 21 Sep 2026).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE ONE PLACE IN THE PRODUCT WHERE A FIREBASE UID IS ATTACHED TO A PERSON. `acceptInvite`'s
//     UPDATE/`createPerson(..., firebaseUid, invite: false)` calls are it — nowhere else writes
//     `app_user.firebase_uid` (spec 04 default 2). The uid never comes from a request body; it comes
//     from a Firebase ID token the caller (8.12's route) has already verified.
//
// ★★ THERE IS NO SECOND EMIT OF `people.person.invited` HERE. That fact already lives in
//     `src/people/writes.mjs`'s `createPerson`/`inviteTeamMember` (called, never edited — see "what
//     not to touch" in the task). This module adds the ROW (`keystone.invite`) and the TOKEN
//     (`keystone.link_token`, CT-019) behind that fact; it never re-announces it.
//
// ★★★ F612 / MIGRATION 0211 — `keystone.invite.token_id` IS A COPY OF THE LINK TOKEN'S PUBLIC ID,
//     WRITTEN ONCE BY `createInvite` IN THE SAME TRANSACTION AS THE MINT. `app_rw` has NO SELECT on
//     `keystone.link_token.token_id` (CCR-16), so `revokeInvite` cannot read it off `link_token` at
//     all; it reads its own copy off `keystone.invite`, a table this module owns outright
//     (0202:66). See FINDINGS.md F612 and 0211's own header for the full reasoning — nothing here
//     re-derives what that record already settled.
//
// ★ THE ID-FIRST IDIOM (`SELECT keystone.uuid_generate_v7()`, then one INSERT) is the same one
//   `src/people/writes.mjs:119`, `src/booking/writes.mjs:63` and `src/accounts/writes.mjs:43` use:
//   `mintLinkToken` needs `subjectId` to be the invite row's id BEFORE that row exists, so the id is
//   generated first and `keystone.invite` is written exactly once — never INSERT-then-UPDATE.
//
// ★ DISPLAY NAME ON ACCEPTANCE — a filled gap, on the record, not a guess. This task's signature for
//   `acceptInvite` is `{ presented, firebaseUid, email }` — no `displayName` — but the "otherwise
//   creates the person" branch below calls `createPerson`, which requires one. There is nowhere else
//   to get it from: `keystone.invite` (0202) has no display-name column, and the accept screen does
//   not collect one per this task's own signature. The fallback below — the email address itself —
//   is the SAME fallback `src/routes/signup.mjs:136` already uses for exactly this situation
//   (`displayName: String(body?.admin?.displayName ?? email)`), not an invented convention. Recorded
//   for whoever reviews this build; a later task can thread a real `displayName` through 8.12's route
//   if the product wants one collected at acceptance.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant, assertTenantTx } from "../db/index.mjs";
import {
  mintLinkToken, redeemLinkToken, peekLinkToken, revokeLinkToken, parsePresented,
} from "./linkToken.mjs";
import { invalid, conflict, notFound, forbidden } from "../http/errors.mjs";
import { createPerson, ROLES, phoneNeededFor } from "../people/writes.mjs";
import { addGuardian } from "../people/guardians.mjs";

const UNIQUE_VIOLATION = "23505";

// ★ keystone.invite's OWN staff_role CHECK (0202) is narrower than app_user's: it admits only
//   'admin' and 'coach'. 'owner' is refused BY NAME, with a reason, rather than left to surface as a
//   bare constraint violation — spec 04 §7.8: an Owner is TRANSFERRED to an existing member, never
//   extended to someone new by invitation.
const INVITE_STAFF_ROLES = Object.freeze(["admin", "member"]);

// ★ ONE message for all three "this invite cannot be acted on any more" causes (already accepted,
//   already revoked, expired) — the same non-oracle discipline `src/auth/linkToken.mjs`'s
//   `LINK_TOKEN_REFUSED` uses for its own five/seven causes. This check is defense-in-depth: the
//   underlying link token (redeemed/revoked/expired) is already refused by `redeemLinkToken` itself
//   before this module ever reads `keystone.invite`, because `revokeInvite` kills the token together
//   with the row and `mintLinkToken`'s expiry is the SAME instant stamped on the invite. It stays
//   because a second, independent refusal is the standing rule in this codebase, not a promise.
const INVITE_NOT_USABLE =
  "This invitation is no longer valid. It may have already been used, expired, or been cancelled.";

/**
 * Validate the role/staffRole/childUserId shape BEFORE the statement — the database (0202's CHECKs)
 * would catch it anyway; catching it here means a sentence instead of a constraint name.
 */
function assertInviteShape(role, staffRole, childUserId) {
  if (!ROLES.includes(role)) {
    throw invalid(`role must be one of ${ROLES.join(", ")} — got ${JSON.stringify(role)}`);
  }
  if (role === "staff") {
    if (!staffRole) {
      throw invalid("a staff invitation must name a rank (admin or coach) — there is no unranked invite");
    }
    if (staffRole === "owner") {
      throw invalid(
        "an Owner cannot be invited — ownership is transferred to an existing member, never " +
        "extended to someone new by invitation (spec 04 §7.8)",
        { field: "staffRole" });
    }
    if (!INVITE_STAFF_ROLES.includes(staffRole)) {
      throw invalid(
        `staffRole must be one of ${INVITE_STAFF_ROLES.join(", ")} — got ${JSON.stringify(staffRole)}`,
        { field: "staffRole" });
    }
  } else if (staffRole) {
    throw invalid(
      `role "${role}" cannot carry a staff rank (got ${JSON.stringify(staffRole)})`,
      { field: "staffRole" });
  }
  // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value. `childUserId` is now an OPTIONAL,
  //   orthogonal fact any adult-client invitation may carry — accepting it links the guardian edge
  //   (see acceptInvite below) and that link, not a role, is what gives them the Parent tag. Only an
  //   adult can be a guardian, so the shape restriction moves from "role === parent" to this.
  if (childUserId && role !== "adult_client") {
    throw invalid(
      `role "${role}" cannot carry a childUserId (got ${JSON.stringify(childUserId)}) — only an ` +
      "adult client invitation may link a child",
      { field: "childUserId" });
  }
}

/**
 * CREATE — mint the link token, then insert the invite row once, with the token's public id already
 * in hand (F612 / 0211).
 * @returns {{ inviteId: string, tokenId: string, presented: string, expiresAt: Date|string }}
 */
export async function createInvite(tx, {
  tenantId, email, role, staffRole = null, childUserId = null,
  invitedByUserId, inviteeUserId = null, ttlHours = 168,
} = {}) {
  assertTenantTx(tx, "createInvite");
  if (typeof tenantId !== "string" || !tenantId) throw invalid("tenantId is required");
  if (typeof email !== "string" || !email.trim()) throw invalid("email is required");
  if (typeof invitedByUserId !== "string" || !invitedByUserId) {
    throw invalid("invitedByUserId is required — who invited this person is not optional (0202: NOT NULL)");
  }
  assertInviteShape(role, staffRole, childUserId);

  // ★ Generated here, not read back with RETURNING — mintLinkToken needs it as subjectId BEFORE the
  //   invite row exists. Same idiom as src/people/writes.mjs:119.
  const inviteId = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  const { presented, expiresAt } = await mintLinkToken(tx, {
    tenantId,
    purpose: role === "staff" ? "invite" : "client_invite",
    subjectType: "invite",          // mint also derives this from PURPOSE_SUBJECT_TYPE (8.1); named
                                     // here rather than left implicit so a call-site typo is loud.
    subjectId: inviteId,            // the keystone.invite row about to be inserted
    // ★ RULED-BY-PLAN — the RECIPIENT's app_user id when one already exists in this practice (the
    //   staff path does, via inviteTeamMember → createPerson), null otherwise. Never the inviter:
    //   "who invited" lives on keystone.invite.invited_by only (0202, NOT NULL).
    issuedTo: inviteeUserId,
    ttlHours,
  });
  // ★ The public 26-character id inside the presented string — what revoke/redeem/peek look up, and
  //   what F612's fix stores on keystone.invite.token_id.
  const { tokenId } = parsePresented(presented);

  try {
    await tx.query(
      `INSERT INTO keystone.invite
         (id, tenant_id, email, role, staff_role, child_user_id, invited_by, token_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [inviteId, tenantId, email.trim().toLowerCase(), role, staffRole, childUserId, invitedByUserId,
       tokenId, expiresAt]);
  } catch (e) {
    // ★ A duplicate OPEN invitation for the same address is CT-001 kind: "conflict", 409 — the
    //   partial unique index (invite_one_open_per_email_idx, 0202) is the enforcement, this is the
    //   message. The mint above still ran inside this same `tx`, so it rolls back with everything
    //   else when this throws — nothing survives a refused create.
    if (e.code === UNIQUE_VIOLATION && e.constraint === "invite_one_open_per_email_idx") {
      throw conflict(
        `there is already an open invitation for ${email.trim().toLowerCase()}`,
        { field: "email", constraint: e.constraint });
    }
    throw e;
  }

  return Object.freeze({ inviteId, tokenId, presented, expiresAt });
}

/**
 * ACCEPT — spend the link, attach a Firebase identity to a person, in the practice the token names.
 * ★★★ THE PURPOSE TRAVELS IN, NEVER OUT (CONTRACTS §0 C-13 / Q0-23 / CT-019). Staff-vs-client comes
 *     from keystone.invite.role (loaded below), never from which purpose redeemed.
 * @returns {{ tenantId: string, appUserId: string, role: string, staffRole: string|null }}
 */
export async function acceptInvite({ presented, firebaseUid, email, mobilePhone = null } = {}) {
  if (typeof firebaseUid !== "string" || !firebaseUid) throw invalid("firebaseUid is required");
  if (typeof email !== "string" || !email.trim()) throw invalid("email is required");

  // ★ Runs with NO tenant context — discovering the practice is the point of the call (CT-019).
  //   Unknown / revoked / expired / spent / wrong-purpose all arrive as the SAME AppError, passed
  //   through unchanged, so the presenter cannot tell which.
  // ★ Run 6: the address is checked on a PEEK, before the link is spent. Redeeming first meant a wrong-address attempt burned the one-time link and locked the real invitee out of their own invitation (test e8_6 (c)'s control caught it).
  {
    const peeked = await peekLinkToken(presented, ["invite", "client_invite"]);
    const addr = await withTenant(peeked.tenantId, async (tx) => (await tx.query(
      `SELECT email FROM keystone.invite WHERE id = $1 AND tenant_id = $2`, [peeked.subjectId, peeked.tenantId])).rows[0]);
    if (addr && email.trim().toLowerCase() !== addr.email.toLowerCase()) throw forbidden(`This invite was sent to ${addr.email}`);
  }
  const { tenantId, subjectId } = await redeemLinkToken(presented, ["invite", "client_invite"]);

  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, email, role, staff_role, child_user_id, invited_by, expires_at, accepted_at, revoked_at
         FROM keystone.invite WHERE id = $1 AND tenant_id = $2`,
      [subjectId, tenantId]);
    const invite = rows[0];
    if (!invite) throw forbidden(INVITE_NOT_USABLE);

    // ★ Defense-in-depth — see INVITE_NOT_USABLE's comment for why this is a second, independent
    //   refusal rather than a duplicate of what redeemLinkToken already checked.
    if (invite.accepted_at || invite.revoked_at ||
        new Date(invite.expires_at).getTime() <= Date.now()) {
      throw forbidden(INVITE_NOT_USABLE);
    }

    // ★★★ spec 04 §7.2 — the address check. The invited address is already known to whoever holds
    //     the link, so naming it back is not an oracle; naming anything else would be. Checked
    //     BEFORE any write, so a mismatch changes NOTHING — not the person, not a guardian edge, not
    //     the invite's own accepted_at.
    if (email.trim().toLowerCase() !== invite.email.toLowerCase()) {
      throw forbidden(`This invite was sent to ${invite.email}`);
    }

    // ★★★ THE ONLY OTHER WRITER OF app_user.firebase_uid IN THE PRODUCT (spec 04 default 2).
    const { rows: existingRows } = await tx.query(
      `SELECT id FROM keystone.app_user
        WHERE tenant_id = $1 AND lower(email) = lower($2) AND firebase_uid IS NULL`,
      [tenantId, invite.email]);
    const existing = existingRows[0];

    let appUserId;
    if (existing) {
      if (invite.role === "staff") {
        await tx.query(
          `UPDATE keystone.app_user SET firebase_uid = $1, staff_role = $2
            WHERE id = $3 AND tenant_id = $4`,
          [firebaseUid, invite.staff_role, existing.id, tenantId]);
      } else {
        await tx.query(
          `UPDATE keystone.app_user SET firebase_uid = $1 WHERE id = $2 AND tenant_id = $3`,
          [firebaseUid, existing.id, tenantId]);
      }
      appUserId = existing.id;
    } else {
      // ★ invite: false — the invitation already happened; emitting people.person.invited on
      //   acceptance would be a second answer to "was this person invited". See DISPLAY NAME note
      //   at the top of the file for the `displayName: invite.email` fallback.
      // ★ actorUserId: null — nobody holds a session yet; the presented token is the credential.
      const created = await createPerson(tx, {
        tenantId, email: invite.email, displayName: invite.email,
        role: invite.role, staffRole: invite.staff_role,
        firebaseUid, invite: false, actorUserId: null,
        // ★ Run 6: a client invitee in a practice that requires a phone number (the platform) supplies it on acceptance; a Docustay team member does not need one.
        mobilePhone: typeof mobilePhone === "string" && mobilePhone.trim() ? mobilePhone : null,
      });
      appUserId = created.id;
    }

    // ★ spec 04 §7.3 — "a parent invite links to the teen record". `childUserId` is now the
    //   trigger (the maintainer, 29 Sep 2026) — `assertInviteShape` above already refused it on anything but
    //   an adult_client invitation, so reaching here with one set means exactly what it used to.
    if (invite.child_user_id) {
      await addGuardian(tx, {
        tenantId, guardianUserId: appUserId, childUserId: invite.child_user_id,
        relationship: "parent", actorId: invite.invited_by,
      });
    }

    // ★ Same transaction as the person write — "a person created without their invitation record"
    //   is the state that must be impossible (src/people/writes.mjs:86-90's own reasoning).
    await tx.query(
      `UPDATE keystone.invite SET accepted_at = now(), accepted_by_uid = $1
        WHERE id = $2 AND tenant_id = $3`,
      [firebaseUid, invite.id, tenantId]);

    return Object.freeze({
      tenantId, appUserId, role: invite.role, staffRole: invite.staff_role,
    });
  });
}

/**
 * REVOKE — kill an invitation that has not been accepted, and the link token behind it.
 * ★★★ F612 — reads token_id off ITS OWN keystone.invite row, never off keystone.link_token (app_rw
 *     has no SELECT on that column there — CCR-16). See the file header and FINDINGS.md F612.
 * @returns {{ revoked: boolean }}
 */
export async function revokeInvite(tx, { tenantId, inviteId, reason = null, actorUserId = null } = {}) {
  assertTenantTx(tx, "revokeInvite");
  const { rows } = await tx.query(
    `SELECT token_id, accepted_at, revoked_at
       FROM keystone.invite WHERE id = $1 AND tenant_id = $2`,
    [inviteId, tenantId]);
  const invite = rows[0];
  if (!invite) throw notFound("that invitation does not exist");
  if (invite.accepted_at) {
    throw conflict(
      "that invitation has already been accepted and cannot be revoked",
      { field: "inviteId" });
  }
  if (invite.revoked_at) return { revoked: false }; // already revoked — idempotent, not an error

  await tx.query(
    `UPDATE keystone.invite SET revoked_at = now(), revoked_reason = $1
      WHERE id = $2 AND tenant_id = $3`,
    [reason, inviteId, tenantId]);

  return revokeLinkToken(tx, invite.token_id, reason);
}

/**
 * RESEND — for a PERSON who cannot sign in yet: revoke whatever invitation is currently open for
 * their address, if any, then mint a fresh one via `createInvite`. A thin composition of the two
 * functions above — it mints no token and revokes no row of its own.
 * ★ F632 FIX (task 8.14b) — keyed by PERSON, not by the invite's own id. See this task's own header
 *   note for why: the only caller knows the person, not any invite row, and a person has at most one
 *   open invite at a time (invite_one_open_per_email_idx, 0202), so "their open invite" is unambiguous.
 * @param {string} [childUserId]  ★ the maintainer, 29 Sep 2026 — an override for who this invite says was linked,
 *   used exactly once: a caller redirecting an adolescent's invite to their PARENT passes the
 *   TEEN's id here (the parent is `personId`) so acceptance re-confirms/creates that guardian edge
 *   (`addGuardian` is `ON CONFLICT DO NOTHING` — safe whether or not it already exists). Omitted,
 *   this preserves whatever the previous open invite had, exactly as before this parameter existed.
 * @param {number} [ttlHours]  ★ the maintainer, 29 Sep 2026 — "one-use link, expires after 30 days" for a CLIENT
 *   portal invite (720h), vs `createInvite`'s own 168h (7-day) default every staff invite still
 *   uses. Omitted, `createInvite`'s own default applies unchanged.
 * @returns {{ inviteId: string, tokenId: string, presented: string, expiresAt: Date|string, email: string }}
 */
export async function resendInvite(tx, {
  tenantId, personId, actorUserId = null, childUserId: childUserIdOverride, ttlHours,
} = {}) {
  assertTenantTx(tx, "resendInvite");
  if (typeof personId !== "string" || !personId) throw invalid("personId is required");

  const { rows: personRows } = await tx.query(
    `SELECT email, role, staff_role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
    [personId, tenantId]);
  const person = personRows[0];
  if (!person) throw notFound("that person does not exist");

  const { rows: openRows } = await tx.query(
    `SELECT id, child_user_id FROM keystone.invite
      WHERE tenant_id = $1 AND lower(email) = lower($2)
        AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, person.email]);
  const open = openRows[0] ?? null;

  if (open) {
    await revokeInvite(tx, {
      tenantId, inviteId: open.id, reason: "superseded by a new invitation", actorUserId,
    });
  }

  // ★ A guardian invitation's childUserId lives only on the invite row (app_user carries no such
  //   column). ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role`, so there is no longer a
  //   role-driven reason a resend MUST carry one: it simply preserves whatever the last open
  //   invite had, guardian-linking or not — UNLESS a caller overrides it (above).
  const created = await createInvite(tx, {
    tenantId, email: person.email, role: person.role, staffRole: person.staff_role,
    childUserId: childUserIdOverride !== undefined ? childUserIdOverride : (open?.child_user_id ?? null),
    invitedByUserId: actorUserId, inviteeUserId: personId,
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });
  return Object.freeze({ ...created, email: person.email });
}

/**
 * LIST — every invitation this practice has ever sent, with a DERIVED status (never stored).
 * @returns {{ id, email, role, staffRole, invitedBy, expiresAt, status }[]}
 */
export async function listInvites(tx, tenantId) {
  assertTenantTx(tx, "listInvites");
  const { rows } = await tx.query(
    `SELECT id, email, role, staff_role, invited_by, expires_at, accepted_at, revoked_at
       FROM keystone.invite
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    staffRole: r.staff_role,
    invitedBy: r.invited_by,
    expiresAt: r.expires_at,
    status: r.revoked_at ? "revoked"
      : r.accepted_at ? "accepted"
      : new Date(r.expires_at).getTime() <= Date.now() ? "expired"
      : "open",
  }));
}

/**
 * PREVIEW — the fifth export, for 8.12's unauthenticated `GET /api/auth/invite/:token`. Must NOT
 * spend the token (CCR-11, shipped — peekLinkToken).
 * ★ peek_link_token applies the SAME five predicates as redeem (0170), so a revoked/spent/expired
 *   invite is already refused here — there is no separate "not usable" check to duplicate.
 * @returns {{ email, practiceName, role, staffRole, expiresAt, inviterName }}
 */
export async function previewInvite({ presented } = {}) {
  const { tenantId, subjectId } = await peekLinkToken(presented, ["invite", "client_invite"]);

  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT i.email, i.role, i.staff_role, i.expires_at,
              t.name AS practice_name,
              u.display_name AS inviter_name
         FROM keystone.invite i
         JOIN keystone.tenant t ON t.id = i.tenant_id
         JOIN keystone.app_user u ON u.id = i.invited_by
        WHERE i.id = $1 AND i.tenant_id = $2`,
      [subjectId, tenantId]);
    const row = rows[0];
    // ★ Should be unreachable — a live peek names a subject_id that is this same transaction's
    //   invite row — but fails the same undifferentiated way rather than assuming it away.
    if (!row) throw forbidden(INVITE_NOT_USABLE);

    return Object.freeze({
      email: row.email,
      practiceName: row.practice_name,
      role: row.role,
      staffRole: row.staff_role ?? null,   // R13-D297: the rank a teammate is invited at (role is the account kind, "staff"); the page said "a member" for an Admin invitation
      expiresAt: row.expires_at,
      inviterName: row.inviter_name,
      // Run 7: the accept screen asks for a phone only when accepting would otherwise be refused for the lack of one (a client in a practice that requires it; never a Docustay teammate)
      phoneRequired: await phoneNeededFor(tx, tenantId, row.role),
    });
  });
}
