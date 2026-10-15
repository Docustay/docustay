// src/product/lifecycle.mjs — Launch step 3: THE WELCOME SERIES for a new Docustay account (welcome, then days 1, 3 and 6).
//
// What a new account got before this: one email, the sign-in code (measured 13 Oct 2026). This adds at most FOUR, over six days, to the person who created the workspace, never more than one a day:
//   step 0 welcome · step 1 "send your first document" · step 2 "make a template" · step 3 "invite a teammate".
// A step the person has already done is SKIPPED, not sent (read from what the workspace really holds, the same three facts the first-run checklist shows). Nothing is sent to a person who switched it off
// (Settings → Account, or the one-click link in every email), to an address with no postal address configured in production (the law wants one in every marketing-type email), or outside the test inboxes when the
// environment is not production (the provider call itself refuses anything not allowlisted). A step is recorded BEFORE its email is sent, so a crash between the two can lose one email but can never send one twice.
import { createHmac, timingSafeEqual } from "node:crypto";
import { withTenant, withCredentialLookup } from "../db/index.mjs";
import { deliverAsOrganisation } from "../email/deliver.mjs";
import { welcomeWords } from "../email/lifecycleEmailLanguages.mjs";
import { sendCountForPeriod, templateCreationsInPeriod } from "../documents/api.mjs";
import { teamSeatUsage } from "../people/seats.mjs";
import { invalid } from "../http/errors.mjs";

/** Whole days after sign-up on which each step becomes due (step 0 is due at once). */
const STEP_DAYS = Object.freeze([0, 1, 3, 6]);
const DAY = 86_400_000;
const FOREVER = { periodStart: new Date(0), periodEnd: new Date("2100-01-01") };

const appBase = (env = process.env) => (env.KEYSTONE_DOCUSTAY_APP_URL ? env.KEYSTONE_DOCUSTAY_APP_URL.replace(/\/+$/, "") : "https://app.docustay.app");
const secretOf = (env = process.env) => env.KEYSTONE_UNSUBSCRIBE_SECRET || env.KEYSTONE_LOCAL_AUTH_SECRET || env.KEYSTONE_SESSION_SECRET || null;
const postalAddress = (env = process.env) => (typeof env.DOCUSTAY_POSTAL_ADDRESS === "string" && env.DOCUSTAY_POSTAL_ADDRESS.trim() ? env.DOCUSTAY_POSTAL_ADDRESS.trim() : null);

/** The one-click unsubscribe token: who (tenant + user), signed. It carries no address and no name. */
export function unsubscribeToken(tenantId, userId, env = process.env) {
  const key = secretOf(env); if (!key) return null;
  const body = Buffer.from(`${tenantId}.${userId}`).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(`welcome:${body}`).digest("base64url")}`;
}
export function readUnsubscribeToken(token, env = process.env) {
  const key = secretOf(env); if (!key || typeof token !== "string") return null;
  const [body, sig] = token.split("."); if (!body || !sig) return null;
  const want = createHmac("sha256", key).update(`welcome:${body}`).digest();
  let got; try { got = Buffer.from(sig, "base64url"); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [tenantId, userId] = Buffer.from(body, "base64url").toString().split(".");
  return /^[0-9a-f-]{36}$/.test(tenantId ?? "") && /^[0-9a-f-]{36}$/.test(userId ?? "") ? { tenantId, userId } : null;
}

/** Start the series for the person who created this workspace. Idempotent; called once from activateWorkspace. */
export async function enrol(tx, { tenantId, userId, lang = "en" }) {
  if (!userId) return null;
  const l = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(lang)) ? String(lang) : "en";
  await tx.query(`INSERT INTO keystone.docustay_welcome (tenant_id, user_id, lang) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO NOTHING`, [tenantId, userId, l]);
  return { enrolled: true };
}

/** What Settings → Account shows and changes: whether this person gets the welcome emails. A person with no row (older account) has none and nothing to turn off. */
export async function preference(tx, { userId }) {
  const { rows: [r] } = await tx.query(`SELECT opted_out_at, finished_at FROM keystone.docustay_welcome WHERE user_id = $1`, [userId]);
  return { enrolled: Boolean(r), emails: Boolean(r) && !r.opted_out_at && !r.finished_at, optedOut: Boolean(r?.opted_out_at) };
}
export async function setPreference(tx, { tenantId, userId, emails }) {
  if (typeof emails !== "boolean") throw invalid("emails must be true or false");
  await tx.query(`UPDATE keystone.docustay_welcome SET opted_out_at = CASE WHEN $3 THEN NULL ELSE COALESCE(opted_out_at, now()) END WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId, emails]);
  return preference(tx, { userId });
}
/** The unsubscribe link, opened from an email with no session: the token says who. Always the same answer, so a guess learns nothing. */
export async function unsubscribeByToken(token, { env = process.env } = {}) {
  const who = readUnsubscribeToken(token, env);
  if (who) await withTenant(who.tenantId, (tx) => tx.query(`UPDATE keystone.docustay_welcome SET opted_out_at = COALESCE(opted_out_at, now()) WHERE tenant_id = $1 AND user_id = $2`, [who.tenantId, who.userId])).catch(() => {});
  return { ok: true };
}

/** Which of the steps is already done by the workspace itself (so its email is skipped). */
async function done(tx, tenantId) {
  const [sends, tpl, seats] = await Promise.all([sendCountForPeriod(tx, { tenantId, ...FOREVER }), templateCreationsInPeriod(tx, FOREVER), teamSeatUsage(tx)]);
  return { 1: sends > 0, 2: tpl > 0, 3: seats.used > 1 };
}
const linkFor = (step, env) => `${appBase(env)}${step === 0 || step === 1 ? "/create?mode=document&upload=1" : step === 2 ? "/templates" : "/people"}`;

/** Build one email: { subject, text, html, headers } — plain words, one link, the postal address, the unsubscribe line, in the person's language. */
export function buildEmail({ step, lang, tenantId, userId, env = process.env }) {
  const w = welcomeWords(lang, step), addr = postalAddress(env);
  const tok = unsubscribeToken(tenantId, userId, env);
  const unsub = `${appBase(env)}/unsubscribe?t=${tok}`;                 // the link a person clicks: a page that confirms
  const oneClick = `${appBase(env)}/api/lifecycle/unsubscribe?t=${tok}`;   // the link the mail client itself posts to (RFC 8058)
  const text = `${w.body}\n\n${w.cta}: ${linkFor(step, env)}\n\n—\n${w.foot.why}\n${w.foot.unsub}: ${unsub}\n${w.foot.settings}\n\nDocustay${addr ? `\n${addr}` : ""}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rtl = String(lang).startsWith("ar") ? ' dir="rtl"' : "";
  const site = (env.DOCUSTAY_PUBLIC_URL || "https://docustay.app").replace(/\/+$/, "");   // the final wordmark (specs/brand/docustay-logo), a PNG because mail clients do not draw SVG
  const html = `<!doctype html><html lang="${esc(lang)}"${rtl}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:24px;background:#f6f5fc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#14112b"><span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(String(w.body).slice(0, 110))}</span><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px"><img src="${esc(site)}/brand/docustay-wordmark-violet.png" alt="Docustay" height="26" style="display:block;margin:0 0 20px;height:26px;width:auto;border:0"><p style="font-size:20px;font-weight:700;margin:0 0 12px">${esc(w.subject)}</p><p style="font-size:15px;line-height:1.55;margin:0 0 20px">${esc(w.body)}</p><p style="margin:0 0 24px"><a href="${esc(linkFor(step, env))}" style="display:inline-block;background:#5a3ac1;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600">${esc(w.cta)}</a></p><p style="font-size:12px;line-height:1.5;color:#5b5878;margin:0">${esc(w.foot.why)}<br><a href="${esc(unsub)}" style="color:#5b5878">${esc(w.foot.unsub)}</a>. ${esc(w.foot.settings)}<br>Docustay${addr ? `<br>${esc(addr)}` : ""}</p></div></body></html>`;
  return { subject: w.subject, text, html, headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}

/**
 * One workspace's turn (the nightly job, and once right after sign-up for the welcome). Handles at most ONE step and sends at most ONE email.
 * `send` is injectable for tests. Returns what happened, never throws for a mail failure (the step stays recorded: the next step is a day away, a repeat of this one would risk a double).
 */
export async function runWelcomeForTenant(tenantId, { now = new Date(), env = process.env, send = deliverAsOrganisation } = {}) {
  const out = [];
  const rows = await withTenant(tenantId, async (tx) => (await tx.query(`SELECT w.user_id, w.started_at, w.lang, w.step, w.last_sent_at, u.email
      FROM keystone.docustay_welcome w JOIN keystone.app_user u ON u.id = w.user_id AND u.tenant_id = w.tenant_id
     WHERE w.tenant_id = $1 AND w.opted_out_at IS NULL AND w.finished_at IS NULL AND u.lifecycle_status <> 'former'`, [tenantId])).rows);
  for (const r of rows) {
    const next = r.step + 1;
    if (next > 3) { await withTenant(tenantId, (tx) => tx.query(`UPDATE keystone.docustay_welcome SET finished_at = now() WHERE tenant_id = $1 AND user_id = $2`, [tenantId, r.user_id])); continue; }
    const age = (now - new Date(r.started_at)) / DAY;
    if (age < STEP_DAYS[next]) { out.push({ userId: r.user_id, wait: next }); continue; }
    if (r.last_sent_at && now - new Date(r.last_sent_at) < DAY) { out.push({ userId: r.user_id, wait: "one a day" }); continue; }
    const skipped = next > 0 && (await withTenant(tenantId, (tx) => done(tx, tenantId)))[next];
    const address = postalAddress(env), key = secretOf(env);
    const blocked = !skipped && ((env.KEYSTONE_ENVIRONMENT === "production" && !address) || !key);
    // record the step first: a crash after this line loses at most this one email, never doubles it. A skipped step does not use the day (nothing was sent).
    await withTenant(tenantId, (tx) => tx.query(`UPDATE keystone.docustay_welcome SET step = $3, last_sent_at = CASE WHEN $4 THEN last_sent_at ELSE $5 END WHERE tenant_id = $1 AND user_id = $2`, [tenantId, r.user_id, next, Boolean(skipped || blocked), now]));
    if (skipped) { out.push({ userId: r.user_id, step: next, skipped: "already done" }); continue; }
    if (blocked) { out.push({ userId: r.user_id, step: next, skipped: key ? "no postal address configured" : "no signing secret" }); continue; }
    const m = buildEmail({ step: next, lang: r.lang, tenantId, userId: r.user_id, env });
    const res = await send(null, { tenantId: null, to: r.email, subject: m.subject, text: m.text, html: m.html, headers: m.headers, purpose: "welcome", product: "docustay" }, { env });
    out.push({ userId: r.user_id, step: next, status: res.status });
  }
  return out;
}

/** The workspaces whose owner's welcome has not gone out yet (a minute old or more). The worker's global tick runs the series for each: the web process cannot reach the job queue. */
export async function pendingWelcomeTenants({ limit = 25 } = {}) {
  return (await withCredentialLookup(async (db) => (await db.query(`SELECT tenant_id FROM keystone_auth.list_pending_welcomes($1)`, [limit])).rows)).map((r) => r.tenant_id);
}
