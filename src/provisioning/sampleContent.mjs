// @ts-check
// src/provisioning/sampleContent.mjs — Task 12.3, NEW FILE.
// `12-signup-first-run-people.md` §3.5 (starter services) / §3.6 (sample clients).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THIS FILE DOES AND DOES NOT DO. Both exports are called once, from inside
//     `POST /api/signup/questions`'s own transaction (`src/routes/signup.mjs`) — never a route of
//     their own. Neither writes a `keystone.price` row and neither creates a real login: a starter
//     service is priced at `price_minor = 0` (a schema-satisfying placeholder, §3.5) with NO
//     `keystone.price` row, so the onboarding checklist's `services_priced` count (which reads
//     `keystone.price`, a separate, versioned table — `src/routes/index.mjs`) correctly keeps
//     reporting "needs you" until the practice actually prices them. A sample client is created with
//     `firebaseUid: null, invite: false` — the SAME safety rail `0214_app_user_is_sample.sql`
//     documents ("never set by a client-facing login") — so a sample person can never receive an
//     invite email or sign in, by construction, not by a later filter.
//
// ★★ NO NEW SUPPRESSION LOGIC. Sample people flow through the EXISTING `is_sample` chain
//    (§3.6, MEASURED): `src/events/outbox.mjs` derives `event.sample` from it at emit time and never
//    delivers a sample event outside the process; `src/money/charge.mjs` refuses a charge against a
//    sample payer before any Stripe call; `src/email/send.mjs` suppresses a send to a sample
//    recipient before any provider call. This file adds none of that — it only creates rows with the
//    flag those chains already read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createPerson } from "../people/writes.mjs";
import { linkGuardian } from "../people/guardians.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ★ TOUCH-UP · WORKSTREAM 12, TY 23 SEP 2026 — WIDENED TO THE 17-VALUE VOCABULARY MIGRATION 0341
//   MOVES `tenant_intake.coaching_type` TO. [MEASURED] every one of the old 7 keys ('life',
//   'recovery', 'health_and_wellness', 'fitness', 'family_and_parenting', 'career', 'other') would
//   throw here the moment `SignupQuestionsAnswers` (`src/http/validate.mjs`) started accepting the
//   16 real verticals instead — `POST /api/signup/questions` calls `createStarterServices`
//   unconditionally, so this table has to cover every value the validator now accepts or every
//   signup outside 'other' fails at this line. 0341's own UPDATE remaps existing rows onto these
//   same 17 keys, so no already-answered practice still holds an old one.
/** §3.5 — three starter services per coaching type, first two 50 minutes, the third 20. */
export const STARTER_SERVICE_NAMES = Object.freeze({
  coaching:                 ["Individual coaching session", "Goal-setting session", "Check-in call"],
  recovery_coaching:        ["Individual recovery session", "Family session", "Check-in call"],
  tutoring:                 ["Tutoring session", "Progress review", "Check-in call"],
  personal_training:        ["Personal training session", "Fitness assessment", "Check-in call"],
  consulting:               ["Consulting session", "Strategy session", "Check-in call"],
  salon_and_spa:            ["Appointment", "Treatment session", "Check-in call"],
  nutrition:                ["Nutrition consultation", "Follow-up session", "Check-in call"],
  music_and_arts:           ["Lesson", "Practice session", "Check-in call"],
  doula_and_birth:          ["Prenatal visit", "Birth support session", "Check-in call"],
  pet_services:             ["Appointment", "Follow-up visit", "Check-in call"],
  photography:              ["Session booking", "Consultation", "Check-in call"],
  legal_and_accounting:     ["Consultation", "Review session", "Check-in call"],
  inspection_and_trades:    ["Inspection", "Follow-up visit", "Check-in call"],
  language_and_translation: ["Lesson", "Practice session", "Check-in call"],
  driving_instruction:      ["Driving lesson", "Test prep session", "Check-in call"],
  event_planning:           ["Consultation", "Planning session", "Check-in call"],
  other:                    ["Individual session", "Consultation", "Check-in call"],
});

/** §3.5 — "duration_minutes: 50 for the first two of each triple, 20 for 'Check-in call'/'Resume review'." */
function durationMinutesFor(name) {
  return name === "Check-in call" || name === "Resume review" ? 20 : 50;
}

/**
 * §3.5 — insert exactly 3 `keystone.service` rows for `coachingType`, price_minor = 0, NO
 * `keystone.price` row. Not `items/writes.mjs`'s `createService` — that function also writes a
 * `keystone.price` row unconditionally, which is exactly what a starter service must not have.
 *
 * ★ No event is emitted here. `12-signup-first-run-people.md` §5's event table lists no topic for
 *   starter-service creation, and `emit()`'s own rule ("a section may only emit its own topics",
 *   §X4) would refuse an `items.*` topic from this, a `provisioning`-owned module anyway.
 */
export async function createStarterServices(tx, { tenantId, coachingType }) {
  const names = STARTER_SERVICE_NAMES[coachingType];
  if (!names) {
    throw new Error(
      `createStarterServices: "${coachingType}" is not a known coaching type — one of ` +
      `${Object.keys(STARTER_SERVICE_NAMES).join(", ")}`);
  }

  // F30 — idempotent: a practice that already has any service (the tenant is RLS-scoped) is already set up, so nothing is added
  if ((await tx.query(`SELECT EXISTS(SELECT 1 FROM keystone.service) AS x`)).rows[0]?.x === true) return [];

  const created = [];
  for (const name of names) {
    const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
    const durationMinutes = durationMinutesFor(name);
    await run(tx, db
      .insertInto("keystone.service")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        name: name ?? null,
        price_minor: 0,
        duration_minutes: durationMinutes ?? null,
        currency: "USD",
        bookable: true,
      }));
    created.push({ id, name, durationMinutes });
  }
  return created;
}

/**
 * §3.6 — a fixed set of 3 sample people: 1 adult client, 1 adolescent + 1 parent guardian pair.
 * Only called when `sampleClientsRequested === true`. Reuses `createPerson` (`isSample: true`) and
 * `linkGuardian` unchanged — both already emit their own events (`people.person.created`,
 * `people.guardian.linked`) under the `people` section, with `sample` auto-derived from the row's
 * own `is_sample` column at emit time. Nothing here duplicates that.
 *
 * Names carry the literal word "Sample" in the DISPLAYED name, not only in the `is_sample` flag —
 * MOCKUPS §21:603: "labelled Sample everywhere", a fact about the row a reader sees, not only a flag
 * a reader might not connect to it.
 */
export async function createSampleClients(tx, { tenantId, actorUserId }) {
  // ★ Fixed addresses, not generated — uniqueness only has to hold WITHIN one tenant
  //   (`app_user_tenant_email_key` is `(tenant_id, lower(email))`), and `tenant_intake`'s own PRIMARY
  //   KEY already makes this whole route a one-time call per tenant (§3.1), so there is no retry
  //   inside one tenant this needs to guard against. `.invalid` per RFC 2606 — never a real mailbox.
  // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON — createPerson
  //   (src/people/writes.mjs) now enforces this unconditionally. `555-01XX` is the same reserved,
  //   never-real-service-assigned fictional-use block (NANP/FCC) that `.invalid` is for email —
  //   three distinct numbers, not one reused three times, matching the three distinct `.invalid`
  //   addresses right above.
  const adult = await createPerson(tx, {
    tenantId, email: "sample.client@example.invalid", mobilePhone: "+15550101000",
    displayName: "Sample Client (Alex Rivera)", role: "adult_client",
    firebaseUid: null, invite: false, actorUserId, isSample: true,
  });
  const adolescent = await createPerson(tx, {
    tenantId, email: "sample.adolescent@example.invalid", mobilePhone: "+15550101001",
    displayName: "Sample Adolescent (Sam Lee)", role: "adolescent_client",
    firebaseUid: null, invite: false, actorUserId, isSample: true,
  });
  const parent = await createPerson(tx, {
    tenantId, email: "sample.parent@example.invalid", mobilePhone: "+15550101002",
    // ★ 0533 removed the `parent` role (Parent is a guardian LINK, made below) — this passed "parent" and threw, so sample-client signup failed at the third person
    displayName: "Sample Parent (Jordan Lee)", role: "adult_client",
    firebaseUid: null, invite: false, actorUserId, isSample: true,
  });

  await linkGuardian(tx, {
    tenantId, childUserId: adolescent.id, guardianUserId: parent.id,
    relationship: "parent", actorUserId,
  });

  return { adult, adolescent, parent };
}
