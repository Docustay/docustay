import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { formatValue } from "@/lib/format.js";

export default function DocsDeclined({ path = "/documents/:id/declined", params = null, app = null, onNavigate = null, onRefetch = null, onSendChanged = null }) {
  const id = params?.id ?? null;

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ─── fetch — decline is load-bearing; certificate is best-effort, for the mailto address only ────
  const [declineData, setDeclineData] = useState(null);
  const [sentTo, setSentTo] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    setDeclineData(null);
    setSentTo([]);
    setLoaded(false);
    if (!id) {
      setLoaded(true);
      return;
    }
    try {
      const res = await request(`/api/documents/${id}/decline`);
      setDeclineData(res?.data ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
      setLoaded(true);
      return;
    }
    // ★ Best-effort only. A failure here must never block the primary decline read above.
    try {
      const cert = await request(`/api/documents/${id}/certificate`);
      setSentTo(cert?.data?.sent_to ?? []);
    } catch {
      setSentTo([]);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, [id, app?.refetchSignal]);

  const phase = (() => {
    if (fetchDenied) return "denied";
    if (fetchError) return "error";
    if (!loaded) return "loading";
    return "ready";
  })();

  const declinedOn = declineData?.declined_at ? formatValue(declineData.declined_at, "date") : null;
  const mailtoAddress = sentTo[0] ?? null;

  // ── MECHANICAL WIRING — "Send a changed version" must always be wired once loaded. ────────────────
  useEffect(() => {
    if (phase !== "ready") return;
    if (typeof onSendChanged !== "function") {
      throw new Error(
        "DocsDeclined: onSendChanged is required once the decline is loaded — \"Send a changed " +
        "version\" must always be wired to a real action (14.64's DocTemplateEditor, then 14.70's " +
        "DocsSend), never drawn dead."
      );
    }
  }, [phase, onSendChanged]);

  function close() {
    go("/documents/pipeline");
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="docs-declined" data-phase={phase}>
      <ScreenState
        phase={phase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        subject="This decline"
        onRetry={load}
        testIds={{ loading: "docs-declined-loading", error: "docs-declined-error", denied: "docs-declined-denied" }}
      >
        <div className="flex flex-col gap-4 overflow-auto p-6" data-testid="docs-declined-body">
          <div className="flex">
            <Button
              type="button"
              variant="ghost"
              data-testid="docs-declined-close"
              aria-label="Close"
              onClick={close}
            >
              Close
            </Button>
          </div>

          <div className="flex items-end gap-4 flex-wrap" data-testid="docs-declined-pgh">
            <div className="flex-1 min-w-0 flex flex-col">
              <h1 className="m-0 text-2xl font-medium text-ink" data-testid="docs-declined-h1">This document was declined.</h1>
              <p className="m-0 mt-1 text-sm text-muted-foreground" data-testid="docs-declined-sub">
                {declinedOn ? `On ${declinedOn}, with a reason.` : "With a reason."}
              </p>
            </div>
            {mailtoAddress && (
              <a
                href={`mailto:${mailtoAddress}`}
                data-testid="docs-declined-email"
                data-slot="button"
                data-variant="outline"
                data-size="default"
                className="inline-flex items-center justify-center shrink-0 rounded-lg border border-line bg-surface text-ink-2 hover:bg-paper hover:text-ink px-[17px] h-9 gap-2 font-medium transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Email them
              </a>
            )}
            <Button
              type="button"
              data-testid="docs-declined-send-changed"
              onClick={() => onSendChanged?.(id)}
            >
              Send a changed version
            </Button>
          </div>

          <div className="flex gap-6">
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              <section className="flex flex-col gap-4 bg-surface border border-line rounded-lg p-4" data-testid="docs-declined-quote-block" style={{ borderColor: "var(--bad, var(--line))" }}>
                <h2 className="m-0 text-sm font-medium text-ink">What she said</h2>
                <Textarea
                  value={declineData?.reason ?? ""}
                  readOnly
                  className="min-h-24 resize-none"
                  data-testid="docs-declined-reason"
                  aria-label="Their reason (staff only)"
                />
              </section>

              <Separator />

              <section className="flex flex-col gap-4" data-testid="docs-declined-happens-now">
                <h2 className="m-0 text-sm font-medium text-ink">What happens now</h2>
                <div className="flex flex-col gap-0.5 py-1.5" data-testid="docs-declined-happens-signed">
                  <span className="text-sm text-ink font-medium">Nothing was signed</span>
                  <span className="text-sm text-muted-foreground">And nothing was charged</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </ScreenState>
    </div>
  );
}
