// P19.10 — THE SANDBOX: A SECOND INSTANCE OF THE TENANT'S OWN **CONFIGURATION**.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A SANDBOX IS A TENANT (migration 0049). That decision is what makes this file short: isolation
//     is the FORCE-RLS isolation the system already has, so there is no `sandbox` flag for a policy to
//     forget and no parallel schema to keep in step.
//
// ★★★ AND IT HOLDS **NO CLIENT DATA**. THIS IS THE RULING, NOT A DEFAULT.
//     "A second instance of the tenant's own data" is read here as CONFIGURATION — services, prices,
//     document categories and types, templates. It deliberately copies **no** people, documents,
//     signatures, notes, bookings, invoices or payments.
//   ★★ WHY, concretely: a sandbox exists to be experimented on, handed to a developer, and reset. A
//      copy of a person's record there is PHI in a space with looser expectations; a copy of an
//      executed instrument means **the same signed agreement exists twice**, which is the one thing
//      §M0 LAW 3 and P15C.11 spend their whole existence preventing.
//   ★ So the copy list below is an ALLOW-LIST, enumerated in code, and `COPY_REFUSES` names what is
//     excluded so a future reader cannot mistake the absence for an oversight.

import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

/** ★★ EVERY TABLE THE SANDBOX COPIES, IN FK ORDER. Adding one is a decision, not a convenience. */
export const COPY_ORDER = Object.freeze([
  "service", "price", ...DOCUMENTS_DOMAIN.sandbox.copyTables,   // Documents' configuration tables — declared by Documents
]);

/**
 * ★★★ WHAT IT WILL NEVER COPY, AND WHY — stated as data so it is greppable and cannot rot into prose.
 *     A gate asserts that none of these ends up in a sandbox.
 */
export const COPY_REFUSES = Object.freeze({
  app_user: "a person is not configuration; copying people duplicates PHI into a space made to be experimented on",
  ...DOCUMENTS_DOMAIN.sandbox.refuseTables,   // executed instruments / signatures / consents — declared by Documents
  booking: "a session happened, or it did not; a copy of one is a fiction on somebody's calendar",
  invoice: "money owed is owed once",
  payment: "a payment is a fact about a card, and there is only one card",
  event: "the audit log of the live tenant is not the sandbox's history",
});

export class SandboxRefused extends Error {
  constructor(message) { super(message); this.name = "SandboxRefused"; this.statusCode = 400; }
}

/**
 * ★★ Create the sandbox tenant row. NOT the copy — that is a separate call, because creating the
 *    tenant and filling it are separately failable and a half-copied sandbox must still be a tenant
 *    somebody can see and delete.
 *
 * @param {{query: Function}} adminTx a connection that may write `keystone.tenant` (the platform path)
 */
export async function createSandboxTenant(adminTx, { liveTenantId, slug, name, timezone } = {}) {
  if (!liveTenantId) throw new SandboxRefused("a sandbox needs the live tenant it belongs to");
  const live = (await adminTx.query(
    `SELECT id, slug, name, timezone, sandbox_of FROM keystone.tenant WHERE id = $1`, [liveTenantId])).rows[0];
  if (!live) throw new SandboxRefused("that live tenant does not exist");
  // ★ Checked here AND by the trigger in 0049. The module gives a readable 400; the trigger is what
  //   makes it true even when the module is bypassed.
  if (live.sandbox_of) {
    throw new SandboxRefused(
      "that tenant is itself a sandbox. Sandboxes are one level deep on purpose — with chains, " +
      "'which one is live' has no answer.");
  }
  let rows;
  try {
    ({ rows } = await adminTx.query(
      `SELECT id, slug, sandbox_of FROM keystone.create_sandbox_tenant($1,$2,$3,$4)`,
      [liveTenantId, slug ?? `${live.slug}-sandbox`, name ?? `${live.name} (sandbox)`, timezone ?? live.timezone]));
  } catch (err) {
    // ★ 42501 = insufficient_privilege — either 0221's own caller_is_platform() check inside the
    //   function, or its backstop RLS policy. Both are "this write is refused"; the route's own
    //   callerIsPlatform(db) check (src/routes/settings.mjs:492) is what normally stops a
    //   non-platform caller from ever reaching this line, so in ordinary operation this branch is
    //   defence in depth, not the primary gate.
    if (err?.code === "42501") throw new SandboxRefused(err.message.replace(/^create_sandbox_tenant: /, ""));
    throw err;
  }
  return Object.freeze({ id: rows[0].id, slug: rows[0].slug, sandboxOf: rows[0].sandbox_of });
}

/**
 * ★★★ COPY THE CONFIGURATION. Runs as a privileged connection because it reads one tenant and writes
 *     another — which is precisely the operation `withTenant()` exists to make impossible, so it is
 *     done in ONE named place rather than by loosening anything.
 *
 * ★ Returns per-table counts. A caller that gets `{service: 0}` for a tenant with services knows the
 *   copy silently did nothing — which is the failure mode a "it ran without error" check would miss.
 */
export async function copyConfigurationIntoSandbox(adminTx, { liveTenantId, sandboxTenantId } = {}) {
  if (!liveTenantId || !sandboxTenantId) throw new SandboxRefused("both tenant ids are required");
  let rows;
  try {
    ({ rows } = await adminTx.query(
      `SELECT table_name, row_count FROM keystone.copy_configuration_into_sandbox($1,$2)`,
      [liveTenantId, sandboxTenantId]));
  } catch (err) {
    if (err?.code === "42501") {
      throw new SandboxRefused(err.message.replace(/^copy_configuration_into_sandbox: /, ""));
    }
    throw err;
  }
  const counts = {};
  for (const r of rows) counts[r.table_name] = r.row_count;
  return Object.freeze(counts);
}

/**
 * ★ Is this tenant a sandbox? Used by every surface that must say so in words, loudly.
 *
 * ★★★ THIS FUNCTION SHIPPED A U30 DEFECT AND ITS OWN GATE CAUGHT IT — after the gate's assertion was
 *     tightened. The first version joined `keystone.tenant` to itself to get the parent's name:
 *         LEFT JOIN keystone.tenant l ON l.id = t.sandbox_of
 *     Run inside the SANDBOX's context, that join is correctly refused by FORCE RLS (the policy is
 *     `id = current_tenant_id()`), so `l.slug` was NULL and **the banner read "Sandbox of null".**
 *   ★ RLS was not the bug. Asking RLS for another tenant's row and then printing whatever came back
 *     was the bug. The parent's name now comes from `keystone.sandbox_parent_name()` (migration 0050),
 *     a definer function that can only ever read the one parent THIS tenant declares.
 *   ★★ AND THE LABEL FAILS CLOSED: if the name is somehow unavailable it says "Sandbox" — never
 *      "Sandbox of null", and never a raw id.
 */
export async function sandboxInfo(tx, tenantId) {
  // ★★★ READS **ONLY THIS TENANT'S OWN ROW**, and that is the fix. Two earlier versions tried to fetch
  //     the parent's name — first by a self-join, then by a SECURITY DEFINER function (0050) — and BOTH
  //     returned NULL, because `keystone.tenant` is FORCE RLS scoped to `id = current_tenant_id()` and
  //     **FORCE applies to the function's owner too** (0008:8-16, met again). 0051 drops that function.
  //   ★★ The live practice's name is already here: `createSandboxTenant` sets the sandbox's own
  //      `name` to "<live practice> (sandbox)" at creation. So the banner needs no cross-tenant read
  //      at all — which is also why it cannot break when RLS is doing its job.
  //   ★ The trade-off, stated: if the live practice renames itself, the sandbox's name does not follow.
  //     That is visible and harmless; a banner reading "Sandbox of null" was neither.
  const { rows } = await tx.query(
    `SELECT t.id, t.slug, t.name, t.sandbox_of FROM keystone.tenant t WHERE t.id = $1`, [tenantId]);
  const r = rows[0];
  if (!r) return null;
  const own = typeof r.name === "string" && r.name.trim() !== "" ? r.name.trim() : null;
  return Object.freeze({
    isSandbox: r.sandbox_of !== null,
    // ★ U30: words, never a boolean and never a machine value. Fails closed to "Sandbox" if the name
    //   is somehow empty — never to "Sandbox of null" and never to a raw id.
    label: r.sandbox_of ? (own ?? "Sandbox") : "Live",
    name: own,
    liveTenantId: r.sandbox_of,
  });
}
