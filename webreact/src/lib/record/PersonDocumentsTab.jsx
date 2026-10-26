import { Button } from "@/lib/components/ui/button.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function PersonDocumentsTab({
  documents = null,
  notesPreview = [],
  error = null,
  onRemindDocument = null,
  versionPrompt = null,
  testId = "person-documents-tab",
}) {
  const signed = documents?.signed ?? [];
  const waiting = documents?.waiting ?? [];
  const hasAny = signed.length > 0 || waiting.length > 0 || notesPreview.length > 0;

  function fmtDayMonth(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  function daysSince(value) {
    if (!value) return 0;
    const ms = Date.now() - new Date(value).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }

  return (
    <div data-testid={testId}>
      {error ? (
        <ErrorPanel error={error} subject="Documents" variant="band" />
      ) : !hasAny ? (
        <EmptyState
          kind="first-run"
          icon="IconFileText"
          headline="No documents"
          line="Nothing signed, nothing waiting yet."
          testId={`${testId}-empty`}
        />
      ) : (
        <div className="flex flex-col gap-5.5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            {signed.length > 0 && (
              <div className="mb-4.5 rounded-card border border-line bg-surface" data-testid={`${testId}-signed`}>
                <div className="border-b border-hair px-4.25 py-3.5">
                  <b className="text-heading font-medium">Signed</b>
                </div>
                <div className="px-4.25 pt-1.5 pb-3.5">
                  {signed.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="doc-signed-row"
                    >
                      <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                        {fmtDayMonth(d.signedAt) ?? "—"}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <a className="text-ui text-ink hover:underline" href={`/record/document/${d.id}`} data-testid="doc-row-link">{d.title}</a>
                        <span className="mt-0.5 text-caption text-mute">
                          {d.version ? `Version ${d.version}. ` : ""}Signed{" "}
                          {fmtDayMonth(d.signedAt) ?? "—"}.
                        </span>
                      </span>
                      <StatusBadge label="Signed" tone="ok" testId="doc-signed-badge" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {waiting.length > 0 && (
              <div className="mb-4.5 rounded-card border border-line bg-surface" data-testid={`${testId}-waiting`}>
                <div className="border-b border-hair px-4.25 py-3.5">
                  <b className="text-heading font-medium">Waiting</b>
                </div>
                <div className="px-4.25 pt-1.5 pb-3.5">
                  {waiting.map((d) => {
                    const days = daysSince(d.sentAt);
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                        data-testid="doc-waiting-row"
                      >
                        <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                          {fmtDayMonth(d.sentAt) ?? "—"}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <a className="text-ui text-ink hover:underline" href={`/record/document/${d.id}`} data-testid="doc-row-link">{d.title}</a>
                          <span className="mt-0.5 text-caption text-mute">
                            Sent, unsigned.
                          </span>
                        </span>
                        <StatusBadge label={`${days} day${days === 1 ? "" : "s"}`} tone="neutral" testId="doc-waiting-badge" />
                        <DisabledWithReason
                          disabled={!onRemindDocument}
                          reason="Reminders arrive with Documents"
                          testId={`doc-remind-${d.id}`}
                        >
                          {({ disabled, describedBy }) => (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={disabled}
                              aria-describedby={describedBy}
                              onClick={() => onRemindDocument?.(d.id)}
                              data-testid={`doc-remind-btn-${d.id}`}
                            >
                              Remind them
                            </Button>
                          )}
                        </DisabledWithReason>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {notesPreview.length > 0 && (
              <div className="mb-4.5 rounded-card border border-line bg-surface" data-testid={`${testId}-notepreview`}>
                <div className="border-b border-hair px-4.25 py-3.5">
                  <b className="text-heading font-medium">From their sessions</b>
                </div>
                <div className="px-4.25 pt-1.5 pb-3.5">
                  {notesPreview.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="doc-notepreview-row"
                    >
                      <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                        {fmtDayMonth(n.createdAt) ?? "—"}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">{n.title}</span>
                        {n.authorName && (
                          <span className="mt-0.5 text-caption text-mute">
                            Written by {n.authorName}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {versionPrompt && (
            <div className="w-full lg:w-80 lg:flex-shrink-0">
              <div className="mb-4.5 rounded-card border border-line bg-surface" data-testid={`${testId}-worthknowing`}>
                <div className="border-b border-hair px-4.25 py-3.5">
                  <b className="text-heading font-medium">Worth knowing</b>
                </div>
                <div className="px-4.25 pt-1.5 pb-3.5">
                  <PromptCard
                    {...versionPrompt}
                    testId={`${testId}-version-prompt`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
