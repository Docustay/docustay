// src/product/docustayPayments.mjs — A DOCUSTAY WORKSPACE TAKES PAYMENTS INTO ITS OWN STRIPE ACCOUNT (Part 30 item 11, the maintainer 4 Oct 2026; hosted onboarding made the primary path 5 Oct 2026).
//   · "Connect Stripe" CREATES a Stripe account for the person (Accounts v1 with controller properties: full Stripe Dashboard, the account pays its own Stripe fees, Stripe collects identity, bank and terms) and sends them to Stripe's HOSTED
//     ONBOARDING through an Account Link. Return and refresh addresses travel in each API request, so nothing is registered in the Stripe dashboard and no OAuth client id is needed.
//   · WHAT THAT REALLY DOES (Stripe's current docs, read 5 Oct 2026 — specs/proofs/part-30/item-11.md): the account made here is a NEW Stripe account that the platform created and controls the relationship of. A person who already has a Stripe login can sign in
//     during hosted onboarding, and Stripe may offer to reuse their verified business details (networked onboarding), but it is still a new, separate account: the history of an account they already have does NOT come with it. The product says exactly that.
//   · OAuth stays in the code, behind KEYSTONE_STRIPE_OAUTH_ENABLED=true AND a client id; the button never needs either. (21 Oct 2026: Stripe finished the Connect review and OAuth is on in the live account, redirect URI <origin>/api/product/docustay/payments/callback; production gets both variables as part of its release.)
//   · We store ONE thing: the connected account id, with the workspace and the state (pending → live | restricted). No token, no key. Payments are DIRECT charges on that account (the Stripe-Account header) — see documentsPayments.mjs, which also decides the platform fee.
//   · The OAuth `state` is signed, expires, and is bound to the tenant AND the signed-in person (CSRF-safe). The hosted return address carries no secret: the return handler re-reads the account from Stripe and trusts only that.
//   · Disconnect clears the account id and shows "Disconnected" plainly. For an account this platform created Stripe refuses its deauthorize call (no_deauth_on_controlled_account), so we do not make it; we forget the id and the account stays in the person's Stripe login.
//     account.updated and account.application.deauthorized events re-read or clear the state (webhooks.mjs).
//   · TEST mode only until the maintainer says otherwise: the charge path (`KEYSTONE_STRIPE_CHARGES_ENABLED`) stays closed unless a person turns it on, and the sandbox runs Stripe test keys. Nothing here opens it.
import { createHmac, createHash, randomBytes } from "node:crypto";
import { stripeEnv } from "./stripeFor.mjs";
import { fetchConnectAccountStatus, connectAccount, disconnectAccount, getConnectAccountState, createConnectAccount, createAccountLink } from "../money/connect.mjs";
import { chargesEnabled } from "../money/charge.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { conflict, invalid, dependency } from "../http/errors.mjs";
import { FEE_SENTENCE } from "./docustayFee.mjs";

const CONNECT_CLIENT_VAR = "KEYSTONE_STRIPE_CONNECT_CLIENT_ID";
const STATE_MAX_AGE_MS = 15 * 60_000;
const BAD_STATE = "That connection link has expired or was not started from Payments settings. Start again from there.";
const oauthBase = (env) => String(env.KEYSTONE_STRIPE_OAUTH_URL || "https://connect.stripe.com").replace(/\/+$/, "");
const pepper = () => { const p = process.env.KEYSTONE_TOKEN_PEPPER; if (!p) throw new Error("payments: KEYSTONE_TOKEN_PEPPER is not set"); return p; };
const mac = (x) => createHmac("sha256", pepper()).update(x, "utf8").digest("base64url");
const same = (a, b) => a.length === b.length && createHash("sha256").update(a).digest().equals(createHash("sha256").update(b).digest());

/** The signed `state` of one connect attempt. */
export function signState({ tenantId, userId = null, now = Date.now() }) {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, u: userId, n: randomBytes(16).toString("base64url"), iat: now })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}
export function verifyState(state, { now = Date.now() } = {}) {
  if (typeof state !== "string" || !state.includes(".")) throw invalid(BAD_STATE);
  const [payload, sig] = state.split(".");
  if (!sig || !same(sig, mac(payload))) throw invalid(BAD_STATE);
  let d; try { d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw invalid(BAD_STATE); }
  if (!d?.t || typeof d.iat !== "number" || now - d.iat > STATE_MAX_AGE_MS || now < d.iat - 60_000) throw invalid(BAD_STATE);
  return { tenantId: d.t, userId: d.u ?? null };
}

const secretKey = (env) => { const k = String(env.KEYSTONE_STRIPE_SECRET_KEY ?? ""); if (!/^sk_(test|live)_/.test(k)) throw conflict("Stripe is not set up on this server, so payments cannot be connected yet."); return k; };
const clientId = (env) => { const c = String(env[CONNECT_CLIENT_VAR] ?? ""); if (!/^ca_[A-Za-z0-9]+$/.test(c)) throw conflict("Taking payments into your own Stripe account is not switched on for this server yet: the platform has not signed up for Stripe Connect (no Connect client id is set). Ask the person who runs this server."); return c; };

async function assertDocustay(tx, { tenantId }) {
  const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (t?.product !== "docustay") throw invalid("This is for Docustay workspaces.");
}
/** OAuth is only offered when an operator switched it on AND a client id exists AND Stripe allowed one. The Connect button works without it. */
const oauthAvailable = (env = stripeEnv("docustay")) => String(env.KEYSTONE_STRIPE_OAUTH_ENABLED ?? "") === "true" && /^ca_[A-Za-z0-9]+$/.test(String(env[CONNECT_CLIENT_VAR] ?? ""));
const mask = (id) => (id ? `acct_…${String(id).slice(-4)}` : null);

/** What the Payments screen shows. Never a key; the account id is shown masked. */
export async function paymentsStatus(tx, { tenantId, env = stripeEnv("docustay") }) {
  await assertDocustay(tx, { tenantId });
  const s = await getConnectAccountState(tx, tenantId);
  const { rows: [c] } = await tx.query(`SELECT disconnected_at, connect_via FROM keystone.connect_account WHERE tenant_id = $1`, [tenantId]);
  const enabled = await flagIsOn(tx, "stripe_enabled", tenantId);
  const key = String(env.KEYSTONE_STRIPE_SECRET_KEY ?? "");
  return {
    state: s.state, account: mask(s.stripeAccountId), direct: s.isDirectAccount === true,
    disconnected: s.state === "not_connected" && Boolean(c?.disconnected_at), disconnectedAt: c?.disconnected_at ?? null,
    connectReady: /^sk_(test|live)_/.test(key) && enabled, method: c?.connect_via ?? null, oauthAvailable: oauthAvailable(env),
    needsInfo: s.state === "pending" || s.state === "restricted",
    stripeAvailable: enabled && /^sk_(test|live)_/.test(key), mode: key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : null,
    chargesOpen: chargesEnabled(env), fee: FEE_SENTENCE,
  };
}

/**
 * Begin connecting: → { url, method } to send the person's browser to Stripe.
 * Default (and primary): create the account once, then an Account Link to Stripe's hosted onboarding. A person who comes back (closed the page, link expired) gets a fresh link for the SAME account, never a second account.
 * method "oauth": only when oauthAvailable(env).
 */
export async function startPayments(tx, { tenantId, actorUserId = null, email = null, redirectUri, returnUrl = null, refreshUrl = null, method = "hosted", env = stripeEnv("docustay"), fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  if (!(await flagIsOn(tx, "stripe_enabled", tenantId))) throw conflict("Payments are switched off for this workspace.");
  secretKey(env);
  if (method === "oauth") {
    if (!oauthAvailable(env)) throw conflict("Connecting an existing Stripe account by sign-in is not switched on for this server. Use Connect Stripe.");
    const id = clientId(env);
    const u = new URL("/oauth/authorize", oauthBase(env));
    u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", id); u.searchParams.set("scope", "read_write");
    u.searchParams.set("redirect_uri", redirectUri); u.searchParams.set("state", signState({ tenantId, userId: actorUserId }));
    if (email) u.searchParams.set("stripe_user[email]", email);
    return { url: u.toString(), method: "oauth" };
  }
  if (!returnUrl || !refreshUrl) throw invalid("payments: a return address and a refresh address are required");
  const existing = await getConnectAccountState(tx, tenantId);
  const { rows: [via] } = await tx.query(`SELECT connect_via FROM keystone.connect_account WHERE tenant_id = $1`, [tenantId]);
  let accountId = existing.stripeAccountId;
  if (accountId && existing.state === "live") return { state: "live", method: via?.connect_via ?? null };
  if (!accountId || existing.state === "not_connected") {
    ({ stripeAccountId: accountId } = await createConnectAccount({ type: "full_dashboard", email, fetchImpl, product: "docustay" }));
    await connectAccount(tx, { tenantId, stripeAccountId: accountId, state: "pending", actorUserId });
    await tx.query(`UPDATE keystone.connect_account SET connect_via = 'account_link', disconnected_at = NULL WHERE tenant_id = $1`, [tenantId]);
  }
  const link = await createAccountLink({ stripeAccountId: accountId, refreshUrl, returnUrl, fetchImpl, product: "docustay" });
  return { url: link.url, method: "hosted" };
}

/** The person came back from Stripe's hosted onboarding (return address, no state is passed): re-read the account from Stripe and record only that. → connected | needs_info | none */
export async function finishHosted(tx, { tenantId, actorUserId = null, fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  const r = await refreshPayments(tx, { tenantId, actorUserId, fetchImpl });
  return { state: r.state, flag: r.state === "live" ? "connected" : r.state === "not_connected" ? "none" : "needs_info" };
}

/** Stripe's refresh address (link expired or already used): a fresh Account Link for the same account, or → null when there is nothing to continue. */
export async function freshLink(tx, { tenantId, returnUrl, refreshUrl, fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  const s = await getConnectAccountState(tx, tenantId);
  if (!s.stripeAccountId || s.state === "not_connected" || s.state === "live") return null;
  return (await createAccountLink({ stripeAccountId: s.stripeAccountId, refreshUrl, returnUrl, fetchImpl, product: "docustay" })).url;
}

/** Stripe sent the person back with a code. Verify the state against THIS person and workspace, exchange the code for the account id, read the account from Stripe, record only the id. */
export async function finishPayments(tx, { tenantId, actorUserId = null, code, state, error = null, env = stripeEnv("docustay"), fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  if (error) return { state: "declined" };   // the person said no on Stripe's page
  const st = verifyState(state);
  if (st.tenantId !== tenantId || (st.userId ?? null) !== (actorUserId ?? null)) throw invalid(BAD_STATE);
  if (typeof code !== "string" || !/^ac_[A-Za-z0-9_]+$/.test(code)) throw invalid("Stripe did not send back a connection code. Start again from Payments settings.");
  const key = secretKey(env);
  const res = await fetchImpl(`${oauthBase(env)}/oauth/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code }).toString() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !/^acct_[A-Za-z0-9]+$/.test(String(body?.stripe_user_id ?? ""))) throw dependency(`Stripe would not complete the connection (${body?.error_description ?? body?.error ?? res.status}). Start again from Payments settings.`);
  const accountId = body.stripe_user_id;
  if (typeof body.livemode === "boolean" && body.livemode !== key.startsWith("sk_live_")) throw conflict("That Stripe connection is in the other mode (test vs live) from this server. Connect again in the same mode.");
  const acct = await fetchConnectAccountStatus({ stripeAccountId: accountId, fetchImpl, product: "docustay" });
  const state2 = acct.chargesEnabled ? "live" : acct.detailsSubmitted ? "restricted" : "pending";
  const before = await getConnectAccountState(tx, tenantId);
  if (before.stripeAccountId && before.stripeAccountId !== accountId) await disconnectAccount(tx, { tenantId, actorUserId });   // connecting a different account replaces the old one
  // one Stripe account belongs to one workspace: the table's unique account id says so: another workspace's row is not visible from here, and connectAccount comes back empty when the id belongs to someone else
  try { await connectAccount(tx, { tenantId, stripeAccountId: accountId, state: state2, actorUserId }); }
  catch (e) { if (e?.code === "23505" || /unique|duplicate key|INSERT\/UPDATE failed/i.test(e?.message ?? "")) throw conflict("That Stripe account is already connected to another Docustay workspace."); throw e; }
  await tx.query(`UPDATE keystone.connect_account SET connect_via = 'oauth', disconnected_at = NULL WHERE tenant_id = $1`, [tenantId]);
  return { state: state2 };
}

/** Re-read the account from Stripe (the person finished the last steps on Stripe, or asks "check again"). */
export async function refreshPayments(tx, { tenantId, actorUserId = null, fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  const existing = await getConnectAccountState(tx, tenantId);
  if (!existing.stripeAccountId || existing.state === "not_connected") return { state: "not_connected" };
  const st = await fetchConnectAccountStatus({ stripeAccountId: existing.stripeAccountId, fetchImpl, product: "docustay" });
  // CONNECTED means ready, not just linked: Stripe says details were submitted AND charges are enabled AND nothing is currently due (a past-due or disabled account is "needs attention", never "connected")
  const state = st.chargesEnabled && st.detailsSubmitted && !st.requirementsDue?.length && !st.pastDue && !st.disabledReason ? "live" : st.detailsSubmitted || st.chargesEnabled ? "restricted" : "pending";
  await connectAccount(tx, { tenantId, stripeAccountId: existing.stripeAccountId, state, actorUserId });
  try { (await import("./docustayStripeAccount.mjs")).forgetStripeCache(tenantId); } catch { /* the screen re-reads within a minute anyway */ }
  return { state, requirementsDue: st.requirementsDue ?? [], deadline: st.deadline ?? null };
}

/** Disconnect from this side: tell Stripe to drop Docustay's access (best effort), forget the account id, show "Disconnected". The person's Stripe account is untouched. */
export async function stopPayments(tx, { tenantId, actorUserId = null, env = stripeEnv("docustay"), fetchImpl = fetch }) {
  await assertDocustay(tx, { tenantId });
  const s = await getConnectAccountState(tx, tenantId);
  const { rows: [via] } = await tx.query(`SELECT connect_via FROM keystone.connect_account WHERE tenant_id = $1`, [tenantId]);
  // an account this platform created cannot be deauthorized from here (Stripe: no_deauth_on_controlled_account); only OAuth-linked accounts get Stripe's deauthorize call
  if (s.stripeAccountId && !s.isDirectAccount && via?.connect_via === "oauth") {
    try {
      const key = secretKey(env), id = clientId(env);
      await fetchImpl(`${oauthBase(env)}/oauth/deauthorize`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, stripe_user_id: s.stripeAccountId }).toString() });
    } catch { /* Stripe unreachable or already disconnected there: the local disconnect below is what matters */ }
  }
  return forgetAccount(tx, { tenantId, actorUserId });
}

async function forgetAccount(tx, { tenantId, actorUserId }) {
  await disconnectAccount(tx, { tenantId, actorUserId });
  await tx.query(`UPDATE keystone.connect_account SET disconnected_at = COALESCE(disconnected_at, now()) WHERE tenant_id = $1`, [tenantId]);
  return { state: "not_connected", disconnected: true };
}

/** The Connect webhook: account.updated — re-read the account from Stripe (never the event's own copy) and record its state. Idempotent. */
export async function onAccountUpdated(tx, { tenantId, accountId, actorUserId = null, fetchImpl = fetch }) {
  const s = await getConnectAccountState(tx, tenantId);
  if (!s.stripeAccountId || s.stripeAccountId !== accountId || s.state === "not_connected") return { applied: false, reason: "not_the_connected_account" };
  const r = await refreshPayments(tx, { tenantId, actorUserId, fetchImpl });
  // Stripe asked for more: the Owners are told once (plain words), and the Activity list says so
  if (r.requirementsDue?.length) { try { await (await import("./docustayStripeNotices.mjs")).onRequirementsChanged(tx, { tenantId, dueKeys: r.requirementsDue, deadline: r.deadline }); } catch { /* an email problem never fails the webhook */ } }
  return { applied: true, reason: "account_updated", state: r.state };
}

/** The Connect webhook: account.application.deauthorized — the person disconnected Docustay from their own Stripe dashboard. Idempotent. */
export async function onDeauthorized(tx, { tenantId, accountId, actorUserId = null }) {
  const s = await getConnectAccountState(tx, tenantId);
  if (!s.stripeAccountId || s.stripeAccountId !== accountId) return { applied: false, reason: "not_the_connected_account" };
  await forgetAccount(tx, { tenantId, actorUserId });
  return { applied: true, reason: "disconnected" };
}

/** Where Stripe sends the person back to: the server's own public address when it has one, else the address the request came in on (only for the person's own browser). */
export function returnOrigin({ env = stripeEnv("docustay"), headers, url }) {
  // The server's own public address wins; for Docustay that is its app address (the production API is reached through app.docustay.app, so the forwarded host is the raw Railway host, which Stripe's OAuth redirect list does not hold: found by the production smoke of 21 Oct 2026).
  // the app address first (23 Oct, R13-D181): the API host has no session cookie, so Stripe sending the person back there showed "You are signed out"
  const fixed = String(env.KEYSTONE_DOCUSTAY_APP_URL || env.KEYSTONE_PUBLIC_URL || "").replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = headers.get?.("x-forwarded-host") || headers["x-forwarded-host"], proto = headers.get?.("x-forwarded-proto") || headers["x-forwarded-proto"];
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `${proto === "http" ? "http" : "https"}://${host}`;
  return new URL(url).origin;
}
