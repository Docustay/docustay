// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SIGN IN (R3.025, webui routes/login/+page.svelte) — served by the server itself at /login (login.html), so the
// sign-in POST sets the HOST-ONLY HttpOnly ks_session the app then sends back. No token crosses a boundary.
// ★ One field that takes either an email or a mobile number; the email branch asks for a password (or an emailed
//   six-digit code — offered UNCONDITIONALLY, so its presence is never an account-existence oracle).
// ★ Config comes from GET /api/auth/config at runtime: an unconfigured deployment fails LOUD with the server's words.
// ★ 403 with a `correctHost` on this site's own registrable domain → "this practice signs in at …" and go there.
// ★ Keeps #ks-identifier / #ks-password and every login-* testid (TESTID-CONTRACT, the harness reads them).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import AuthPanel from "@/lib/auth/AuthPanel.jsx";
import GoogleMark from "@/lib/auth/GoogleMark.jsx";
import { loadBranding } from "@/lib/auth/branding.js";
import { classifyIdentifier } from "@/lib/auth/phone.js";
import { PRODUCT_NAME } from "@/lib/auth/product.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { requestCode, verifyCode, exchangeCustomToken } from "@/lib/auth/codeSignIn.js";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Label } from "@/lib/components/ui/label";

const definitiveRefusal = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const BARE_HOSTNAME = /^[A-Za-z0-9.-]+$/;
const registrableSuffix = (hostname) => { const p = String(hostname ?? "").toLowerCase().split(".").filter(Boolean); return p.length >= 2 ? p.slice(-2).join(".") : p.join("."); };
function resolveCorrectHost(rawHost, currentHostname) {
  if (typeof rawHost !== "string" || !rawHost || !BARE_HOSTNAME.test(rawHost)) return null;
  const suffix = registrableSuffix(currentHostname);
  if (!suffix) return null;
  const host = rawHost.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`) ? rawHost : null;
}
const WRONG_ADDRESS_REDIRECT_DELAY_MS = 1200;
const TWO_STEP_FAILURE_MESSAGE = "That code did not match. Try again, or use a backup code.";

const Problem = ({ children }) => <p className="mt-4 mb-0 rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert" data-testid="login-problem">{children}</p>;
const Quiet = (props) => <Button type="button" variant="ghost" className="mt-3 w-full" {...props} />;

export default function LoginPage() {
  const [apiKey, setApiKey] = useState(null);
  const localMode = useRef(false);
  const [configProblem, setConfigProblem] = useState(null);
  const [stage, setStage] = useState("identify");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [twoStepCode, setTwoStepCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [brand, setBrand] = useState(null);
  const [chosenSlug, setChosenSlug] = useState(null);
  const [practices, setPractices] = useState([]);
  const loginKey = useRef(null);
  // ★ The Firebase ID token from the identify step, held only long enough to resubmit it with a
  //   chosen practice slug when there is more than one — see completeLogin's needsPracticePick
  //   branch. Never sent anywhere but this same /api/auth/login call; never rendered.
  const pendingIdToken = useRef(null);
  const heading = brand?.displayName ? `Sign in to ${brand.displayName}` : `Sign in to ${PRODUCT_NAME}`;

  useEffect(() => {
    document.title = `Sign in · ${PRODUCT_NAME}`;
    fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => r.json().then((b) => ({ r, b })))
      .then(({ r, b }) => { if (r.ok && b.data.mode === "local") { localMode.current = true; setApiKey("local"); } else if (r.ok) setApiKey(b.data.firebase.apiKey); else setConfigProblem(b?.error?.message ?? "Sign-in is not configured on this deployment"); })
      .catch(() => setConfigProblem("Sign-in is having trouble — try again"));
    const q = new URLSearchParams(window.location.search).get("tenant");
    setChosenSlug(q && q.trim() ? q.trim() : null);
    loadBranding().then(setBrand);
  }, []);

  const handleContinue = (e) => {
    e.preventDefault(); setProblem(null);
    const { kind, value } = classifyIdentifier(identifier);
    if (kind === "email") { setEmail(value); setStage("password"); return; }
    if (kind === "phone") {
      setProblem(value ? "Signing in by phone is not available yet. Use your email address and password." : "That looks like a phone number but it is missing a country code. Try it as +1 510 555 0100.");
      return;
    }
    setProblem("Enter the email address or mobile number you use for this practice.");
  };

  const completeLogin = async (idToken, { pickedSlug = null } = {}) => {
    loginKey.current ??= newIdempotencyKey();
    const who = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": loginKey.current }, credentials: "same-origin",
      body: JSON.stringify({ idToken, tenantSlug: pickedSlug ?? chosenSlug ?? brand?.slug ?? null }),
    });
    if (!who.ok) {
      if (definitiveRefusal(who.status)) loginKey.current = null;
      if (who.status === 403) {
        const body = await who.json().catch(() => null);
        const correctHost = resolveCorrectHost(body?.error?.detail?.correctHost, window.location.hostname);
        // ★ the maintainer, 28 Sep 2026 — NO "this practice's sign-in page is at ..." message. The practice's
        //   own host still can't finish this sign-in for a wrong-address visit without new
        //   credentials there (see login.jsx's own header on the app.-only handoff), so this stays
        //   a redirect rather than an on-the-spot handoff — but it now happens quietly, with
        //   `busy` driving the same loading treatment a normal sign-in shows, not an error banner.
        if (correctHost) {
          setBusy(true);
          setTimeout(() => window.location.assign(`https://${correctHost}/login`), WRONG_ADDRESS_REDIRECT_DELAY_MS);
        } else setProblem("That sign-in does not have access to the practice at this address.");
      } else setProblem(who.status === 401 ? "Your sign-in could not be verified. Try again." : "Sign-in failed. Try again.");
      return;
    }
    const body = await who.json().catch(() => null);
    // ★★★ the maintainer, 28 Sep 2026 — THE PRACTICE PICKER. More than one membership and nothing has
    //   narrowed it yet: hold onto the idToken (it is NOT consumed by a failed attempt — Firebase
    //   ID tokens are reusable within their own short window) and show "choose your practice".
    //   Picking one resubmits the SAME idToken with that slug, which narrows cleanly server-side.
    if (body?.needsPracticePick) {
      pendingIdToken.current = idToken;
      setPractices(body.practices ?? []);
      setStage("practices");
      return;
    }
    // ★★★ the maintainer, 28 Sep 2026 — THE APP.-DOMAIN HANDOFF. `POST /api/auth/login` on the central
    //   `app.{domain}` host never sets a cookie (src/auth/install.mjs's own header says why) —
    //   it hands back the practice's own address, with a one-time token already in the query
    //   string, and THIS is the entire client-side handling the ruling asks for: follow it. No
    //   second password, no intermediate screen — `GET .../api/auth/handoff/redeem` on the far
    //   end sets the real cookie and redirects straight into the app.
    if (body?.redirectTo) { setBusy(true); window.location.assign(body.redirectTo); return; }
    if (body?.requiresTwoStep) { setTwoStepCode(""); setStage("two-step"); return; }
    loginKey.current = null;
    window.location.assign("/");
  };

  const handlePickPractice = async (slug) => {
    if (!pendingIdToken.current || busy) return;
    setBusy(true); setProblem(null);
    try { await completeLogin(pendingIdToken.current, { pickedSlug: slug }); }
    catch (err) { setProblem(`Sign-in failed: ${err.message}`); }
    finally { setBusy(false); }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    if (!apiKey) { setProblem(configProblem ?? "Still loading — try again"); return; }
    setBusy(true); setProblem(null);
    try {
      // Batch B — a deployment with no Firebase project signs in with its own built-in identity (same idToken contract afterwards)
      const res = localMode.current
        ? await fetch("/api/auth/local/signin", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })
        : await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
          });
      const payload = await res.json();
      if (!res.ok) {
        const failure = localMode.current ? "" : (payload?.error?.message ?? "");
        setProblem(failure.startsWith("TOO_MANY_ATTEMPTS") || failure.includes("BLOCKED") ? "Too many attempts. Wait a few minutes and try again." : "That email and password combination was not accepted.");
        loginKey.current = null;
        return;
      }
      await completeLogin(payload.idToken);
    } catch (err) { setProblem(`Sign-in failed: ${err.message}`); } finally { setBusy(false); }
  };
  const handleUseCode = async () => { setProblem(null); try { await requestCode(email); setStage("code"); } catch (err) { setProblem(err.message); } };
  const handleResendCode = async () => { setProblem(null); try { await requestCode(email); } catch (err) { setProblem(err.message); } };
  const handleCode = async (e) => {
    e.preventDefault();
    if (!apiKey) { setProblem(configProblem ?? "Still loading — try again"); return; }
    setBusy(true); setProblem(null);
    try { const { customToken } = await verifyCode(email, code); const { idToken } = await exchangeCustomToken(customToken, apiKey); await completeLogin(idToken); }
    catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const handleTwoStep = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/auth/two-step/verify", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ code: twoStepCode }) });
      if (!res.ok) { setProblem(TWO_STEP_FAILURE_MESSAGE); return; }
      loginKey.current = null;
      window.location.assign("/");
    } catch { setProblem(TWO_STEP_FAILURE_MESSAGE); } finally { setBusy(false); }
  };
  const handleGoogle = () => setProblem("Continue with Google is not switched on yet — it is waiting on Google's verification review. Use your email address and password.");

  if (configProblem) {
    return (
      <AuthPanel brand={null}>
        <div data-testid="login-misconfigured">
          <h1 className="mt-0 mb-4 text-page-title font-semibold tracking-tight">{PRODUCT_NAME} cannot sign you in</h1>
          <p className="m-0 text-control text-ink-2">{configProblem}</p>
        </div>
      </AuthPanel>
    );
  }
  const identity = <p className="mt-0 mb-4 text-control text-mute" data-testid="login-identity">{email}</p>;
  const pickerHeading = stage === "practices" ? "Choose your practice" : heading;
  return (
    <AuthPanel brand={brand} panelKey={stage}>
      <div data-testid="login">
        <h1 className="mt-0 mb-6 text-page-title font-semibold tracking-tight" data-testid="login-title">{pickerHeading}</h1>
        {stage === "practices" ? (
          <div data-testid="login-practices">
            <p className="mt-0 mb-4 text-control text-mute">This email signs in to more than one practice.</p>
            <div className="flex flex-col gap-2">
              {practices.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  disabled={busy}
                  onClick={() => handlePickPractice(p.slug)}
                  data-testid="login-practice-option"
                  className="flex items-center gap-3 rounded-sm border border-line px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60"
                >
                  {p.logoUrl ? (
                    <img src={p.logoUrl} alt={p.displayName} className="h-8 w-8 shrink-0 rounded-sm object-contain" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-control font-medium text-ink-2">
                      {p.displayName?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="text-control font-medium text-ink">{p.displayName}</span>
                </button>
              ))}
            </div>
            {problem ? <Problem>{problem}</Problem> : null}
            <Quiet data-testid="login-back" onClick={() => { setStage("identify"); setPractices([]); pendingIdToken.current = null; setProblem(null); }}>Use a different account</Quiet>
          </div>
        ) : stage === "identify" ? (
          <form onSubmit={handleContinue} noValidate>
            <Label htmlFor="ks-identifier" className="mb-1.5 block">Email or mobile number</Label>
            <Input id="ks-identifier" type="text" inputMode="email" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            {problem ? <Problem>{problem}</Problem> : null}
            <Button className="mt-5 w-full" type="submit" data-testid="login-continue">Continue</Button>
            <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-line" /><span className="text-caption text-mute">or</span><span className="h-px flex-1 bg-line" /></div>
            <button type="button" onClick={handleGoogle} data-testid="login-google"
              className="flex h-10 w-full items-center justify-center gap-3 rounded-sm border border-google-border bg-white px-3 text-control font-medium text-google-ink hover:bg-google-hover">
              <GoogleMark /><span>Continue with Google</span>
            </button>
            <a className="mt-4 block text-center text-control text-brand no-underline hover:underline" href="/signup" data-testid="go-to-signup">Create a new workspace</a>
          </form>
        ) : stage === "password" ? (
          <form onSubmit={handlePassword} noValidate>
            {identity}
            <Label htmlFor="ks-password" className="mb-1.5 block">Password</Label>
            <Input id="ks-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            {problem ? <Problem>{problem}</Problem> : null}
            <Button className="mt-5 w-full" type="submit" disabled={busy} data-testid="login-submit">{busy ? "Signing in…" : "Sign in"}</Button>
            <Quiet data-testid="login-back" onClick={() => { setStage("identify"); setPassword(""); setProblem(null); }}>Use a different account</Quiet>
            <Quiet data-testid="login-use-code" onClick={handleUseCode}>Email me a code instead</Quiet>
          </form>
        ) : stage === "code" ? (
          <form onSubmit={handleCode} noValidate>
            {identity}
            <Label htmlFor="ks-code" className="mb-1.5 block">6-digit code</Label>
            <Input id="ks-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} data-testid="login-code" />
            {problem ? <Problem>{problem}</Problem> : null}
            <Button className="mt-5 w-full" type="submit" disabled={busy} data-testid="login-code-submit">{busy ? "Signing in…" : "Sign in"}</Button>
            <Quiet data-testid="login-code-resend" onClick={handleResendCode}>Send it again</Quiet>
            <Quiet data-testid="login-back" onClick={() => { setStage("identify"); setCode(""); setProblem(null); }}>Use a different account</Quiet>
          </form>
        ) : (
          <form onSubmit={handleTwoStep} noValidate>
            <p className="mt-0 mb-4 text-control text-mute">Enter the six-digit code from your authenticator app.</p>
            <Label htmlFor="ks-two-step" className="mb-1.5 block">6-digit code</Label>
            <Input id="ks-two-step" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={twoStepCode} onChange={(e) => setTwoStepCode(e.target.value)} data-testid="login-two-step" />
            {problem ? <Problem>{problem}</Problem> : null}
            <Button className="mt-5 w-full" type="submit" disabled={busy} data-testid="login-two-step-submit">{busy ? "Signing in…" : "Sign in"}</Button>
            <Quiet data-testid="login-two-step-backup" onClick={handleTwoStep}>Use a backup code instead</Quiet>
          </form>
        )}
      </div>
    </AuthPanel>
  );
}
