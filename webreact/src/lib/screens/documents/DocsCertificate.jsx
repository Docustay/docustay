// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsCertificate — the certificate of signature screen. Built FROM specs/mockups/DocsCertificate.frame.html.
// Shows signers, opens, and facts about when the document was signed and opened. The only API call is
// GET /api/documents/:id/certificate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/lib/components/ui/table.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PreviewPanel from "@/lib/components/editor/PreviewPanel.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { formatValue } from "@/lib/format.js";

// ★ the maintainer, 1 Oct 2026 — the "seven years" retention claim is gone (same ruling as the public privacy
//   policy's §7 rewrite): we keep personal information only as long as we need it, not a named
//   term. A new ruling from the maintainer beats this file's own earlier "never re-worded" comment (F07 §2.9) —
//   that comment is history, not standing authority, per CLAUDE.md's own rule on exactly this.
//   The immutability claim ("cannot be edited by anyone") is untouched — that's about record
//   integrity, not retention duration, and nothing asked for it to change.
const CLOSING_SENTENCE =
  "This record is kept only as long as we need it, and cannot be edited by anyone, including us. " +
  "It is what makes an electronic signature hold up — not the signature itself, but the evidence " +
  "of who signed, when, and from where.";

export default function DocsCertificate({
  path = "/documents/:id/certificate",
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
}) {
  const id = params?.id ?? null;

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ─── fetch — the one real route this screen owes everything to ────────────────────────────────────
  const [data, setData] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    setData(null);
    setLoaded(false);
    if (!id) {
      setLoaded(true);
      return;
    }
    try {
      const res = await request(`/api/documents/${id}/certificate`);
      setData(res?.data ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    } finally {
      setLoaded(true);
    }
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

  const signers = data?.signers ?? [];
  const opens = data?.opens ?? [];
  const sentTo = data?.sent_to ?? [];

  const status =
    signers.length > 0
      ? { label: "Signed", tone: "ok" }
      : { label: "Awaiting signature", tone: "warn" };

  function close() {
    go("/documents/pipeline");
  }

  // ─── Download PDF — the EXISTING route, raw `fetch` (bytes, not JSON) ─────────────────────────────
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    const url = `/api/documents/${id}/pdf`;
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { error: { message: text.slice(0, 500) } };
          }
        }
        const error = new Error(
          parsed?.error?.message ?? `${res.status} on ${url}`
        );
        error.status = res.status;
        error.requestId = parsed?.error?.requestId ?? null;
        throw error;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `executed-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setPdfError({
        message: err?.message ?? String(err),
        requestId: err?.requestId ?? null,
      });
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-paper"
      data-testid="docs-certificate"
      data-phase={phase}
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? fetchError?.message ?? null : null}
        subject="This certificate"
        onRetry={load}
        testIds={{
          loading: "docs-cert-loading",
          error: "docs-cert-error",
          denied: "docs-cert-denied",
        }}
      >
        <div className="flex flex-col h-full min-h-0">
          <div
            className="flex items-center gap-3 px-6 py-4 border-b border-line flex-0 flex-wrap"
            data-testid="docs-cert-head"
          >
            <Button
              type="button"
              variant="ghost"
              data-testid="docs-cert-close"
              aria-label="Close"
              onClick={close}
            >
              Close
            </Button>

            <b className="text-heading font-medium text-ink">
              Record of signature
            </b>

            <StatusBadge
              label={status.label}
              tone={status.tone}
              testId="docs-cert-status"
            />

            <span className="flex-1" />

            <Button
              type="button"
              variant="outline"
              data-testid="docs-cert-download"
              disabled={pdfBusy || !id}
              onClick={downloadPdf}
            >
              {pdfBusy ? "Downloading…" : "Download PDF"}
            </Button>
          </div>

          {pdfError && (
            <ErrorPanel
              error={pdfError}
              subject="This PDF"
              variant="band"
              testId="docs-cert-pdf-error"
            />
          )}

          <div className="flex-1 min-h-0 overflow-auto p-7">
            <PreviewPanel
              title="Record of signature"
              subtitle={
                signers.length > 0
                  ? `${signers.length} signer${signers.length === 1 ? "" : "s"} on file`
                  : "No signatures on file yet"
              }
              printable
              testId="docs-cert-panel"
            >
              <div className="flex flex-col gap-3" data-testid="docs-cert-content">
                <section
                  className="flex flex-col gap-3"
                  data-testid="docs-cert-signers"
                >
                  <h3 className="text-sm font-heading text-ink m-0">
                    Signers
                  </h3>
                  {signers.length === 0 ? (
                    <p className="text-sm text-mute m-0">
                      No signatures on file yet.
                    </p>
                  ) : (
                    <Table data-testid="docs-cert-signers-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Role</TableHead>
                          <TableHead>Typed name</TableHead>
                          <TableHead>Signature</TableHead>
                          <TableHead>When</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>Device</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {signers.map((s, i) => (
                          <TableRow
                            key={i}
                            data-testid={`docs-cert-signer-${i}`}
                          >
                            <TableCell>{s.role ?? "—"}</TableCell>
                            <TableCell>
                              {s.typed_name ?? "—"}
                            </TableCell>
                            <TableCell>
                              {s.mark_image
                                ? "Drawn, held with this record"
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {s.signed_at ?? "—"}
                            </TableCell>
                            <TableCell>{s.ip ?? "—"}</TableCell>
                            <TableCell>
                              {s.user_agent ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>

                <Separator />

                <section
                  className="flex flex-col gap-3"
                  data-testid="docs-cert-opens"
                >
                  <h3 className="text-sm font-heading text-ink m-0">
                    Opened
                  </h3>
                  {opens.length === 0 ? (
                    <p className="text-sm text-mute m-0">Not opened yet.</p>
                  ) : (
                    <Table data-testid="docs-cert-opens-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>Device</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {opens.map((o, i) => (
                          <TableRow
                            key={i}
                            data-testid={`docs-cert-open-${i}`}
                          >
                            <TableCell>
                              {formatValue(o.at, "datetime")}
                            </TableCell>
                            <TableCell>{o.ip ?? "—"}</TableCell>
                            <TableCell>
                              {o.user_agent ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>

                <Separator />

                <section
                  className="flex flex-col gap-0"
                  data-testid="docs-cert-facts"
                >
                  {sentTo.length > 0 && (
                    <div
                      className="flex gap-4 py-2.5 border-b border-line last:border-b-0 text-sm"
                      data-testid="docs-cert-sent-to"
                    >
                      <span className="w-[180px] flex-0 text-mute">
                        Sent to
                      </span>
                      <span className="flex-1 text-ink">
                        {sentTo.join(", ")}
                      </span>
                    </div>
                  )}
                  {data?.version != null && (
                    <div
                      className="flex gap-4 py-2.5 border-b border-line last:border-b-0 text-sm"
                      data-testid="docs-cert-version"
                    >
                      <span className="w-[180px] flex-0 text-mute">
                        Document version
                      </span>
                      <span className="flex-1 text-ink">
                        {data.version}
                        {data?.published_at &&
                          `, published ${formatValue(
                            data.published_at,
                            "date"
                          )}`}
                      </span>
                    </div>
                  )}
                  {data?.reference && (
                    <div
                      className="flex gap-4 py-2.5 border-b border-line last:border-b-0 text-sm"
                      data-testid="docs-cert-reference"
                    >
                      <span className="w-[180px] flex-0 text-mute">
                        Reference
                      </span>
                      <span className="flex-1 text-ink">
                        {data.reference}
                      </span>
                    </div>
                  )}
                </section>

                {data?.retention_sentence && (
                  <p
                    className="text-sm text-mute m-0 leading-relaxed"
                    data-testid="docs-cert-retention"
                  >
                    {data.retention_sentence}
                  </p>
                )}

                <p
                  className="text-sm text-mute m-0 leading-relaxed mt-1.5"
                  data-testid="docs-cert-closing"
                >
                  {CLOSING_SENTENCE}
                </p>
              </div>
            </PreviewPanel>
          </div>
        </div>
      </ScreenState>
    </div>
  );
}
