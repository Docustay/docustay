// Batch B1 — the Docustay sign-up: ONE short form (workspace name, email, password, the policy checkbox) that creates a Documents-only workspace. Same engine as the the platform sign-up
// (Firebase identity → POST /api/signup → POST /api/auth/login), plus the activation call that makes the new organisation a Docustay workspace on the Free plan, then lands on Documents.
// Served at /signup?product=docustay (and on a docustay.* host). The the platform five-step wizard is untouched.
import { useRef, useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Label } from "@/lib/components/ui/label.jsx";
import { newIdempotencyKey } from "@/lib/idempotency.js";

const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"; } catch { return "America/Los_Angeles"; } })();
const slugOf = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const suffix = () => Math.random().toString(36).slice(2, 6);
const definitive = (s) => s >= 400 && s < 500 && s !== 408 && s !== 429;

export default function DocustaySignup({ apiKey, configProblem }) {
  const [f, setF] = useState({ name: "", email: "", password: "", policy: false });
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const keys = useRef({ signup: null, login: null, activate: null, slug: null });
  const set = (k) => (e) => { const v = e.currentTarget.type === "checkbox" ? e.currentTarget.checked : e.currentTarget.value; setF((x) => ({ ...x, [k]: v })); };

  async function submit(e) {
    e?.preventDefault();
    if (!apiKey) { setProblem(configProblem ?? "Still loading — try again in a moment."); return; }
    if (!f.name.trim()) { setProblem("Enter a name for your workspace."); return; }
    if (!f.email.trim()) { setProblem("Enter your email address."); return; }
    if (f.password.length < 6) { setProblem("Choose a password of at least 6 characters."); return; }
    if (!f.policy) { setProblem("Please agree to the Terms, Privacy Policy and Data Processing Addendum."); return; }
    const k = keys.current;
    k.signup ??= newIdempotencyKey();
    k.slug ??= `${slugOf(f.name) || "docs"}-${suffix()}`;
    setBusy(true); setProblem(null);
    try {
      let created;
      if (apiKey === "local") {   // a deployment with no Firebase project: the built-in identity
        const lr = await fetch("/api/auth/local/signup", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password: f.password }) });
        created = await lr.json().catch(() => null);
        if (!lr.ok) { setProblem(created?.error?.message ?? "Could not create the account."); k.signup = null; return; }
      } else {
        const idt = (path) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password: f.password, returnSecureToken: true }) });
        created = await (await idt("signUp")).json();
        if (created?.error) {
          if (!String(created.error.message ?? "").startsWith("EMAIL_EXISTS")) { setProblem("That email and password could not be used to create an account."); k.signup = null; return; }
          const back = await idt("signInWithPassword");
          if (!back.ok) { setProblem("That email already has an account, and the password did not match it."); k.signup = null; return; }
          created = await back.json();
        }
      }
      const su = await fetch("/api/signup", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": k.signup },
        body: JSON.stringify({ idToken: created.idToken, tenant: { slug: k.slug, name: f.name.trim(), timezone: ZONE }, admin: { displayName: f.name.trim() }, policyAccepted: f.policy }) });
      const res = await su.json().catch(() => null);
      if (!su.ok) { if (definitive(su.status)) { k.signup = null; k.slug = null; } setProblem(res?.error?.message ?? "Could not create the workspace."); return; }
      k.login ??= newIdempotencyKey();
      const li = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": k.login }, body: JSON.stringify({ idToken: created.idToken }) });
      if (!li.ok) { setProblem("Your workspace was created, but signing in did not complete. Sign in with your email and password."); return; }
      k.activate ??= newIdempotencyKey();
      const act = await fetch("/api/product/docustay/activate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": k.activate }, body: "{}" });
      if (!act.ok) { setProblem("Your workspace was created, but setting it up as a Docustay workspace did not complete. Sign in and try again."); return; }
      window.location.assign("/documents");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} data-testid="docustay-signup" className="mx-auto flex w-full max-w-(--size-sheet) flex-col gap-4 px-7 py-12">
      <div>
        <h1 className="m-0 text-empty-title font-medium text-ink">Create your Docustay account</h1>
        <p className="m-0 mt-3 text-ui text-mute">Upload a document, send it, get it signed and sealed. Free to start.</p>
      </div>
      {problem ? <p className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert" data-testid="docustay-signup-problem">{problem}</p> : null}
      <div><Label htmlFor="ds-name" className="mb-1.5 block">Your name or organisation</Label><Input id="ds-name" data-testid="docustay-signup-name" value={f.name} onChange={set("name")} autoComplete="organization" required /></div>
      <div><Label htmlFor="ds-email" className="mb-1.5 block">Email</Label><Input id="ds-email" data-testid="docustay-signup-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></div>
      <div><Label htmlFor="ds-pw" className="mb-1.5 block">Password</Label><Input id="ds-pw" data-testid="docustay-signup-password" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" required /></div>
      <label className="flex cursor-pointer items-start gap-2.5 text-control text-mute">
        <input type="checkbox" data-testid="docustay-signup-policy" checked={f.policy} onChange={set("policy")} className="mt-0.5" required />
        <span>I agree to the <a href="https://app.example.com/legal/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a>, <a href="https://app.example.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a> and <a href="https://app.example.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="underline">Data Processing Addendum</a>.</span>
      </label>
      <Button type="submit" data-testid="docustay-signup-submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
      <p className="m-0 text-control text-mute">Already have an account? <a href="/login" className="text-brand">Sign in</a></p>
    </form>
  );
}
