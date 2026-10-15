// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocPreview — the document preview screen. Built FROM specs/mockups/DocPreview.frame.html.
//
// ★★★ FIX, 30 Sep 2026 (documents preview brief) — THIS SCREEN NEVER LOADED THE TEMPLATE'S BODY. It
//     fetched only the LIST row (name, builder) and printed the whole smart-field catalogue with
//     hardcoded samples — the same page on every template, never the actual clauses. Its own subtitle
//     said "no staff preview route exists yet". That route now exists
//     (`GET /api/documents/templates/:id/preview`, src/routes/documentsPreview.mjs, backed by
//     `fetchTemplatePreview` in src/documents/preview.mjs) and this screen calls it, rendering the
//     REAL body with `renderSectionBlocks` — the same reader the signing page and the portal use, so
//     what staff preview is what a client will actually see.
//   ★ Two other bugs fixed alongside it:
//     · Download PDF called `/api/documents/:id/pdf` with the TEMPLATE id — that route is P18.9's
//       ARCHIVED-INSTANCE fetch, keyed by a signed instrument's id, and named the download
//       "executed-…" — wrong route, wrong semantics for a document nobody has sent yet. Now calls
//       `/api/documents/templates/:id/preview.pdf` (`renderPreviewPdf`, never signed/sealed).
//     · Close went to the retired `/documents/pipeline` address (kept alive only by a redirect table,
//       `OLD_DOCUMENT_ADDRESSES` in routes.js) — now goes to `/documents` directly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { listPeopleForPicker } from "@/lib/documents/ports.js";
import { labelsMismatch, usePersonLabels } from "./labels.js";
import { Button } from "@/lib/components/ui/button.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PreviewPanel from "@/lib/components/editor/PreviewPanel.jsx";
import DocPreviewModal1Modal from "./DocPreviewModal1Modal.jsx";
import DocumentPreviewTabs from "./DocumentPreviewTabs.jsx";

export default function DocPreview({ path = "/documents/:id/preview", params = null, app = null, onNavigate = null, onRefetch = null, onSend = null }) {
  const id = params?.id ?? null;

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // Template row (for builder + name, and the "Send it" wiring below).
  const [templateRow, setTemplateRow] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadTemplateRow() {
    setFetchError(null);
    setFetchDenied(false);
    setTemplateRow(null);
    setLoaded(false);
    if (!id) {
      setLoaded(true);
      return;
    }
    try {
      const [c, f] = await Promise.all([
        request("/api/list/documents/contracts/templates"),
        request("/api/list/documents/forms/templates"),
      ]);
      const rows = [
        ...(c.rows ?? []).map((r) => ({ ...r, builder: "contract" })),
        ...(f.rows ?? []).map((r) => ({ ...r, builder: "form" })),
      ];
      setTemplateRow(rows.find((r) => r.id === id) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => { loadTemplateRow(); }, [id, app?.refetchSignal]);

  const phase = (() => {
    if (fetchDenied) return "denied";
    if (fetchError) return "error";
    if (!loaded) return "loading";
    return "ready";
  })();

  const documentTitle = templateRow?.name?.trim() || "Untitled document";

  // ★ "Filled in for" — sample values (default) or a real client's real resolved data.
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  useEffect(() => {
    listPeopleForPicker()
      .then((res) => setPeople(res.rows ?? []))
      .catch(() => setPeople([]))
      .finally(() => setPeopleLoading(false));
  }, []);
  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null;
  // ★ QUEUE §4 — Documents' generic labels: a non-blocking note when this template is set up for other people.
  const previewPersonLabels = usePersonLabels(selectedPersonId ? [selectedPersonId] : [])[selectedPersonId];
  const labelNote = selectedPerson && previewPersonLabels !== undefined && labelsMismatch(templateRow?.labels, previewPersonLabels)
    ? `This document is set up for other people than ${selectedPerson.display_name ?? selectedPerson.name}. You can still send it.`
    : null;

  // ★ THE REAL PREVIEW — the actual body, laid out the way a signer would see it.
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  async function loadPreview() {
    if (!id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = selectedPersonId ? `?personId=${encodeURIComponent(selectedPersonId)}` : "";
      const res = await request(`/api/documents/templates/${id}/preview${qs}`);
      setPreviewSnapshot(res.data);
    } catch (err) {
      setPreviewError(err);
      setPreviewSnapshot(null);
    } finally {
      setPreviewLoading(false);
    }
  }
  useEffect(() => { loadPreview(); }, [id, selectedPersonId]);

  // ★ Mechanical wiring — "Send it" must always be wired to a real action once this is ready.
  useEffect(() => {
    if (phase !== "ready") return;
    if (typeof onSend !== "function") {
      throw new Error(
        "DocPreview: onSend is required once the preview is ready — \"Send it\" must always be " +
        "wired to a real action (14.70's DocsSend), never drawn dead."
      );
    }
  }, [phase, onSend]);

  function close() {
    go("/documents");
  }

  const [chooserOpen, setChooserOpen] = useState(false);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    const qs = selectedPersonId ? `?personId=${encodeURIComponent(selectedPersonId)}` : "";
    const url = `/api/documents/templates/${id}/preview.pdf${qs}`;
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
        const error = new Error(parsed?.error?.message ?? `${res.status} on ${url}`);
        error.status = res.status;
        error.requestId = parsed?.error?.requestId ?? null;
        throw error;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `preview-${id}.pdf`;
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

  const filledInForLabel = selectedPerson ? (selectedPerson.display_name ?? selectedPerson.name) : "Sample values";

  return (
    <div className="flex flex-col h-full min-h-0 bg-paper" data-testid="doc-preview" data-phase={phase}>
      <ScreenState
        phase={phase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? fetchError?.message ?? null : null}
        subject="This document"
        onRetry={loadTemplateRow}
        testIds={{ loading: "doc-preview-loading", error: "doc-preview-error", denied: "doc-preview-denied" }}
      >
        <div className="flex flex-col h-full min-h-0">
          <div
            className="flex items-center gap-3 px-6 py-4 border-b border-line flex-0 flex-wrap"
            data-testid="doc-preview-head"
          >
            <Button
              type="button"
              variant="ghost"
              data-testid="doc-preview-close"
              aria-label="Close"
              onClick={close}
            >
              Close
            </Button>

            <b className="text-heading font-medium text-ink" data-testid="doc-preview-title">
              {documentTitle} — as they will see it
            </b>

            <span className="flex-1" />

            <Button
              type="button"
              variant="outline"
              data-testid="doc-preview-chooser-open"
              onClick={() => setChooserOpen(true)}
            >
              Filled in for {filledInForLabel} ⌄
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="doc-preview-download"
              disabled={pdfBusy || !id}
              onClick={downloadPdf}
            >
              {pdfBusy ? "Downloading…" : "Download PDF"}
            </Button>

            <Button
              type="button"
              data-testid="doc-preview-send"
              onClick={() => onSend?.(id, templateRow?.builder ?? "contract")}
            >
              Send it
            </Button>
          </div>

          {labelNote && (
            <p className="m-0 border-b border-line bg-surface px-4 py-2 text-meta text-warn" data-testid="doc-preview-label-note">{labelNote}</p>
          )}

          {pdfError && (
            <ErrorPanel
              error={pdfError}
              subject="This PDF"
              variant="band"
              testId="doc-preview-pdf-error"
            />
          )}

          <div className="flex-1 min-h-0 overflow-auto bg-surface-sunken p-7">
            <div className="mx-auto max-w-160 rounded-card shadow-phone">
              <PreviewPanel
                title={documentTitle}
                subtitle={selectedPerson
                  ? `Filled in for ${filledInForLabel} — their real, current data.`
                  : "Sample values — this is the real document, with placeholder data standing in for a real client."}
                printable
                testId="doc-preview-panel"
              >
                {previewLoading ? (
                  <p className="m-0 text-sm text-mute">Loading…</p>
                ) : previewError ? (
                  <ErrorPanel error={previewError} subject="This preview" testId="doc-preview-body-error" />
                ) : (
                  // ★ QUEUE §23.3.1 — both tabs are the ONE document view (what the client sees; what the signed copy will look like)
                  <DocumentPreviewTabs templateId={id} personId={selectedPersonId} />
                )}
              </PreviewPanel>
            </div>
          </div>

          <DocPreviewModal1Modal
            open={chooserOpen}
            onOpenChange={setChooserOpen}
            close={() => setChooserOpen(false)}
            people={people}
            peopleLoading={peopleLoading}
            selectedPersonId={selectedPersonId}
            onChoose={(personId) => { setSelectedPersonId(personId); setChooserOpen(false); }}
          />
        </div>
      </ScreenState>
    </div>
  );
}
