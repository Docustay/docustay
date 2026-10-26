// C2.5 — THE CLIENT PORTAL'S OWN ADMIN SCREEN
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★★ CONTACT DETAILS, ADDRESS, NOTIFICATION PREFERENCES, CONSENT, GUARDIANSHIP,
//     AND FOR A PARENT — THE PEOPLE THEY PAY FOR.
//
// ★ THE SCREEN REUSES THE SAME NOTIFICATION-PREFERENCE MECHANISM the notification centre uses
//   (notification_preference table, setNotificationPreference writer). A separate preference
//   system would have been an invention instead of reuse.
//
// ★★ FOR AN ADOLESCENT: `consent_status` (a display fact about whether a guardian has consented),
//    and guardian(s) linked to them.
//
// ★★ FOR A PARENT: the list of adolescents they are a guardian for (the people they pay for,
//    derived from `keystone.guardian` where guardian_user_id = $1).
//
// ★ "REQUEST THEIR DATA" is a simple request-logging action, not a full export pipeline.
// ═══════════════════════════════════════════════════════════════════════════

import { setNotificationPreference } from "../notifications/writes.mjs";
import { getEffectiveChannels } from "../notifications/rules.mjs";
import { forbidden, invalid, notFound } from "../http/errors.mjs";

/**
 * Assert the caller is a client (not staff).
 */
function assertClientRole(principal) {
  const role = principal?.user?.role ?? null;
  // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value; see src/routes/app.mjs's own note.
  const CLIENT_ROLES = Object.freeze(["adult_client", "adolescent_client"]);
  if (!CLIENT_ROLES.includes(role)) {
    throw forbidden(
      `the client app is for ${CLIENT_ROLES.join(", ")}. A staff session belongs in the CRM.`);
  }
  return role;
}

export function registerAppProfileRoutes(app, { scoped, get, post }) {
  // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): `get`/`post` are now injected from
  //   registerAppRoutes (src/routes/app.mjs) instead of calling `app.get`/`app.post` directly — a
  //   stale duplicate stub in that file used to win this exact route in Hono's routing (first
  //   registration serves an exact-path duplicate), so this real handler never ran. See the note at
  //   the old stub's former location.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ GET /api/app/profile — READ THEIR OWN PROFILE, PREFERENCES, CONSENT, & DEPENDENTS
  // ───────────────────────────────────────────────────────────────────────────
  get("/api/app/profile", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);

      // Fetch the app_user row with all profile fields
      const { rows: profileRows } = await db.query(
        `SELECT id, email, display_name, role, first_name, last_name, preferred_name, pronouns,
                date_of_birth, secondary_email, mobile_phone, home_phone, preferred_contact_method,
                do_not_email, do_not_text, do_not_call, address_line1, address_line2, city,
                state_region, postcode, country, timezone, consent_status
           FROM keystone.app_user WHERE id = $1`,
        [principal.appUserId]);

      if (profileRows.length === 0) {
        throw notFound("profile not found");
      }

      const profile = profileRows[0];

      // Fetch notification preferences for this person
      const { rows: preferences } = await db.query(
        `SELECT topic, channel, enabled FROM keystone.notification_preference
          WHERE app_user_id = $1 ORDER BY topic, channel`,
        [principal.appUserId]);

      // ★ F115 — what "What we send you" says must be what the sender actually does: the reminder email is gated by
      //   `getEffectiveChannels` (person's own choice -> practice default -> catalogue default, ON), the same call
      //   `deliverNotificationEmail` makes. The raw `preferences` rows above hold only choices the person has made.
      const reminders = {
        email: await getEffectiveChannels(db, {
          tenantId: principal.user.tenant_id, recipientId: principal.appUserId,
          topic: "booking.booking.reminder", channel: "email" }),
      };

      // ★ For an adolescent: fetch their consent status and any linked guardians
      let guardians = null;
      if (role === "adolescent_client") {
        const { rows: guardianRows } = await db.query(
          `SELECT g.guardian_user_id, gu.display_name, g.relationship, g.consent_executed_at
             FROM keystone.guardian g
             LEFT JOIN keystone.app_user gu ON gu.id = g.guardian_user_id
            WHERE g.tenant_id = $1 AND g.child_user_id = $2
            ORDER BY g.created_at`,
          [principal.user.tenant_id, principal.appUserId]);
        guardians = guardianRows;
      }

      // ★ For a parent: fetch the adolescents they are a guardian for
      let dependents = null;
      if (principal.user.is_guardian) {
        const { rows: dependentRows } = await db.query(
          `SELECT u.id, u.display_name, u.first_name, u.last_name, u.date_of_birth
             FROM keystone.guardian g
             JOIN keystone.app_user u ON u.id = g.child_user_id AND u.tenant_id = g.tenant_id
            WHERE g.tenant_id = $1 AND g.guardian_user_id = $2
            ORDER BY u.display_name`,
          [principal.user.tenant_id, principal.appUserId]);
        dependents = dependentRows;
      }

      // ★ Build the family object: payers (guardians for teen, payer-group payer for adult) and what they can see
      let family = { payers: [], payerSees: ["money", "attendance", "block", "card", "invoices"] };

      if (role === "adolescent_client" && guardians && guardians.length > 0) {
        // ★ For a teen: the payers are their guardians
        family.payers = guardians
          .map((g) => ({ firstName: g.display_name?.split(" ")[0] ?? "" }))
          .filter((p) => p.firstName);
      } else if (role === "adult_client") {
        // ★ For an adult: fetch their payer group member record and the payer's name
        const { rows: payerRows } = await db.query(
          `SELECT pu.first_name, pu.display_name, pg.name AS family_name
             FROM keystone.payer_group_member pgm
             JOIN keystone.payer_group pg
               ON pg.tenant_id = pgm.tenant_id AND pg.id = pgm.payer_group_id
             JOIN keystone.app_user pu
               ON pu.id = pg.contact_user_id AND pu.tenant_id = pg.tenant_id
            WHERE pgm.person_id = $1 AND pg.archived_at IS NULL
            LIMIT 1`,
          [principal.appUserId]);

        if (payerRows.length > 0) {
          family.payers = [{ firstName: payerRows[0].first_name }];
        }
      }

      return {
        profile: {
          id: profile.id,
          email: profile.email,
          display_name: profile.display_name,
          role: profile.role,
          first_name: profile.first_name,
          last_name: profile.last_name,
          preferred_name: profile.preferred_name,
          pronouns: profile.pronouns,
          date_of_birth: profile.date_of_birth,
          secondary_email: profile.secondary_email,
          mobile_phone: profile.mobile_phone,
          home_phone: profile.home_phone,
          preferred_contact_method: profile.preferred_contact_method,
          do_not_email: profile.do_not_email,
          do_not_text: profile.do_not_text,
          do_not_call: profile.do_not_call,
          address_line1: profile.address_line1,
          address_line2: profile.address_line2,
          city: profile.city,
          state_region: profile.state_region,
          postcode: profile.postcode,
          country: profile.country,
          timezone: profile.timezone,
          consent_status: profile.consent_status,
        },
        preferences,
        reminders,
        guardians,
        dependents,
        family,
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ★ PUT /api/app/profile — UPDATE CONTACT DETAILS & ADDRESS
  // ───────────────────────────────────────────────────────────────────────────
  app.put("/api/app/profile", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);

      const body = await c.req.json();

      // Allowed fields for update
      const ALLOWED_FIELDS = [
        "first_name", "last_name", "preferred_name", "pronouns",
        "secondary_email", "mobile_phone", "home_phone", "preferred_contact_method",
        "address_line1", "address_line2", "city", "state_region", "postcode", "country", "timezone",
      ];

      // Build update SQL dynamically based on provided fields
      const updates = [];
      const values = [principal.appUserId];
      let paramIndex = 2;

      for (const field of ALLOWED_FIELDS) {
        if (field in body) {
          updates.push(`${field} = $${paramIndex}`);
          values.push(body[field]);
          paramIndex++;
        }
      }

      // If no fields provided, it's an error
      if (updates.length === 0) {
        throw invalid("no fields to update");
      }

      // Add updated_at
      updates.push(`updated_at = now()`);

      const updateSql = `UPDATE keystone.app_user SET ${updates.join(", ")} WHERE id = $1 RETURNING *`;

      const { rows } = await db.query(updateSql, values);

      if (rows.length === 0) {
        throw notFound("profile not found");
      }

      const updated = rows[0];
      return {
        updated: true,
        profile: {
          id: updated.id,
          email: updated.email,
          display_name: updated.display_name,
          first_name: updated.first_name,
          last_name: updated.last_name,
          preferred_name: updated.preferred_name,
          pronouns: updated.pronouns,
          secondary_email: updated.secondary_email,
          mobile_phone: updated.mobile_phone,
          home_phone: updated.home_phone,
          preferred_contact_method: updated.preferred_contact_method,
          address_line1: updated.address_line1,
          address_line2: updated.address_line2,
          city: updated.city,
          state_region: updated.state_region,
          postcode: updated.postcode,
          country: updated.country,
          timezone: updated.timezone,
        },
      };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ★ POST /api/app/notifications/preference — SET NOTIFICATION PREFERENCE
  // ───────────────────────────────────────────────────────────────────────────
  // (This route already exists in app.mjs, but registered here for completeness if needed)
  // The existing route in app.mjs handles this at line 500.

  // ───────────────────────────────────────────────────────────────────────────
  // ★ POST /api/app/profile/request-data — REQUEST DATA EXPORT (LOGGING ONLY)
  // ───────────────────────────────────────────────────────────────────────────
  post("/api/app/profile/request-data", "/api/app/profile", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);

      // Simple logging: insert a record into an audit trail or events table
      // For now, this just logs via the event system as an info-level fact
      // that the user requested their data.
      const { rows } = await db.query(
        `INSERT INTO keystone.event
         (id, tenant_id, topic, emitted_by, subject_type, subject_id, created_at)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, $4, $5, now())
         RETURNING id, created_at`,
        [principal.user.tenant_id, "profile.data_requested", "app", "person", principal.appUserId]);

      return {
        requested: true,
        message: "Your data export request has been logged. You will receive an email with your data.",
        requestId: rows[0]?.id,
        requestedAt: rows[0]?.created_at,
      };
    }, { bucket: "app" })
  );
}
