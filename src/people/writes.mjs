// @ts-check
// P15B.4 — THE PEOPLE WRITES. createPerson · updatePerson · inviteTeamMember · setStaffRole.
//
// ★★★ EVERY FUNCTION HERE TAKES `tx` AND EMITS IN THE SAME TRANSACTION (§X4.1, P15B.2). A write with
//     no event is a silent state change, and `emit()` refuses anything that is not the branded handle
//     `withTenant()` supplies (U26 / P15B.2a) — so the atomicity is structural, not remembered.
//
// ★★ NO FUNCTION HERE OPENS A TRANSACTION OR TOUCHES A POOL. The caller is always a route running
//    inside `runTenantScoped`, which has already set the tenant GUC — which is also why no function
//    takes a tenantId it could disagree with: `require_tenant_id()` in the RLS policy is the
//    authority, and passing one would create a second opinion. It is passed only where `emit()`
//    needs it for the event row, and it comes from the same scoped source.
//
// ★★★ THE SHAPE CONSTRAINT THAT DOMINATES THIS FILE, MEASURED FROM THE CATALOG:
//       staff_role_shape CHECK ((role = 'staff' AND staff_role IS NOT NULL)
//                            OR (role <> 'staff' AND staff_role IS NULL))
//     So a rank is REQUIRED for staff and FORBIDDEN for everyone else. There is no "default rank"
//     and no "staff member we will grade later". ★ Migration 0010 added this AFTER the signup path
//     was written, and every signup had been inserting a row the schema now refuses — the recorded
//     lesson that "each phase passed when written" is a weaker claim than it sounds. This file states
//     the rule in code AND lets the constraint be the final word, because two independent refusals
//     are the point.

import { isQaLoginUid, QA_LOGIN_REFUSAL } from "../auth/qaLogins.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { emit, userActor } from "../events/outbox.mjs";
import { normaliseReason, keepReason } from "../events/reasons.mjs";
import { grantRole } from "../permissions/writes.mjs";
import { STAFF_ROLE_TO_ROLE_KEY } from "../permissions/defaults.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { revokeSessionsForUser } from "../auth/session.mjs";
import { invalid, conflict, notFound, unprocessable, forbidden } from "../http/errors.mjs";
// ★ TASK 12.5 — `removeSamples` (bottom of this file) reuses the ONE archive writer every other
//   archivable object uses, rather than a bespoke bulk-delete path. `src/records/archive.mjs` is
//   P2.9's file; imported here, not redefined.
import { archiveRecord } from "../records/archive.mjs";
// ★ C1.9 — required fields validation
import { requiredFor, validateRequired } from "../records/fieldRules.mjs";
// ★ C1.2 — Stripe customer sync
import { ensureCustomer } from "../money/customers.mjs";

const SECTION = "people";

/** The four roles the CHECK admits. Named here so a typo is a local failure, not a Postgres one. */
// ★ the maintainer, 29 Sep 2026 — "parent" is retired as a `role` value. Everyone who receives services is a
//   client (adult or adolescent); whether they're ALSO a parent is the `guardian` link, a fact,
//   never a role a person is assigned instead of being a client. See db migration 0533 and
//   src/nav/authorise.mjs's `effectiveRank`.
export const ROLES = Object.freeze(["staff", "adult_client", "adolescent_client"]);
/** The four staff ranks. ★ `super_admin_1` is additionally gated to the platform tenant by 0010. */
// ★★★ THE VOCABULARIES LIVE IN `vocab.mjs` AND ARE RE-EXPORTED HERE — A MOVE, NOT A FORK (A3.2).
//     Split out so the stage popover and the rank dropdown can import them in a BROWSER, which
//     cannot load this file: `emit` reaches `pg`. Re-exported so every existing importer — and
//     every gate — resolves with no edit. Same pattern as `events/topics.mjs` (F406).
// ★ TASK 12.4 — `CONSENT_STATUSES` joins the re-export, same reason, same pattern.
export { STAFF_ROLES, LIFECYCLE_STATUSES, CONSENT_STATUSES } from "./vocab.mjs";
import { STAFF_ROLES, LIFECYCLE_STATUSES, CONSENT_STATUSES } from "./vocab.mjs";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
// ★ TASK 12.21 — createPerson's referred-by FKs surface this code; named here rather than inline
//   so it reads the same as its two neighbours above.
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * ★ Validate the role/rank pair BEFORE the statement. The database would catch it anyway; catching it
 *   here means the caller gets a sentence instead of a constraint name, and the two cannot disagree
 *   because the database still has the last word.
 */
function assertRoleShape(role, staffRole) {
  if (!ROLES.includes(role)) {
    throw invalid(`role must be one of ${ROLES.join(", ")} — got ${JSON.stringify(role)}`);
  }
  if (role === "staff") {
    if (!staffRole) {
      throw invalid(
        `a staff member must be given a rank (admin or coach) — there is no unranked staff row, ` +
        "because a tenant whose only staff member has no rank is a tenant nobody can administer"
      );
    }
    if (!STAFF_ROLES.includes(staffRole)) {
      throw invalid(`staff_role must be one of ${STAFF_ROLES.join(", ")} — got ${JSON.stringify(staffRole)}`);
    }
  } else if (staffRole) {
    // ★★ REFUSED, NOT IGNORED. Silently dropping a rank the caller asked for would mean a request to
    //    make someone an admin appeared to succeed and did nothing — the failure shape this project
    //    keeps meeting. Their intent disappears and nothing says so.
    throw invalid(
      `role "${role}" cannot carry a staff rank (got ${JSON.stringify(staffRole)}) — a rank is ` +
      `meaningful only for staff, and dropping it silently would hide what you asked for`
    );
  }
}

/**
 * Check for a possible duplicate person in this tenant: display name matches (case-insensitive,
 * trimmed) AND (email matches OR mobile_phone matches), excluding archived rows.
 * @returns { id, display_name, email, mobile_phone, matchedOn } or null if no match found
 */
export async function findPossibleDuplicate(tx, {
  tenantId, displayName, email, mobilePhone, excludePersonId = null,
}) {
  if (typeof displayName !== "string" || !displayName.trim()) return null;
  const nameTrimmed = displayName.trim().toLowerCase();

  // ★ TASK 12.12 — "not the same person": once a pair is dismissed, never suggest it again. Only
  //   applies when checking against an EXISTING person (`excludePersonId` given); a brand-new person
  //   being created has no id yet, so no dismissal can apply and the clause is omitted.
  const query = `
    SELECT id, display_name, email, mobile_phone
      FROM keystone.app_user
     WHERE tenant_id = $1
       AND LOWER(TRIM(display_name)) = $2
       AND archived_at IS NULL
       AND (
         (LOWER(TRIM(email)) = $3)
         OR ($4::text IS NOT NULL AND mobile_phone = $4::text)
       )
       ${excludePersonId ? `AND app_user.id <> $5
       AND NOT EXISTS (
         SELECT 1 FROM keystone.person_merge_dismissal d
          WHERE d.tenant_id = $1
            AND d.person_low_id  = least(app_user.id, $5)
            AND d.person_high_id = greatest(app_user.id, $5)
       )` : ""}
     LIMIT 1
  `;

  const params = [
    tenantId,
    nameTrimmed,
    email ? email.trim().toLowerCase() : "",
    mobilePhone ? mobilePhone.trim() : null,
    ...(excludePersonId ? [excludePersonId] : []),
  ];

  const { rows } = await tx.query(query, params);
  if (rows.length === 0) return null;

  const row = rows[0];
  let matchedOn = [];
  if (email && row.email && row.email.toLowerCase() === email.trim().toLowerCase()) {
    matchedOn.push("email");
  }
  if (mobilePhone && row.mobile_phone && row.mobile_phone === mobilePhone.trim()) {
    matchedOn.push("mobile");
  }

  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    mobile_phone: row.mobile_phone,
    matchedOn,
  };
}

/**
 * Create a person. `role` decides everything else about the shape.
 * @returns { id, role, staff_role, email, display_name }
 */
/**
 * ★★★ A3.1 — PORTAL ACCESS IS CREATED IN THE **SAME TRANSACTION** AS THE PERSON. [TY, RULED]
 *
 *   THE ALTERNATIVE IS A CLIENT RECORD NOBODY CAN LOG IN AS, WITH NO SIGNAL ANYTHING IS MISSING.
 *   A coach adds Dana, the record looks complete on every screen, and Dana never hears from the
 *   practice — because the second, separate "invite" step is one a busy person forgets and no
 *   surface reminds them of. **A half-created person is indistinguishable from a finished one**,
 *   which is why this cannot be a follow-up action.
 *
 * ★★ SAME TRANSACTION, NOT "STRAIGHT AFTERWARDS". `emit(tx, …)` takes the caller's transaction as
 *    its FIRST argument, so the invitation record and the person row commit or roll back together.
 *    A person created without their invitation — because the process died between two statements —
 *    is exactly the state this is written to make impossible.
 *
 * ★★★ AND IT IS THE SAME EMIT `inviteTeamMember` USES, NOT A SECOND ONE. There is no `invite`
 *     table (NAV 13/75 — "NO TABLE → ADDENDUM 4"); the durable fact that an invitation was
 *     extended is `people.person.invited`. Two places emitting it would be two answers to "was
 *     this person invited", and the notification consumer would have to know about both.
 *
 * ★ `has_login: false` STAYS LOAD-BEARING FOR EVERY ROLE. An invited person has no `firebase_uid`,
 *   and `login()` matches by uid and never by email (P13.4) — so emitting this cannot accidentally
 *   admit anybody. The invitation is a MESSAGE, not a credential.
 *
 * ★★ THE ROLE TRAVELS IN THE PAYLOAD. A client, a parent and a coach are invited to different
 *   things and in different words, and the consumer composes from this. Never borrow one party's
 *   word for another — the payload says which one it is.
 */
export async function createPerson(tx, {
  tenantId, email, displayName, firstName, role, staffRole = null, firebaseUid = null,
  invite = false, actorUserId = null,
  // ★★★ TASK 12.3 — `12-signup-first-run-people.md` §3.4. `keystone.app_user.is_sample` has existed
  //     since 0214 with zero writers [MEASURED — this INSERT's column list was exactly (id,
  //     tenant_id, email, display_name, role, staff_role, firebase_uid), `is_sample` absent].
  //     Every EXISTING caller keeps getting `false` unchanged; only the sample-client producer
  //     (`src/provisioning/sampleContent.mjs`) passes `true`.
  isSample = false,
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TOUCH-UP · WORKSTREAM 7.2/7.3 — FOUR MORE COLUMNS THIS INSERT NOW WRITES. 0076 (P2.1) added
  //     `mobile_phone`, `date_of_birth`, `source` and `lifecycle_status` to `keystone.app_user`
  //     with NO WRITER anywhere in `src/` — this project's own recorded failure #3 ("a schema built
  //     from rules instead of the model"). All four are the SAME columns, unmodified; every existing
  //     caller of `createPerson` keeps working unchanged because all four default to `undefined`
  //     (omitted from the INSERT via `?? null`, letting the column's own DEFAULT / nullability
  //     stand — `lifecycle_status` in particular already defaults to `'lead'` at the schema level,
  //     0076:102, so omitting it is correct, not a gap).
  //   ★ Validated the SAME way `updatePerson`'s `mobilePhone` already is (non-blank if present) —
  //     no new validation shape invented for this.
  mobilePhone = null, dateOfBirth = null, source = null, lifecycleStatus = null,
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ TOUCH-UP ROUND 2 — 24 NEW COLUMNS FROM MIGRATIONS 0076/0081, ALL REQUIRED BY THE SCHEMA
  //   but absent from every existing caller. Appended to the parameter list following the same
  //   pattern `mobilePhone` · `dateOfBirth` · `source` · `lifecycleStatus` already set.
  preferredName = null, pronouns = null,
  homePhone = null, secondaryEmail = null, preferredContactMethod = null,
  doNotEmail = null, doNotText = null, doNotCall = null,
  country = null, addressLine1 = null, addressLine2 = null, city = null, stateRegion = null, postcode = null,
  timezone = null, tags = null,
  emergencyContactName = null, emergencyContactRelationship = null, emergencyContactPhone = null,
  sobrietyDate = null, recoveryProgramme = null, sponsorName = null, supportNetwork = null,
  notes = null,
  // ★ TASK 12.21 — the two referral edges, deliberately separate (0081:11-19):
  //   person→PERSON (`referredById`) and person→PARTY (`referredByPartyId`). Mutually exclusive —
  //   see the validation below and `app_user_one_referrer`.
  referredById = null, referredByPartyId = null,
}) {
  // ★★★ [TY, RULED 2 Oct 2026] NAME, EMAIL AND PHONE ARE ALL REQUIRED — NOT "ONE OR THE OTHER."
  //   An earlier version of this code tried to make email satisfiable by a phone number instead,
  //   matching what fieldRules.mjs's OWN comment used to claim was the intent. the maintainer's ruling, once he
  //   saw that: there is no "or" — every person needs a name, an email, AND a phone number, for
  //   every practice, with no setting that can turn either off (fieldRules.mjs's own
  //   UNCHANGEABLE list). `validateRequired` already does plain AND-over-a-list correctly; the fix
  //   was adding `mobile_phone` to that list (fieldRules.mjs), not special-casing this call site.
  const normalizedName = firstName ?? displayName;
  const phoneNeeded = await phoneRequiredFor(tx, tenantId, role);
  const required = (await requiredFor(tx, tenantId, "person")).filter((f) => f !== "mobile_phone" || phoneNeeded);
  const validation = validateRequired({
    firstName: normalizedName,
    displayName: normalizedName,
    email,
    mobilePhone,
  }, required);

  if (!validation.ok) {
    throw unprocessable(
      `missing required fields: ${validation.missing.join(", ")}`,
      { fields: validation.missing }
    );
  }

  assertRoleShape(role, staffRole);
  if (mobilePhone !== null && (typeof mobilePhone !== "string" || !mobilePhone.trim())) {
    throw invalid("mobilePhone cannot be blank — omit the field or send null", { field: "mobilePhone" });
  }
  if (lifecycleStatus !== null && !["lead", "active", "paused", "former"].includes(lifecycleStatus)) {
    throw invalid("lifecycleStatus must be one of lead, active, paused, former", { field: "lifecycleStatus" });
  }
  if (preferredContactMethod !== null &&
      !["email", "sms", "phone", "mail"].includes(preferredContactMethod)) {
    throw invalid("preferredContactMethod must be one of email, sms, phone, mail",
                  { field: "preferredContactMethod" });
  }
  // ★ TASK 12.21 — "REFERRED BY" IS TWO EDGES, NOT ONE. person→PERSON and person→PARTY are
  //   deliberately separate columns (0081:11-19) and `app_user_one_referrer` refuses both at once —
  //   checked here too, so the caller gets a sentence instead of a constraint name.
  const REFERRED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (referredById !== null && !REFERRED_UUID_RE.test(referredById)) {
    throw invalid("referredById must be a UUID", { field: "referredById" });
  }
  if (referredByPartyId !== null && !REFERRED_UUID_RE.test(referredByPartyId)) {
    throw invalid("referredByPartyId must be a UUID", { field: "referredByPartyId" });
  }
  if (referredById !== null && referredByPartyId !== null) {
    throw invalid("a person was referred by a person or by a party, not both", { field: "referredById" });
  }

  // ★ The id is generated here rather than read back with RETURNING, for the same reason the signup
  //   path does it (D-17.17): RETURNING is subject to RLS and needs the new row to be VISIBLE, and a
  //   role with no SELECT policy fails with a message about WITH CHECK that points at the wrong
  //   thing. Generating it also means the event can name the subject without a second round trip.
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  // ★ TASK 12.21 — somebody cannot have referred themselves. Checked here because `id` does not
  //   exist before this line.
  if (referredById !== null && referredById === id) {
    throw invalid("somebody cannot have referred themselves", { field: "referredById" });
  }

  try {
    await tx.query(
      `INSERT INTO keystone.app_user
         (id, tenant_id, email, display_name, role, staff_role, firebase_uid, is_sample,
          mobile_phone, date_of_birth, source, lifecycle_status,
          preferred_name, pronouns, home_phone, secondary_email, preferred_contact_method,
          do_not_email, do_not_text, do_not_call,
          country, address_line1, address_line2, city, state_region, postcode,
          timezone, tags,
          emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
          sobriety_date, recovery_programme, sponsor_name, support_network, notes,
          referred_by_id, referred_by_party_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)`,
      [id, tenantId, email.trim().toLowerCase(), normalizedName.trim(), role, staffRole, firebaseUid,
       isSample, mobilePhone === null ? null : mobilePhone.trim(), dateOfBirth, source,
       // ★ Matches the column's OWN default (0076:102) rather than relying on SQL's `DEFAULT`
       //   keyword mid-expression, which `coalesce()` cannot take as an argument.
       lifecycleStatus ?? "lead",
       preferredName, pronouns, homePhone, secondaryEmail, preferredContactMethod,
       // ★ Matches the columns' OWN default (0076:71-73) — same reason as `lifecycleStatus` above.
       doNotEmail ?? false, doNotText ?? false, doNotCall ?? false,
       country, addressLine1, addressLine2, city, stateRegion, postcode,
       // ★ `tags` matches its own column default too (0076:111) — same reason as above.
       timezone, tags ?? [],
       emergencyContactName, emergencyContactRelationship, emergencyContactPhone,
       sobrietyDate, recoveryProgramme, sponsorName, supportNetwork, notes,
       referredById, referredByPartyId]
    );
  } catch (e) {
    // ★★ A DUPLICATE EMAIL IN THIS TENANT IS A 409, NOT A 500. `UNIQUE (tenant_id, lower(email))`
    //    means the same address can exist in ANOTHER practice — which is correct, and is why the
    //    message says "in this organisation" rather than "already registered".
    //
    // ★★★ BUT THERE ARE **THREE** UNIQUE INDEXES ON THIS TABLE, AND UNTIL 2026-09-14 ALL THREE WERE
    //     REPORTED AS AN EMAIL COLLISION. [MEASURED against the deployed app] creating a second
    //     super_admin_1 answered
    //         409 "someone in this organisation already uses the maintainer"
    //                                                        …an address NO ROW IN THE DATABASE HELD.
    //     The violated index was `app_user_single_super_admin_1_idx`
    //     — UNIQUE (staff_role) WHERE staff_role = 'super_admin_1' — i.e. **one Super Admin 1 may
    //     exist in the whole database**. An operator reading that message would go looking for a
    //     duplicate person who does not exist, and would never find the rule that actually refused
    //     them. ★ The refusal was correct; the REASON was fiction, and `detail.field = "email"` sent
    //     a form to highlight the wrong input.
    //   ★★ So the constraint NAMES ITSELF. Each index gets the sentence that is true of it, and an
    //      index nobody has anticipated says so plainly rather than borrowing another's words — the
    //      same rule as CLAUDE.md §2.7's "name the party you mean, never borrow another's".
    if (e.code === UNIQUE_VIOLATION) {
      if (e.constraint === "app_user_single_super_admin_1_idx") {
        throw conflict(
          "there is already a Super Admin 1, and there may only ever be one. That rank is the " +
          "platform's owner, not a role to hand out: to move it, change the person who holds it " +
          "rather than adding a second.",
          { field: "staffRole", constraint: e.constraint });
      }
      if (e.constraint === "app_user_tenant_firebase_uid_key") {
        throw conflict(
          "that sign-in identity is already attached to someone in this organisation. A Firebase " +
          "uid identifies one person, so attaching it twice would give one login two records and " +
          "make which one they get arbitrary.",
          { field: "firebaseUid", constraint: e.constraint });
      }
      if (e.constraint === "app_user_tenant_email_key") {
        throw conflict(`someone in this organisation already uses ${email.trim().toLowerCase()}`,
                       { field: "email", constraint: e.constraint });
      }
      // ★★★ FOUND LIVE, the maintainer's own real submission, 2 Oct 2026 — this constraint has existed since
      //   0076, but mobile_phone was never REQUIRED before tonight's ruling, so a duplicate-phone
      //   collision was rare enough that nobody had taught this handler about it — it fell through
      //   to the generic "not taught to explain" message below, which is honest but not
      //   human-readable for a now-common case. Same pattern as email, just late to need it.
      if (e.constraint === "app_user_tenant_mobile_phone_key") {
        throw conflict(`someone in this organisation already uses that phone number`,
                       { field: "mobilePhone", constraint: e.constraint });
      }
      // ★ FAIL HONESTLY on an index this code has never been taught about, rather than guessing the
      //   most common one. A wrong reason is worse than an unfamiliar one.
      throw conflict(
        `this person collides with an existing record (${e.constraint ?? "unnamed constraint"}). ` +
        `That rule is not one this message has been taught to explain — the constraint name above ` +
        `is the exact thing that refused it.`,
        { constraint: e.constraint ?? null });
    }
    // ★ TASK 12.21 — the two referral FKs, both composite on (tenant_id, …), so a cross-practice id
    //   cannot be stored even if RLS were bypassed; this is that refusal surfacing as a sentence.
    if (e.code === FOREIGN_KEY_VIOLATION) {
      if (e.constraint === "app_user_referred_by_fkey") {
        throw invalid("no such person in this practice", { field: "referredById", constraint: e.constraint });
      }
      if (e.constraint === "app_user_referred_by_party_fkey") {
        throw invalid("no such partner in this practice", { field: "referredByPartyId", constraint: e.constraint });
      }
      throw e;
    }
    if (e.code === CHECK_VIOLATION) {
      // ★ Reached when the DATABASE disagrees with assertRoleShape — e.g. 0010's
      //   enforce_super_admin_1(), which refuses that rank outside the platform tenant and which
      //   this module deliberately does NOT re-implement. Surface the constraint's own name.
      throw invalid(`the database refused this person: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A NEW STAFF MEMBER IS GIVEN A ROLE, AND WITHOUT THIS THE WHOLE PERMISSION SYSTEM HAS NO
  //     WAY IN. [MEASURED by the P1 adversarial review] `grantRole()` had **ZERO production call
  //     sites** — `seed_builtin_roles` runs once per tenant for the FOUNDER, and this function
  //     inserted an `app_user` and granted nothing. So every staff member hired after signup held
  //     no role forever, and `scope_not_yet_configured` (0075) handed them the entire tenant.
  //   ★★ Migration 0078 re-keyed that fallback on the TENANT, which closes the leak — and closing
  //      it turns the same gap into a LOCKOUT unless somebody grants the role. **Both halves have
  //      to land together**: a fix that trades over-admission for an outage is not a fix.
  //   ★ The rank → role correspondence is `STAFF_ROLE_TO_ROLE_KEY`, the same map the signup path
  //     and the backfill use. One place, three callers.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (role === "staff") {
    const roleKey = STAFF_ROLE_TO_ROLE_KEY[staffRole] ?? "member";
    const { rows: rr } = await run(tx, db
      .selectFrom("keystone.role")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("key", "=", roleKey));
    // ★★ A TENANT WITH NO ROLES IS NOT AN ERROR HERE — it is one that predates 0066 and has not been
    //    backfilled, and `scope_not_yet_configured` is covering it. Throwing would make creating a
    //    person impossible on exactly those deployments. ★ When the roles exist, the grant is not
    //    optional: skipping it silently is what produced the hole this comment describes.
    if (rr.length === 1) {
      // ★ STAGE 3 TASK 1 — this call already had `actorUserId` in hand and was passing a hardcoded
      //   `null`; the grant's own event (`people.role.granted`) can now name who caused it too.
      await grantRole(tx, { tenantId, userId: id, roleId: rr[0].id, actorId: actorUserId ?? null });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ C1.2 — STRIPE CUSTOMER SYNC. Ensure the person gets a Stripe Customer on the practice's
  //   connected account. If no Connect account exists yet, this queues the customer (stores as
  //   null) and backfill runs it later.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await ensureCustomer(tx, { tenantId, personId: id });

  await emit(tx, {
    tenantId,
    topic: "people.person.created",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: id,
    // ★ STAGE 3 TASK 1 — who ran this write, on the envelope. `actorUserId` is the session id
    //   `routes/writes.mjs` stamps last (never from the body); see outbox.mjs's userActor.
    actor: userActor(actorUserId),
    // ★ NO EMAIL IN THE PAYLOAD. An event is read by the activity feed, the audit log and the worker;
    //   an address in it is a copy of a contact detail that outlives every later correction to it,
    //   in a table nothing ever edits. The role and rank ARE the fact worth recording.
    payload: { role, staff_role: staffRole, has_login: firebaseUid !== null },
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A3.1 — THE INVITATION, IN THIS TRANSACTION. [TY, RULED] See the header.
  //   ★★ IT IS A SECOND EVENT, NOT A FIELD ON THE FIRST. "This person exists" and "this person was
  //      invited" are different facts with different audiences: the activity feed wants both, and
  //      the notification consumer must fire on exactly one of them. Folding `invited` into
  //      `created`'s payload would make "send the invitation" a decision the consumer has to infer
  //      from a boolean, and a person created WITHOUT an invitation would look identical to one
  //      whose invitation failed to send.
  //   ★ `firebaseUid !== null` means this person already has a login, so there is nothing to invite
  //     them to. Emitting anyway would send a "set up your account" message to somebody who has one.
  if (invite && firebaseUid === null) {
    await emit(tx, {
      tenantId,
      topic: "people.person.invited",
      emittedBy: SECTION,
      subjectType: "person",
      subjectId: id,
      // ★ STAGE 3 TASK 1.
      actor: userActor(actorUserId),
      // ★★ THE ROLE TRAVELS. A client, a parent and a coach are invited to different things and in
      //    different words; the consumer composes from this rather than guessing. Never borrow one
      //    party's word for another.
      payload: {
        role,
        staff_role: staffRole,
        // ★★★ FIX ROUND 1, I5 / F494 — ONLY THE SESSION. This used to read
        //     `invitedByUserId ?? actorUserId`, and `invitedByUserId` was never stamped by
        //     `routes/writes.mjs` — it arrived only if a request body named it, so any caller could
        //     claim somebody else sent the invitation. The parameter is gone; a body still sending
        //     `invitedByUserId` is simply ignored, never read under any name.
        invited_by: actorUserId ?? null,
        // ★★ LOAD-BEARING FOR EVERY ROLE, NOT JUST STAFF. No `firebase_uid` means they cannot log
        //    in until they complete sign-up, and `login()` matches by uid and never by email
        //    (P13.4) — so an invitation can never accidentally admit anybody.
        has_login: false,
      },
    });
  }

  // 21 Oct 2026 (the maintainer, decision 4): a team member joining changes what a Pay as you go workspace owes; Stripe hears of it now, prorated (an open invitation is not a team member yet and is not billed)
  if (role === "staff" && !invite) { const { syncSeatsNow } = await import("../product/docustaySeatSync.mjs"); await syncSeatsNow(tx, { tenantId, why: "person_created" }); }
  return {
    id, role, staff_role: staffRole,
    email: email.trim().toLowerCase(), display_name: displayName.trim(),
    // ★ So a caller — and a gate — can tell what actually happened rather than what was asked for.
    invited: Boolean(invite && firebaseUid === null),
  };
}

/**
 * Update the mutable parts of a person: display name, email, firebase uid.
 * ★★★ ROLE AND RANK ARE NOT UPDATABLE HERE — `setStaffRole` is a separate, deliberate call. Folding
 *     a privilege change into a general-purpose update is how an escalation arrives as a typo, and it
 *     would emit the wrong topic: `person.updated` and `person.role_changed` are different facts and
 *     somebody auditing the second does not want to read every instance of the first.
 */
// ★★★ F469 — THE ROUTE SPREADS THE REQUEST BODY INTO THIS FUNCTION (src/routes/writes.mjs:228). A login
//     id, a rank or a role arriving here is an attempt to change WHO someone is or WHAT they may do,
//     through a route that only checks "may edit people". Refused by name, loudly, and never silently
//     ignored — a silent ignore would let the next edit re-add the column without anyone noticing.
//     A Firebase uid is attached only by accepting an invite (04 default 2); a rank only by setStaffRole.
const REFUSED_UPDATE_FIELDS = Object.freeze(["firebaseUid", "staffRole", "role", "tenant"]);

export async function updatePerson(tx, input) {
  for (const f of REFUSED_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      throw invalid(`${f} cannot be changed here`, { field: f });
    }
  }
  const {
    tenantId, personId, displayName, email, mobilePhone, tags, referredById, actorUserId = null,
  } = input;
  const sets = [];
  const args = [personId];
  const changed = [];
  if (displayName !== undefined) {
    if (typeof displayName !== "string" || !displayName.trim()) throw invalid("displayName cannot be blank");
    args.push(displayName.trim()); sets.push(`display_name = $${args.length}`); changed.push("display_name");
  }
  if (email !== undefined) {
    if (typeof email !== "string" || !email.trim()) throw invalid("email cannot be blank");
    args.push(email.trim().toLowerCase()); sets.push(`email = $${args.length}`); changed.push("email");
  }
  // ★★ TOUCH-UP WORKSTREAM 4.5 (inline edit) — the list workspace's "phone" field. `mobile_phone`
  //   has carried a normalising trigger and an E.164 CHECK since migration 0122; neither existed as
  //   a writable field on this route before now. `null` is accepted (clearing the number) the same
  //   way `ownerUserId` accepts `null` elsewhere in this file — a blank string is refused rather than
  //   silently stored, matching displayName/email's own "cannot be blank" rule for a PRESENT field.
  if (mobilePhone !== undefined) {
    if (mobilePhone !== null && (typeof mobilePhone !== "string" || !mobilePhone.trim())) {
      throw invalid("mobilePhone cannot be blank — omit the field or send null to clear it", { field: "mobilePhone" });
    }
    args.push(mobilePhone === null ? null : mobilePhone.trim());
    sets.push(`mobile_phone = $${args.length}`); changed.push("mobile_phone");
  }
  // ★ Tags are an array of strings, validated and converted to the database format
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      throw invalid("tags must be an array", { field: "tags" });
    }
    args.push(tags);
    sets.push(`tags = $${args.length}`); changed.push("tags");
  }
  // ★ TASK 12.21 — "who sent them" is most often learned after the first session, so this is
  //   editable on UPDATE as well as CREATE (unlike `referredByPartyId`, which is not — the party
  //   edge is set at intake and changed through the network surfaces). `undefined` = not being
  //   changed, `null` clears it — the `mobilePhone` rule above, verbatim shape.
  if (referredById !== undefined) {
    if (referredById !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referredById)) {
        throw invalid("referredById must be a UUID", { field: "referredById" });
      }
      if (referredById === personId) {
        throw invalid("somebody cannot have referred themselves", { field: "referredById" });
      }
    }
    args.push(referredById);
    sets.push(`referred_by_id = $${args.length}`); changed.push("referred_by_id");
  }
  // ★ An update that changes nothing is a caller error, not a no-op success. Accepting it would emit
  //   a `person.updated` event describing no change, which is noise in an audit log.
  if (sets.length === 0) throw invalid("nothing to update");

  let r;
  try {
    r = await tx.query(
      `UPDATE keystone.app_user SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict("someone in this organisation already uses that email address", { field: "email" });
    }
    // ★ The E.164 CHECK (0122) is the only CHECK this statement can hit, since displayName/email are
    //   already validated above — so the field name is unambiguous rather than guessed.
    if (e.code === CHECK_VIOLATION) {
      throw invalid("that does not look like a phone number this practice can text", { field: "mobilePhone" });
    }
    throw e;
  }

  // ★★★ ZERO ROWS IS A 404, AND SAYING SO IS THE WHOLE POINT. An UPDATE that matches nothing is not
  //     an error in Postgres — it is this project's signature silent failure (D-17.19), and under RLS
  //     it is ALSO how a cross-tenant id presents: the row exists, the predicate hides it, the
  //     statement succeeds having done nothing. Refusing here makes both visible.
  if (r.rowCount === 0) throw notFound("no such person in this organisation");

  await emit(tx, {
    tenantId,
    topic: "people.person.updated",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    // ★ STAGE 3 TASK 1 — `input.actorUserId` is the session id `routes/writes.mjs` stamps last;
    //   `updatePerson` takes the whole spread object as `input` rather than destructuring per field,
    //   so this is the one place in this function that reads it.
    actor: userActor(actorUserId),
    // ★ The FIELD NAMES, not the values. A consumer needs to know what moved; storing the new values
    //   would put a person's name and address permanently in an append-only table.
    payload: { fields: changed },
  });
  return { id: personId, fields: changed };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P8.9 — NOBODY COULD EVER STOP BEING A LEAD.
//
//     `app_user.lifecycle_status` has four values (`lead · active · paused · former`) and is
//     `NOT NULL DEFAULT 'lead'`. It is READ everywhere — the people list's Stage column, the person
//     record page, the global-search subtitle. **[MEASURED 2026-09-15] nothing in `src/` had ever
//     written it**, and the live distribution was the proof:
//
//         SELECT lifecycle_status, count(*) FROM keystone.app_user GROUP BY 1
//           →  [{"lifecycle_status":"lead","n":55}]      ← all 55. every person. one value.
//
//     `updatePerson` accepts `displayName` and `email` and nothing else, so three of
//     the four values were unreachable BY CONSTRUCTION. A CRM in which a lead can never become a
//     client, a client can never pause, and nobody can ever leave.
//
// ★★★ AND THE RECORDED CAUSE FOR THE MISSING EVENT WAS WRONG IN A WAY THAT WOULD HAVE CLOSED THE
//     ITEM. `db/gates/p8_4_chain_topics_have_reachable_producers.mjs` lists
//     `people.person.stage_changed` as known-unproduced because *"there is no stage or lifecycle
//     field to change… It is a missing capability, not a forgotten emit."* **The field has existed
//     since migration 0076.** The capability that was missing was one function, not a schema change
//     — and a session reading that note would have gone looking for a column, found one, and been
//     confused, or believed the note and moved on.
//
// ★★ THE TRANSITIONS ARE A CLOSED MAP, NOT A FREE ASSIGNMENT, and the one that is absent is the one
//    worth naming: **nothing returns to `lead`.** A lead is somebody who has not yet decided; once
//    they have, they never un-decide. A former client who comes back is `active` again — that is a
//    returning client, and recording them as a new lead would lose the history that makes them one.
//  ★ `active → former` and `paused → former` are both permitted because leaving from a pause is the
//    commonest way a client actually leaves: they stop, they mean to come back, and eventually it is
//    time to say so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The four values 0076's CHECK permits. Exported so the gate asserts against the SAME list. */


/** ★★ From → the set it may go to. A status absent as a KEY is terminal-ish; a value absent from
 *     every set is unreachable — and `lead` is deliberately in no set at all. */
export const LIFECYCLE_TRANSITIONS = Object.freeze({
  lead:   Object.freeze(["active", "former"]),
  active: Object.freeze(["paused", "former"]),
  paused: Object.freeze(["active", "former"]),
  former: Object.freeze(["active"]),
});

/**
 * Move a person along the relationship: lead → active → paused → former, and back from former.
 *
 * ★★★ THE TRANSITION IS CHECKED AGAINST THE ROW'S CURRENT VALUE, IN ONE STATEMENT. Reading the
 *     status and then writing it would leave a gap in which two staff members both move the same
 *     person, and the second one's move would silently win from a stale starting point. The
 *     `AND lifecycle_status = $3` in the UPDATE is what makes the check and the write the same act.
 * ★★ A MOVE TO THE STATUS IT ALREADY HAS IS REFUSED, not accepted as a no-op. It would emit a
 *    `stage_changed` event describing no change, which is noise in the one log an auditor reads —
 *    the same rule `updatePerson` applies to an empty update.
 * ★ `reason` is optional and free text. It is a fact about a moment, not a property of the person,
 *   so it is kept in `keystone.record_reason` beside the event (R46) — never in the payload (§2.4).
 */
export async function setLifecycleStatus(
  tx, { tenantId, personId, status, reason = null, actorUserId = null }
) {
  if (!personId) throw invalid("setLifecycleStatus needs a personId");
  // ★ R46 — validated before anything moves, so a refused reason leaves the person where they were.
  const keptReason = normaliseReason(reason);
  if (!LIFECYCLE_STATUSES.includes(status)) {
    throw invalid(
      `lifecycle status must be one of ${LIFECYCLE_STATUSES.join(" · ")} — got ${JSON.stringify(status)}`);
  }

  const current = (await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["lifecycle_status", "firebase_uid"])
    .where("id", "=", personId))).rows[0];
  // ★ 404 BEFORE anything else — under RLS a cross-tenant id and a deleted one present identically,
  //   and both should say so rather than falling through to a confusing transition message.
  if (!current) throw notFound("no such person in this organisation");

  // ★ F865 — the QA sign-in accounts are never paused or made former (see src/auth/qaLogins.mjs)
  if (isQaLoginUid(current.firebase_uid) && (status === "paused" || status === "former")) throw conflict(QA_LOGIN_REFUSAL);

  const from = current.lifecycle_status;
  if (from === status) {
    throw invalid(`this person is already ${status} — a move to the same stage is not a change`);
  }
  const allowed = LIFECYCLE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(status)) {
    throw conflict(
      `a ${from} cannot become ${status}` +
      (allowed.length ? ` — from ${from} the options are ${allowed.join(" or ")}` : "") +
      (status === "lead"
        ? ". ★ Nothing returns to `lead`: a lead is somebody who has not decided yet, and a person " +
          "who came back is `active` again, which keeps the history that makes them a returning client."
        : ""));
  }

  const r = await run(tx, db
    .updateTable("keystone.app_user")
    .set({ lifecycle_status: status, updated_at: sql`now()` })
    .where("id", "=", personId)
    .where("lifecycle_status", "=", from));
  // ★★ ZERO ROWS HERE MEANS SOMEBODY ELSE MOVED THEM BETWEEN THE READ AND THE WRITE. Saying so is
  //    the difference between "your change did not apply" and this project's signature silent
  //    success (D-17.19).
  if (r.rowCount === 0) {
    throw conflict(
      `this person was moved out of ${from} by somebody else while you were deciding — re-read and try again`);
  }

  const stageEvent = await emit(tx, {
    tenantId,
    topic: "people.person.stage_changed",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    // ★ STAGE 3 TASK 1 — same fact as payload's `changed_by` below, now also on the envelope.
    actor: userActor(actorUserId),
    // ★★ BOTH ENDS TRAVEL. "They became former" answers less than half of what anybody asks of this
    //    log; "they went from paused to former" is the fact.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ STAGE 3 TASK 3 — `reason` DROPPED. §12's own example IS this call site:
    //     `reason: "moved away"` is the exact free text the payload lint refuses. FIX ROUND 1, R46:
    //     it is RELOCATED, not lost — PersonActions asks for it, so it goes to
    //     `keystone.record_reason` just below, beside this event, never into the payload.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    payload: { from, to: status, changed_by: actorUserId },
  });
  await keepReason(tx, {
    tenantId, eventId: stageEvent.id, subjectType: "person", subjectId: personId,
    kind: "stage_change", reason: keptReason, createdBy: actorUserId,
  });

  // 21 Oct 2026 (the maintainer, decision 4): a team member leaving or coming back changes what a Pay as you go workspace owes; Stripe hears of it now, prorated, not at the next daily count
  { const { syncSeatsNow } = await import("../product/docustaySeatSync.mjs"); await syncSeatsNow(tx, { tenantId, why: `person_${status}` }); }
  return { id: personId, from, to: status };
}

/**
 * Run 6: is a phone number required for this person? the platform: always (the maintainer's ruling of 2 Oct 2026, unchanged). A DOCUSTAY workspace's team member (staff) is invited by email to sign documents, not texted, so for them the phone is optional.
 * Everyone else in a Docustay workspace (there are no clients there, but the rule is stated, not implied) and every the platform person keeps the requirement.
 */
/** Run 7: whether creating a person with this role in this workspace will refuse a missing phone (the role rule AND the practice's own required-fields list), so a screen can ask before the write does. */
export async function phoneNeededFor(tx, tenantId, role) {
  return (await phoneRequiredFor(tx, tenantId, role)) && (await requiredFor(tx, tenantId, "person")).includes("mobile_phone");
}

export async function phoneRequiredFor(tx, tenantId, role) {
  if (role !== "staff") return true;
  const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return !(t?.product === "docustay" || process.env.KEYSTONE_PRODUCT === "docustay");   // the same rule as the mail module's product key, stated here so people/ does not reach into mail/
}

/**
 * Invite a team member: create the staff row, and record that the invitation happened.
 * ★★ THERE IS NO `invite` TABLE — NAV 13/75 is ❌ "NO TABLE → ADDENDUM 4", and this function does not
 *    invent one. What it does is create the staff person and emit `people.person.invited`, so the
 *    fact that an invitation was extended is durable in the ONE place that can hold it today.
 * ★ The email itself is NOT sent here. Notifications consume the event (§X4 — sections never call
 *   each other), which is also why this cannot be the place that decides whether sending worked.
 */
export async function inviteTeamMember(tx, { tenantId, email, displayName, mobilePhone = null, staffRole = "member",
                                            actorUserId = null }) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A3.1 — THIS NO LONGER EMITS `people.person.invited` ITSELF. It passes `invite: true` and
  //     `createPerson` emits it, in the same transaction, for every role.
  //
  //   ★★ BEFORE A3.1 THIS WAS THE **ONLY** PATH THAT PRODUCED AN INVITATION, and it hardcodes
  //      `role: "staff"` — so a CLIENT, an ADOLESCENT or a PARENT could be created and there was no
  //      way to invite them at all. the maintainer's ruling closes that; keeping the emit here as well would
  //      have made TWO places that answer "was this person invited", and the notification consumer
  //      would have had to know about both.
  //   ★ What is left in this function is the thing that is genuinely its own: **a team member is
  //     staff, and staff have a rank.** That is the only difference between inviting a colleague
  //     and inviting a client, and it is the only difference this function now expresses.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  return createPerson(tx, {
    tenantId, email, displayName, mobilePhone, role: "staff", staffRole, firebaseUid: null,
    invite: true, actorUserId,
  });
}

/**
 * Change a staff member's rank.
 * ★★★ SEPARATE FROM updatePerson ON PURPOSE, AND IT EMITS ITS OWN TOPIC. `people.person.role_changed`
 *     exists so that an auditor asking "who was ever made an admin here" reads a handful of rows
 *     instead of every profile edit in the practice's history.
 */
// ★★★ FIX ROUND 1, I5 / F494 — the parameter used to be `changedByUserId`, a name
//     `routes/writes.mjs` never stamps (it stamps `actorUserId` only, last, from the session). So
//     `changed_by` on a RANK CHANGE — the most privileged write in this file — was whatever a
//     request body claimed, never verified. Renamed to `actorUserId`: a body still sending
//     `changedByUserId` is simply ignored, not read under any name.
export async function setStaffRole(tx, { tenantId, personId, staffRole, actorUserId = null, requestId = null }) {
  if (!STAFF_ROLES.includes(staffRole)) {
    throw invalid(`staff_role must be one of ${STAFF_ROLES.join(", ")} — got ${JSON.stringify(staffRole)}`);
  }
  // R13-D309: the Owner rank is the Owner's to give and to take. Admins hold staff_role.change (0190) for Members and Admins; without this an Admin could make
  // themself Owner, or demote the Owner, in one call. Asked in this transaction with a row lock on both people, so two changes cannot race past it.
  if (actorUserId) {
    const { rows: ranks } = await tx.query(`SELECT id, staff_role FROM keystone.app_user WHERE id = ANY($1::uuid[]) FOR UPDATE`, [[personId, actorUserId]]);
    const rankOf = (id) => ranks.find((x) => x.id === id)?.staff_role ?? null;
    if ((staffRole === "owner" || rankOf(personId) === "owner") && rankOf(actorUserId) !== "owner") throw forbidden("Only an Owner can make someone Owner or change an Owner's role.");
  }

  // ★★ `AND role = 'staff'` IS IN THE PREDICATE, NOT AN `if` ABOVE. Checking first would be a read
  //    followed by a write with a gap between them; putting it in the WHERE clause means a
  //    non-staff person matches zero rows and is refused below, in one statement.
  //    ★ It is also what keeps `staff_role_shape` satisfied: a client can never acquire a rank.
  // ★★★ TASK 7.13 — THE `previous` CTE RUNS ON THE PRE-UPDATE SNAPSHOT, IN THE SAME STATEMENT AS
  //     THE UPDATE, so `before` on the audit row below is the real old value under the same lock —
  //     never reconstructed from a separate read with a gap in between.
  let r;
  try {
    r = await tx.query(
      `WITH previous AS (
         SELECT staff_role FROM keystone.app_user WHERE id = $1 AND role = 'staff'
       )
       UPDATE keystone.app_user
          SET staff_role = $2, updated_at = now()
        WHERE id = $1 AND role = 'staff'
        RETURNING staff_role, (SELECT staff_role FROM previous) AS previous_staff_role`,
      [personId, staffRole]);
  } catch (e) {
    if (e.code === CHECK_VIOLATION) {
      // ★ 0010's enforce_super_admin_1() lives here: super_admin_1 outside the platform tenant is
      //   refused by the DATABASE, and this module does not duplicate that rule — it reports it.
      throw invalid(`the database refused that rank: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  if (r.rowCount === 0) {
    // ★ Deliberately one message for "no such person", "not in this tenant" and "not staff". The
    //   caller is a staff surface, so this is not an anonymous oracle — but naming which of the three
    //   it was would still tell them about rows RLS is hiding from them.
    throw notFound("no such staff member in this organisation");
  }

  const previousStaffRole = r.rows[0].previous_staff_role;

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 7.13 — A RANK CHANGE REWRITES THE GRANTS, IN THE SAME TRANSACTION AS THE RANK
  //     (F471: "the two systems drift after any rank change" — `app_user.staff_role` is the rank,
  //     `keystone.user_role` is what the permission resolver actually reads, and nothing kept them
  //     in step after the initial grant at creation).
  //   ★ ONLY THE BUILT-IN ROLES ARE REPLACED — a custom role a practice granted by hand is not a
  //     preset and is not silently dropped by a rank change.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await tx.query(
    `DELETE FROM keystone.user_role ur
       USING keystone.role ro
      WHERE ur.tenant_id = $1 AND ur.user_id = $2
        AND ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id AND ro.is_builtin`,
    [tenantId, personId]);

  // ★ Same tolerance as the grant at creation, above: a tenant that predates the roles being
  //   seeded is not thrown at — `scope_not_yet_configured` already covers it.
  const roleKey = STAFF_ROLE_TO_ROLE_KEY[staffRole];
  const { rows: rr } = await run(tx, db
    .selectFrom("keystone.role")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("key", "=", roleKey));
  if (rr.length === 1) {
    await tx.query(
      `INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
      [tenantId, personId, rr[0].id, actorUserId ?? null]);
  }

  await writeAudit(tx, {
    tenantId,
    action: "staff_role.changed",
    object: "person",
    subjectId: personId,
    before: { staff_role: previousStaffRole },
    after: { staff_role: staffRole },
    actorUserId,
    requestId,
  });

  await revokeSessionsForUser(tx, tenantId, personId, "role_changed");

  await emit(tx, {
    tenantId,
    topic: "people.person.role_changed",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    // ★ FIX ROUND 1, I5 — envelope and payload agree, both from the session only.
    actor: userActor(actorUserId),
    payload: { staff_role: staffRole, changed_by: actorUserId },
  });

  return { id: personId, staff_role: r.rows[0].staff_role };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.4 (`12-signup-first-run-people.md` §2, §3.3, §4) — THREE NEW WRITES, ADDED HERE
//     BECAUSE THIS IS THE ONE EXISTING HOME FOR EXACTLY THIS CLASS OF FUNCTION. The task's own file
//     list names `src/records/lists/people.mjs` and `src/routes/writes.mjs` but not this file —
//     these three follow `setLifecycleStatus`'s own shape immediately above (optimistic
//     UPDATE...WHERE the current value still holds, 404 before the transition question, 409 on a
//     stale write, `emit()` inside the same transaction) precisely because that is the ESTABLISHED
//     pattern for exactly this shape of change, and duplicating it inline in `routes/writes.mjs`
//     would fork it a second time. Flagged in this task's own report rather than silently expanded
//     without saying so.
//
// ★★★ NONE OF THE THREE CALLS `writeAudit`. §5 of the source spec says "audit (writeAudit, existing
//     person.edit action…)" for all three new topics below, but [MEASURED against
//     `src/permissions/audit.mjs:50-75`] `AUDIT_ACTIONS` is a FROZEN 25-member list (CT-042 — "the
//     number is the contract") and holds no `person.edit` member; calling `writeAudit` with one
//     would throw `AuditViolation` before any row committed. `setLifecycleStatus` and `updatePerson`
//     immediately above this comment — the two functions already doing this exact class of ordinary
//     person-field edit — call ONLY `emit()` and never `writeAudit` for the same reason: the EVENT is
//     this project's audit trail for an ordinary field edit; `keystone.audit_entry` is reserved for
//     the closed, more sensitive 25. Matching that real, working precedent rather than the spec's
//     inaccurate description of it.
//
// ★★★ A MEASURED GAP THIS TASK DOES NOT FIX: `assertMay`'s coarse, route-level owner resolution
//     (`src/permissions/assertMay.mjs:93`, `const subjectId = check.subjectId ?? body?.id ?? null;`)
//     reads `body.id`. This task's three routes — like the ALREADY-SHIPPED `/api/people/update` and
//     `/api/people/stage` before them — carry the target person as `body.personId`, per this spec's
//     own §2 wire contract. `body.id` is therefore always `undefined` for all three, so the coarse
//     gate always resolves `ownerId = null`, and `keystone.scope_allows('owned', null, viewer)`
//     (`0066_roles_permissions.sql:191`) always answers `false` for a Coach — REGARDLESS of whether
//     the target person's real `owner_user_id` matches them. A Coach's OWN successful case in the
//     spec`s "Coach, adolescent consent + assignment" acceptance scenario therefore cannot pass`
//     through the coarse gate as literally wired today; only Admin/Owner (`scope: everything`, which
//     ignores `ownerId` entirely) is unaffected. This is a PRE-EXISTING, systemic gap — not
//     introduced here — and fixing it means editing `src/permissions/assertMay.mjs`, a file shared
//     by every write route in the application and not on this task's file list. Not silently worked
//     around; reported in this task's own build report for `opus-tester` to route into a fix task.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Set an adolescent's standing guardian-consent status (PeopleAdolescents). NOT the per-booking
 * consent gate (spec 03b/CT-116, which reads this column as one input alongside an executed
 * document) — this is the STANDING fact a coach/admin sees on the person before ever proposing a
 * booking. §3.3's own CHECK (`app_user_consent_status_adolescent_only`, migration 0231) is the
 * database's own backstop; this function asks the same question first so the caller gets a sentence
 * instead of a constraint name.
 */
export async function setConsentStatus(tx, { tenantId, personId, status, actorUserId = null }) {
  if (!personId) throw invalid("setConsentStatus needs a personId");
  if (!CONSENT_STATUSES.includes(status)) {
    throw invalid(
      `consent status must be one of ${CONSENT_STATUSES.join(" · ")} — got ${JSON.stringify(status)}`);
  }

  const current = (await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["role", "consent_status"])
    .where("id", "=", personId))).rows[0];
  // ★ 404 BEFORE anything else — under RLS a cross-tenant id and a deleted one present identically.
  if (!current) throw notFound("no such person in this organisation");
  if (current.role !== "adolescent_client") {
    throw invalid(
      "consent status is only meaningful for an adolescent client — this person is not one",
      { field: "personId" });
  }

  const from = current.consent_status;
  if (from === status) {
    throw invalid(`this person's consent status is already ${status} — a change to the same status is not a change`);
  }

  const r = await tx.query(
    `UPDATE keystone.app_user
        SET consent_status = $2, updated_at = now()
      WHERE id = $1 AND role = 'adolescent_client' AND consent_status IS NOT DISTINCT FROM $3`,
    [personId, status, from]);
  // ★★ ZERO ROWS HERE MEANS SOMEBODY ELSE CHANGED IT BETWEEN THE READ AND THE WRITE — the same
  //    "your change did not apply" distinction `setLifecycleStatus` makes, above.
  if (r.rowCount === 0) {
    throw conflict(
      `this person's consent status was changed by somebody else while you were deciding — re-read and try again`);
  }

  await emit(tx, {
    tenantId,
    topic: "people.person.consent_status_changed",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    actor: userActor(actorUserId),
    payload: { from, to: status },
  });

  return { id: personId, from, to: status };
}

/**
 * Assign — or clear (`ownerUserId: null`) — the staff member who owns a non-staff person: a coach
 * for a client/adolescent, or an owner for a lead. Reuses the EXISTING `app_user.owner_user_id`
 * (`0071_record_ownership.sql`) — no new column, this function is the missing WRITE PATH (§3.3).
 * ★ A re-assignment to the SAME owner is accepted, not refused as a no-op — a Coach re-confirming a
 *   person they already own is a legitimate, self-confirming call (§12's own acceptance scenario),
 *   unlike `setConsentStatus`/`setLifecycleStatus` above, where repeating the current value is a
 *   caller error. This function's own "did the row actually still say what I read" check is the
 *   optimistic `WHERE owner_user_id IS NOT DISTINCT FROM $3` below, not a same-value refusal.
 */
export async function assignPerson(tx, { tenantId, personId, ownerUserId = null, actorUserId = null }) {
  if (!personId) throw invalid("assignPerson needs a personId");

  const current = (await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["role", "owner_user_id"])
    .where("id", "=", personId))).rows[0];
  if (!current) throw notFound("no such person in this organisation");
  // ★ A staff row owns ITSELF, set automatically by `app_user_staff_owns_self_trg` (0071) — this
  //   route reassigns clients and leads, not staff, so a staff subject is refused rather than
  //   silently accepted and then overridden by the trigger the next time the row is touched.
  if (current.role === "staff") {
    throw invalid(
      "a staff member's owner is themselves, set automatically — this route assigns clients and leads, not staff",
      { field: "personId" });
  }

  if (ownerUserId !== null) {
    const staffRow = (await run(tx, db
      .selectFrom("keystone.app_user")
      .select(sql`1`.as("_one"))
      .where("id", "=", ownerUserId)
      .where("role", "=", "staff"))).rows[0];
    if (!staffRow) {
      throw invalid("ownerUserId is not staff in this organisation", { field: "ownerUserId" });
    }
  }

  const from = current.owner_user_id;
  const r = await tx.query(
    `UPDATE keystone.app_user
        SET owner_user_id = $2, updated_at = now()
      WHERE id = $1 AND owner_user_id IS NOT DISTINCT FROM $3`,
    [personId, ownerUserId, from]);
  if (r.rowCount === 0) {
    throw conflict(
      `this person's assignment was changed by somebody else while you were deciding — re-read and try again`);
  }

  await emit(tx, {
    tenantId,
    topic: "people.person.assigned",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    actor: userActor(actorUserId),
    payload: { from, to: ownerUserId },
  });

  return { id: personId, from, to: ownerUserId };
}

/**
 * Set a lead's next step (PeopleLeads) — free text, staff-set, no enum (§3.3: "a next step is
 * whatever the coach actually needs to do"). Settable on any person, not restricted to `lifecycle_
 * status = 'lead'` — migration 0231 carries no CHECK restricting it, matching that exact choice.
 */
export async function setLeadNextStep(tx, { tenantId, personId, nextStep, actorUserId = null }) {
  if (!personId) throw invalid("setLeadNextStep needs a personId");
  if (typeof nextStep !== "string" || !nextStep.trim()) {
    throw invalid("nextStep cannot be blank");
  }
  const trimmed = nextStep.trim();

  const current = (await run(tx, db
    .selectFrom("keystone.app_user")
    .select("lead_next_step")
    .where("id", "=", personId))).rows[0];
  if (!current) throw notFound("no such person in this organisation");

  const from = current.lead_next_step;
  const r = await tx.query(
    `UPDATE keystone.app_user
        SET lead_next_step = $2, updated_at = now()
      WHERE id = $1 AND lead_next_step IS NOT DISTINCT FROM $3`,
    [personId, trimmed, from]);
  if (r.rowCount === 0) {
    throw conflict(
      `this person's next step was changed by somebody else while you were deciding — re-read and try again`);
  }

  // ★ THE FIELD NAME, NOT THE VALUE — same rule `updatePerson`'s payload states, above: a consumer
  //   needs to know something moved, not a permanent copy of free text in an append-only table.
  await emit(tx, {
    tenantId,
    topic: "people.person.lead_next_step_set",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    actor: userActor(actorUserId),
    payload: { changed: true },
  });

  return { id: personId, nextStep: trimmed };
}

/**
 * Set a lead's stage (e.g., moved to client).
 *
 * ★ Only settable on a person whose lifecycle_status is 'lead'. If stage is 'became_client',
 *   also sets lifecycle_status to 'active'.
 */
export async function setLeadStage(tx, { tenantId, personId, stage, actorUserId = null }) {
  if (!personId) throw invalid("setLeadStage needs a personId");
  if (typeof stage !== "string" || !stage.trim()) {
    throw invalid("stage cannot be blank");
  }

  const current = (await run(tx, db
    .selectFrom("keystone.app_user")
    .select("lifecycle_status")
    .where("id", "=", personId))).rows[0];
  if (!current) throw notFound("no such person in this organisation");

  if (current.lifecycle_status !== "lead") {
    throw invalid("stage can only be set on a lead");
  }

  const r = await run(tx, db
    .updateTable("keystone.app_user")
    .set({ lead_stage: stage.trim(), updated_at: sql`now()` })
    .where("id", "=", personId)
    .returning("id"));

  if (r.rowCount === 0) {
    throw conflict(
      `this person was moved out of lead status by somebody else while you were deciding — re-read and try again`);
  }

  // ★ If stage is 'became_client', also set lifecycle_status to 'active'
  if (stage.trim() === "became_client") {
    await setLifecycleStatus(tx, { tenantId, personId, status: "active", actorUserId });
  }

  await emit(tx, {
    tenantId,
    topic: "people.person.stage_changed",
    emittedBy: SECTION,
    subjectType: "person",
    subjectId: personId,
    actor: userActor(actorUserId),
    payload: { stage: stage.trim() },
  });

  return { id: personId, stage: stage.trim() };
}

/**
 * Read lead board data — returns leads grouped by stage, scoped to what the viewer can see.
 *
 * ★ Each row appears only when the viewer has 'view' permission on that person, matching
 *   the same per-row scoping pattern other person-list reads use.
 */
export async function readLeadBoard(tx, { tenantId, viewerId }) {
  if (!viewerId) throw invalid("readLeadBoard needs a viewerId");

  // ★ Use the same scoped person query pattern, respecting viewer's permissions
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "display_name", "lead_stage", "lead_next_step", "owner_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("lifecycle_status", "=", "lead")
    .where("archived_at", "is", null));

  // ★ Filter rows based on viewer's permission to view each person
  const result = [];
  for (const row of rows) {
    // ★ Check if viewer may view this person
    const mayView = await tx.query(
      `SELECT keystone.user_may($1, 'person', 'view', $2)`,
      [viewerId, row.owner_user_id]);

    if (mayView.rows[0] && mayView.rows[0].user_may) {
      result.push({
        id: row.id,
        display_name: row.display_name,
        lead_stage: row.lead_stage,
        lead_next_step: row.lead_next_step,
        owner_user_id: row.owner_user_id,
      });
    }
  }

  return result;
}

/**
 * ★★★ TASK 12.5 — `12-signup-first-run-people.md` §3.7. FirstRunHome's "Remove samples" action.
 *
 * Archives every `is_sample = true, archived_at IS NULL` person in the tenant, looping the SAME
 * `archiveRecord` writer (`src/records/archive.mjs`) every other archivable object already uses —
 * §3.7's own framing: "no hard delete anywhere in this codebase, and this spec does not introduce
 * the first one." Archived rows disappear from every list automatically via `scoped()`'s existing
 * `archived_at IS NULL` predicate — no list descriptor changes needed for this.
 *
 * ★ `object: "person"` — the `ARCHIVABLE` KEY (`src/records/archive.mjs`), not the table name
 *   `app_user` that §3.7's own prose literally quotes. [MEASURED against `archive.mjs`'s own
 *   `ARCHIVABLE` map] `archiveRecord(tx, { object: "app_user", ... })` throws — `"app_user"` is not
 *   one of its nine keys; the key for that table is `"person"`. Read as a spec-text/code mismatch,
 *   not a design choice: `"person"` is what actually "reuses `archiveRecord`, already supports
 *   `app_user`" the way §3.7's own sentence describes.
 *
 * ★★ IDEMPOTENT BY COUNT, NOT BY REFUSAL — unlike `archiveRecord` itself (idempotent by 404 on a
 *    single id), a repeat call here after every sample is already gone finds zero matching rows and
 *    returns `{removed:0}`, a 200, not an error. §12's own acceptance scenario is explicit: "a
 *    repeat call with a NEW idempotency key → 200 {removed:0} (idempotent no-op, not an error)" —
 *    this task follows that over §2's route-table gloss, which lists a 409 "Samples are already
 *    removed" the detailed scenario itself does not produce; see this task's own build report.
 */
export async function removeSamples(tx, { tenantId, actorUserId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("is_sample", "=", true)
    .where("archived_at", "is", null));

  const removedIds = [];
  for (const row of rows) {
    await archiveRecord(tx, {
      tenantId, object: "person", id: row.id, actorUserId, reason: "sample removed",
    });
    removedIds.push(row.id);
  }

  // ★ ONE event for the whole call, not one per archived person — each archived person already gets
  //   its own `people.person.archived` from `archiveRecord` above (subject is a sample person, so
  //   that event is already `sample:true` and suppressed from outbound delivery, same chain §3.6
  //   documents). This event's subject is the ACTOR (the Owner who clicked "Remove samples"), not a
  //   sample row — the tenant's own action, not itself a sample event, same precedent
  //   `provisioning.questions.answered` sets in `src/routes/signup.mjs`.
  await emit(tx, {
    tenantId,
    topic: "provisioning.samples.removed",
    emittedBy: "provisioning",
    subjectType: actorUserId ? "person" : null,
    subjectId: actorUserId ?? null,
    actor: userActor(actorUserId),
    payload: { removed: removedIds.length, personIds: removedIds },
  });

  return { removed: removedIds.length };
}
