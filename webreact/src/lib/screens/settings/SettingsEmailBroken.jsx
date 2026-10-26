// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.23 — BROKEN-EMAIL INCIDENT SCREEN — client.
//
// Shows when `EmailSettingsPage` fetches `api.emailHealth()` and `state==='broken'`.
// The incident banner and the affected-delivery context for a practice's own sending domain or
// mailbox consent broken.
//
// Props: { health, onFixClick, onShowLineClick }
// Ported from webui/src/lib/screens/settings/SettingsEmailBroken.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function SettingsEmailBroken({ health = null, onFixClick = null, onShowLineClick = null }) {
  const dateFmt = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

  // Calculate days since broke
  const daysSinceBroke = (() => {
    if (!health?.brokeAt) return 0;
    const brokenDate = new Date(health.brokeAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - brokenDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  })();

  // Format the broke date for display
  const brokeDate = health?.brokeAt ? dateFmt.format(new Date(health.brokeAt)) : null;

  // Determine if this is a mailbox issue or domain issue
  const isMailboxIssue =
    health?.cause === "mailbox_consent_withdrawn" ||
    health?.cause === "mailbox_reconsent_required";

  // The incident message based on cause
  const incidentMessage = (() => {
    if (!health || health.state !== "broken") return "";

    if (isMailboxIssue) {
      return `Your mailbox connection was broken on ${brokeDate}.`;
    }

    // Sending domain failed
    return `Nothing has been sent from your address for ${daysSinceBroke} day${daysSinceBroke === 1 ? "" : "s"}.`;
  })();

  // The explanation text
  const explanationText = (() => {
    if (!health || health.state !== "broken") return "";

    if (isMailboxIssue) {
      return health.cause === "withdrawn"
        ? "This mailbox was disconnected here."
        : "Google has stopped accepting our access to this mailbox.";
    }

    // Sending domain failed - the frame shows this specific text
    return "Your domain's DNS changed and the record that proves emails are really from you went with it. Reminders and invoices have been going out from our address instead, which lands more of them in spam.";
  })();

  return (
    <>
      {/* ═══ THE INCIDENT BANNER ═══════════════════════════════════════════════════════════════ */}
      <div
        className="flex items-start gap-3 rounded-[11px] border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] px-[16px] py-[14px] text-[13.5px] leading-[1.6] text-[var(--color-danger-700)] mb-[22px]"
        role="alert"
        data-testid="email-broken-banner"
      >
        <span className="flex shrink-0 items-center justify-center w-5 h-5 font-semibold text-base flex-none">!</span>
        <span className="flex-1">
          <strong className="block font-semibold mb-1">{incidentMessage}</strong>
          {explanationText && <>{explanationText}</>}
        </span>
        <Button
          variant="default"
          size="default"
          className="shrink-0"
          data-testid="email-broken-fix-button"
          onClick={onFixClick}
        >
          Fix it
        </Button>
      </div>

      {/* ═══ SENDING FROM YOUR OWN ADDRESS SECTION ═════════════════════════════════════════════ */}
      <div className="rounded-lg border border-line bg-surface mb-[18px]" data-testid="email-broken-sending-section">
        <div className="flex items-center gap-[11px] border-b border-hair px-[18px] py-[15px]">
          <h3 className="flex-1 font-semibold text-base m-0 text-ink">Sending from your own address</h3>
          <StatusBadge label="Broken" tone="bad" testId="email-broken-status" />
          {brokeDate && (
            <span className="text-[12.5px] text-mute" data-testid="email-broken-date">
              Broke {brokeDate}
            </span>
          )}
        </div>

        <div className="px-[18px] pt-1 pb-2.5">
          {/* Email address row */}
          {health?.address && (
            <div className="flex items-start gap-[18px] border-b border-hair py-[15px]" data-testid="email-broken-address">
              <div className="flex-1">
                <div className="font-semibold text-[14.5px] m-0 text-ink block">{health.address}</div>
                <div className="text-[13px] text-mute mt-1 block leading-[1.55]">The address clients see.</div>
              </div>
              <StatusBadge label="Not verified" tone="bad" testId="email-broken-not-verified" />
            </div>
          )}

          {/* The record that went missing row */}
          <div className="flex items-start gap-[18px] border-b border-hair py-[15px]" data-testid="email-broken-record-row">
            <div className="flex-1">
              <div className="font-semibold text-[14.5px] m-0 text-ink block">The record that went missing</div>
              <div className="text-[13px] text-mute mt-1 block leading-[1.55]">
                {health?.cloudflareConnected
                  ? "A TXT record on your domain. We can add it for you since Cloudflare is connected."
                  : "A TXT record on your domain. We can give you the exact line to paste in."}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              data-testid="email-broken-show-line-button"
              onClick={onShowLineClick}
            >
              Show me the line
            </Button>
          </div>

          {/* What's happened since row (only if since data exists) */}
          {health?.since && (
            <div className="flex items-start gap-[18px] py-[15px]" data-testid="email-broken-since-row">
              <div className="flex-1">
                <div className="font-semibold text-[14.5px] m-0 text-ink block">What's happened since</div>
                <div className="text-[13px] text-mute mt-1 block leading-[1.55]">
                  {health.since.sentFromOurs} email{health.since.sentFromOurs === 1 ? "" : "s"} sent from our address instead.
                  {health.since.spam !== undefined && (
                    <>
                      {" "}
                      {health.since.spam} of them landed in spam
                      {health.since.usualSpam !== null ? `, against a usual ${health.since.usualSpam}.` : "."}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ WHILE IT'S BROKEN SECTION ═════════════════════════════════════════════════════════ */}
      <div className="rounded-lg border border-line bg-surface" data-testid="email-broken-while-broken">
        <div className="flex items-center gap-[11px] border-b border-hair px-[18px] py-[15px]">
          <h3 className="flex-1 font-semibold text-base m-0 text-ink">While it's broken</h3>
        </div>

        <div className="px-[18px] pt-1 pb-2.5">
          <div className="flex items-start gap-[18px] border-b border-hair py-[15px]" data-testid="email-broken-everything-sends">
            <div className="flex-1">
              <div className="font-semibold text-[14.5px] m-0 text-ink block">Everything still sends</div>
              <div className="text-[13px] text-mute mt-1 block leading-[1.55]">
                From mail.workbench.app, with your name on it.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-[18px] border-b border-hair py-[15px]" data-testid="email-broken-more-spam">
            <div className="flex-1">
              <div className="font-semibold text-[14.5px] m-0 text-ink block">More of it lands in spam</div>
              <div className="text-[13px] text-mute mt-1 block leading-[1.55]">
                Because the receiving server can't confirm it's from you.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-[18px] py-[15px]" data-testid="email-broken-replies-reach">
            <div className="flex-1">
              <div className="font-semibold text-[14.5px] m-0 text-ink block">Replies still reach you</div>
              <div className="text-[13px] text-mute mt-1 block leading-[1.55]">
                They go to your address either way.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
