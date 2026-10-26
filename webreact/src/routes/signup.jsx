// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CREATE YOUR WORKSPACE (R3.027, webui routes/signup/+page.svelte) — served at /signup (signup.html).
// ★ Five steps: find the business → confirm what was found → the practice questions → where you are moving from →
//   account details. The step screens are R4 components (lib/screens/signup/*, home/SignupQuestions), loaded
//   through the lazy registry; their `bind:` props are the R-55 pairs (x + onXChange).
// ★★★ F780, CLOSED 1 Oct 2026 — step 5 used to be a fake six-digit "email code" screen that called
//     nothing: no endpoint ever sent a code, and nothing validated one. `submit()` below (Firebase
//     sign-up → POST /api/signup → POST /api/auth/login) was reachable from NO control anywhere in
//     the wizard. Step 5 is now the real account-details form (org name, workspace address, email,
//     password, required policy-acceptance checkbox) and its "Create workspace" button calls
//     `submit()` directly — see SignupExistingVerify.jsx's `step === 5` branch.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useRef, useState } from "react";
import AuthPanel from "@/lib/auth/AuthPanel.jsx";
import { loadBranding } from "@/lib/auth/branding.js";
import { PRODUCT_NAME } from "@/lib/auth/product.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { fileComponent } from "@/lib/app/lazyScreens.js";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import { cn } from "@/lib/utils";

const SignupForm = fileComponent("lib/screens/signup/SignupForm.jsx");
const SignupFound = fileComponent("lib/screens/signup/SignupFound.jsx");
const SignupQuestions = fileComponent("lib/screens/home/SignupQuestions.jsx");
const SignupExistingVerify = fileComponent("lib/screens/signup/SignupExistingVerify.jsx");
const DocustaySignup = fileComponent("lib/screens/signup/DocustaySignup.jsx");
const SelfHostSetup = fileComponent("lib/screens/signup/SelfHostSetup.jsx");
const isSetupPage = () => { try { return window.location.pathname === "/setup"; } catch { return false; } };
// Batch B — /signup?product=docustay (or a docustay.* host) is the Docustay sign-up: one form, a Documents-only workspace
const isDocustay = () => { try { return new URLSearchParams(window.location.search).get("product") === "docustay" || /^docustay\./i.test(window.location.hostname); } catch { return false; } };

const GUESSED_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"; } catch { return "America/Los_Angeles"; } })();
const definitiveRefusal = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;
// ★ A convenience DEFAULT only — not a validator. The real rule is validateSubdomain
//   (src/provisioning/subdomain.mjs), the intersection of every downstream system's constraints;
//   duplicating it here would risk accepting a name the server later rejects. The slug stays
//   editable and the server's own error message is what the user actually sees if it's wrong.
const suggestSlug = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);

export default function SignupPage() {
  const [apiKey, setApiKey] = useState(null);
  const [configProblem, setConfigProblem] = useState(null);
  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState("");
  const [foundBusiness, setFoundBusiness] = useState(null);
  const [found, setFound] = useState({ address: "", phone: "", website: "", hours: "", reviews: "" });
  const [earlyFinding, setEarlyFinding] = useState(null);
  const [brand, setBrand] = useState(null);
  const [problem, setProblem] = useState(null);
  const answers = useRef({ serviceType: null, teamSize: null, movingFrom: null });
  const keys = useRef({ signup: null, login: null, createdFor: null });
  const [account, setAccount] = useState({ orgName: "", slug: "", email: "", password: "", confirmPassword: "", policyAccepted: false });
  const [submitting, setSubmitting] = useState(false);
  const [codeStep, setCodeStep] = useState(null);   // { code, sentTo } while the emailed confirmation code is awaited (built-in identity only)
  const creds = useRef(account);
  creds.current = account;

  useEffect(() => {
    document.title = isDocustay() ? "Create your account · Docustay" : `Create your workspace · ${PRODUCT_NAME}`;
    fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => r.json().then((b) => ({ r, b })))
      .then(({ r, b }) => { if (r.ok && b.data.mode === "local") setApiKey("local"); else if (r.ok) setApiKey(b.data.firebase.apiKey); else setConfigProblem(b?.error?.message ?? "Sign-in is not configured on this deployment"); })
      .catch(() => setConfigProblem("Sign-in is having trouble — try again"));
    loadBranding().then(setBrand);
  }, []);

  async function submit() {
    if (!apiKey) { setProblem(configProblem ?? "Still loading — try again"); return; }
    const { orgName, slug, email, password, confirmPassword, policyAccepted } = creds.current;
    if (!orgName.trim()) { setProblem("Enter your organisation's name."); return; }
    if (!slug.trim()) { setProblem("Choose a workspace address."); return; }
    if (!email.trim()) { setProblem("Enter your email address."); return; }
    if (password.length < 6) { setProblem("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setProblem("Those passwords don't match."); return; }
    if (!policyAccepted) { setProblem("You must agree to the Terms, Privacy Policy and Data Processing Addendum."); return; }
    const sentSlug = slug.trim().toLowerCase();
    const k = keys.current;
    if (k.createdFor && (k.createdFor.slug !== sentSlug || k.createdFor.email !== email)) { k.createdFor = null; k.signup = null; k.login = null; }
    k.signup ??= newIdempotencyKey();
    setSubmitting(true);
    setProblem(null);
    try {
      let created;
      if (apiKey === "local") {   // a deployment with no Firebase project (the beta): the built-in identity, as DocustaySignup does
        const local = (path) => fetch(`/api/auth/local/${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        let lr = await local("signup");
        created = await lr.json().catch(() => null);
        // coming back after the code step was left half-way: the identity exists, so sign in to it
        if (!lr.ok && /already has an account/i.test(created?.error?.message ?? "")) { lr = await local("signin"); created = await lr.json().catch(() => null); }
        if (!lr.ok) { setProblem(created?.error?.message ?? "That email and password could not be used to create an account."); k.signup = null; return; }
      } else {
        const idt = (path) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
        created = await (await idt("signUp")).json();
        if (created?.error) {
          if (!String(created.error.message ?? "").startsWith("EMAIL_EXISTS")) { setProblem("That email and password could not be used to create an account."); k.signup = null; return; }
          const signedIn = await idt("signInWithPassword");
          if (!signedIn.ok) { setProblem("That email and password combination was not accepted."); k.signup = null; return; }
          created = await signedIn.json();
        }
      }
      await finish(created.idToken);
    } finally {
      setSubmitting(false);
    }
  }

  // POST /api/signup then sign in. On the built-in identity an unconfirmed address is refused, so the emailed code step opens instead (F64, cycle 2).
  async function finish(idToken) {
    const { orgName, slug, email, policyAccepted } = creds.current;
    const sentSlug = slug.trim().toLowerCase();
    const k = keys.current;
    k.signup ??= newIdempotencyKey();
    {
      const signupRes = await fetch("/api/signup", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": k.signup },
        body: JSON.stringify({ idToken, tenant: { slug: sentSlug, name: orgName.trim(), timezone: GUESSED_ZONE }, admin: { displayName: orgName.trim() }, policyAccepted }),
      });
      const res = await signupRes.json().catch(() => null);
      if (!signupRes.ok && apiKey === "local" && res?.error?.detail?.fields?.email === "not confirmed yet") {
        k.signup = null;
        const sent = await fetch("/api/signup/verify/request", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name: orgName.trim() }) });
        if (!sent.ok) { const b = await sent.json().catch(() => null); setProblem(b?.error?.message ?? "We couldn't send the confirmation code. Try again."); return; }
        setCodeStep({ code: "", sentTo: email }); setProblem(null); return;
      }
      if (!signupRes.ok) { if (definitiveRefusal(signupRes.status)) { k.signup = null; k.createdFor = null; } setProblem(res?.error?.message ?? "Could not create the organisation."); return; }
      k.createdFor = { slug: sentSlug, email };
      k.login ??= newIdempotencyKey();
      const logged = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": k.login }, body: JSON.stringify({ idToken }) });
      if (!logged.ok) { if (definitiveRefusal(logged.status)) k.login = null; setProblem(`${res.slug} was created. The automatic sign-in did not complete — sign in with your email and password.`); return; }
      window.location.assign("/");
    }
  }

  async function confirmCode() {
    const code = codeStep.code.trim();
    if (!/^\d{6}$/.test(code)) { setProblem("Enter the six-digit code from the email."); return; }
    setSubmitting(true); setProblem(null);
    try {
      const r = await fetch("/api/signup/verify/verify", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: codeStep.sentTo, code }) });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.idToken) { setProblem(b?.error?.message ?? "That code didn't work. Check the email, or send a new one."); return; }
      setCodeStep(null);
      await finish(b.idToken);
    } finally {
      setSubmitting(false);
    }
  }

  const setFoundField = (k) => (v) => setFound((f) => ({ ...f, [k]: v }));
  if (isSetupPage()) {
    return (
      <AuthPanel brand={null}>
        <div className="flex h-dvh flex-col bg-paper">
          <div className="flex h-18 items-center gap-4 border-b border-line px-7"><span className="text-ui font-medium">Docustay</span></div>
          <div className="flex-1 overflow-auto"><Suspense fallback={<AppSpinner />}><SelfHostSetup /></Suspense></div>
        </div>
      </AuthPanel>
    );
  }
  if (isDocustay()) {
    return (
      <AuthPanel brand={brand}>
        <div className="flex h-dvh flex-col bg-paper">
          <div className="flex h-18 items-center gap-4 border-b border-line px-7"><span className="text-ui font-medium">Docustay</span></div>
          <div className="flex-1 overflow-auto"><Suspense fallback={<AppSpinner />}><DocustaySignup apiKey={apiKey} configProblem={configProblem} /></Suspense></div>
        </div>
      </AuthPanel>
    );
  }
  // F58 — a NEW workspace is created under the platform's own brand, never a practice's logo (a stored logo address 404'd here)
  return (
    <AuthPanel brand={null}>
      <div data-testid="signup" className="flex h-dvh flex-col bg-paper">
        <div className="flex h-18 items-center gap-4 border-b border-line px-7">
          {step > 1 ? <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} className="text-empty-title leading-none text-ink" aria-label="Go back">‹</button> : null}
          <span className="text-ui font-medium">{PRODUCT_NAME}</span>
          {step === 1 ? <div className="ml-auto text-control text-mute">Already have an account? <a href="/login" className="text-brand">Sign in</a></div> : null}
        </div>
        <div className="flex flex-1 justify-center overflow-auto px-7 py-12">
          <div className="w-full max-w-(--size-sheet)">
            {/* F62 — ONE progress bar: steps 3–5 draw their own inside the step, so the shell draws it only for steps 1–2 */}
            {step <= 2 ? <div role="progressbar" aria-label="Sign-up progress" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step} className="mb-8 flex gap-1.5">{Array.from({ length: 5 }, (_, i) => <div key={i} className={cn("h-0.75 flex-1 rounded-pill", i < step ? "bg-brand" : "bg-mute-bg")} />)}</div> : null}
            {problem ? <p className="mb-4 rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert">{problem}</p> : null}
            <Suspense fallback={<AppSpinner />}>
              {step === 1 ? (
                <SignupForm businessName={businessName} onBusinessNameChange={setBusinessName} foundBusiness={foundBusiness} onFoundBusinessChange={setFoundBusiness}
                  earlyFinding={earlyFinding} onEarlyFindingChange={setEarlyFinding}
                  onContinue={() => { if (foundBusiness) setFound({ address: foundBusiness.address || "", phone: foundBusiness.phone || "", website: foundBusiness.website || "", hours: foundBusiness.hours || "", reviews: foundBusiness.reviews || "" }); setStep(2); }} />
              ) : null}
              {step === 2 ? (
                <SignupFound businessName={businessName} onBusinessNameChange={setBusinessName}
                  address={found.address} onAddressChange={setFoundField("address")} phone={found.phone} onPhoneChange={setFoundField("phone")}
                  website={found.website} onWebsiteChange={setFoundField("website")} hours={found.hours} onHoursChange={setFoundField("hours")}
                  reviews={found.reviews} onReviewsChange={setFoundField("reviews")} earlyFinding={earlyFinding} onEarlyFindingChange={setEarlyFinding}
                  onContinue={() => setStep(3)} />
              ) : null}
              {step === 3 ? <SignupQuestions mode="signup" onSubmit={(a) => { answers.current.serviceType = a.serviceType; answers.current.teamSize = a.teamSize; setStep(4); }} /> : null}
              {codeStep ? (
                <form className="flex flex-col gap-4" data-testid="signup-code-step" onSubmit={(e) => { e.preventDefault(); confirmCode(); }}>
                  <h1 className="m-0 text-page-title font-semibold tracking-tight">Check your email</h1>
                  <p className="m-0 text-ui text-mute">We sent a six-digit code to {codeStep.sentTo}. Enter it to finish creating your workspace.</p>
                  <label className="flex flex-col gap-1.5 text-ui font-medium" htmlFor="signup-code">Code
                    <input id="signup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codeStep.code}
                      onChange={(e) => setCodeStep((c) => ({ ...c, code: e.target.value.replace(/\D/g, "") }))}
                      className="h-10 rounded-control border border-line bg-surface px-3 text-ui tracking-[0.3em]" />
                  </label>
                  <button type="submit" disabled={submitting} className="h-10 rounded-control border border-brand bg-brand text-ui font-medium text-surface disabled:opacity-60">{submitting ? "Checking…" : "Confirm and create workspace"}</button>
                  <button type="button" className="text-ui text-brand underline" onClick={() => { setCodeStep(null); submit(); }}>Send a new code</button>
                </form>
              ) : step === 4 || step === 5 ? (
                <SignupExistingVerify
                  step={step}
                  onStepChange={(s, movingFrom) => {
                    if (movingFrom !== undefined) answers.current.movingFrom = movingFrom;
                    if (s === 5 && !account.orgName.trim()) {
                      setAccount((a) => ({ ...a, orgName: businessName, slug: a.slug || suggestSlug(businessName) }));
                    }
                    setStep(s);
                  }}
                  account={account}
                  onAccountChange={setAccount}
                  submitting={submitting}
                  onCreateWorkspace={submit}
                />
              ) : null}
            </Suspense>
          </div>
        </div>
      </div>
    </AuthPanel>
  );
}
