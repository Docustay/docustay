// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A10.2 / A10.3 / A10.4 — WHO A PRACTICE'S MAIL COMES FROM.
//
// ★★★ THE POINT OF THE WHOLE THING: a session reminder leaves **the coach's** Gmail, not ours.
//     Today `send.mjs` reads ONE `KEYSTONE_EMAIL_FROM` for the entire platform, so every practice's
//     clients receive mail from the same address.
//
// ★★★ "ONE CONNECT, THEN ENUMERATE" IS TRUE ABOUT THE **GRANT**, NOT ABOUT THE **ADDRESSES**, AND
//     THE UI MUST NOT PRETEND OTHERWISE:
//       · `users.settings.sendAs.list` needs only `gmail.settings.basic` — NO second OAuth grant
//         per address, and aliases are cheap ("up to 30 email aliases for each user at no extra
//         cost").
//       · ★★ BUT ENUMERATION FINDS ONLY WHAT IS ALREADY CONFIGURED: *"Aliases don't automatically
//         enable sending. Users must manually configure them in Gmail by setting up a custom From
//         address."* A GROUP is worse — it needs `membersCanPostAsTheGroup` **and** the address
//         added as a send-as. **Membership alone puts nothing in the list.**
//
// ★★★ AND MICROSOFT IS NOT AS CLEAN — THERE IS NO EQUIVALENT: *"It's not currently possible to use
//     Microsoft Graph to query which mailboxes the authenticated user has permissions for."*
//     `proxyAddresses` is beta, read-only, admin-centre only. **So the two providers get DIFFERENT
//     UI and this module returns different shapes for them, rather than faking parity:**
//       GOOGLE    → a PICKER, from `sendAs.list`.
//       MICROSOFT → a TYPED address, VERIFIED BY ATTEMPTING A SEND, showing the provider's own
//                   refusal if the permission is not there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, conflict } from "../http/errors.mjs";
import { callOutside } from "../http/outside.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH, read fresh every call, no cache (flags.mjs's own rule).
import { withTenant } from "../db/index.mjs";
import { flagIsOn } from "../platform/flags.mjs";

export class NoUsableSender extends Error {
  constructor(message, detail = {}) { super(message); this.name = "NoUsableSender"; this.detail = detail; }
}

/**
 * ★★ ENUMERATE THE ADDRESSES A GOOGLE MAILBOX MAY SEND FROM.
 *   `fetchImpl` is injected so this is testable without a network — the same discipline
 *   `deliverEvent` uses, and for the same reason: a gate asserts WHAT WE WOULD HAVE SENT.
 * ★★★ IT RETURNS ONLY WHAT GOOGLE SAYS IS `verificationStatus: "accepted"` AND SENDABLE. Listing an
 *     address a practice cannot actually send from would put it in a picker, let somebody route
 *     invoices through it, and fail at send time — the failure furthest from the decision.
 */
// ★★★ Task 9.13 — `tenantId` IS A NEW, LEADING PARAMETER. [MEASURED] this export had ZERO callers
//     anywhere in `src/` before this task, so widening its signature breaks nothing already wired.
export async function enumerateGoogleSendAs(tenantId, accessToken, fetchImpl = fetch) {
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP, BEFORE ANYTHING ELSE.
  const mailEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "google_mail_enabled", tenantId));
  if (!mailEnabled) {
    throw new NoUsableSender(
      "google_mail_enabled is off for this practice — a platform operator turned it off. " +
      "Sending addresses cannot be listed until it is switched back on.",
      { status: null, kind: "forbidden" });
  }
  // ★ Task 9.6 (CT-064) — the transport moved onto `callOutside` (15 s default, 06 §5). What this
  //   function throws and when it throws are unchanged; only the fetch/timer underneath moved.
  const result = await callOutside(
    "google", "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
    { fetchImpl, timeoutMs: 15_000 });
  if (result.status === null) {
    throw new NoUsableSender(
      `Google could not be reached to list sending addresses (${result.timedOut ? "timed out" : result.kind ?? "dependency"}).`,
      { status: null });
  }
  // ★ Same normalisation the old bare-fetch code did: a non-JSON body becomes `{error: {message}}`
  //   so `body?.error?.message` below reads the same either way.
  const body = (result.body && typeof result.body === "object")
    ? result.body
    : (typeof result.body === "string" && result.body ? { error: { message: result.body.slice(0, 400) } } : null);
  if (!result.ok) {
    // ★★ GOOGLE'S OWN MESSAGE. If the scope is missing it says so far better than we could.
    throw new NoUsableSender(
      `Google refused the list of sending addresses: ${body?.error?.message ?? result.status}`,
      { status: result.status });
  }
  return (body?.sendAsEmail ? [body] : body?.sendAs ?? [])
    .filter((a) => a.verificationStatus === "accepted" || a.isPrimary)
    .map((a) => ({
      email: a.sendAsEmail,
      displayName: a.displayName || null,
      // ★ The durability fact the screen has to state: an alias dies with the account, a group
      //   survives the owner leaving. Google marks the primary; anything else is an alias unless
      //   the practice tells us it is a group.
      kind: a.isPrimary ? "primary" : "alias",
      origin: "enumerated",
    }));
}

/**
 * ★★★ THE RESOLVER. **IT THROWS RATHER THAN GUESSING.** [TY, RULED]
 *
 *   resolveSender(tenant, purpose)
 *     routing row → its identity's grant_state === 'usable'?  use it
 *     not 'usable'?                    ★★★ THROW, NAMING THE ADDRESS AND THE PROVIDER'S OWN ERROR
 *     no routing row, tenant default?  use it
 *     platform shared?                 use it, WITH THE PRACTICE'S DISPLAY NAME
 *     nothing verified?                ★★ THROW — never guess
 *
 * ★★★ A ROUTING ROW POINTING AT A DEAD MAILBOX IS A **LOUD** FAILURE, NEVER A QUIET FALLBACK.
 *     Silent fallback to the platform address means a practice's clients start receiving mail from
 *     a stranger, with no warning to anybody. `sendingAddress()` already throws rather than
 *     defaulting, and this inherits that instinct deliberately.
 *
 * ★★ `grant_state` IS READ THROUGH THE JOIN, NOT MIRRORED. It distinguishes `reconsent_required`
 *    (*Google refused us*) from `withdrawn` (*we withdrew*) — deliberately never called `revoked` —
 *    and stores the provider's error verbatim. That is the same they-refused-us vs we-chose-not-to
 *    distinction as accounts pause/resume, and it is already correct.
 */
export async function resolveSender(tx, { tenantId, purpose }) {
  if (!purpose) throw invalid("resolveSender needs a purpose — reminders, documents, invoices or receipts");

  const { rows } = await tx.query(
    `SELECT si.id, si.email, si.display_name, si.verified_at, si.origin, si.kind,
            gi.grant_state, gi.grant_error, gi.google_email
       FROM keystone.sender_routing sr
       JOIN keystone.sender_identity si ON si.id = sr.sender_identity_id
       LEFT JOIN keystone.google_identity gi ON gi.id = si.google_identity_id
      WHERE sr.purpose = $1`,
    [purpose]);

  if (rows.length) {
    const r = rows[0];
    // ★★★ A ROUTE THAT POINTS AT A BROKEN MAILBOX IS AN ERROR, NOT A REASON TO SEND FROM SOMEWHERE
    //     ELSE. The practice chose this address; sending from another one without telling anybody is
    //     the failure this whole module exists to prevent.
    if (r.grant_state && r.grant_state !== "usable") {
      throw new NoUsableSender(
        `${purpose} are routed through ${r.email}, and that mailbox is not usable ` +
        `(${r.grant_state}). ${r.grant_error ?? "The provider gave no further detail."} ` +
        `Reconnect it, or point ${purpose} at a different address — nothing will be sent from a ` +
        `different address on its own.`,
        { purpose, email: r.email, grantState: r.grant_state });
    }
    // ★★ AND AN UNVERIFIED ADDRESS IS NOT A SENDER. Enumeration finds only what is configured, and a
    //    typed Microsoft address is verified by attempting a send — until that has happened, this
    //    address has never been shown to work.
    if (!r.verified_at) {
      throw new NoUsableSender(
        `${purpose} are routed through ${r.email}, which has never been verified. ` +
        `Send a test from it first — an address that has not been shown to work is not a sender.`,
        { purpose, email: r.email });
    }
    return { email: r.email, displayName: r.display_name, source: "routing" };
  }

  // ★ The practice's own default, when they have set one but not routed this purpose specifically.
  const { rows: def } = await tx.query(
    `SELECT si.email, si.display_name
       FROM keystone.sender_identity si
      WHERE si.verified_at IS NOT NULL AND si.origin <> 'platform'
      ORDER BY si.created_at LIMIT 1`);
  if (def.length) return { email: def[0].email, displayName: def[0].display_name, source: "tenant_default" };

  // ★★ THE PLATFORM SHARED ADDRESS — **WITH THE PRACTICE'S DISPLAY NAME**, so a client sees who it
  //    is from even when the envelope is ours.
  const { rows: plat } = await tx.query(
    `SELECT si.email, si.display_name FROM keystone.sender_identity si
      WHERE si.origin = 'platform' LIMIT 1`);
  if (plat.length) {
    const { rows: t } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
    return { email: plat[0].email, displayName: t[0]?.name ?? plat[0].display_name, source: "platform" };
  }

  // ★★★ NOTHING VERIFIED — THROW. Falling back to `KEYSTONE_EMAIL_FROM` here is exactly the silent
  //     default this function was written to remove.
  throw new NoUsableSender(
    `This practice has no verified sending address, so ${purpose} cannot be sent. ` +
    `Connect a mailbox under Settings → Email. Nothing is sent from a shared address without that ` +
    `being set up deliberately.`,
    { purpose });
}
