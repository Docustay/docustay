// ═══════════════════════════════════════════════════════
// MailSendingPanel — the organisation's ONE sending identity (the mail module), as a screen part. Used by Settings → Email ("Use your own domain") and by Documents → Settings → Email sending: the same
// identity, the same states, the same panel — there is no second one.
//   States (st.state): ok · pending_dns (domain added, waiting for DNS: mail still goes from the platform address, with a banner) · failed (the domain check failed) ·
//   not_configured (no provider key on this server, and no own mail server) · limit_reached (today's sending limit is used up) — plus a bounce note when addresses have bounced.
// Everything is read from and written to /api/email/*; nothing here knows which email family is being sent.
// ═══════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";

const MODE_TEXT = {
  platform: "Sending from the product's address on your behalf. Replies go to your reply-to address.",
  domain: "Sending from your own domain.",
  smtp: "Sending through your own mail server.",
};
const STATUS_TEXT = { pending: "Waiting for DNS", verified: "Verified", failed: "Could not verify" };
const BANNER = {
  not_configured: { tone: "danger", text: "Email isn't set up on this server yet, so nothing is being sent. An administrator needs to add the email provider key, or you can send through your own mail server below." },
  limit_reached: { tone: "danger", text: "Today's sending limit has been reached, so new emails are held back until it resets (midnight UTC). The limit can be raised below." },
  failed: { tone: "danger", text: "Your domain could not be verified. Check the records below at your DNS provider and press Check now." },
  pending_dns: { tone: "info", text: "Your domain is not verified yet. Until it is, email goes out from the product's address with your name on it — nothing is lost." },
};

function Copy({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="rounded border border-line px-1.5 py-0.5 text-meta text-mute hover:text-ink" onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
// The label is tied to its control by id (not only by wrapping it), and an error for the field shows directly under it.
const Field = ({ label, id, error = null, children }) => (<div className="flex flex-col gap-1 text-meta text-mute"><label htmlFor={id}>{label}</label>{children}{error ? <p id={`${id}-error`} className="m-0 text-meta text-danger" role="alert" data-testid={`${id}-error`}>{error}</p> : null}</div>);
const EMAIL_SHAPE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const FIELD_OF_SERVER_KEY = { mode: "mode", fromName: "fromName", fromAddress: "fromAddress", replyTo: "replyTo", smtpHost: "smtpHost", smtpPort: "smtpPort", smtpUser: "smtpUser", smtpSecurity: "smtpSecurity", dailyLimit: "dailyLimit" };

export default function MailSendingPanel({ onChanged = null, showIdentityForm = true }) {
  const [st, setSt] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [test, setTest] = useState(null);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const adopt = (r) => {
    setSt(r); setLoadError(null); setFieldErrors({});
    if (r?.domain?.domain) setDomain((d) => d || r.domain.domain);
    const s = r?.settings ?? {};
    setForm({ mode: s["email.provider"] ?? "platform", fromName: s["email.from_name"] ?? "", fromAddress: s["email.from_address"] ?? "", replyTo: s["email.reply_to"] ?? "", smtpHost: s["email.smtp_host"] ?? "", smtpPort: String(s["email.smtp_port"] ?? 587), smtpUser: s["email.smtp_user"] ?? "", smtpSecurity: s["email.smtp_security"] ?? "starttls", dailyLimit: r?.limit?.custom ? String(r.limit.limit) : "" });
  };
  async function load() { try { adopt(await api.mailIdentity()); } catch (e) { setLoadError(e?.message ?? "Could not load email sending"); } }
  useEffect(() => { load(); }, []);

  async function run(name, fn) {
    setBusy(name); setProblem(null);
    try { const r = await fn(); if (r && r.mode !== undefined && r.requested !== undefined) adopt(r); else await load(); onChanged?.(); return r; }
    catch (e) {
      // A refusal that names one field of the sender form goes under that field; anything else goes at the bottom.
      const field = FIELD_OF_SERVER_KEY[e?.body?.error?.detail?.field];
      if (name === "identity" && field) setFieldErrors({ [field]: e.message });
      else setProblem(e?.message ?? "That did not work.");
    }
    finally { setBusy(null); }
  }

  if (loadError) return <p className="m-0 py-3 text-meta text-danger" role="alert" data-testid="email-load-error">{loadError} <button type="button" className="underline" onClick={load}>Try again</button></p>;
  if (!st || !form) return <p className="m-0 py-3 text-meta text-mute" data-testid="email-loading">Loading email sending…</p>;

  const d = st.domain;
  const banner = BANNER[st.state];
  const set = (k) => (e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [k]: v })); setFieldErrors((x) => { if (!x[k]) return x; const { [k]: _gone, ...rest } = x; return rest; }); };   // read the value BEFORE the updater runs (the event target is gone by then)
  // Checked here first, each problem under its own field; the server checks the same things again and names the field it refused.
  const checkIdentity = () => {
    const errs = {};
    if (form.fromAddress.trim() !== "" && !EMAIL_SHAPE.test(form.fromAddress.trim())) errs.fromAddress = "Enter an email address like name@yourdomain.com.";
    if (form.replyTo.trim() !== "" && !EMAIL_SHAPE.test(form.replyTo.trim())) errs.replyTo = "Enter an email address like name@yourdomain.com.";
    const limit = form.dailyLimit.trim();
    if (limit !== "" && !(/^\d+$/.test(limit) && Number(limit) >= 1)) errs.dailyLimit = "Enter a whole number of 1 or more, or leave it empty for the default.";
    return errs;
  };
  const saveIdentity = async () => {
    const errs = checkIdentity();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    await saveIdentityNow();
  };
  const saveIdentityNow = () => run("identity", () => api.saveMailIdentity({ fields: {
    mode: form.mode, fromName: form.fromName, fromAddress: form.fromAddress, replyTo: form.replyTo,
    smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), smtpUser: form.smtpUser, smtpSecurity: form.smtpSecurity,
    dailyLimit: form.dailyLimit.trim() === "" ? null : Number(form.dailyLimit),
  } }));

  return (
    <div className="py-2" data-testid="email-panel" data-state={st.state}>
      <div className="flex flex-wrap items-center gap-2" data-testid="email-mode">
        <Badge variant={st.mode === "platform" ? "secondary" : "default"} data-testid="email-mode-badge">{st.mode === "platform" ? "Product address" : st.mode === "domain" ? "Your domain" : "Your mail server"}</Badge>
        <span className="text-meta text-ink-2">{MODE_TEXT[st.mode]}</span>
      </div>
      {banner ? <p className={`m-0 mt-2 rounded border px-3 py-2 text-meta ${banner.tone === "danger" ? "border-danger text-danger" : "border-line bg-surface-2 text-ink-2"}`} role={banner.tone === "danger" ? "alert" : "status"} data-testid="email-banner" data-banner={st.state}>{banner.text}</p> : null}
      {st.fallbackReason && !banner ? <p className="m-0 mt-2 rounded border border-line bg-surface-2 px-3 py-2 text-meta text-ink-2" role="status" data-testid="email-fallback">{st.fallbackReason}</p> : null}
      {st.bounced ? <p className="m-0 mt-2 rounded border border-line bg-surface-2 px-3 py-2 text-meta text-ink-2" role="status" data-testid="email-bounced">{st.events.bounced} email{st.events.bounced === 1 ? "" : "s"} bounced in the last 30 days. Check those addresses — people with a bounced address are not reaching their email.</p> : null}
      <p className="m-0 mt-2 text-meta text-mute" data-testid="email-from-line">
        Emails come from <strong className="font-medium text-ink">{st.mode === "domain" || st.mode === "smtp" ? `${st.from.name} <${st.from.address}>` : `${st.from.name || "your organisation"} via ${st.from.platform?.name ?? "the product"}`}</strong>
        {st.from.replyTo ? <> · replies go to <strong className="font-medium text-ink">{st.from.replyTo}</strong></> : <> · no reply-to set, so replies go to the sending address</>}.
        {" "}<span data-testid="email-limit-line">Sent today: {st.limit.sent} of {st.limit.limit}.</span>
      </p>

      {showIdentityForm ? (
        <div className="mt-4" data-testid="email-identity">
          <p className="m-0 text-ui font-medium text-ink">Who your email comes from</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Send from" id="email-identity-mode-field" error={fieldErrors.mode}><select id="email-identity-mode-field" className="h-9 rounded border border-line bg-surface px-2 text-ui text-ink" value={form.mode} onChange={set("mode")} data-testid="email-identity-mode"><option value="platform">The product's address</option><option value="domain">My own domain</option><option value="smtp">My own mail server</option></select></Field>
            <Field label="From name" id="email-identity-from-name-field" error={fieldErrors.fromName}><Input id="email-identity-from-name-field" aria-invalid={fieldErrors.fromName ? "true" : undefined} value={form.fromName} onChange={set("fromName")} placeholder="Your organisation" data-testid="email-identity-from-name" /></Field>
            <Field label="From address (own domain or server)" id="email-identity-from-address-field" error={fieldErrors.fromAddress}><Input id="email-identity-from-address-field" aria-invalid={fieldErrors.fromAddress ? "true" : undefined} value={form.fromAddress} onChange={set("fromAddress")} placeholder="hello@yourdomain.com" data-testid="email-identity-from-address" /></Field>
            <Field label="Reply-to address" id="email-identity-reply-to-field" error={fieldErrors.replyTo}><Input id="email-identity-reply-to-field" aria-invalid={fieldErrors.replyTo ? "true" : undefined} value={form.replyTo} onChange={set("replyTo")} placeholder="you@yourdomain.com" data-testid="email-identity-reply-to" /></Field>
            {form.mode === "smtp" ? (<>
              <Field label="Mail server" id="email-identity-smtp-host-field" error={fieldErrors.smtpHost}><Input id="email-identity-smtp-host-field" value={form.smtpHost} onChange={set("smtpHost")} placeholder="smtp.yourprovider.com" data-testid="email-identity-smtp-host" /></Field>
              <Field label="Port" id="email-identity-smtp-port-field" error={fieldErrors.smtpPort}><Input id="email-identity-smtp-port-field" value={form.smtpPort} onChange={set("smtpPort")} inputMode="numeric" data-testid="email-identity-smtp-port" /></Field>
              <Field label="User name" id="email-identity-smtp-user-field" error={fieldErrors.smtpUser}><Input id="email-identity-smtp-user-field" value={form.smtpUser} onChange={set("smtpUser")} data-testid="email-identity-smtp-user" /></Field>
              <Field label="Security" id="email-identity-smtp-security-field" error={fieldErrors.smtpSecurity}><select id="email-identity-smtp-security-field" className="h-9 rounded border border-line bg-surface px-2 text-ui text-ink" value={form.smtpSecurity} onChange={set("smtpSecurity")} data-testid="email-identity-smtp-security"><option value="starttls">STARTTLS (port 587)</option><option value="tls">TLS (port 465)</option><option value="none">None</option></select></Field>
            </>) : null}
            <Field label="Daily sending limit (empty = default)" id="email-identity-limit-field" error={fieldErrors.dailyLimit}><Input id="email-identity-limit-field" aria-invalid={fieldErrors.dailyLimit ? "true" : undefined} value={form.dailyLimit} onChange={set("dailyLimit")} inputMode="numeric" placeholder="Default" data-testid="email-identity-limit" /></Field>
          </div>
          <div className="mt-3"><Button type="button" size="sm" disabled={busy !== null} onClick={saveIdentity} data-testid="email-identity-save">{busy === "identity" ? "Saving…" : "Save"}</Button></div>
        </div>
      ) : null}

      <div className="mt-4" data-testid="email-domain">
        <p className="m-0 text-ui font-medium text-ink">Your own sending domain</p>
        <p className="m-0 mt-1 text-meta text-mute">Add a domain you own, publish the records below at your DNS provider, then press Check now. Until it is verified, mail goes out from the product's address.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input value={domain} onChange={(e) => setDomain(e.currentTarget.value)} placeholder="yourdomain.com" className="w-[260px] max-w-full" aria-label="Sending domain" data-testid="email-domain-input" />
          <Button type="button" size="sm" disabled={busy !== null || !domain.trim()} onClick={() => run("domain", () => api.addMailDomain({ domain: domain.trim() }))} data-testid="email-domain-add">{busy === "domain" ? "Adding…" : d ? "Change domain" : "Add domain"}</Button>
          {d ? <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("verify", () => api.verifyMailDomain())} data-testid="email-domain-verify">{busy === "verify" ? "Checking…" : "Check now"}</Button> : null}
          {d ? <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("remove", () => api.removeMailDomain())} data-testid="email-domain-remove">Remove</Button> : null}
          {d ? <Badge variant={d.status === "verified" ? "default" : d.status === "failed" ? "destructive" : "secondary"} data-testid="email-domain-status">{STATUS_TEXT[d.status]}</Badge> : null}
        </div>
        {d?.lastError ? <p className="m-0 mt-2 text-meta text-danger" role="alert" data-testid="email-domain-error">{d.lastError}</p> : null}
        {d && d.records?.length ? (
          <div className="mt-3 overflow-x-auto rounded border border-line" data-testid="email-dns-records">
            <table className="w-full min-w-[520px] text-left text-meta">
              <thead className="bg-surface-2 text-mute"><tr><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Value</th><th className="px-3 py-2 font-medium">Status</th></tr></thead>
              <tbody>
                {d.records.map((r, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-3 py-2">{r.type}{r.priority != null ? ` (${r.priority})` : ""}</td>
                    <td className="px-3 py-2 break-all">{r.name} <Copy value={r.name} /></td>
                    <td className="px-3 py-2 break-all">{r.value} <Copy value={r.value} /></td>
                    <td className="px-3 py-2">{r.status === "verified" ? "Found" : "Not found yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="mt-4" data-testid="email-smtp">
        <p className="m-0 text-ui font-medium text-ink">Your own mail server (SMTP)</p>
        <p className="m-0 mt-1 text-meta text-mute">Choose "My own mail server" above and fill in the server details, then save the password here. The password is stored encrypted and is never shown again.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} placeholder={st.smtp.passwordSet ? "Password saved — type to replace" : "Mail server password"} className="w-[260px] max-w-full" aria-label="Mail server password" data-testid="email-smtp-password" />
          <Button type="button" size="sm" disabled={busy !== null || !password} onClick={async () => { await run("pw", () => api.saveMailSmtpPassword({ password })); setPassword(""); }} data-testid="email-smtp-save">Save password</Button>
          {st.smtp.passwordSet ? <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("pw", () => api.saveMailSmtpPassword({ password: "" }))} data-testid="email-smtp-remove">Remove</Button> : null}
          <Badge variant={st.smtp.passwordSet ? "default" : "secondary"} data-testid="email-smtp-status">{st.smtp.passwordSet ? "Password saved" : "No password yet"}</Badge>
        </div>
      </div>

      <div className="mt-4" data-testid="email-test">
        <p className="m-0 text-ui font-medium text-ink">Send a test email</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input type="email" value={testTo} onChange={(e) => setTestTo(e.currentTarget.value)} placeholder="you@example.com" className="w-[260px] max-w-full" aria-label="Send the test to" data-testid="email-test-to" />
          <Button type="button" size="sm" variant="outline" disabled={busy !== null || !testTo.trim()} onClick={async () => { setTest(null); const r = await run("test", () => api.sendMailTest({ to: testTo.trim() })); if (r) setTest(r); }} data-testid="email-test-send">{busy === "test" ? "Sending…" : "Send test"}</Button>
        </div>
        {test ? (
          <p className={`m-0 mt-2 text-meta ${test.status === "sent" ? "text-ink-2" : "text-danger"}`} role={test.status === "sent" ? "status" : "alert"} data-testid="email-test-result">
            {test.status === "sent" ? `Sent ${test.mode === "platform" ? "from the product's address" : test.mode === "domain" ? "from your domain" : "through your mail server"}. Check the inbox.` : test.error || "The test email could not be sent."}
          </p>
        ) : null}
      </div>
      {problem ? <p className="m-0 mt-3 text-meta text-danger" role="alert" data-testid="email-problem">{problem}</p> : null}
    </div>
  );
}
