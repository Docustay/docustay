// ErrorPanel — ported from webui/src/lib/empty/ErrorPanel.svelte. Same props, testids and sentences.
// "This did not load", the request id, and the rest of the app still works (COMPONENTS.md §7).
import { Button } from "@/lib/components/ui/button.jsx";

export default function ErrorPanel({
  error = null, subject = null, onRetry = null, onTellSupport = null,
  variant = "band", testId = "error-panel", retryTestId = "error-panel-retry",
}) {
  const message = error?.message ?? (error ? String(error) : "Something went wrong.");
  const requestId = error?.requestId ?? error?.request_id ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-bad-border bg-bad-bg p-5" data-state="error" data-variant={variant} data-testid={testId} role="alert">
      <p className="m-0 text-heading font-medium text-ink">{subject ? `${subject} couldn't load.` : "This didn't load"}</p>
      <p className="m-0 text-ui text-ink-2">{message}</p>
      <p className="m-0 text-ui text-ink-2">
        It's us, not you, and nothing has been lost. The rest of Workbench is working normally{variant === "page" ? " — you can still book people and take payments while we sort this out." : "."}
      </p>
      {requestId && <p className="m-0 text-meta text-mute">Reference: <code>{requestId}</code></p>}
      {(onRetry || onTellSupport) && (
        <div className="mt-1 flex gap-2">
          {onRetry && <Button data-testid={retryTestId} onClick={() => onRetry()}>Try again</Button>}
          {onTellSupport && <Button variant="ghost" data-testid={`${testId}-tell-support`} onClick={() => onTellSupport()}>Tell support</Button>}
        </div>
      )}
    </div>
  );
}
