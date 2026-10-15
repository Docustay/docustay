// @ts-check
// src/booking/websiteLead.mjs — THE LEAD A WEBSITE BOOKING CREATES OR MATCHES (6 Oct 2026).
//
// the platform merges leads by EMAIL OR PHONE, never by name (src/routes/publicLeads.mjs:300-309 — the site's lead form has done so
// since 30 Sep). The older public booking door (`publicBooking.mjs findOrCreateLead`) matched by email only and wrote the phone
// as typed, so a returning visitor who changed email but kept a phone number hit the unique phone index (a 409), and a booking
// lead carried no ad attribution. A website booking is a lead event exactly like the website form, so it runs the SAME rules:
//   · match an existing person by lower(email) OR the E.164 phone (archived people are never matched)
//   · a new person is a `lead`, `source = 'website'`, role adult_client
//   · `lead_attribution` keeps the FIRST attribution a person ever carried (COALESCE) — a later organic visit cannot erase the ad
//   · the service name is written as the lead's interest, and the service's PROGRAM membership is added (additive)
//   · consent is recorded every time, with the exact wording shown and whether the box was ticked
//   · one funnel_event 'conversion' so reporting counts it
// Tenant isolation: every statement is scoped by `tenantId` (the Host-resolved tenant, passed in) AND by RLS.

import { createPerson } from "../people/writes.mjs";
import { getSetting } from "../settings/writes.mjs";
import { ATTRIBUTION_KEYS, normalisePhone } from "../lead-contract/index.mjs";

/** The attribution object the lead record keeps (only keys the contract names, only non-empty values). */
function attributionOf(lead) {
  const out = {};
  for (const key of ATTRIBUTION_KEYS) if (lead[key]) out[key] = lead[key];
  return Object.keys(out).length ? out : null;
}

/**
 * @param {any} tx   a tenant-scoped transaction
 * @param {{ tenantId:string, lead:any, ip?:string|null, userAgent?:string|null, serviceName?:string|null, programId?:string|null, noteLine?:string|null }} a
 * @returns {Promise<{ personId:string, isNew:boolean }>}
 */
export async function findOrCreateWebsiteLead(tx, { tenantId, lead, ip = null, userAgent = null, serviceName = null, programId = null, noteLine = null }) {
  const email = String(lead.email).trim().toLowerCase();
  const phoneE164 = normalisePhone(lead.phone);
  const { rows: dup } = await tx.query(
    `SELECT id FROM keystone.app_user
      WHERE tenant_id = $1 AND archived_at IS NULL
        AND (lower(email) = lower($2) OR ($3::text IS NOT NULL AND mobile_phone = $3::text))
      ORDER BY (lower(email) = lower($2)) DESC, created_at
      LIMIT 1`,
    [tenantId, email, phoneE164]);
  let personId = dup[0]?.id ?? null;
  let isNew = false;
  if (!personId) {
    const person = await createPerson(tx, {
      tenantId, email, displayName: lead.name, firstName: lead.name, mobilePhone: phoneE164,
      role: "adult_client", lifecycleStatus: "lead", source: "website", actorUserId: null,
    });
    personId = person.id;
    isNew = true;
  }

  const attribution = attributionOf(lead);
  await tx.query(
    `UPDATE keystone.app_user
        SET lead_service_name = COALESCE($3, lead_service_name),
            lead_attribution = COALESCE(lead_attribution, $4::jsonb),
            notes = CASE WHEN $5::text IS NULL THEN notes
                         WHEN notes IS NULL OR notes = '' THEN $5
                         ELSE notes || E'\n' || $5 END
      WHERE id = $1 AND tenant_id = $2`,
    [personId, tenantId, serviceName, attribution ? JSON.stringify(attribution) : null, noteLine]);

  if (programId) {
    await tx.query(
      `INSERT INTO keystone.person_program (tenant_id, person_id, program_id)
       SELECT $1, $2, p.id FROM keystone.program p WHERE p.tenant_id = $1 AND p.id = $3
       ON CONFLICT DO NOTHING`,
      [tenantId, personId, programId]);
  }

  const { rows: [t] } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const practiceName = (await getSetting(tx, "practice.name", null)) || t?.name || "us";
  const wording = `By checking this box, you agree to receive text messages about your enquiry from ${practiceName}. Message and data rates may apply.`;
  await tx.query(
    `INSERT INTO keystone.consent_record
       (tenant_id, person_id, consent_type, ip_address, user_agent, consent_method, is_active, detail, created_at)
     VALUES ($1, $2, 'sms_marketing', $3, $4, 'web_form', $5, $6, now())`,
    [tenantId, personId, ip, userAgent, lead.textConsent === true, wording]);

  await tx.query(
    `INSERT INTO keystone.funnel_event (tenant_id, event_type, person_id, source_tag, metadata, created_at)
     VALUES ($1, 'conversion', $2, 'website', $3, now())`,
    [tenantId, personId, JSON.stringify({ via: "booking" })]);

  return { personId, isNew };
}
