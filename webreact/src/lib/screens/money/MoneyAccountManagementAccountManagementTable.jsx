// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.036.T1 — MoneyAccountManagement › MoneyAccountManagementAccountManagementTable
// ★ the maintainer's ruling, 28 Sep 2026 — no embedded Stripe screens. Real business details, bank account, and
//   payout schedule, read and written directly against Stripe's Account object
//   (GET/POST /api/money/account → src/money/accountManagement.mjs). Bank account and legal-entity
//   fields are read-only here — changing those needs Stripe's own verification flow, the same
//   exception the maintainer carved out for new-account onboarding (a hosted redirect, not an embed).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Field, FieldLabel, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function MoneyAccountManagementAccountManagementTable({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [account, setAccount] = useState(null);
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [statementDescriptor, setStatementDescriptor] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setPhase("loading");
      const res = await request("/api/money/account");
      setAccount(res);
      setSupportEmail(res.supportEmail ?? "");
      setSupportPhone(res.supportPhone ?? "");
      setSupportUrl(res.supportUrl ?? "");
      setStatementDescriptor(res.statementDescriptor ?? "");
      setPhase("ready");
    } catch (err) {
      if (err?.status === 403) setPhase("denied");
      else { setError(err); setPhase("error"); }
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await request("/api/money/account", {
        method: "POST",
        body: { supportEmail, supportPhone, supportUrl, statementDescriptor },
      });
      setAccount(res);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  if (phase === "loading") return <ScreenState phase="loading" />;
  if (phase === "denied") return <ScreenState phase="denied" />;
  if (phase === "error") return <ScreenState phase="error" error={error} onRetry={load} />;

  return (
    <LedgerPage
      title="Account management"
      summary="Business details, bank account and payout schedule on your Stripe account."
      onNavigate={onNavigate}
    >
      <div className="flex flex-col gap-5.5 max-w-2xl" data-testid="money-account-management-form">
        {/* Business identity — read-only, needs Stripe's own verification to change */}
        <div className="rounded-card border border-line bg-surface p-4.25">
          <div className="mb-3.5 flex items-center justify-between">
            <b className="text-sm font-semibold">Business</b>
            <span className="text-xs text-mute">{account?.accountType === "standard" ? "Your own Stripe account" : account?.accountType}</span>
          </div>
          <div className="text-ui text-ink">{account?.businessName ?? "—"}</div>
          {account?.address && (
            <div className="mt-1 text-xs text-mute">
              {account.address.line1}{account.address.line2 ? `, ${account.address.line2}` : ""}, {account.address.city}, {account.address.state} {account.address.postal_code}
            </div>
          )}
          <div className="mt-2 text-xs text-mute">
            {account?.chargesEnabled ? "Charges enabled" : "Charges not yet enabled"} · {account?.payoutsEnabled ? "Payouts enabled" : "Payouts not yet enabled"}
          </div>
          {account?.requirementsDue?.length > 0 && (
            <div className="mt-2 text-xs text-warn">
              Stripe needs: {account.requirementsDue.join(", ")}
            </div>
          )}
        </div>

        {/* Support contact — real, editable, writes to Stripe */}
        <div className="rounded-card border border-line bg-surface p-4.25">
          <b className="mb-3.5 block text-sm font-semibold">Support contact</b>
          <div className="flex flex-col gap-3.5">
            <Field>
              <FieldLabel>Support email</FieldLabel>
              <Input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@yourpractice.com" data-testid="account-support-email" />
            </Field>
            <Field>
              <FieldLabel>Support phone</FieldLabel>
              <Input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="+1 555 555 5555" data-testid="account-support-phone" />
            </Field>
            <Field>
              <FieldLabel>Support website</FieldLabel>
              <Input value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://yourpractice.com" data-testid="account-support-url" />
            </Field>
            <Field>
              <FieldLabel>Statement descriptor</FieldLabel>
              <Input value={statementDescriptor} onChange={(e) => setStatementDescriptor(e.target.value.slice(0, 22))} maxLength={22} data-testid="account-statement-descriptor" />
              <FieldDescription>What shows on a client's card statement. 22 characters max — Stripe's own limit.</FieldDescription>
            </Field>
          </div>
          {saveError && <ErrorPanel error={{ message: saveError }} variant="band" testId="account-save-error" />}
          <div className="mt-3.5 flex items-center gap-2.5">
            <Button onClick={handleSave} disabled={saving} data-testid="account-save-button">
              {saving ? "Saving…" : "Save"}
            </Button>
            {saved && <span className="text-xs text-ok">Saved to Stripe.</span>}
          </div>
        </div>

        {/* Bank account — read-only display */}
        <div className="rounded-card border border-line bg-surface p-4.25">
          <b className="mb-3.5 block text-sm font-semibold">Payout bank account</b>
          {account?.bank ? (
            <div className="text-ui text-ink">{account.bank.name} • {account.bank.last4}</div>
          ) : (
            <div className="text-ui text-mute">No bank account on file.</div>
          )}
          <div className="mt-2 text-xs text-mute">
            {account?.payoutSchedule?.interval
              ? `Paid out ${account.payoutSchedule.interval}${account.payoutSchedule.delay_days != null ? `, ${account.payoutSchedule.delay_days} day delay` : ""}`
              : "No payout schedule set."}
          </div>
          <div className="mt-2 text-xs text-mute">
            To change your bank account, use Stripe's own verification flow — that's not something we can do from here safely.
          </div>
        </div>
      </div>
    </LedgerPage>
  );
}
