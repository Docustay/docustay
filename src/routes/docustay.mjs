// Batch B — the Docustay hosted workspace over HTTP: the signed-in owner makes their new organisation a Documents-only workspace, sees plan and usage, and (when Pro has a price) starts a Stripe Checkout.
// Writes are ROWS spread into writes.mjs (via itemsAndDocuments.mjs); the read is mounted separately. Owner-only, same section as the platform's own plan screen.
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import * as docustay from "../product/docustay.mjs";
import * as accounts from "../product/docustayAccounts.mjs";
import * as payments from "../product/docustayPayments.mjs";
import * as deletion from "../product/deletion.mjs";
import { listSessionsForUser } from "../auth/session.mjs";
import { documentsCreatedBy, personReport } from "../documents/frontDoor.mjs";
import { usageReportFor } from "../product/docustaySelfhost.mjs";
import * as suggestions from "../product/translationSuggestions.mjs";
import * as aiUsage from "../product/docustayAiUsage.mjs";
import { listApiCalls, usageSummary } from "../developer/callLog.mjs";
import * as inbox from "../product/docustayInbox.mjs";
import * as lifecycle from "../product/lifecycle.mjs";
import * as billingContact from "../product/docustayBillingContact.mjs";

const SECTION = "/settings/plans";

export const DOCUSTAY_WRITES = Object.freeze([
  { path: "/api/product/docustay/licenses", section: SECTION, fn: (tx, a) => accounts.issueLicenseForViewer(tx, { tenantId: a.tenantId, expiresAt: a.expiresAt, note: a.note, subscriptionId: a.subscriptionId }), object: "setting", action: "edit", subject: null },
  { path: "/api/product/docustay/activate", section: SECTION, fn: (tx, a) => docustay.activateWorkspace(tx, { tenantId: a.tenantId, requestHost: a.requestHost, actorUserId: a.actorUserId ?? null, lang: typeof a.lang === "string" ? a.lang : "en" }), object: "setting", action: "edit", subject: null },
  { path: "/api/product/docustay/checkout", section: SECTION, fn: (tx, a) => docustay.startCheckout(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, interval: a.interval === "year" ? "year" : "month" }), object: "setting", action: "edit", subject: null },
  // Run 9: the inbox's "Mark all read" — every member, their own notices only (the documents section, not the owner's plan screen)
  { path: "/api/product/docustay/inbox/read-all", section: "/documents", fn: (tx, a) => inbox.markInboxRead(tx, { appUserId: a.actorUserId ?? null }), object: "document", action: "edit", subject: null },
  // Launch step 3: the person's own switch for the welcome emails (Settings → Account). With no `emails` it only reports the current state; every member may, for themselves only.
  { path: "/api/product/docustay/welcome-emails", section: "/documents", fn: (tx, a) => (typeof a.emails === "boolean" ? lifecycle.setPreference(tx, { tenantId: a.tenantId, userId: a.actorUserId, emails: a.emails }) : lifecycle.preference(tx, { userId: a.actorUserId })), object: "document", action: "edit", subject: null },
  // Run 9 Part 3.7 (B2, B5): confirm a finished checkout (re-read from Stripe), cancel to the end of the paid period, resume before it
  { path: "/api/product/docustay/checkout/confirm", section: SECTION, fn: (tx, a) => docustay.confirmUpgrade(tx, { tenantId: a.tenantId, sessionId: a.sessionId }), object: "setting", action: "edit", subject: null },
  // C (13 Oct 2026): cancelling is two steps. The cancel PAGE asks for a confirm token (nothing is cancelled); only the page's own confirm button sends it back, with the reason, and only then does Stripe hear of it.
  { path: "/api/product/docustay/cancel/prepare", section: SECTION, fn: (tx, a) => docustay.prepareCancel(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null }), object: "setting", action: "edit", subject: null },
  { path: "/api/product/docustay/cancel", section: SECTION, fn: (tx, a) => docustay.cancelPro(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, token: typeof a.token === "string" ? a.token : null, reason: typeof a.reason === "string" ? a.reason : null, reasonText: typeof a.reasonText === "string" ? a.reasonText : null }), object: "setting", action: "edit", subject: null },
  { path: "/api/product/docustay/resume", section: SECTION, fn: (tx, a) => docustay.resumePro(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null }), object: "setting", action: "edit", subject: null },
  // Launch Part 3: the workspace's separate billing email. With no `email` it only reports the saved one; an empty string removes it. Owner/admin (the plan screen's gate).
  { path: "/api/product/docustay/billing-email", section: SECTION, fn: (tx, a) => (typeof a.email === "string" ? billingContact.setBillingEmail(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, email: a.email }) : billingContact.getBillingEmail(tx, { tenantId: a.tenantId }).then((email) => ({ email }))), object: "setting", action: "edit", subject: null },
  { path: "/api/product/docustay/portal", section: SECTION, fn: (tx, a) => docustay.startPortal(tx, { tenantId: a.tenantId }), object: "setting", action: "edit", subject: null },
]);

export function registerDocustayReads(app, { runTenantScoped, tenantIsPlatform }) {
  // D5: Docustay's own invoice PDF (owner/admin: the plan screen's gate). The invoice must be this workspace's own.
  app.get("/api/product/docustay/invoices/:id/pdf", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { const d = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) }); if (!d.allowed) throw forbidden(`refused: ${d.reason}`); return docustay.invoicePdfFor(db, { tenantId, invoiceId: c.req.param("id") }); }, { bucket: "settings" })
      .then((r) => c.body(r.bytes, 200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.filename}"`, "cache-control": "private, no-store" })));
  // Part 30 item 11 — taking payments into the workspace's own Stripe account (Standard connected account, direct charges, no platform fee). Owner only, same gate as the plan screen.
  const guard = async (db, principal, tenantId) => { const d = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) }); if (!d.allowed) throw forbidden(`refused: ${d.reason}`); };
  app.get("/api/product/docustay/payments", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return payments.paymentsStatus(db, { tenantId }); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.post("/api/product/docustay/payments/connect", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const origin = payments.returnOrigin({ headers: c.req.raw.headers, url: c.req.url });
      const body = await c.req.json().catch(() => ({}));
      return payments.startPayments(db, { tenantId, actorUserId: principal.appUserId ?? null, email: principal.user?.email ?? null, method: body?.method === "oauth" ? "oauth" : "hosted",
        redirectUri: `${origin}/api/product/docustay/payments/callback`, returnUrl: `${origin}/api/product/docustay/payments/return`, refreshUrl: `${origin}/api/product/docustay/payments/refresh-link` });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/product/docustay/payments/refresh", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return payments.refreshPayments(db, { tenantId, actorUserId: principal.appUserId ?? null }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/product/docustay/payments/disconnect", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return payments.stopPayments(db, { tenantId, actorUserId: principal.appUserId ?? null }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  // Stripe's hosted onboarding sends the person's browser back here (no state is passed): the account is re-read from Stripe and only that is trusted
  app.get("/api/product/docustay/payments/return", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      try { return (await payments.finishHosted(db, { tenantId, actorUserId: principal.appUserId ?? null })).flag; } catch { return "error"; }
    }, { bucket: "api" }).then((flag) => c.redirect(`/settings?tab=payments&payments=${encodeURIComponent(flag)}`, 302)));
  // ...or here when the onboarding link expired or was already used: a fresh link for the same account
  app.get("/api/product/docustay/payments/refresh-link", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const origin = payments.returnOrigin({ headers: c.req.raw.headers, url: c.req.url });
      try { return await payments.freshLink(db, { tenantId, returnUrl: `${origin}/api/product/docustay/payments/return`, refreshUrl: `${origin}/api/product/docustay/payments/refresh-link` }); } catch { return null; }
    }, { bucket: "api" }).then((url) => c.redirect(url ?? "/settings?tab=payments&payments=error", 302)));
  // OAuth only (off unless switched on): Stripe sends the person's browser back here with a one-time code and our signed state; their own session proves it is the same person who started it
  app.get("/api/product/docustay/payments/callback", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      let flag = "error";
      try { flag = (await payments.finishPayments(db, { tenantId, actorUserId: principal.appUserId ?? null, code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") ?? null })).state; } catch { /* the screen says it could not be completed */ }
      return flag;
    }, { bucket: "api" }).then((flag) => c.redirect(`/settings?tab=payments&payments=${encodeURIComponent(flag)}`, 302)));

  // FP-C2 — the API-call log (Settings → Developers): what keys did, newest first, filterable; a request id finds one call. Same owner-only gate as the plan screen.
  // Round 3 — deleting a workspace is a REQUEST with a cooling-off period (src/product/deletion.mjs): owner only, the name typed back, a sign-in from the last few minutes; the worker carries it out when the period ends, and any owner can keep the workspace until then.
  const sessionStart = async (db, { principal, tenantId }) => {
    const rows = await listSessionsForUser(db, tenantId, principal.appUserId, principal.tokenId);
    return rows.find((r) => r.current)?.createdAt ?? null;
  };
  app.post("/api/product/docustay/delete-workspace", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await runTenantScoped(c, async (ctx) => {
      await guard(ctx.db, ctx.principal, ctx.tenantId);
      return deletion.requestWorkspaceDeletion(ctx.db, { tenantId: ctx.tenantId, actorUserId: ctx.principal.appUserId ?? null, confirm: body?.confirm, sessionCreatedAt: await sessionStart(ctx.db, ctx) });
    }, { bucket: "api" });
    return c.json({ requested: true, ...r }, 200);
  });
  app.post("/api/product/docustay/delete-workspace/cancel", (c) =>
    runTenantScoped(c, async (ctx) => { await guard(ctx.db, ctx.principal, ctx.tenantId); return deletion.cancelDeletion(ctx.db, { tenantId: ctx.tenantId, kind: "workspace", actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json({ cancelled: true, ...r }, 200)));
  // Round 3 — "delete my account": any signed-in member, about themselves only (never a person named in the request)
  // Run 10 (R10-23): the person's own name. A new owner is named after the workspace until they say otherwise, and that name is what the Team list, "Hello …" and the audit trail show. About themselves only.
  app.get("/api/account/profile", (c) =>
    runTenantScoped(c, async (ctx) => {
      const { rows } = await ctx.db.query(`SELECT email, display_name FROM keystone.app_user WHERE id = $1`, [ctx.principal.appUserId ?? null]);
      return { email: rows[0]?.email ?? null, displayName: rows[0]?.display_name ?? "" };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.put("/api/account/profile", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw forbidden("A name belongs to a person signed in, not an API key.");
      const name = String(body?.displayName ?? "").replace(/\s+/g, " ").trim();
      if (!name) throw invalid("Type your name.", { field: "displayName" });
      if (name.length > 80) throw invalid("A name can be up to 80 letters.", { field: "displayName" });
      const { rows } = await ctx.db.query(`UPDATE keystone.app_user SET display_name = $2, updated_at = now() WHERE id = $1 RETURNING email, display_name`, [ctx.principal.appUserId, name]);
      return { email: rows[0]?.email ?? null, displayName: rows[0]?.display_name ?? name };
    }, { bucket: "api" });
    return c.json(r, 200);
  });
  app.get("/api/account/deletion", (c) =>
    runTenantScoped(c, async (ctx) => deletion.deletionStatus(ctx.db, { tenantId: ctx.tenantId, userId: ctx.principal.appUserId }), { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/account/deletion", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw forbidden("Deleting an account needs the person signed in, not an API key.");   // F990 scope: plain words (an API key has no person)
      return deletion.requestAccountDeletion(ctx.db, { tenantId: ctx.tenantId, userId: ctx.principal.appUserId, confirm: body?.confirm, sessionCreatedAt: await sessionStart(ctx.db, ctx) });
    }, { bucket: "api" });
    return c.json({ requested: true, ...r }, 200);
  });
  app.post("/api/account/deletion/cancel", (c) =>
    runTenantScoped(c, async (ctx) => deletion.cancelDeletion(ctx.db, { tenantId: ctx.tenantId, kind: "account", actorUserId: ctx.principal.appUserId }), { bucket: "api" }).then((r) => c.json({ cancelled: true, ...r }, 200)));
  app.get("/api/account/export", (c) =>
    runTenantScoped(c, async (ctx) => deletion.exportAccount(ctx.db, { tenantId: ctx.tenantId, userId: ctx.principal.appUserId, documents: { documentsCreatedBy, personReport } }), { bucket: "api" }).then((r) => {
      c.header("content-disposition", 'attachment; filename="docustay-my-data.json"'); c.header("cache-control", "no-store");
      return c.json(r, 200);
    }));
  app.get("/api/product/docustay/api-calls", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); const q = c.req.query(); return listApiCalls(db, { limit: q.limit, cursor: q.cursor ?? null, status: q.status ?? null, method: q.method ?? null, path: q.path ?? null, requestId: q.requestId ?? null, tokenId: q.keyId ?? null }); }, { bucket: "settings" }).then((r) => c.json(r)));

  // FP-F9 — usage over the last N days (calls, errors, slow end, per day, per key, busiest routes); same owner-only gate as the log
  app.get("/api/product/docustay/api-usage", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return usageSummary(db, { days: c.req.query("days") }); }, { bucket: "api" }).then((r) => c.json(r)));

  // Run 9 (R9-k): the bell and the inbox — the signed-in person's own Docustay notices, as facts the browser words in its language. Any member who can see documents.
  app.get("/api/product/docustay/inbox", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const d = authoriseSection(principal.user, "/documents", { tenantIsPlatform: await tenantIsPlatform(db, tenantId) }); if (!d.allowed) throw forbidden(`refused: ${d.reason}`);
      return inbox.listInbox(db, { appUserId: principal.appUserId ?? null, tab: c.req.query("tab") ?? "all", limit: c.req.query("limit"), before: c.req.query("before") ?? null });
    }, { bucket: "app" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/inbox/settings", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const d = authoriseSection(principal.user, "/documents", { tenantIsPlatform: await tenantIsPlatform(db, tenantId) }); if (!d.allowed) throw forbidden(`refused: ${d.reason}`);
      const { rows } = await db.query(`SELECT topic, channel, enabled FROM keystone.notification_preference WHERE tenant_id = $1 AND app_user_id = $2`, [tenantId, principal.appUserId ?? null]);
      return { appUserId: principal.appUserId ?? null, kinds: inbox.INBOX_SETTINGS.map((k) => ({ key: k.key, topics: k.topics, inApp: !rows.some((r) => k.topics.includes(r.topic) && r.channel === "in_app" && r.enabled === false), email: !rows.some((r) => k.topics.includes(r.topic) && r.channel === "email" && r.enabled === false) })) };
    }, { bucket: "app" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/billing-details", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return docustay.billingDetails(db, { tenantId }); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/status", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      return docustay.workspaceStatus(db, { tenantId });
    }, { bucket: "settings" }).then((r) => c.json(r)));

  // Part 29 step 2 — platform-only (the setting `platform.docustay_viewers`; the database refuses anyone else). Opening the list also brings the "Docustay customer" Accounts rows up to date.
  app.get("/api/product/docustay/customers", (c) =>
    runTenantScoped(c, async ({ db, tenantId }) => { const sync = await accounts.syncAccounts(db, { tenantId }); return { customers: await accounts.listCustomers(db), sync }; }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/accounts/:id", (c) =>
    runTenantScoped(c, async ({ db }) => accounts.accountPanel(db, { accountId: c.req.param("id") }), { bucket: "settings" }).then((r) => c.json(r)));
  // item 5 — "Download usage report" (Settings): the five usage numbers as a file, for an install that cannot reach docustay.app. Owner only (same gate as the plan screen).
  app.get("/api/product/docustay/usage-report", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      return usageReportFor(db, { tenantId });
    }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/installs", (c) =>
    runTenantScoped(c, async ({ db }) => accounts.listInstalls(db), { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/money", (c) =>
    runTenantScoped(c, async ({ db }) => accounts.listMoney(db), { bucket: "settings" }).then((r) => c.json(r)));

  // Part 31 follow-up — the review queue for "Suggest a better translation". Viewers only: the database policy refuses everyone else, and the guard says so in plain words first.
  const viewerGuard = async (db) => { const { rows } = await db.query(`SELECT keystone.docustay_may_view() AS ok`); if (rows[0]?.ok !== true) throw forbidden("refused: translation suggestions are visible only to the people the platform names"); };
  // AI-COST-AND-USAGE-SPEC §5 — Platform > AI usage: the ceiling bar, the pause, the breakdowns and the CSV. Viewers only (the same guard, and the database refuses everyone else).
  app.get("/api/product/docustay/ai-usage", (c) =>
    runTenantScoped(c, async ({ db }) => { await viewerGuard(db); return aiUsage.summary(db); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/ai-usage.csv", async (c) => {
    const csv = await runTenantScoped(c, async ({ db }) => { await viewerGuard(db); return aiUsage.eventsCsv(db, { month: c.req.query("month") ?? null }); }, { bucket: "settings" });
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="docustay-ai-usage.csv"', "cache-control": "no-store" });
  });
  app.post("/api/product/docustay/ai-usage/ceiling", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await viewerGuard(db); const b = await c.req.json().catch(() => ({})); return aiUsage.setCeiling(db, { tenantId, usd: b?.usd, userId: principal.appUserId ?? null }); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.post("/api/product/docustay/ai-usage/pause", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await viewerGuard(db); const b = await c.req.json().catch(() => ({})); return aiUsage.setPaused(db, { tenantId, paused: b?.paused, userId: principal.appUserId ?? null }); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/translation-suggestions", (c) =>
    runTenantScoped(c, async ({ db }) => { await viewerGuard(db); const status = ["new", "approved", "rejected", "applied", "all"].includes(c.req.query("status")) ? c.req.query("status") : "new"; return { suggestions: await suggestions.listSuggestions(db, { status }) }; }, { bucket: "settings" }).then((r) => c.json(r)));
  app.get("/api/product/docustay/translation-suggestions/patch", (c) =>
    runTenantScoped(c, async ({ db }) => { await viewerGuard(db); return suggestions.approvedPatch(db); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.post("/api/product/docustay/translation-suggestions/:id/review", (c) =>
    runTenantScoped(c, async ({ db, principal }) => { await viewerGuard(db); const b = await c.req.json().catch(() => ({})); return suggestions.reviewSuggestion(db, { id: c.req.param("id"), userId: principal.appUserId ?? null, decision: b?.decision, note: b?.note }); }, { bucket: "settings" }).then((r) => c.json(r)));
  app.post("/api/product/docustay/translation-suggestions/applied", (c) =>
    runTenantScoped(c, async ({ db }) => { await viewerGuard(db); const b = await c.req.json().catch(() => ({})); const ids = Array.isArray(b?.ids) ? b.ids.filter((x) => typeof x === "string").slice(0, 500) : []; await suggestions.markApplied(db, ids); return { applied: ids.length }; }, { bucket: "settings" }).then((r) => c.json(r)));
}
