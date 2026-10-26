import { useState, useEffect } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import SettingsEmailBroken from "@/lib/screens/settings/SettingsEmailBroken.jsx";
import MailSendingPanel from "@/lib/mail/MailSendingPanel.jsx";
import EmailSettingsPageEmailDisconnectConfirm from "./EmailSettingsPageEmailDisconnectConfirm.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Alert, AlertDescription } from "@/lib/components/ui/alert.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { FieldLabel } from "@/lib/components/ui/field.jsx";
import { api, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";

const PURPOSES = [
  { key: "reminders", label: "Session reminders", who: "Clients, before a session" },
  { key: "documents", label: "Documents to sign", who: "Whoever is asked to sign" },
  { key: "invoices", label: "Invoices", who: "Whoever is paying" },
  { key: "receipts", label: "Receipts", who: "Whoever paid" },
];

const STATE_WORDS = {
  usable: "Connected and working.",
  reconsent_required:
    "Google has stopped accepting our access to this mailbox. Nothing is being sent from it. " +
    "Reconnecting asks for permission again.",
  withdrawn:
    "This mailbox was disconnected here. Nothing is being sent from it until it is reconnected.",
};

const BROKEN_REASON = {
  reconsent_required: "Google asked for permission again.",
  withdrawn: "This mailbox was disconnected here.",
};

const CONNECT_HREF = "/api/settings/email/connect/start";

const CONNECT_ERROR_TEXT = {
  invalid_state:
    "That connection link had expired or was not started from this screen. Try again below.",
  google_declined: "The connection was cancelled before Google finished.",
  google_unreachable: "Google could not be reached to finish connecting. Try again.",
};

export default function EmailSettingsPage({
  mailbox = null,
  routing = {},
  rank = null,
  onNavigate = null,
  onDone = null,
  lastChanged = null,
}) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  const [connectError, setConnectError] = useState(null);
  const [typed, setTyped] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [health, setHealth] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [testSendResult, setTestSendResult] = useState(null);

  // Extract connect error from URL params
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const errorCode = params.get("connectError");
      if (errorCode) {
        setConnectError(errorCode);
      }
    }
  }, []);

  // Load email health and templates
  useEffect(() => {
    const loadEmailHealth = async () => {
      try {
        const result = await api.emailHealth();
        setHealth(result);
      } catch (err) {
        // Health errors are not critical
      }
    };

    const loadTemplates = async () => {
      if (!isAdmin) return;
      try {
        const result = await api.listEmailTemplates();
        setTemplates(result.templates || []);
      } catch (err) {
        setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    };

    loadEmailHealth();
    loadTemplates();
  }, [isAdmin]);

  const breaks = PURPOSES.filter((p) =>
    (mailbox?.addresses ?? []).some((a) => a.email === routing[p.key])
  );

  const formatBrokenDate = (iso) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const fmt = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
      return Number.isNaN(d.getTime()) ? null : fmt.format(d);
    } catch {
      return null;
    }
  };

  const goToAuditLog = (e) => {
    e.preventDefault();
    onNavigate?.("/settings/developer/audit-log");
  };

  const route = async (purpose, email) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.setSenderRouting({ purpose, email });
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.disconnectMailbox();
      setDisconnectOpen(false);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const previewTemplate = async (key) => {
    if (busy) return;
    setBusy(true);
    setPreviewResult(null);
    setTestSendResult(null);
    try {
      const result = await api.previewEmailTemplate(key);
      setSelectedTemplate(key);
      setPreviewResult(result);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const sendTestEmail = async (key) => {
    if (busy) return;
    setBusy(true);
    setTestSendResult(null);
    try {
      const result = await api.testSendEmail(key);
      setTestSendResult(result);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-6" data-testid="email-settings">
      <PageTitle>Email</PageTitle>

      {connectError && (
        <Alert variant="destructive">
          <AlertDescription data-testid="email-connect-error">
            {CONNECT_ERROR_TEXT[connectError] ?? "That connection attempt did not finish."}
          </AlertDescription>
        </Alert>
      )}

      {health?.state === "broken" && <SettingsEmailBroken health={health} />}

      {/* Zone 1: Your mailbox */}
      <div
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
        data-testid="email-zone-mailbox"
      >
        <h2 className="text-base font-semibold text-ink">Your mailbox</h2>
        {lastChanged && <LastChanged by={lastChanged.by} at={lastChanged.at} />}

        {!mailbox ? (
          <>
            <p className="text-sm text-mute" data-testid="email-not-connected">
              No mailbox is connected, so your practice's mail is sent from Workbench's shared
              address with your practice name on it. Connecting one means reminders and documents
              come from you.
            </p>
            <div>
              <Button asChild data-testid="email-connect">
                <a href={CONNECT_HREF}>Connect a mailbox</a>
              </Button>
            </div>
          </>
        ) : (
          <>
            {mailbox.grantState !== "usable" && (
              <>
                <div
                  className="flex flex-col gap-3 rounded-md border border-bad-border bg-bad-soft p-4 text-sm text-bad"
                  role="alert"
                  data-testid="email-broken-banner"
                >
                  <div>
                    <strong>
                      {mailbox.email} was disconnected
                      {formatBrokenDate(mailbox.brokenAt)
                        ? ` on ${formatBrokenDate(mailbox.brokenAt)}`
                        : ""}
                      .
                    </strong>
                    <span> {BROKEN_REASON[mailbox.grantState] ?? ""}</span>
                    {mailbox.waitingCount && (
                      <span>
                        {" "}
                        {mailbox.waitingCount}{" "}
                        {mailbox.waitingCount === 1 ? "message is" : "messages are"} waiting to
                        send.
                      </span>
                    )}
                  </div>
                  <Button asChild variant="default" size="sm">
                    <a href={CONNECT_HREF} data-testid="email-reconnect">
                      Reconnect
                    </a>
                  </Button>
                </div>
                <div
                  className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4"
                  data-testid="email-while-broken"
                >
                  <div>
                    <h3 className="font-semibold text-ink">While disconnected</h3>
                    <p className="text-sm text-mute">Nothing is lost.</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-mute">
                      Sign-in emails and password resets still work — they never use your mailbox.
                      Everything else waits and sends once you reconnect.
                    </p>
                    {mailbox.waitingCount && (
                      <a
                        href="/settings/developer/audit-log"
                        onClick={goToAuditLog}
                        className="text-sm text-brand underline"
                        data-testid="email-see-waiting"
                      >
                        See the {mailbox.waitingCount} waiting{" "}
                        {mailbox.waitingCount === 1 ? "message" : "messages"}
                      </a>
                    )}
                  </div>
                </div>
              </>
            )}

            <p className="text-sm font-medium text-ink" data-testid="email-mailbox">
              {mailbox.email}
            </p>
            <p className="text-sm text-mute" data-testid="email-state" data-state={mailbox.grantState}>
              {STATE_WORDS[mailbox.grantState] ?? mailbox.grantState}
            </p>
            {mailbox.grantState !== "usable" && mailbox.grantError && (
              <p className="text-sm text-bad" data-testid="email-grant-error" role="alert">
                {mailbox.grantError}
              </p>
            )}

            {mailbox.provider === "google" ? (
              <>
                <h3 className="text-sm font-semibold text-ink">Addresses this mailbox can send from</h3>
                <ul className="flex flex-col gap-3" data-testid="email-addresses">
                  {(mailbox.addresses ?? []).map((a) => (
                    <li key={a.email} data-testid={`email-address-${a.email}`} className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-ink">{a.email}</span>
                      <span className="text-sm text-mute">
                        {a.kind === "group"
                          ? "A group address — it keeps working if the person who set it up leaves."
                          : a.kind === "primary"
                            ? "The mailbox's own address."
                            : "An alias — it stops working if this person leaves."}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-mute" data-testid="email-enumeration-gap">
                  These are the addresses this mailbox can send from. If the one you want is
                  missing, add it in Gmail under <strong>Settings → Accounts → Send mail as</strong>
                  , then refresh. An alias that exists but has not been set up there will not appear
                  here, and a group also needs "members can post as the group" turned on.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-ink">Add an address</h3>
                <p className="text-sm text-mute" data-testid="email-microsoft-note">
                  Microsoft does not publish which addresses a mailbox may send from, so type the
                  address and we will verify it by sending one test message. If the permission is
                  not there, you will see Microsoft's own refusal.
                </p>
                <div className="flex flex-col gap-2">
                  <FieldLabel>Address</FieldLabel>
                  <Input
                    type="email"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    data-testid="email-typed"
                    placeholder="Enter email address"
                  />
                </div>
                <Button disabled={busy || !typed.trim()} data-testid="email-verify">
                  Send a test and verify
                </Button>
              </>
            )}

            <Button
              variant="outline"
              onClick={() => {
                setProblem(null);
                setDisconnectOpen(true);
              }}
              data-testid="email-disconnect"
            >
              Disconnect
            </Button>
          </>
        )}
      </div>

      {/* Zone: Use your own domain — the organisation's ONE sending identity (admin only), above What sends what */}
      {isAdmin ? (
        <section className="rounded-lg border border-line bg-surface p-5" data-testid="email-zone-domain">
          <h2 className="text-base font-semibold text-ink">Use your own domain</h2>
          <p className="mt-1 text-sm text-mute">Send your organisation's email — invoices, reminders, documents to sign — from your own address. Until it is verified, mail goes out from the product's address with your name on it.</p>
          <MailSendingPanel />
        </section>
      ) : null}

      {/* Zone 2: What sends what (admin only) */}
      {isAdmin && (
        <div
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
          data-testid="email-zone-routing"
        >
          <h2 className="text-base font-semibold text-ink">What sends what</h2>
          <p className="text-sm text-mute">
            Choose which address each kind of message comes from. Sign-in and password emails
            always come from Workbench and cannot be changed — if your mailbox ever broke, those are
            what you would need to fix it.
          </p>

          <div className="flex flex-col gap-4">
            {PURPOSES.map((p) => (
              <div
                key={p.key}
                className="flex flex-col gap-2"
                data-testid={`email-route-${p.key}`}
              >
                <div>
                  <p className="text-sm font-medium text-ink">{p.label}</p>
                  <p className="text-xs text-mute">{p.who}</p>
                </div>
                <select
                  className="flex h-10 rounded-md border border-line bg-white px-3 py-2 text-sm"
                  value={routing[p.key] ?? ""}
                  disabled={busy}
                  onChange={(e) => route(p.key, e.currentTarget.value)}
                  aria-label={`${p.label}: send from`}
                  data-testid={`email-route-select-${p.key}`}
                >
                  <option value="">Workbench's shared address</option>
                  {(mailbox?.addresses ?? []).map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {problem && (
            <p className="text-sm text-bad" data-testid="email-routing-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}

      {/* Zone 3: Email templates (admin only) */}
      {isAdmin && (
        <div
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
          data-testid="email-zone-templates"
        >
          <h2 className="text-base font-semibold text-ink">Email templates</h2>
          <p className="text-sm text-mute">
            Preview what templates look like and send a test copy to your own email address.
          </p>

          <div className="flex flex-col gap-2">
            {templates.map((t) => (
              <div
                key={t.key}
                className="flex items-center justify-between rounded-md border border-line bg-white p-3"
                data-testid={`email-template-${t.key}`}
              >
                <span className="text-sm font-medium text-ink">{t.key}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => previewTemplate(t.key)}
                  data-testid={`email-template-preview-${t.key}`}
                >
                  Preview
                </Button>
              </div>
            ))}
          </div>

          {previewResult && (
            <div
              className="flex flex-col gap-3 rounded-md border border-line bg-white p-4"
              data-testid="email-preview-result"
            >
              <h3 className="font-semibold text-ink">Preview: {selectedTemplate}</h3>
              <div className="flex flex-col gap-2">
                <div>
                  <strong className="text-sm">Subject:</strong>
                  <p className="text-sm text-ink">{previewResult.subject}</p>
                </div>
                <div>
                  <strong className="text-sm">Body:</strong>
                  <pre className="overflow-auto rounded bg-gray-50 p-2 text-xs">
                    {previewResult.text}
                  </pre>
                </div>
              </div>
              <Button
                onClick={() => sendTestEmail(selectedTemplate)}
                disabled={busy}
                data-testid="email-test-send"
              >
                Send test email to my address
              </Button>
            </div>
          )}

          {testSendResult && (
            <div
              className={`rounded-md border p-3 text-sm ${
                testSendResult.sent
                  ? "border-ok-border bg-ok-soft text-ok"
                  : "border-bad-border bg-bad-soft text-bad"
              }`}
              data-testid="email-test-result"
              role="alert"
            >
              {testSendResult.sent ? (
                <p>Test email sent successfully!</p>
              ) : (
                <p>Test email send failed: {testSendResult.error || "unknown error"}</p>
              )}
            </div>
          )}
        </div>
      )}

      <EmailSettingsPageEmailDisconnectConfirm
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        mailbox={mailbox}
        busy={busy}
        problem={problem}
        breaks={breaks}
        confirmDisconnect={confirmDisconnect}
      />
    </section>
  );
}
