// C3.4 — PAYER GROUPS ROUTES. List, create, get/update/archive, add/move/remove members.
//
// ★★★ STAFF-ONLY, GATED ON THE `account` OBJECT — F03 §4/§8, 12.5. `authoriseSection` checks the
// `/accounts/all` nav row (Owner/Admin/Coach — any staff rank reaches the section); `assertMay`
// then checks the `account` PERMISSION GRANT itself, with no subject id, so only a role holding
// `account: */everything` passes — a Coach holding `account: view/owned` is refused (F03 §4:
// "Staff: nothing renders"), because a payer group/account has no single owning coach to match
// `owned` against.

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import {
  createPayerGroup, updatePayerGroup, addMember, removeMember, moveMember, archivePayerGroup,
  listPayerGroups, readPayerGroup,
} from "../money/payerGroups.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPayerGroupsRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  /**
   * ★ Wrapper to authorize staff access to payer groups (accounts) — the section floor first
   *   (`/accounts/all`), then the `account` permission grant itself. `opts.verb` names the verb
   *   this route needs (`view`, the default, or `edit`).
   */
  const guarded = (fn, opts = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.user?.role || ctx.principal.user.role !== "staff") {
        throw forbidden("payer groups are for staff only");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/accounts/all", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) {
        throw forbidden(`access to payer groups requires access to the accounts section`);
      }
      // ★ No `subject` — a create/list/read has no existing row to inherit an owner from, and an
      //   account has no owning coach in any case; only `account: */everything` can pass this.
      await assertMay(ctx.db, ctx.principal, { object: "account", action: opts.verb ?? "view" });
      return fn(ctx);
    }, opts).then((r) => c.json(r));
  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/staff/payer-groups — LIST ALL PAYER GROUPS (ACCOUNTS) FOR THIS TENANT
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/staff/payer-groups", guarded(async (ctx) => {
    const groups = await listPayerGroups(ctx.db, { viewerId: ctx.principal.appUserId });
    return { groups };
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/staff/payer-groups — CREATE A NEW PAYER GROUP (ACCOUNT)
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/staff/payer-groups", guarded(async (ctx) => {
    const { name, kind, contactUserId, billingNote, memberPersonIds } = ctx.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      throw invalid("name is required");
    }

    const result = await createPayerGroup(ctx.db, {
      tenantId: ctx.tenantId,
      name: name.trim(),
      kind,
      contactUserId: contactUserId || null,
      billingNote: billingNote || null,
      memberPersonIds: Array.isArray(memberPersonIds) ? memberPersonIds : [],
      actorUserId: ctx.principal.appUserId,
    });

    return { id: result.id, name: result.name, kind: result.kind };
  }, { verb: "edit" }));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/staff/payer-groups/:id — GET A PAYER GROUP (ACCOUNT) WITH MEMBERS
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/staff/payer-groups/:id", guarded(async (ctx) => {
    const groupId = ctx.c.req.param("id");
    if (!groupId) throw invalid("group id is required");
    if (!UUID_RE.test(groupId)) throw invalid("group id must be a valid UUID");

    return readPayerGroup(ctx.db, { viewerId: ctx.principal.appUserId, payerGroupId: groupId });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/staff/payer-groups/:id — UPDATE A PAYER GROUP (ACCOUNT)
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/staff/payer-groups/:id", guarded(async (ctx) => {
    const groupId = ctx.c.req.param("id");
    if (!groupId) throw invalid("group id is required");
    if (!UUID_RE.test(groupId)) throw invalid("group id must be a valid UUID");

    const { name, kind, contactUserId, billingNote } = ctx.body || {};

    const result = await updatePayerGroup(ctx.db, {
      tenantId: ctx.tenantId,
      payerGroupId: groupId,
      name,
      kind,
      contactUserId,
      billingNote,
      actorUserId: ctx.principal.appUserId,
    });

    return result;
  }, { verb: "edit" }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/staff/payer-groups/:id/archive — ARCHIVE A PAYER GROUP (ACCOUNT)
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/staff/payer-groups/:id/archive", guarded(async (ctx) => {
    const groupId = ctx.c.req.param("id");
    if (!groupId) throw invalid("group id is required");
    if (!UUID_RE.test(groupId)) throw invalid("group id must be a valid UUID");

    const result = await archivePayerGroup(ctx.db, {
      tenantId: ctx.tenantId,
      payerGroupId: groupId,
      actorUserId: ctx.principal.appUserId,
    });

    return result;
  }, { verb: "edit" }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/staff/payer-groups/:id/members — ADD A MEMBER TO A PAYER GROUP
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/staff/payer-groups/:id/members", guarded(async (ctx) => {
    const groupId = ctx.c.req.param("id");
    if (!groupId) throw invalid("group id is required");

    const { person_id, account_id } = ctx.body || {};

    const result = await addMember(ctx.db, {
      tenantId: ctx.tenantId,
      payerGroupId: groupId,
      personId: person_id || null,
      accountId: account_id || null,
      actorUserId: ctx.principal.appUserId,
    });

    return result;
  }, { verb: "edit" }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/staff/payer-groups/:id/members/move — MOVE A PERSON TO A DIFFERENT PAYER GROUP
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/staff/payer-groups/:id/members/move", guarded(async (ctx) => {
    const groupId = ctx.c.req.param("id");
    if (!groupId) throw invalid("group id is required");
    if (!UUID_RE.test(groupId)) throw invalid("group id must be a valid UUID");

    const { personId } = ctx.body || {};
    if (!personId) throw invalid("personId is required");

    const result = await moveMember(ctx.db, {
      tenantId: ctx.tenantId,
      personId,
      toPayerGroupId: groupId,
      actorUserId: ctx.principal.appUserId,
    });

    return result;
  }, { verb: "edit" }));

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /api/staff/payer-groups/:id/members/:memberId — REMOVE A MEMBER
  // ───────────────────────────────────────────────────────────────────────────
  app.delete("/api/staff/payer-groups/:id/members/:memberId", guarded(async (ctx) => {
    const memberId = ctx.c.req.param("memberId");
    if (!memberId) throw invalid("member id is required");
    if (!UUID_RE.test(memberId)) throw invalid("member id must be a valid UUID");

    const result = await removeMember(ctx.db, {
      tenantId: ctx.tenantId,
      membershipId: memberId,
      actorUserId: ctx.principal.appUserId,
    });

    return result;
  }, { verb: "edit" }));
}
