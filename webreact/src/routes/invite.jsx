// ACCEPT AN INVITATION (R3.024, webui routes/invite/+page.svelte). `data` = { invite } | { problem } from the loader
// (publicRoutes.js). The invitation is to THIS address, shown as text, never an editable field. "Create a password"
// falls back to "Enter your existing password" when Firebase already knows the email.
import { useEffect, useRef, useState } from "react";
import AuthPanel from "@/lib/auth/AuthPanel.jsx";
import { loadBranding } from "@/lib/auth/branding.js";
import { PRODUCT_NAME } from "@/lib/auth/product.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Label } from "@/lib/components/ui/label";

const DEAD_LINK_COPY = "This invitation is no longer valid. Ask whoever invited you to send a new one.";
const definitiveRefusal = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const Problem = ({ children, testId }) => <p className="m-0 mt-4 rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert" data-testid={testId}>{children}</p>;

export default function InvitePage({ data }) {
  const invite = data?.invite ?? null;
  const [apiKey, setApiKey] = useState(null);
  const [configProblem, setConfigProblem] = useState(null);
  const [brand, setBrand] = useState(null);
  const [token, setToken] = useState(null);
  const [accountMode, setAccountMode] = useState("create");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const acceptKey = useRef(null);

  useEffect(() => {
    document.title = `Accept your invitation · ${PRODUCT_NAME}`;
    fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => r.json().then((b) => ({ r, b })))
      .then(({ r, b }) => { if (r.ok) setApiKey(b.data.firebase.apiKey); else setConfigProblem(b?.error?.message ?? "Sign-in is not configured on this deployment"); })
      .catch(() => setConfigProblem("Sign-in is having trouble — try again"));
    setToken(new URLSearchParams(window.location.search).get("token"));
    loadBranding().then(setBrand);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey) { setProblem(configProblem ?? "Still loading — try again"); return; }
    if (!invite || !token) { setProblem(DEAD_LINK_COPY); return; }
    if (invite.phoneRequired && phone.replace(/[^0-9]/g, "").length < 7) { setProblem("Enter your mobile number."); return; }
    setBusy(true); setProblem(null);
    try {
      const idt = (path) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: invite.email, password, returnSecureToken: true }) });
      let idToken;
      if (accountMode === "create") {
        const res = await idt("signUp"); const body = await res.json();
        if (!res.ok) {
          const code = body?.error?.message ?? "";
          if (code.startsWith("EMAIL_EXISTS")) { setAccountMode("existing"); setPassword(""); return; }
          setProblem(code.startsWith("WEAK_PASSWORD") ? "That password is too short — use at least six characters." : "That password could not be used.");
          return;
        }
        idToken = body.idToken;
      } else {
        const res = await idt("signInWithPassword"); const body = await res.json();
        if (!res.ok) { setProblem("That email and password combination was not accepted."); return; }
        idToken = body.idToken;
      }
      acceptKey.current ??= newIdempotencyKey();
      const accepted = await fetch("/api/auth/invite/accept", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": acceptKey.current }, body: JSON.stringify({ token, idToken, ...(invite.phoneRequired ? { mobilePhone: phone.trim() } : {}) }) });
      if (!accepted.ok) { if (definitiveRefusal(accepted.status)) acceptKey.current = null; setProblem("Could not finish accepting the invitation. Try again."); return; }
      acceptKey.current = null;
      window.location.assign("/");
    } catch (err) { setProblem(`Could not accept the invitation: ${err.message}`); } finally { setBusy(false); }
  };

  const h1 = "mt-0 text-page-title font-semibold tracking-tight";
  if (configProblem) {
    return <AuthPanel brand={null}><div data-testid="invite"><h1 className={`${h1} mb-4`}>{PRODUCT_NAME} cannot sign you in</h1><p className="m-0 text-control text-ink-2">{configProblem}</p></div></AuthPanel>;
  }
  return (
    <AuthPanel brand={brand}>
      <div data-testid="invite">
        {!invite ? (
          <div data-testid="invite-dead">
            <h1 className={`${h1} mb-4`}>Invitation link</h1>
            <Problem>{DEAD_LINK_COPY}</Problem>
            <a className="mt-4 block text-center text-control text-brand no-underline hover:underline" href="/login" data-testid="go-to-login">Go to sign in</a>
          </div>
        ) : (
          <>
            <h1 className={`${h1} mb-6 font-normal`} data-testid="invite-inviter"><strong className="font-semibold">{invite.inviterName}</strong> invited you to join <strong className="font-semibold">{invite.practiceName}</strong></h1>
            <form onSubmit={handleSubmit} noValidate>
              <p className="mt-0 mb-4 text-control text-mute" data-testid="invite-email">{invite.email}</p>
              <Label htmlFor="ks-invite-password" className="mb-1.5 block">{accountMode === "existing" ? "Enter your existing password" : "Create a password"}</Label>
              <Input id="ks-invite-password" type="password" autoComplete={accountMode === "existing" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="invite-password" />
              {invite.phoneRequired ? (<>
                <Label htmlFor="ks-invite-phone" className="mt-4 mb-1.5 block">Mobile number</Label>
                <Input id="ks-invite-phone" type="tel" autoComplete="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="invite-phone" />
              </>) : null}
              {problem ? <Problem testId="invite-problem">{problem}</Problem> : null}
              <Button className="mt-5 w-full" type="submit" disabled={busy} data-testid="invite-submit">{busy ? "Creating…" : "Create my account"}</Button>
            </form>
          </>
        )}
      </div>
    </AuthPanel>
  );
}
