// @ts-check
// lead-intake brief, 30 Sep 2026 — THE PUBLIC LEAD-INTAKE DOOR.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SAME BOUNDARY AS `src/routes/public.mjs`/`publicMoney.mjs` — READ THAT FILE'S HEADER FIRST.
//     Tenant resolved from the Host header (`subdomainFromRequest`), exactly the way
//     `/api/public/book/practice` already does (this module's own contract names that route as
//     its model). No `body.tenantId` is ever read.
//
// ★★ THE ONE NEW THING THIS DOOR NEEDS THAT NO EARLIER PUBLIC ROUTE DID: real CORS. The website
//    (`example-practice-site`, a SEPARATE Railway deployment) calls this cross-origin from a browser.
//    [MEASURED] nothing in `src/` sets `Access-Control-Allow-Origin` anywhere today — every earlier
//    public route is same-origin. Scoped to exactly this path, never applied globally.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { withTenant } from "../db/index.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";
import { getSetting } from "../settings/writes.mjs";
import { invalid, notFound, AppError, ErrorKind } from "../http/errors.mjs";
import { createPerson } from "../people/writes.mjs";
import { emit } from "../events/outbox.mjs";
import { sendLeadThanksEmail, sendLeadNotifyPracticeEmail } from "../email/leadEmail.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
// ★ SAME LIST the CSRF guard (src/http/app.mjs) reads — see that module's own header for why
//   this is shared rather than declared twice.
import { leadFormOriginsFor } from "../http/publicCorsAllowlist.mjs";
import { platformAlertTo, productName, identitySettings } from "../mail/index.mjs";
import { normalise as normaliseIp, isValidIp } from "../http/trustedIp.mjs";
// ★★★ THE ONE RULE SET. Field rules and every visitor-facing message live in the lead contract, which
//   the website imports a byte-identical copy of — this route no longer carries its own.
import { parseLead, normalisePhone, ATTRIBUTION_KEYS, MSG } from "../lead-contract/index.mjs";

/** The organisation's own contact address: its sending identity's reply-to, else its owner's email. Never a typed-in address. */
async function practiceContactEmail(tx) {
  const replyTo = (await identitySettings(tx))["email.reply_to"];
  if (replyTo) return replyTo;
  const { rows } = await tx.query(`SELECT email FROM keystone.app_user WHERE role = 'staff' AND staff_role = 'owner' AND email IS NOT NULL ORDER BY created_at, id LIMIT 1`);
  return rows[0]?.email ?? null;
}

const WINDOW_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const DAYS_LABEL = { weekdays: "weekdays", weekends: "weekends", any: "any day" };

function bestTimeLabel(daysKey, windowKey) {
  if (!daysKey && !windowKey) return null;
  if (daysKey && windowKey) return `${DAYS_LABEL[daysKey] || daysKey}, ${WINDOW_LABEL[windowKey] || windowKey}`;
  return DAYS_LABEL[daysKey] || WINDOW_LABEL[windowKey] || null;
}

// ★★★ [TY, 2 Oct 2026] "If lead submissions fail (any 4xx/5xx other than a real validation
//   message), email alerts@... immediately (once per incident, not per request)." A VALIDATION-kind
//   AppError (missing name, bad serviceId, etc.) is the form working correctly — a visitor's own
//   mistake, never an incident. Anything else (a dependency failure, a bug, an unexpected throw)
//   is. Debounced per PROCESS, not persisted — this is a single-service Railway deploy, and the
//   point is "don't flood an inbox during an outage", not a durable audit trail (the request id in
//   the alert, and this route's own rejection log, already cover that).
let lastAlertSentAt = 0;
const ALERT_DEBOUNCE_MS = 15 * 60 * 1000;
async function alertLeadFailure(requestId, summary) {
  const now = Date.now();
  if (now - lastAlertSentAt < ALERT_DEBOUNCE_MS) return;
  lastAlertSentAt = now;
  try {
    const to = platformAlertTo();
    if (!to) { console.error("publicLeads: lead submissions are failing and no platform alert address is set (KEYSTONE_MAIL_ALERT_TO)"); return; }
    await sendViaResend({
      to,
      from: sendingAddress(),
      subject: `${productName()}: lead submissions are failing`,
      text: `A public lead-form submission failed with an unexpected error.\n\n` +
        `Request id: ${requestId}\nSummary: ${summary}\n\n` +
        `No personal data from the submission is in this alert. Check the keystone-app deploy log ` +
        `for request id ${requestId} for the full detail. Further alerts are suppressed for 15 ` +
        `minutes so one bad deploy does not flood this inbox.`,
    });
  } catch (err) {
    console.error(`publicLeads: alertLeadFailure itself failed: ${err?.message || err}`);
  }
}

// ★★★ [TY, RULED 1 Oct 2026] AD ATTRIBUTION — captured by the website (a 90-day first-party cookie) and
//   sent as plain string fields; the key list lives in the lead contract. Marketing data shown on a
//   lead's record, never used for an access decision. The "Came from: Google Ads — campaign …" sentence
//   is built in SQL at read time (`lead_came_from`, src/records/queries.mjs), not here.
function readAttribution(lead) {
  const out = {};
  for (const key of ATTRIBUTION_KEYS) if (lead[key]) out[key] = lead[key];
  return Object.keys(out).length ? out : null;
}

// ★★ SERVER-TO-SERVER FROM THE WEBSITE. The site's SvelteKit server now posts here, so every visitor
//   arrives from the SITE'S address — per-IP limiting and the consent record would see one "visitor".
//   The site forwards the visitor's address in `X-Visitor-IP`, honoured ONLY when `X-Lead-Forward-Secret`
//   matches LEAD_FORWARD_SECRET (a shared secret held by the two services). A wrong or missing secret
//   is not an error — the header is simply ignored and the normal trusted-proxy address is used, so
//   no one outside can pick their own rate-limit bucket.
function visitorIp(c) {
  const normal = c.get("clientIp") ?? null;
  const secret = process.env.LEAD_FORWARD_SECRET;
  const given = c.req.header("x-lead-forward-secret");
  if (!secret || !given) return normal;
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return normal;
  const ip = normaliseIp(c.req.header("x-visitor-ip"));
  return ip && isValidIp(ip) ? ip : normal;
}

// ★ ONE ERROR SHAPE for every refusal the form can cause: `error.detail.fields` is ALWAYS an object map
//   { field: "plain-English sentence" }. createPerson's own checks (422 with a bare array of column
//   names; 409 with a singular `field`) are translated here, so the website never decodes two shapes.
const COLUMN_TO_FIELD = {
  email: ["email", MSG.emailRequired],
  mobilePhone: ["phone", MSG.phoneRequired], mobile_phone: ["phone", MSG.phoneRequired],
  firstName: ["name", MSG.nameRequired], first_name: ["name", MSG.nameRequired],
  displayName: ["name", MSG.nameRequired], display_name: ["name", MSG.nameRequired],
};
const DUPLICATE_MESSAGE = {
  email: "That email is already linked to another record — please call or text us.",
  phone: "That phone number is already linked to another record — please call or text us.",
};
function toLeadError(err) {
  if (!(err instanceof AppError)) return err;
  const d = err.detail;
  if (err.kind === ErrorKind.UNPROCESSABLE && Array.isArray(d?.fields)) {
    const fields = {};
    for (const col of d.fields) {
      const hit = COLUMN_TO_FIELD[col];
      if (hit) fields[hit[0]] = hit[1];
    }
    if (!Object.keys(fields).length) fields.form = err.message;
    return invalid("please fix the highlighted fields", { fields });
  }
  if (err.kind === ErrorKind.CONFLICT && typeof d?.field === "string") {
    const [field] = COLUMN_TO_FIELD[d.field] ?? [d.field];
    return new AppError(ErrorKind.CONFLICT, err.message, { detail: { fields: { [field]: DUPLICATE_MESSAGE[field] ?? err.message } } });
  }
  if (err.kind === ErrorKind.VALIDATION && !(d && typeof d.fields === "object" && !Array.isArray(d.fields))) {
    return invalid(err.message, { fields: { form: err.message } });
  }
  return err;
}

// Same visitor tapping twice (or a browser re-POST of the success page) must create ONE lead and send
// ONE pair of emails. In-process — single-service deploy. A request that finds
// the key still in flight waits for it and gets the same answer; a FAILED attempt is forgotten so a
// retry can run.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const seenKeys = new Map();

export function registerPublicLeadsRoutes(app) {
  app.use("/api/public/leads/*", cors({ origin: async (origin, c) => ((await leadFormOriginsFor(c)).includes(origin) ? origin : null), allowMethods: ["GET", "POST", "OPTIONS"] }));

  // ── GET /api/public/leads/options ───────────────────────────────────────────────────────────
  app.get("/api/public/leads/options", async (c) => {
    c.header("cache-control", "no-store");
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    const result = await withTenant(tenantId, async (tx) => {
      const interests = await getSetting(tx, "growth.lead_interests", []);
      const services = interests.map((i) => ({ id: i.id, name: i.name }));
      return { services };
    }, { userId: null });

    return c.json(result);
  });

  // ── POST /api/public/leads ───────────────────────────────────────────────────────────────────
  app.post("/api/public/leads", async (c) => {
    const requestId = c.get("requestId");
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON", { fields: { form: "the request body is not JSON" } });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw invalid("the request body is not an object", { fields: { form: "the request body is not an object" } });
    }

    // ★ HONEYPOT, FIRST. A real visitor never fills the `website` field (it is hidden on the real
    //   form) — a bot that fills every field does. Fake success, do nothing else.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return c.json({ ok: true }, 201);
    }

    // ★ Idempotency: header, else body field. A repeat of a request that already succeeded just
    //   gets the same answer. Everything from the check
    //   to `seenKeys.set` is synchronous, so two simultaneous requests cannot both miss.
    const rawKey = c.req.header("idempotency-key") ?? body.idempotencyKey;
    const idemKey = typeof rawKey === "string" && rawKey.length >= 8 && rawKey.length <= 100 ? rawKey : null;
    if (idemKey && seenKeys.has(idemKey)) {
      const done = await seenKeys.get(idemKey).then(() => true, () => false);
      if (done) return c.json({ ok: true, replayed: true }, 201);
    }

    // ★★★ [TY, 2 Oct 2026] Everything from here down is wrapped so an UNEXPECTED failure (a
    //   dependency down, a bug — anything that is not the form's own validation refusal) fires the
    //   alert email once per incident, never per request. See `alertLeadFailure`'s own header.
    try {
      const ip = visitorIp(c);
      // ★★★ [TY, RULED 2 Oct 2026] Name, email AND phone are required — the rules, and the sentence a
      //   visitor reads for each, are the lead contract's. `serviceId` is optional ("Not sure yet").
      const parsed = parseLead(body);
      if (!parsed.ok) {
        // Field NAMES only — never the submitted values (no personal data reaches this line).
        console.log(`[${requestId}] publicLeads: rejected — fields: ${Object.keys(parsed.fields).join(", ")}`);
        throw invalid("please fix the highlighted fields", { fields: parsed.fields });
      }
      const lead = parsed.data;
      const work = createLead(c, lead, ip);
      if (idemKey) {
        seenKeys.set(idemKey, work);
        work.then(
          () => setTimeout(() => seenKeys.delete(idemKey), IDEMPOTENCY_TTL_MS).unref(),
          () => seenKeys.delete(idemKey),
        );
      }
      await work;
      return c.json({ ok: true }, 201);
    } catch (raw) {
      const err = toLeadError(raw);
      // ★ UNPROCESSABLE, CONFLICT and VALIDATION are all "a real validation message" — they tell the
      //   visitor what to fix; none means something is broken. Found live, 2 Oct 2026: a duplicate-phone
      //   collision fired this alert for what was an ordinary "someone already used that".
      const isValidationLike = err instanceof AppError &&
        (err.kind === ErrorKind.VALIDATION || err.kind === ErrorKind.UNPROCESSABLE || err.kind === ErrorKind.CONFLICT);
      if (!isValidationLike) {
        console.error(`[${requestId}] publicLeads: unexpected failure: ${err?.message || err}`);
        await alertLeadFailure(requestId, err?.message || String(err));
      }
      throw err;
    }
  });
}

// ── the work after validation: find-or-create the person, record consent, emit, send both emails ──
async function createLead(c, lead, ip) {
  const { name, email, phone, serviceId, serviceText, message, textConsent } = lead;
  const bestTimeDays = lead.bestTimeDays || null;
  const bestTimeWindow = lead.bestTimeWindow || null;
  const attribution = readAttribution(lead);
  const phoneE164 = normalisePhone(phone);

    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    const result = await withTenant(tenantId, async (tx) => {
      // ★ `serviceId` is optional — only resolved/validated against the practice's real interest list
      //   when the visitor actually picked one. An empty serviceId is "Not sure yet", not an error.
      //   `serviceText` is the free-text answer for when the list could not be offered.
      const interests = await getSetting(tx, "growth.lead_interests", []);
      const interest = serviceId ? interests.find((i) => i.id === serviceId) : null;
      if (serviceId && !interest) throw invalid(`"${serviceId}" is not a known interest`, { fields: { serviceId: MSG.serviceBad } });
      const interestLabel = interest?.name ?? (serviceText || null);

      // ★ Batch A — the organisation's own public name, never one practice's typed in
      const { rows: [consentTenant] } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const consentName = (await getSetting(tx, "practice.name", null)) || consentTenant?.name || "us";
      const consentWording =
        "By checking this box, you agree to receive text messages about your enquiry from " +
        `${consentName}. Message and data rates may apply.`;

      // ── find an existing person by EMAIL OR PHONE — never by name (a returning lead may give a
      //    different name spelling; the identifying facts are the ones the maintainer named: email or phone).
      //    ★ The phone is compared in E.164 — the stored form. Compared as typed, "(510) 555-0100"
      //    never matched "+15105550100", so a returning lead hit the unique index and got a 409. ──
      const { rows: dupRows } = await tx.query(
        `SELECT id FROM keystone.app_user
           WHERE tenant_id = $1 AND archived_at IS NULL
             AND (lower(email) = lower($2)
                  OR ($3::text IS NOT NULL AND mobile_phone = $3::text))
           LIMIT 1`,
        [tenantId, email, phoneE164]);

      let personId = dupRows[0]?.id ?? null;
      let isNew = false;
      if (!personId) {
        const person = await createPerson(tx, {
          tenantId, email: email || null, displayName: name, firstName: name,
          mobilePhone: phoneE164, role: "adult_client", lifecycleStatus: "lead",
          source: "website", actorUserId: null,
        });
        personId = person.id;
        isNew = true;
      }

      // ── the lead's own facts: latest submission wins for service/best-time; the note is
      //    APPENDED (never overwritten) so a second submission does not erase the first's note.
      //    `lead_attribution` is the one exception to "latest wins" — COALESCE keeps the FIRST
      //    attribution a lead ever carried (an ad click), so a later organic visit with no ad
      //    params in the URL cannot silently erase the record of which ad actually brought them in. ──
      const noteLine = message ? `[${new Date().toISOString().slice(0, 10)}] ${message}` : null;
      await tx.query(
        `UPDATE keystone.app_user
            SET lead_service_id = $2, lead_service_name = $3,
                lead_best_time_days = $4, lead_best_time_window = $5,
                lead_attribution = COALESCE($6::jsonb, lead_attribution),
                notes = CASE WHEN $7::text IS NULL THEN notes
                             WHEN notes IS NULL OR notes = '' THEN $7
                             ELSE notes || E'\\n' || $7 END
          WHERE id = $1 AND tenant_id = $8`,
        [personId, serviceId || null, interestLabel, bestTimeDays, bestTimeWindow,
         attribution ? JSON.stringify(attribution) : null, noteLine, tenantId]);

      // ── ★ QUEUE §4 — the service they picked puts the lead in that service's PROGRAM (additive: a lead can already be in others). A program that
      //    has since been deleted simply matches nothing — an enquiry is never refused over it.
      if (interest?.programId) {
        await tx.query(
          `INSERT INTO keystone.person_program (tenant_id, person_id, program_id)
           SELECT $1, $2, p.id FROM keystone.program p WHERE p.tenant_id = $1 AND p.id = $3
           ON CONFLICT DO NOTHING`,
          [tenantId, personId, interest.programId]);
      }

      // ── consent, recorded every submission (the exact wording shown, and whether they checked
      //    it) — same consent_record table `/go/:pageSlug/lead` already uses. ──
      await tx.query(
        `INSERT INTO keystone.consent_record
           (tenant_id, person_id, consent_type, ip_address, user_agent, consent_method, is_active, detail, created_at)
         VALUES ($1, $2, 'sms_marketing', $3, $4, 'web_form', $5, $6, now())`,
        [tenantId, personId, ip, c.req.header("user-agent") || null, textConsent, consentWording]);

      // ── the history trail: one funnel_event per submission, same shape the landing-page lead
      //    form already uses (conversion, no landing page, no PII in metadata). ──
      await tx.query(
        `INSERT INTO keystone.funnel_event
           (tenant_id, event_type, person_id, source_tag, metadata, created_at)
         VALUES ($1, 'conversion', $2, 'website', $3, now())`,
        [tenantId, personId, JSON.stringify({})]);

      await emit(tx, {
        tenantId, topic: "forms.form.submitted", emittedBy: "forms",
        subjectType: "person", subjectId: personId, actor: "system",
        payload: { person_id: personId, source: "website", is_new: isNew },
      });

      // ★ `keystone.tenant` has no `logo_url`/name-override column — both are SETTINGS
      //   (`branding.logo_url`, `practice.name`), same as `readPublicPractice` resolves them
      //   (src/booking/publicBooking.mjs:168-174). A bare tenant-row lookup here would have been
      //   the wrong source and, for logo_url, a straight 42703 (no such column).
      const { rows: [tenant] } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const practiceName = (await getSetting(tx, "practice.name", null)) || tenant?.name || "the practice";
      const logoUrl = await getSetting(tx, "branding.logo_url", null);
      const supportPhone = await getSetting(tx, "practice.support_phone", "(510) 555-0100");
      const contactEmail = await practiceContactEmail(tx);
      const notifyTo = (await getSetting(tx, "growth.lead_notification_email", null)) || contactEmail;

      return {
        personId, isNew, practiceName, logoUrl,
        interestName: interestLabel ?? "a general inquiry", supportPhone, notifyTo, contactEmail,
      };
    }, { userId: null });

    // ── both emails, outside the transaction (Resend is not transactional — src/email/send.mjs's
    //    own header gives the identical reasoning). A send failure never un-creates the lead. ──
    const label = bestTimeLabel(bestTimeDays, bestTimeWindow);
    if (email) {
      try {
        await withTenant(tenantId, (tx) => sendLeadThanksEmail({
          tx, tenantId, to: email, practiceName: result.practiceName, logoUrl: result.logoUrl,
          vars: {
            practiceName: result.practiceName, recipientName: name, interestName: result.interestName,
            bestTimeLabel: label || "as soon as we can", supportPhone: result.supportPhone,
            supportEmail: result.contactEmail ?? "",
          },
        }, {}), { userId: null });
      } catch (err) {
        console.error(`publicLeads: growth.lead_thanks send failed: ${err?.message || err}`);
      }
    }
    if (!result.notifyTo) console.error("publicLeads: no notification address (set growth.lead_notification_email, or a reply-to under Settings → Email) — the new-lead notice was not sent");
    else try {
      await withTenant(tenantId, (tx) => sendLeadNotifyPracticeEmail({
        tx, tenantId, to: result.notifyTo, practiceName: result.practiceName, logoUrl: result.logoUrl,
        vars: {
          leadName: name, leadEmail: email || "(none given)", leadPhone: phone || "(none given)",
          interestName: result.interestName, bestTimeLabel: label || "no preference given",
          leadNote: message || "(none)", link: `https://app.example.com/people/${result.personId}`,
        },
      }, {}), { userId: null });
    } catch (err) {
      console.error(`publicLeads: growth.lead_notify_practice send failed: ${err?.message || err}`);
    }

}
