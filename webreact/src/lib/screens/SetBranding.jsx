// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.016 — SetBranding: the branding settings screen.
//
// Ported from webui/src/lib/screens/SetBranding.svelte (462 lines).
// Uses EditorPage archetype for layout. Behaviour and structure from the Svelte source.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import LogoUploader from "./LogoUploader.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import PreviewPanel from "@/lib/components/editor/PreviewPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function SetBranding({
  data = null,
  stripePushState = null,
  stripePushFailureReason = null,
  stripePushAt = null,
  onNavigate = null,
}) {
  const [expandedView, setExpandedView] = useState(false);

  function handleNavigate(href, event) {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(href, event);
    }
  }

  function toggleExpandedView() {
    setExpandedView(!expandedView);
  }

  // ★ State row rendering helpers (TASK 20.32)
  const STRIPE_STATE_LABELS = {
    pushed: "Pushed to Stripe",
    failed: "Push failed",
    pending: "Pending push",
  };

  const STRIPE_STATE_HELP = {
    pushed: stripePushAt ? `Last pushed ${stripePushAt}` : "Pushed to Stripe",
    failed: stripePushFailureReason || "Push failed",
    pending: "Waiting to push",
  };

  return (
    <section
      className="flex flex-col gap-6 px-7.5 py-6.5"
      data-testid="set-branding"
    >
      {/* ★ Header with title, intro, and "See it all" action */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-page-title font-medium text-ink">
            {data?.title}
          </h1>
          {data?.intro && (
            <p className="m-0 mt-1 text-ui text-mute">
              {data.intro}
            </p>
          )}
        </div>
        <Button variant="outline" data-testid="see-all-button" onClick={toggleExpandedView}>
          See it all
        </Button>
      </div>

      {/* ★ Main content with two columns */}
      <div className="grid grid-cols-1 gap-5.5 items-start lg:grid-cols-[1fr_320px]">
        {/* ★ Left column: logo section and "Where it turns up" rows */}
        <div className="flex flex-col gap-[18px]">
          {/* ★ Your mark section with logos */}
          <div className="bg-surface border border-line rounded-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
              <h2 className="m-0 text-ui font-medium text-ink flex-1">
                Your mark
              </h2>
              {data?.lastChanged && (
                <LastChanged
                  by={data.lastChanged.by}
                  at={data.lastChanged.at}
                  testId="mark-last-changed"
                />
              )}
            </div>

            <div className="px-5 py-4">
              {/* ★ Logo uploaders for sidebar and login logos */}
              {data?.logos?.map((logo) => (
                <LogoUploader key={logo.kind} logo={logo} />
              ))}

              {/* ★ Colour row - disabled with reason per OQ-17.1 */}
              {data?.colour && (
                <div className="flex items-start gap-3 px-0 py-4 border-t border-hair">
                  <DisabledWithReason
                    disabled={!data.colour.changeable}
                    reason={data.colour.reason}
                    testId="colour-row"
                  >
                    {({ disabled }) => (
                      <div
                        className={`inline-flex items-center justify-center px-3 py-2 rounded-control border ${
                          disabled
                            ? "bg-structure-50 border-structure-300 text-structure-600"
                            : "bg-surface border-line text-mute"
                        } text-ui`}
                        data-disabled={disabled ? "true" : undefined}
                      >
                        Your colour
                      </div>
                    )}
                  </DisabledWithReason>
                </div>
              )}
            </div>
          </div>

          {/* ★ Where it turns up section */}
          {expandedView && data?.whereItTurnsUp && data.whereItTurnsUp.length > 0 && (
            <div className="bg-surface border border-line rounded-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                <h2 className="m-0 text-ui font-medium text-ink">
                  Where it turns up
                </h2>
              </div>

              <div className="flex flex-col px-5 py-4">
                {data.whereItTurnsUp.map((row) =>
                  row.href ? (
                    <SettingsHubRow
                      key={row.key}
                      label={row.label}
                      where={row.detail}
                      href={row.href}
                      onNavigate={handleNavigate}
                      testId={`where-it-turns-up-${row.key}`}
                    />
                  ) : (
                    /* ★ Rows with no href render as plain text without "See it" link */
                    <div
                      key={row.key}
                      className="flex items-start gap-3 py-3.75 border-b border-hair last:border-b-0"
                      data-testid={`where-it-turns-up-${row.key}`}
                    >
                      <span className="block text-ui font-medium text-ink flex-1 min-w-0">
                        {row.label}
                      </span>
                      <span className="block text-meta text-mute">
                        {row.detail}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* ★ Stripe push state row (TASK 20.32) */}
          {stripePushState !== null && (
            <div
              className="bg-surface border border-line rounded-card px-5 py-4 flex justify-between items-start gap-4.5"
              data-testid="stripe-push-state"
            >
              <div className="text-ui font-medium text-ink">
                Push to Stripe
              </div>
              <div className="text-right">
                <div
                  className={`inline-block px-3 py-1 rounded-[12px] text-caption font-medium mb-1 ${
                    stripePushState === "pushed"
                      ? "bg-ok-soft text-ok"
                      : stripePushState === "failed"
                        ? "bg-bad-soft text-bad"
                        : "bg-warn-soft text-warn"
                  }`}
                  data-state={stripePushState || "pending"}
                >
                  {STRIPE_STATE_LABELS[stripePushState] || "Pending push"}
                </div>
                {STRIPE_STATE_HELP[stripePushState] && (
                  <div className="text-caption text-mute mt-1">
                    {STRIPE_STATE_HELP[stripePushState]}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ★ Right column: preview card */}
        {data?.preview && (
          <div className="w-80">
            <PreviewPanel
              title="How it looks"
              printable={false}
              testId="branding-preview"
            >
              <div className="flex flex-col gap-3 p-4 border border-line rounded-card bg-surface">
                <div className="text-lg font-medium text-ink">
                  {data.preview.practiceName}
                </div>
                <div className="text-caption text-mute leading-relaxed">
                  Invoice {data.preview.invoiceNumberExample}
                  <br />
                  Due 8 October
                </div>
                <div className="text-figure-sm text-ink my-3">
                  $540.00
                </div>
                <button className="h-8 rounded-sm bg-brand text-surface text-caption font-medium px-4 flex items-center justify-center hover:opacity-90">
                  Pay $540.00
                </button>
              </div>
            </PreviewPanel>
          </div>
        )}
      </div>

      {/* ★ Notice at the bottom if present */}
      {data?.notice && (
        <p
          className="m-0 text-meta text-mute leading-[1.55]"
          data-testid="branding-notice"
        >
          {data.notice}
        </p>
      )}
    </section>
  );
}
