// src/auth/twoStepRoutes.mjs — the HTTP side of two-step sign-in (spec: ~/keystone/specs/v1/TWO-STEP-SPEC.md; recon: RECON-FINDINGS.md "Two-step sign-in, 20 Oct").
//   A person's second steps are an authenticator app, passkeys and security keys, plus recovery codes (src/auth/twoStep.mjs). Everything that changes them needs a PROOF when two-step is already on:
//   the person's current second step, sent in the same request ({ proof: { code } } or { proof: { passkey: { ticket, response } } }), so a stolen session alone cannot add its own method or turn it off.
//   Every database call here is short (one pooled connection for one statement); nothing holds a connection while a person types a code or waits for a device.
import { enforceFreeDeviceLimit } from "./deviceLimit.mjs";
import { parsePresented } from "./session.mjs";
import { withTenant } from "../db/index.mjs";
import { invalid, forbidden, unauthenticated, notFound } from "../http/errors.mjs";
import { takeAttempt, clearAttempts, lockedError, attemptKeyFor } from "./attemptLimit.mjs";
import { beginEnrolment, confirmEnrolment, verifyTotp, removeTotpFactor, retireBackupCodes } from "./totp.mjs";
import * as ts from "./twoStep.mjs";
import { passkeysEnabled, requestOrigin, beginRegistration, finishRegistration, listPasskeys, removePasskey, renamePasskey, beginSecondStep, finishSecondStep } from "./passkeys.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { MIN_PASSWORD, assertPassword, hasPassword, changePassword, requestPasswordRecovery, verifyRecoveryCode } from "./password.mjs";

const SECURITY_URL = () => `${(process.env.KEYSTONE_DOCUSTAY_APP_URL || "").replace(/\/+$/, "")}/settings?tab=security`;
const when = () => new Date().toUTCString();
const KIND_WORDS = { passkey: "a passkey", security_key: "a security key" };

export function registerTwoStepRoutes(app, { loadSelf, resolvePrincipal, resolvePartialSession, upgradeSession, revokeSession }) {
  // ── small helpers ────────────────────────────────────────────────────────────────────────────
  const send = (self, templateKey, vars) => sendAuthEmail({ to: self.email, templateKey, vars: { link: SECURITY_URL(), ...vars }, product: self.product ?? "docustay" }).catch(() => null);
  /** Tell the workspace's owners and admins (not the person themself). Best effort: a failed email never undoes the change. */
  async function tellOwners(self, what) {
    try {
      const owners = await withTenant(self.tenantId, async (db) => (await db.query(
        `SELECT email FROM keystone.app_user WHERE role = 'staff' AND staff_role IN ('owner', 'admin') AND archived_at IS NULL AND email IS NOT NULL AND id <> $1`, [self.appUserId])).rows);
      await Promise.allSettled(owners.slice(0, 20).map((o) => sendAuthEmail({ to: o.email, templateKey: "auth.two_step_owner_notice", vars: { person: self.email, what, when: when(), link: SECURITY_URL() }, product: self.product ?? "docustay" })));
    } catch { /* best effort */ }
  }
  const lock = async (uid, scope = "two_step") => { const n = await takeAttempt(scope, uid); if (n > 0) throw lockedError(n, "Too many tries. Try again in a few minutes."); };
  const needProof = () => { const e = forbidden("Confirm it's you first."); e.detail = { code: "proof_required" }; return e; };

  /** After a recovery code was used: note it, email the person and the owners, say how many are left. */
  async function recoveryUsed(self) {
    const s = await ts.summary(self.firebaseUid);
    await ts.recordEvent(self.firebaseUid, "recovery_code_used", { left: s.recoveryLeft });
    await send(self, "auth.recovery_code_used", { remaining: String(s.recoveryLeft), when: when() });
    await tellOwners(self, "used a recovery code to sign in");
    return s.recoveryLeft;
  }

  /** The proof a change needs when two-step is on. Returns the summary read on the way (so callers do not read it twice). */
  async function requireProof(c, self, proof) {
    const s = await ts.summary(self.firebaseUid);
    if (!s.on) return { s, used: null };
    if (!proof || typeof proof !== "object") throw needProof();
    if (proof.passkey) {
      await lock(self.firebaseUid);
      await finishSecondStep({ firebaseUid: self.firebaseUid, origin: requestOrigin(c), ticket: proof.passkey.ticket, response: proof.passkey.response });
      await clearAttempts("two_step", self.firebaseUid);
      return { s, used: "passkey" };
    }
    const r = await verifyTotp({ firebaseUid: self.firebaseUid, code: String(proof.code ?? "") });   // throws forbidden for a wrong code, rate_limited when locked
    if (r.usedBackupCode) await recoveryUsed(self);
    return { s, used: r.usedBackupCode ? "recovery" : "code" };
  }
  const methodChanged = async (self, event, change, detail = {}) => {
    await ts.forgetDevices(self.firebaseUid);   // any change to a second step forgets every remembered device
    await ts.recordEvent(self.firebaseUid, event, detail);
    await send(self, "auth.two_step_method", { change, when: when() });
  };
  /** Two-step has just stopped being on (the last method went): drop what is left, note it, tell the person and the owners. */
  async function turnedOff(self, how) {
    await ts.clearAll(self.firebaseUid);
    await ts.recordEvent(self.firebaseUid, "two_step_off", { how });
    await send(self, "auth.two_step_changed", { what: "turned off", when: when() });
    await tellOwners(self, "turned off two-step sign-in");
  }
  const turnedOn = async (self) => { await ts.recordEvent(self.firebaseUid, "two_step_on", {}); await send(self, "auth.two_step_changed", { what: "turned on", when: when() }); };
  const deviceLabel = (c) => { const ua = String(c.req.header("user-agent") ?? ""); const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device"; const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser"; return `${br} on ${os}`; };
  const rememberHere = async (c, uid) => { const { token, expires } = await ts.rememberDevice(uid, deviceLabel(c)); c.header("set-cookie", ts.trustCookie(token, expires), { append: true }); await ts.recordEvent(uid, "device_remembered", { label: deviceLabel(c) }); };

  // ── the Security page: everything in one call ───────────────────────────────────────────────
  app.get("/api/auth/two-step/overview", async (c) => {
    const self = await loadSelf(c);
    const s = await ts.summary(self.firebaseUid);
    const passkeys = passkeysEnabled() ? (await listPasskeys({ firebaseUid: self.firebaseUid })).passkeys : [];
    const devices = s.on ? await ts.listDevices(self.firebaseUid) : [];
    const activity = await ts.listEvents(self.firebaseUid, 20);
    return c.json({ passkeysAvailable: passkeysEnabled(), on: s.on, authenticatorApp: { on: s.authenticatorApp, since: s.authenticatorSince }, passkeys, recoveryLeft: s.recoveryLeft, devices, activity,
      thisDeviceRemembered: devices.length > 0 && Boolean(ts.trustTokenFrom(c.req.header("cookie"))) });
  });

  // ── authenticator app ───────────────────────────────────────────────────────────────────────
  app.post("/api/auth/two-step/start", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const { s } = await requireProof(c, self, body?.proof);
    if (s.authenticatorApp) throw invalid("You already have an authenticator app. Remove it first if you want to set up a new one.");
    const { provisioningUri } = await beginEnrolment({ firebaseUid: self.firebaseUid, email: self.email, issuer: self.productName });
    let secret = null; try { secret = new URL(provisioningUri).searchParams.get("secret"); } catch { secret = null; }
    return c.json({ secret, otpauthUrl: provisioningUri });
  });
  app.post("/api/auth/two-step/confirm", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const before = await ts.summary(self.firebaseUid);
    const { backupCodes } = await confirmEnrolment({ firebaseUid: self.firebaseUid, code: body?.code });
    let recoveryCodes = null;
    if (before.on) await retireBackupCodes({ firebaseUid: self.firebaseUid });   // they already hold a set: the ten just made are retired, the saved set stays
    else recoveryCodes = backupCodes;   // the first method: these ten ARE their recovery codes, shown once now
    if (before.on) await methodChanged(self, "authenticator_added", "An authenticator app was added to your account");
    else { await ts.forgetDevices(self.firebaseUid); await ts.recordEvent(self.firebaseUid, "authenticator_added", {}); await turnedOn(self); }
    return c.json({ confirmed: true, backupCodes: recoveryCodes, recoveryCodes });
  });
  app.post("/api/auth/two-step/authenticator/remove", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    await requireProof(c, self, body?.proof);
    if (!(await removeTotpFactor({ firebaseUid: self.firebaseUid }))) throw notFound("No authenticator app is set up.");
    const after = await ts.summary(self.firebaseUid);
    if (!after.on) await turnedOff(self, "last method removed"); else await methodChanged(self, "authenticator_removed", "The authenticator app was removed from your account");
    return c.json({ removed: true, on: after.on });
  });

  // ── turn it all off ─────────────────────────────────────────────────────────────────────────
  app.post("/api/auth/two-step/disable", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const { hasActiveOperatorGrant } = await import("./operatorSession.mjs");
    if ((await hasActiveOperatorGrant(self.firebaseUid))?.active) throw forbidden("Two-step cannot be turned off while you hold the operator grant.");
    const s = await ts.summary(self.firebaseUid);
    if (!s.on) throw forbidden("That code was not accepted.");
    await requireProof(c, self, body?.proof ?? (body?.code ? { code: body.code } : null));
    await turnedOff(self, "turned off");
    c.header("set-cookie", ts.clearTrustCookie(), { append: true });
    return c.json({ disabled: true });
  });

  // ── the person's own password (21 Oct 2026) ─────────────────────────────────────────────────
  app.get("/api/auth/password/status", async (c) => {
    const self = await loadSelf(c);
    const has = await hasPassword(self);
    const s = await ts.summary(self.firebaseUid);
    return c.json({ hasPassword: has, twoStep: s.on, minLength: MIN_PASSWORD });
  });
  /** A person with no password yet (code-only sign-up), or who forgot it, asks for a code to their own address. Same budgets as any code request. */
  app.post("/api/auth/password/request-code", async (c) => {
    const self = await loadSelf(c);
    return c.json(await requestPasswordRecovery({ email: self.email, ip: c.get("clientIp") ?? null, product: self.product === "docustay" ? "docustay" : null }));
  });
  app.post("/api/auth/password/change", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    assertPassword(body?.newPassword);
    await requireProof(c, self, body?.proof);   // a stolen session alone must not take the account
    let grant = null;
    if (body?.code) grant = (await verifyRecoveryCode({ email: self.email, code: String(body.code) })).grant;
    else if (typeof body?.currentPassword !== "string" || body.currentPassword === "") throw invalid("Enter your current password.", { field: "currentPassword" });
    return c.json(await changePassword({ self, currentPassword: body?.currentPassword ?? null, grant, newPassword: body.newPassword, signOutOthers: body?.signOutOthers !== false }));
  });

  /** The old, small status the account screen used. */
  app.get("/api/auth/two-step/status", async (c) => {
    const self = await loadSelf(c);
    const s = await ts.summary(self.firebaseUid);
    return c.json({ enabled: s.on, since: s.authenticatorSince, unusedBackupCodes: s.recoveryLeft });
  });

  // ── recovery codes ──────────────────────────────────────────────────────────────────────────
  app.post("/api/auth/two-step/recovery-codes", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const { s } = await requireProof(c, self, body?.proof);
    if (!s.on) throw invalid("Set up a way to confirm it's you first.");
    const codes = await ts.newRecoveryCodes(self.firebaseUid);
    await methodChanged(self, "recovery_codes_made", "New recovery codes were made for your account");
    return c.json({ codes });
  });

  // ── passkeys and security keys ──────────────────────────────────────────────────────────────
  app.get("/api/auth/passkeys", async (c) => { const self = await loadSelf(c); return c.json({ enabled: passkeysEnabled(), ...(passkeysEnabled() ? await listPasskeys({ firebaseUid: self.firebaseUid }) : { passkeys: [] }) }); });
  app.get("/api/auth/passkeys/status", (c) => c.json({ enabled: passkeysEnabled() }));
  app.post("/api/auth/two-step/proof/passkey/begin", async (c) => { const self = await loadSelf(c); return c.json(await beginSecondStep({ firebaseUid: self.firebaseUid, origin: requestOrigin(c) })); });
  app.post("/api/auth/passkeys/register/begin", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    await requireProof(c, self, body?.proof);
    return c.json(await beginRegistration({ firebaseUid: self.firebaseUid, email: self.email, origin: requestOrigin(c), kind: body?.kind === "security_key" ? "security_key" : "passkey" }));
  });
  app.post("/api/auth/passkeys/register/finish", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const kind = body?.kind === "security_key" ? "security_key" : "passkey";
    const before = await ts.summary(self.firebaseUid);
    const { id } = await finishRegistration({ firebaseUid: self.firebaseUid, email: self.email, origin: requestOrigin(c), ticket: body?.ticket, response: body?.response, name: body?.name, kind });
    const name = String(body?.name ?? "").trim().slice(0, 80) || (kind === "security_key" ? "Security key" : "Passkey");
    let recoveryCodes = null;
    if (before.on) await methodChanged(self, kind === "security_key" ? "security_key_added" : "passkey_added", `${kind === "security_key" ? "A security key" : "A passkey"} named “${name}” was added to your account`, { name });
    else {
      await ts.forgetDevices(self.firebaseUid); await ts.recordEvent(self.firebaseUid, kind === "security_key" ? "security_key_added" : "passkey_added", { name });
      recoveryCodes = await ts.newRecoveryCodes(self.firebaseUid);   // the first method: the person gets recovery codes now, once
      await turnedOn(self);
    }
    return c.json({ id, recoveryCodes });
  });
  app.post("/api/auth/passkeys/rename", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const r = await renamePasskey({ firebaseUid: self.firebaseUid, id: body?.id, name: body?.name });
    await ts.recordEvent(self.firebaseUid, "passkey_renamed", { name: String(body?.name ?? "").slice(0, 80) });
    return c.json(r);
  });
  app.post("/api/auth/passkeys/remove", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    await requireProof(c, self, body?.proof);
    const mine = (await listPasskeys({ firebaseUid: self.firebaseUid })).passkeys.find((p) => p.id === body?.id);
    const r = await removePasskey({ firebaseUid: self.firebaseUid, id: body?.id });
    const after = await ts.summary(self.firebaseUid);
    if (!after.on) await turnedOff(self, "last method removed");
    else await methodChanged(self, mine?.kind === "security_key" ? "security_key_removed" : "passkey_removed", `${KIND_WORDS[mine?.kind] ? KIND_WORDS[mine.kind][0].toUpperCase() + KIND_WORDS[mine.kind].slice(1) : "A passkey"} named “${mine?.name ?? "Passkey"}” was removed from your account`, { name: mine?.name ?? null });
    return c.json({ ...r, on: after.on });
  });

  // ── remembered devices ──────────────────────────────────────────────────────────────────────
  app.post("/api/auth/two-step/devices/forget", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const n = await ts.forgetDevices(self.firebaseUid, typeof body?.id === "string" ? body.id : null);
    if (n > 0) await ts.recordEvent(self.firebaseUid, "devices_forgotten", { count: n });
    if (!body?.id) c.header("set-cookie", ts.clearTrustCookie(), { append: true });
    return c.json({ forgotten: n });
  });
  /** Remember THIS browser (the option on the Security page, for a person who is already signed in). Needs a proof: it lowers the guard on this device. */
  app.post("/api/auth/two-step/devices/remember", async (c) => {
    const self = await loadSelf(c); const body = await c.req.json().catch(() => null);
    const { s } = await requireProof(c, self, body?.proof);
    if (!s.on) throw invalid("Set up a way to confirm it's you first.");
    await rememberHere(c, self.firebaseUid);
    return c.json({ remembered: true });
  });

  // ── signing in: the second step (a partial session) ─────────────────────────────────────────
  async function partial(c) {
    const principal = await resolvePrincipal(c);
    if (!principal?.sessionId) throw unauthenticated("no partial session to verify");
    const p = await resolvePartialSession(principal.sessionId);
    if (!p) throw unauthenticated("no partial session to verify");
    const row = await withTenant(p.tenantId, async (db) => (await db.query(`SELECT u.firebase_uid, u.email, t.product FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id WHERE u.id = $1`, [p.appUserId])).rows[0] ?? null);
    if (!row?.firebase_uid) throw unauthenticated("no partial session to verify");
    return { principal, uid: row.firebase_uid, self: { firebaseUid: row.firebase_uid, email: row.email, tenantId: p.tenantId, appUserId: p.appUserId, product: row.product } };
  }
  const sessionBudget = async (principal) => {
    const locked = await takeAttempt("two_step_session", attemptKeyFor(principal.sessionId));
    if (locked > 0) { await revokeSession(principal.sessionId, "logout").catch(() => {}); throw unauthenticated("no partial session to verify"); }
  };
  /** Which ways this person can confirm it's them, for the sign-in screen. */
  app.get("/api/auth/two-step/options", async (c) => {
    const { uid } = await partial(c);
    const s = await ts.summary(uid);
    return c.json({ passkey: s.passkeys + s.securityKeys > 0, authenticatorApp: s.authenticatorApp, recovery: s.recoveryLeft > 0, recoveryLeft: s.recoveryLeft });
  });
  app.post("/api/auth/two-step/verify", async (c) => {
    const { principal, uid, self } = await partial(c);
    const body = await c.req.json().catch(() => null);
    await sessionBudget(principal);
    const r = await verifyTotp({ firebaseUid: uid, code: body?.code });   // a wrong code: forbidden; a locked account: rate_limited
    let recoveryLeft = null;
    if (r.usedBackupCode) recoveryLeft = await recoveryUsed(self);
    if (!(await upgradeSession(principal.sessionId))) throw unauthenticated("no partial session to verify");
    await enforceFreeDeviceLimit({ tenantId: self.tenantId, appUserId: self.appUserId, currentTokenId: parsePresented(principal.sessionId)?.tokenId ?? null });   // 21 Oct 2026: a Free workspace is on three devices at most
    if (body?.remember === true) await rememberHere(c, uid);
    return c.json({ verified: true, usedRecoveryCode: r.usedBackupCode === true, recoveryLeft });
  });
  app.post("/api/auth/two-step/passkey/begin", async (c) => {
    const { uid } = await partial(c);
    return c.json(await beginSecondStep({ firebaseUid: uid, origin: requestOrigin(c) }));
  });
  app.post("/api/auth/two-step/passkey/finish", async (c) => {
    const { principal, uid, self } = await partial(c);
    const body = await c.req.json().catch(() => null);
    await sessionBudget(principal);
    await lock(uid);
    await finishSecondStep({ firebaseUid: uid, origin: requestOrigin(c), ticket: body?.ticket, response: body?.response });
    await clearAttempts("two_step", uid);
    if (!(await upgradeSession(principal.sessionId))) throw unauthenticated("no partial session to verify");
    await enforceFreeDeviceLimit({ tenantId: self.tenantId, appUserId: self.appUserId, currentTokenId: parsePresented(principal.sessionId)?.tokenId ?? null });   // 21 Oct 2026: a Free workspace is on three devices at most
    if (body?.remember === true) await rememberHere(c, uid);
    return c.json({ verified: true });
  });
}
