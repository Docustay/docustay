// 12.7 — NETWORK ROUTES. Refer out, record inbound, set outcome, read a partner.
//
// ★★★ STAFF-ONLY, GATED ON THE `/network` SECTION FLOOR — same idiom as `src/routes/
//     payerGroups.mjs:18-29` (staff-role check, then `authoriseSection`). ★ Unlike payer groups,
//     there is no further object-level `assertMay` call here: `createReferral`/`setReferralOutcome`
//     already resolve the referred person's OWNER and check `user_may(viewer,'referral','edit',
//     owner)` themselves (`src/network/writes.mjs`), and `readPartnerRecord` does its own two
//     viewer-scoped gates (spentMinor, recent[].person) — a third, blanket check here would be a
//     second, independent decision that could drift from those.

import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import {
  refusedKeys, recordBlockedReferral, createReferral, recordInboundReferral, setReferralOutcome,
} from "../network/writes.mjs";
import { readPartnerRecord } from "../network/partnerRecord.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerNetworkRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  const guarded = (fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.user?.role || ctx.principal.user.role !== "staff") {
        throw forbidden("the network is for staff only");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/network", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) {
        throw forbidden("access to the network requires access to the network section");
      }
      return fn(ctx);
    }).then((r) => c.json(r));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/network/parties/:id — READ A PARTNER RECORD
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/network/parties/:id", guarded(async (ctx) => {
    const partyId = ctx.c.req.param("id");
    if (!partyId || !UUID_RE.test(partyId)) throw invalid("party id must be a valid UUID");
    return readPartnerRecord(ctx.db, { viewerId: ctx.principal.appUserId, partyId });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/network/referrals — REFER A CLIENT OUT
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/network/referrals", guarded(async (ctx) => {
    const body = ctx.body || {};
    // ★★★ A referral carries a name and a reason, nothing more. Any other body key — most
    //   pointedly `notes` — is refused and audited BEFORE any referral row is written.
    const keys = refusedKeys(body);
    if (keys.length) {
      await recordBlockedReferral(ctx.tenantId, {
        actorUserId: ctx.principal.appUserId,
        personId: body.personId,
        partyId: body.partyId,
        keys,
      });
      throw forbidden(
        "blocked_no_release — a referral carries a name and a reason. Anything more needs a " +
        "signed release, sent from Documents.");
    }

    return createReferral(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      personId: body.personId,
      partyId: body.partyId,
      reason: body.reason,
      copyPerson: body.copyPerson,
      toldPerson: body.toldPerson,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/network/referrals/inbound — RECORD AN INBOUND REFERRAL
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/network/referrals/inbound", guarded(async (ctx) => {
    const body = ctx.body || {};
    return recordInboundReferral(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      personId: body.personId,
      partyId: body.partyId,
      reason: body.reason,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/network/referrals/:id/outcome — SET A REFERRAL'S OUTCOME
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/network/referrals/:id/outcome", guarded(async (ctx) => {
    const referralId = ctx.c.req.param("id");
    if (!referralId || !UUID_RE.test(referralId)) throw invalid("referral id must be a valid UUID");
    const body = ctx.body || {};
    return setReferralOutcome(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      referralId,
      outcome: body.outcome,
      outcomeNote: body.note,
    });
  }));
}
