// P1.13 — ZOD VALIDATION AT EVERY BOUNDARY.
//
// ★ "Boundary" means every place untrusted data ENTERS the process, not just HTTP request bodies:
//     HTTP body · query string · path params · webhook payloads · QUEUE JOB PAYLOADS
//   ★★ The queue one is the easy miss. A job envelope looks internal because *we* wrote it — but
//   it was serialised by a previous deploy, possibly a different version, and has been sitting in
//   a queue. It is untrusted input with a friendly face.
//
// ★ STRICT BY DEFAULT. Unknown keys are an ERROR, not silently stripped. A silently-dropped field
// is how a rename ships as a no-op: the caller sends `timeZone`, the schema wants `timezone`, the
// value vanishes, and nothing anywhere says so.

import { z } from "zod";
import { invalid } from "./errors.mjs";
import { isValidTimezone } from "../health/index.mjs";
import { validateSubdomain } from "../provisioning/subdomain.mjs";
import { SHAPES } from "../nav/groups.mjs";

/**
 * Parse `data` against `schema`, or throw a VALIDATION AppError carrying a machine-readable
 * list of field paths. The detail is safe to return: it is 400-class, and it describes the
 * REQUEST, never internal state.
 */
export function parse(schema, data, what = "request") {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.error.issues.map((i) => ({
    path: i.path.join(".") || "(root)",
    code: i.code,
    message: i.message,
  }));
  throw invalid(`invalid ${what}`, { issues });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives. Defined once so a rule cannot drift between two boundaries.
// ─────────────────────────────────────────────────────────────────────────────
export const uuid = z.string().uuid();

// ★★ IANA timezone — DELIBERATELY THE SAME FUNCTION P1.17's STARTUP ASSERTION USES.
//
// It is imported, not reimplemented. Two copies of a validation rule is how the boundary comes to
// accept a value the startup check later rejects — the service then refuses to boot because of a
// row its own API wrote. This project already has a measured instance of exactly that shape
// ("the two enforcement paths disagree" in the legacy document system), so it is not hypothetical.
//
// ★ The rule is stricter than "ICU parses it", and the reason is measured: ICU accepts "EST" and
// resolves it to America/Panama, which has NO DAYLIGHT SAVING — an hour wrong all summer, silently.
// See the long note in src/health/index.mjs.
export const ianaTimezone = z
  .string()
  .min(1)
  .refine((tz) => isValidTimezone(tz), {
    message: "not a canonical IANA timezone (abbreviations like EST/PST are ambiguous — use e.g. America/New_York)",
  });

export const email = z.string().email().max(320);

// §K2: the four portals. The role decides which portal renders; ★ §K3 — it is NEVER the security
// boundary on its own. RLS is.
const portalRole = z.enum(["staff", "adult_client", "adolescent_client", "parent"]);

/** `.strict()` everywhere — see the note above about silently-dropped fields. */
export const CreateTenant = z
  .object({
    // ★★ DELEGATES to validateSubdomain — it does NOT restate the rule. A second copy of a
    // validation rule is how the boundary comes to accept a name provisioning will later reject,
    // which is the partial state P2.5 exists to prevent. Same mistake as the timezone rule, which
    // was already fixed the same way; this one was caught before it could bite.
    slug: z.string().superRefine((v, ctx) => {
      const r = validateSubdomain(v);
      for (const f of r.failures) {
        ctx.addIssue({ code: "custom", message: `${f.explain} (${f.system})` });
      }
    }),
    name: z.string().min(1).max(200),
    timezone: ianaTimezone,
  })
  .strict();

export const CreateUser = z
  .object({
    email,
    displayName: z.string().min(1).max(200),
    role: portalRole,
  })
  .strict();

// ★ The FIRST admin of a new tenant is staff BY DEFINITION — there is nobody else yet to grant
// anything. So `role` is not an input here: `.strict()` makes passing one a 400 rather than a
// value that is accepted and then silently overwritten. Accepting a field and ignoring it is the
// same silently-dropped-field defect this file's header warns about, and it cost a red test.
export const CreateAdminUser = z
  .object({
    email,
    displayName: z.string().min(1).max(200),
  })
  .strict();

// ★★★ TASK 12.3 — `12-signup-first-run-people.md` §3.8. A NEW `.strict()` schema, not a loosening
// of `CreateTenant`/`CreateAdminUser` above (§1's framing: "the fix is a new schema and route, not
// loosening the two frozen ones"). `POST /api/signup/questions` parses the SignupQuestions form
// against this.
// ★ TOUCH-UP · WORKSTREAM 12, TY 23 SEP 2026 — widened from the original 7-value coaching-only list
//   to the platform's 16 real verticals (measured against example.com) plus 'other'. Migration
//   0341 widens `tenant_intake.coaching_type`'s own CHECK to the identical set — this schema and
//   that constraint must be read together, not just this one.
// ★ PART 4.5 [TY, RULED 23 Sep 2026] — `shape` joins the other three at signup, replacing the old,
//   separate "what do you need the platform for?" step (WORKSTREAM 12's `SignupNeedsAnswers`, deleted).
//   Validated against the same `SHAPES` the nav filter and the settings control both read.
export const SignupQuestionsAnswers = z
  .object({
    shape: z.enum(SHAPES),
    coachingType: z.enum([
      "coaching", "recovery_coaching", "tutoring", "personal_training", "consulting",
      "salon_and_spa", "nutrition", "music_and_arts", "doula_and_birth", "pet_services",
      "photography", "legal_and_accounting", "inspection_and_trades", "language_and_translation",
      "driving_instruction", "event_planning", "other",
    ]),
    teamSize: z.enum(["just_me", "small", "large"]),
    movingFrom: z.enum(["no", "carepatron", "simplepractice", "square", "spreadsheet", "other"]),
    sampleClientsRequested: z.boolean(),
  })
  .strict();

/** ★ Queue jobs get a schema too. See the note at the top of this file. */
export const QueueJob = z
  .object({
    tenantId: uuid,
    kind: z.string().min(1).max(100),
    payload: z.unknown(),
    attempt: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export { z };
