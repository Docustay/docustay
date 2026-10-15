// @ts-check
// src/routes/publicBookingS2S.mjs — THE PRACTICE'S OWN WEBSITE BOOKS THROUGH PLATFORM, SERVER TO SERVER (6 Oct 2026).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Specs: specs/BOOKING-TEAM-PLAN-6OCT.md §4 (the credential) and specs/BOOKING-PUBLIC-CONTRACT-6OCT.md (the wire).
//
// ★★★ SAME BOUNDARY AS `src/routes/public.mjs` — READ ITS HEADER FIRST. The tenant is the one the Host header resolves
//     (`subdomainFromRequest`, or a live custom hostname), NEVER a value in a body, a query string or a signature. This file
//     reads exactly these request headers and no other: `host` (through the resolver), `x-workbench-timestamp`,
//     `x-workbench-signature`, `x-visitor-ip`. It is a SEPARATE FILE from public.mjs on purpose: public.mjs's own rule is "no header
//     but Host"; the browser door keeps that rule, and this door is the one that carries a credential (the same way
//     publicLeads.mjs carries the forwarding secret).
//
// ★★ THE CREDENTIAL REPLACES TURNSTILE FOR ONE CALLER — it does not replace any other check. Everything the browser door enforces
//    is enforced here too: `public_booking_enabled` flag, `booking.online_enabled`, `booking.who_can_book`, notice, window, the
//    service's three public flags, the host being accepting staff. A refusal is the SAME generic 404 for: an unknown host, a bad,
//    missing or expired signature, booking switched off — a stranger learns nothing from which one it was.
//
// ★ NOT OFFERED: cancel/reschedule by a visitor. Staff do that in the platform; the confirmation tells the visitor to contact the
//   practice. (Adding a visitor-side cancel would need its own token design; it was not asked for.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { resolvePublicTenantId, PUBLIC_BOOKING_REFUSED } from "../booking/publicBooking.mjs";
import { tenantForCustomHost, isPlatformHost } from "../http/customHost.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { getSetting } from "../settings/writes.mjs";
import { invalid, notFound, AppError, ErrorKind } from "../http/errors.mjs";
import { checkIpLimit, checkTenantLimit, formSubmitLimiter } from "../http/rateLimit.mjs";
import { normalise as normaliseIp, isValidIp } from "../http/trustedIp.mjs";
import { verifyRequest } from "../booking/s2sAuth.mjs";
import { parseLead, ATTRIBUTION_KEYS } from "../lead-contract/index.mjs";
import { loadTeamService, readTeamSlots, createTeamBooking, teamPool, staffChoiceAllowed } from "../booking/teamBooking.mjs";
import { SlotTakenError } from "../booking/createBooking.mjs";
import { getObject } from "../storage/s3.mjs";

const LOGO_POINTER = /^ks-object:(t\/[0-9a-f-]{36}\/brand_logo\/[A-Za-z0-9._-]{1,128})$/i;
const MAX_BODY = 20_000;

// ── tenant from the Host header, and ONLY from it ───────────────────────────────────────────────
async function tenantFromHost(c) {
  const slug = subdomainFromRequest(c);
  if (slug) return resolvePublicTenantId(slug);
  // a live custom hostname a practice attached (src/domains) — still the Host header, resolved by the same kind of lookup
  const host = String(c.req.header("host") ?? "").toLowerCase().split(":")[0].replace(/\.$/, "");
  if (!host || isPlatformHost(host)) return null;
  return tenantForCustomHost(host);
}

/**
 * Resolve the tenant, verify the signature against the key derived FOR THAT TENANT, rate-limit. Every failure is the one generic 404.
 * @returns {Promise<{ tenantId:string, ip:string|null, rawBody:string }>}
 */
async function gate(c, { needBookingOn = true, limits = "read" } = {}) {
  const tenantId = await tenantFromHost(c);
  if (!tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);

  const method = c.req.method;
  const rawBody = method === "GET" ? "" : await c.req.text();
  if (rawBody.length > MAX_BODY) throw invalid("the request body is too large");
  const url = new URL(c.req.url);
  const epoch = await withTenant(tenantId, (tx) => getSetting(tx, "booking.api_key_epoch", 1), { userId: null });
  const v = verifyRequest({
    tenantId, epoch: Number(epoch) || 1, method, pathAndQuery: url.pathname + url.search, rawBody,
    timestampHeader: c.req.header("x-workbench-timestamp"), signatureHeader: c.req.header("x-workbench-signature"),
    visitorIpHeader: c.req.header("x-visitor-ip"),
  });
  if (!v.ok) throw notFound(PUBLIC_BOOKING_REFUSED);

  // the visitor's address is honoured only because it was SIGNED (a valid signature covers it); otherwise the caller's own address
  const forwarded = v.visitorIp ? normaliseIp(v.visitorIp) : null;
  const ip = forwarded && isValidIp(forwarded) ? forwarded : (c.get("clientIp") ?? null);

  if (needBookingOn) {
    const on = await withTenant(tenantId, async (tx) => (await flagIsOn(tx, "public_booking_enabled", tenantId)) && (await getSetting(tx, "booking.online_enabled", true)) !== false, { userId: null });
    if (!on) throw notFound(PUBLIC_BOOKING_REFUSED);
  }
  // per visitor address (in this process) and per practice (shared across replicas, its own bucket so staff are never starved)
  if (limits === "create") formSubmitLimiter("s2s_book", ip, { limit: 8, windowMs: 10 * 60_000 });
  checkIpLimit(ip, { limit: limits === "create" ? 30 : 120, windowMs: 60_000 });
  await checkTenantLimit(tenantId, "public_booking", limits === "create" ? { limit: 120, windowMs: 3_600_000 } : { limit: 1200, windowMs: 60_000 });
  return { tenantId, ip, rawBody };
}

// ── the brand: a name and a logo, nothing else (no colours — the owner's S8 ruling) ─────────────
async function readBrand(tx, { tenantId, origin }) {
  const { rows } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const name = (await getSetting(tx, "practice.name", null)) || rows[0]?.name || "";
  const logo = await getSetting(tx, "branding.logo_url", null);
  let logoUrl = null;
  if (typeof logo === "string" && logo) {
    if (LOGO_POINTER.test(logo)) logoUrl = `${origin}/api/public/brand/logo`; // stored by us: served by the public route below
    else if (/^https:\/\//.test(logo)) logoUrl = logo;
  }
  return { name, logoUrl, logoAlt: name ? `${name} logo` : "Logo" };
}
const originOf = (c) => {
  const h = c.req.header("x-forwarded-proto");
  const proto = h === "http" || h === "https" ? h : new URL(c.req.url).protocol.replace(":", "");
  return `${proto}://${String(c.req.header("host") ?? "").toLowerCase()}`;
};

function toAppResponse(err) {
  if (err instanceof SlotTakenError) {
    return { status: 409, body: { error: { kind: "slot_taken", message: err.message } } };
  }
  return null;
}

// replays: the same idempotency key inside ten minutes gets the same answer (in-flight requests share one result)
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const seen = new Map();

export function registerPublicBookingS2SRoutes(app) {
  // ── the brand, on its own ─────────────────────────────────────────────────────────────────────
  app.get("/api/public/s2s/brand", async (c) => {
    c.header("cache-control", "no-store");
    const { tenantId } = await gate(c, { needBookingOn: false });
    const brand = await withTenant(tenantId, (tx) => readBrand(tx, { tenantId, origin: originOf(c) }), { userId: null });
    return c.json({ brand });
  });

  // ── the bytes of a logo we store (public, Host-resolved, cacheable; a pointer is never returned raw) ──
  app.get("/api/public/brand/logo", async (c) => {
    const tenantId = await tenantFromHost(c);
    if (!tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);
    checkIpLimit(c.get("clientIp") ?? null, { limit: 120, windowMs: 60_000 });
    const pointer = await withTenant(tenantId, (tx) => getSetting(tx, "branding.logo_url", null), { userId: null });
    const m = LOGO_POINTER.exec(typeof pointer === "string" ? pointer : "");
    if (!m) throw notFound(PUBLIC_BOOKING_REFUSED);
    const got = await getObject({ key: m[1] });
    if (!got.ok) throw notFound(PUBLIC_BOOKING_REFUSED);
    const b = got.body;
    const type = b.length > 12 && b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
      : b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : null;
    if (!type) throw notFound(PUBLIC_BOOKING_REFUSED);
    return c.body(b, 200, { "content-type": type, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
  });

  // ── the service and who delivers it ───────────────────────────────────────────────────────────
  app.get("/api/public/s2s/book/service", async (c) => {
    c.header("cache-control", "no-store");
    const { tenantId } = await gate(c);
    const key = String(c.req.query("service") ?? "").trim();
    if (!key) throw invalid("service is required");
    const origin = originOf(c);
    const out = await withTenant(tenantId, async (tx) => {
      const service = await loadTeamService(tx, { tenantId, serviceKey: key });
      if (!service) return null;
      const choice = await staffChoiceAllowed(tx);
      const pool = await teamPool(tx, { tenantId, serviceId: service.id });
      const { rows: tz } = await tx.query(`SELECT timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);
      const { rows: pol } = await tx.query(`SELECT minimum_notice_minutes, booking_window_days FROM keystone.booking_policy WHERE tenant_id = $1 AND service_id = $2`, [tenantId, service.id]);
      return {
        brand: await readBrand(tx, { tenantId, origin }),
        service: { key: service.bookingKey, name: service.name, description: service.description, durationMinutes: service.durationMinutes, modalities: service.deliveryModes.filter((m) => m === "phone" || m === "video"), free: true },
        hostChoice: choice,
        hosts: choice ? pool.filter((h) => h.bookingSlug).map((h) => ({ slug: h.bookingSlug, name: h.displayName, firstName: h.firstName })) : [],
        timeZone: tz[0]?.timezone ?? "UTC",
        noticeMinutes: pol[0]?.minimum_notice_minutes ?? null, windowDays: pol[0]?.booking_window_days ?? null,
      };
    }, { userId: null });
    if (!out) throw notFound(PUBLIC_BOOKING_REFUSED);
    return c.json(out);
  });

  // ── pooled slots ──────────────────────────────────────────────────────────────────────────────
  app.get("/api/public/s2s/book/slots", async (c) => {
    c.header("cache-control", "no-store");
    const { tenantId } = await gate(c);
    const key = String(c.req.query("service") ?? "").trim();
    const from = String(c.req.query("from") ?? "").trim();
    const to = String(c.req.query("to") ?? "").trim();
    const host = String(c.req.query("host") ?? "").trim() || null;
    if (!key) throw invalid("service is required");
    const out = await withTenant(tenantId, async (tx) => {
      const service = await loadTeamService(tx, { tenantId, serviceKey: key });
      if (!service) return null;
      return readTeamSlots(tx, { tenantId, service, fromDate: from, toDate: to || from, hostKey: host });
    }, { userId: null });
    if (!out) throw notFound(PUBLIC_BOOKING_REFUSED);
    return c.json(out);
  });

  // ── book ──────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/public/s2s/book", async (c) => {
    c.header("cache-control", "no-store");
    const { tenantId, ip, rawBody } = await gate(c, { limits: "create" });
    let body;
    try { body = JSON.parse(rawBody); } catch { throw invalid("the request body is not JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("the request body is not an object");

    // honeypot, same as the lead form: a bot that fills every field gets a fake success and nothing happens
    if (typeof body.website === "string" && body.website.trim() !== "") return c.json({ ok: true }, 201);

    const idem = typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 100 ? body.idempotencyKey : null;
    if (!idem) throw invalid("an idempotencyKey of 8 to 100 characters is required", { fields: { idempotencyKey: "required" } });
    const seenKey = `${tenantId}:${idem}`;
    if (seen.has(seenKey)) {
      const prior = await seen.get(seenKey).catch(() => null);
      if (prior) return c.json({ ...prior, replayed: true }, 201);
    }

    const parsed = parseLead(body);
    if (!parsed.ok) throw invalid("please fix the highlighted fields", { fields: parsed.fields });
    const lead = parsed.data;
    const key = typeof body.service === "string" ? body.service.trim() : "";
    if (!key) throw invalid("service is required", { fields: { service: "required" } });
    const startsAt = new Date(body.startsAt);
    if (typeof body.startsAt !== "string" || Number.isNaN(startsAt.getTime())) throw invalid("startsAt is required and must be an ISO-8601 time", { fields: { startsAt: "required" } });
    const inviteeTimezone = typeof body.inviteeTimezone === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(body.inviteeTimezone) ? body.inviteeTimezone : null;
    const origin = originOf(c);

    const work = (async () => {
      const result = await withTenant(tenantId, async (tx) => {
        const service = await loadTeamService(tx, { tenantId, serviceKey: key });
        if (!service) throw notFound(PUBLIC_BOOKING_REFUSED);
        const r = await createTeamBooking(tx, {
          tenantId, service, startsAt, hostKey: typeof body.host === "string" ? body.host : null,
          modality: typeof body.modality === "string" ? body.modality : null, lead, ip,
          userAgent: c.req.header("user-agent") ?? null, inviteeTimezone,
        });
        return { r, brand: await readBrand(tx, { tenantId, origin }) };
      }, { userId: null });
      const { r, brand } = result;
      return {
        booking: {
          id: r.bookingId, reference: r.reference, state: r.state, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(),
          timeZone: r.timeZone, modality: r.modality, durationMinutes: r.durationMinutes, service: { name: r.serviceName },
          host: { name: r.hostName, firstName: r.hostFirstName },
        },
        lead: { isNew: !r.replayed ? undefined : undefined },
        brand,
      };
    })();
    seen.set(seenKey, work);
    work.then(() => setTimeout(() => seen.delete(seenKey), IDEMPOTENCY_TTL_MS).unref(), () => seen.delete(seenKey));
    try {
      const out = await work;
      delete out.lead;
      return c.json(out, 201);
    } catch (err) {
      const mapped = toAppResponse(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      if (err instanceof AppError && err.kind === ErrorKind.CONFLICT) return c.json({ error: { kind: "slot_taken", message: err.message } }, 409);
      throw err;
    }
  });
}
