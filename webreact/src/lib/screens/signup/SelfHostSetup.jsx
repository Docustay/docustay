// Batch B3 — the self-hosted install's first-run page (/setup): create the owner and the workspace with the install's setup token, sign in, and land on Documents,
// where the "email isn't set up" state is shown until email works. Only exists on a KEYSTONE_SELF_HOST=1 install (the API refuses it anywhere else).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Label } from "@/lib/components/ui/label.jsx";
import { newIdempotencyKey } from "@/lib/idempotency.js";

const json = (r) => r.json().catch(() => null);

export default function SelfHostSetup() {
  const [state, setState] = useState(null);
  const [f, setF] = useState({ token: "", org: "", email: "", password: "" });
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const set = (k) => (e) => { const v = e.currentTarget.value; setF((x) => ({ ...x, [k]: v })); };
  useEffect(() => { fetch("/api/setup/state", { cache: "no-store" }).then((r) => (r.ok ? json(r) : null)).then(setState).catch(() => setState({ selfHost: false })); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const r = await fetch("/api/setup/owner", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": key.current }, body: JSON.stringify({ setupToken: f.token.trim(), orgName: f.org, email: f.email, password: f.password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const b = await json(r);
      if (!r.ok) { setProblem(b?.error?.message ?? "Setup did not complete."); return; }
      const si = await fetch("/api/auth/local/signin", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password: f.password }) });
      const t = await json(si);
      if (!si.ok) { setProblem("Your workspace was created. Sign in with your email and password."); return; }
      const li = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": newIdempotencyKey() }, body: JSON.stringify({ idToken: t.idToken }) });
      if (!li.ok) { setProblem("Your workspace was created, but signing in did not complete. Sign in with your email and password."); return; }
      window.location.assign("/documents");
    } finally { setBusy(false); }
  }

  if (state === null) return <p className="px-7 py-12 text-ui text-mute">Loading…</p>;
  if (!state.selfHost) return <p className="px-7 py-12 text-ui text-mute" data-testid="setup-not-selfhost">This page is only used by a self-hosted install.</p>;
  if (!state.needsSetup) return <p className="px-7 py-12 text-ui text-mute" data-testid="setup-done">This install is already set up. <a href="/login" className="text-brand">Sign in</a>.</p>;
  return (
    <form onSubmit={submit} data-testid="selfhost-setup" className="mx-auto flex w-full max-w-(--size-sheet) flex-col gap-4 px-7 py-12">
      <div>
        <h1 className="m-0 text-empty-title font-medium text-ink">Set up Docustay</h1>
        <p className="m-0 mt-3 text-ui text-mute">Create the owner account for this install. The setup token is the KEYSTONE_SETUP_TOKEN value in your .env file.</p>
      </div>
      {!state.tokenConfigured ? <p className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" data-testid="setup-no-token">KEYSTONE_SETUP_TOKEN is not set on this install, so the owner cannot be created yet. Set it in .env and restart.</p> : null}
      {problem ? <p className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert" data-testid="setup-problem">{problem}</p> : null}
      <div><Label htmlFor="su-token" className="mb-1.5 block">Setup token</Label><Input id="su-token" data-testid="setup-token" value={f.token} onChange={set("token")} autoComplete="off" required /></div>
      <div><Label htmlFor="su-org" className="mb-1.5 block">Organisation name</Label><Input id="su-org" data-testid="setup-org" value={f.org} onChange={set("org")} autoComplete="organization" required /></div>
      <div><Label htmlFor="su-email" className="mb-1.5 block">Your email</Label><Input id="su-email" data-testid="setup-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></div>
      <div><Label htmlFor="su-pw" className="mb-1.5 block">Password (8 or more characters)</Label><Input id="su-pw" data-testid="setup-password" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" required /></div>
      <Button type="submit" data-testid="setup-submit" disabled={busy}>{busy ? "Creating…" : "Create owner account"}</Button>
    </form>
  );
}
