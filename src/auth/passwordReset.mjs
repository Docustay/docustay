// Part 29 B3 — Docustay's own "forgot password": we ask Firebase for the one-time reset code, build OUR link around it (on the Docustay app's own address), and send it through the sign-in sender from the Docustay address —
// never Firebase's default sender and never a the platform address. Same answer whether the address has an account or not (no enumeration); a per-address and per-IP budget like the sign-in code.
import { getFirebaseAuth } from "./firebase.mjs";
import { localAuthEnabled, issueLocalReset } from "./localIdentity.mjs";
import { internal } from "../http/errors.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { takeCodeRequestBudget } from "./emailCode.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {{email:string, ip?:string|null, product?:string|null}} a  @param {{auth?:object, send?:Function, env?:object}} [deps] */
export async function requestPasswordReset({ email, ip = null, product = null, lang = null }, { auth, send = sendAuthEmail, env = process.env, budget = takeCodeRequestBudget, issueLocal = issueLocalReset } = {}) {
  const to = String(email ?? "").trim().toLowerCase();
  const answer = { sent: true };
  if (!EMAIL.test(to) || to.length > 254) return answer;
  // The link must be absolute. Its base comes from configuration only (never from a request header, which an attacker controls); with none set the mail is not sent, for every address alike.
  const base = ((product === "docustay" ? env.KEYSTONE_DOCUSTAY_APP_URL : env.KEYSTONE_APP_URL) || env.KEYSTONE_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw internal(product === "docustay" ? "KEYSTONE_DOCUSTAY_APP_URL (or KEYSTONE_PUBLIC_URL) is not set — the reset link would have no address, so no reset email is sent" : "KEYSTONE_APP_URL (or KEYSTONE_PUBLIC_URL) is not set — the reset link would have no address, so no reset email is sent");
  await budget("email", to);
  await budget("ip", ip);
  let oob;
  // A deployment with no Firebase project (self-host, sandbox) resets through its own identity store: same link shape, same answer for every address.
  if (!auth && localAuthEnabled(env)) oob = await issueLocal({ email: to });
  else try {
    const link = await (auth ?? getFirebaseAuth()).generatePasswordResetLink(to);
    oob = new URL(link).searchParams.get("oobCode");
  } catch (err) {
    if (err?.code === "auth/user-not-found" || err?.errorInfo?.code === "auth/user-not-found") return answer;
    // With the identity project's "email enumeration protection" on (it is, on the shared project), asking for a reset link for an address that has no account does not answer "not found": it answers success with no link, and the admin library then throws this assertion. That is the same case, and it must get the same answer (found live 9 Oct 2026: the forgot-password screen showed "Something went wrong on our side" for any unknown address, and thereby told a stranger which addresses have accounts).
    if (/Unable to create the email action link/i.test(String(err?.message ?? ""))) return answer;
    throw err;
  }
  if (!oob) return answer;
  const url = `${base}/reset?oobCode=${encodeURIComponent(oob)}`;
  await send({ to, templateKey: "auth.password_reset", vars: { link: url }, product, lang }, { env });
  return answer;
}
