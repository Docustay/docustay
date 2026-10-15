// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsPdfImport — pdf.js IN THE BROWSER. Built FROM `specs/mockups/DocsPdfImport.frame.html`.
// Shows the upload+detect step with per-field keep/skip/change-variable review modal.
// See the Svelte source for full documentation of the phases, error handling, and detection logic.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useCallback, useEffect, useMemo } from "react";
import { request, ApiError } from "@/lib/api.js";
import { requestUploadTicket } from "@/lib/documents/ports.js";
import { FileDropZoneDragOverlay, FileDropZoneRoot, FileDropZoneTrigger } from "@/lib/components/ui/file-drop-zone.jsx";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Progress } from "@/lib/components/ui/progress.jsx";
import { Spinner } from "@/lib/components/ui/spinner.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DocsPdfImportDocsPdfImportReviewModal from "./DocsPdfImportDocsPdfImportReviewModal.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import { VARIABLES } from "@keystone/documents/variableCatalogue.mjs";

const UPLOAD_INPUT_ID = "docs-pdf-import-input";

// ★★★ THE TWO ERROR SENTENCES — verbatim, field 14's own words, and the only two this screen uses.
const PDF_UNREADABLE_MESSAGE = "That PDF couldn't be read. Try exporting it again.";
const PUT_REFUSED_MESSAGE = "The upload didn't finish. Try again.";

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];

function numberWord(n) {
  if (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length) return NUMBER_WORDS[n];
  return String(n);
}

function snippetAround(text, index, len) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 500);
}

/** ★★ See header — five regexes, mapped by label, never auto-accepted, never silently skipped. */
function detectFields(texts) {
  const out = [];
  const n = { name: 0, date: 0, signature: 0, blank: 0, amount: 0 };
  for (const { page, text } of texts) {
    for (const m of text.matchAll(/\bName\s*:/gi)) {
      n.name += 1;
      out.push({
        localId: `name_${page}_${n.name}`, key: `client_name_${page}_${n.name}`,
        label: "Name", kind: "variable", variable: "client.name", page,
        snippet: snippetAround(text, m.index, m[0].length), keep: true,
      });
    }
    for (const m of text.matchAll(/\bDate\s*:/gi)) {
      n.date += 1;
      out.push({
        localId: `date_${page}_${n.date}`, key: `date_${page}_${n.date}`,
        label: "Date", kind: "date", variable: "document.date", page,
        snippet: snippetAround(text, m.index, m[0].length), keep: true,
      });
    }
    for (const m of text.matchAll(/\bSignature\b/gi)) {
      n.signature += 1;
      out.push({
        localId: `signature_${page}_${n.signature}`, key: `signature_${page}_${n.signature}`,
        label: "Signature", kind: "signature", variable: null, page,
        snippet: snippetAround(text, m.index, m[0].length), keep: true,
      });
    }
    for (const m of text.matchAll(/_{5,}/g)) {
      n.blank += 1;
      const ctx = snippetAround(text, m.index, m[0].length).toLowerCase();
      const isDate = /date/.test(ctx) && !/sign/.test(ctx);
      out.push({
        localId: `blank_${page}_${n.blank}`, key: `blank_${page}_${n.blank}`,
        label: isDate ? "Date line" : "Signature line",
        kind: isDate ? "date" : "signature",
        variable: isDate ? "document.date" : null,
        page, snippet: snippetAround(text, m.index, m[0].length), keep: true,
      });
    }
    for (const m of text.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?/g)) {
      n.amount += 1;
      out.push({
        localId: `amount_${page}_${n.amount}`, key: `amount_${page}_${n.amount}`,
        label: `Amount (${m[0].trim()})`, kind: "variable", variable: null, page,
        snippet: snippetAround(text, m.index, m[0].length),
        // ★★★ no catalogue variable exists for a price — default SKIP, see header.
        keep: false,
      });
    }
  }
  return out;
}

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ★★★ DYNAMIC IMPORT ONLY — 09 §:97's bundle rule. `pdfjs-dist` and its worker module are both
 *  fetched for the first time here, once a person has actually chosen a PDF — never at page load. */
async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjsLib;
}

function toWireField(f) {
  return {
    key: f.key, label: f.label, kind: f.kind, variable: f.variable ?? null, page: f.page,
    snippet: f.snippet ?? null,
  };
}

function needsVariable(f) { return f.kind !== "signature"; }
function fieldIsBlocking(f) { return f.keep && needsVariable(f) && !f.variable; }
function fieldStatusTone(f) {
  if (!f.keep) return "neutral";
  if (fieldIsBlocking(f)) return "warn";
  return "ok";
}
function fieldStatusLabel(f) {
  if (!f.keep) return "Skipped";
  if (fieldIsBlocking(f)) return "Needs a variable";
  return "Keeping";
}

export default function DocsPdfImport({
  path = "/documents/import",
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
}) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else if (typeof window !== "undefined") window.location.assign(href);
  }

  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [reading, setReading] = useState({ page: 0, total: 0 });
  const [uploadStep, setUploadStep] = useState(null);
  const [putPercent, setPutPercent] = useState(0);
  const [fileName, setFileName] = useState(null);
  const [pageTexts, setPageTexts] = useState([]);
  const [textSha256, setTextSha256] = useState(null);
  const [importId, setImportId] = useState(null);
  const [fields, setFields] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const resetForNewFile = useCallback(() => {
    setError(null);
    setReading({ page: 0, total: 0 });
    setUploadStep(null);
    setPutPercent(0);
    setPageTexts([]);
    setTextSha256(null);
    setImportId(null);
    setFields([]);
    setReviewOpen(false);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  /** ★★★ THE BYTES NEVER PASS THROUGH THE APPLICATION. This PUT targets `ticket.url` — the presigned
   *  storage URL, never an `/api/*` path — and carries only the header the ticket itself signed
   *  (`content-type`; `s3.mjs`'s SignedHeaders is `content-type;host`). `XMLHttpRequest`, not
   *  `fetch`: it is the standard API with real `upload.onprogress`, which is what makes this a real
   *  progress bar rather than a spinner standing in front of an opaque transfer. */
  function putToStorage(ticket, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(ticket.method ?? "PUT", ticket.url, true);
      for (const [k, v] of Object.entries(ticket.headers ?? {})) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPutPercent(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { setPutPercent(100); resolve(); }
        else reject(new Error(`storage refused the upload (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("network error during upload"));
      xhr.send(file);
    });
  }

  const handleFile = useCallback(async (file) => {
    resetForNewFile();
    setFileName(file.name);
    setPhase("reading");

    let extracted;
    try {
      const pdfjsLib = await loadPdfjs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const total = pdf.numPages;
      extracted = [];
      for (let p = 1; p <= total; p++) {
        setReading({ page: p, total });
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((it) => it.str ?? "").join(" ");
        extracted.push({ page: p, text });
      }
    } catch {
      setPhase("error");
      setError({ message: PDF_UNREADABLE_MESSAGE });
      return;
    }

    setPageTexts(extracted);
    const hash = await sha256Hex(extracted.map((p) => p.text).join("\n"));
    setTextSha256(hash);
    const detected = detectFields(extracted);

    // ── uploading: (3) the ticket, (4) the PUT straight to storage, (5) the record ────────────────
    setPhase("uploading");
    setUploadStep("ticket");
    let ticket;
    try {
      ticket = await requestUploadTicket({ kind: "pdf_import", contentType: "application/pdf", bytes: file.size });
    } catch (err) {
      setPhase("error");
      setError(err instanceof ApiError ? { message: err.message, requestId: err.requestId }
                                       : { message: String(err?.message ?? err) });
      return;
    }

    setUploadStep("put");
    setPutPercent(0);
    try {
      await putToStorage(ticket, file);
    } catch {
      setPhase("error");
      setError({ message: PUT_REFUSED_MESSAGE });
      return;
    }

    setUploadStep("record");
    let recorded;
    try {
      recorded = await request("/api/documents/pdf-imports", {
        method: "POST",
        body: {
          fileName: file.name, pageCount: extracted.length, textSha256: hash,
          detectedFields: detected.map(toWireField), s3Key: ticket.key,
        },
      });
    } catch (err) {
      setPhase("error");
      setError(err instanceof ApiError ? { message: err.message, requestId: err.requestId }
                                       : { message: String(err?.message ?? err) });
      return;
    }

    setImportId(recorded.id);
    setFields(detected);
    setPhase("found");
  }, [resetForNewFile]);

  const handleUpload = useCallback(async (files) => {
    const file = files?.[0];
    if (!file) return;
    await handleFile(file);
  }, [handleFile]);

  /** ★ A dropped/picked file FileDropZone's own `accept` refuses is read as "couldn't be read" —
   *  see header for why this does not invent a third sentence. */
  const onFileRejected = useCallback(() => {
    setPhase("error");
    setError({ message: PDF_UNREADABLE_MESSAGE });
  }, []);

  const chooseAgain = useCallback(() => {
    setPhase("idle");
    resetForNewFile();
    setFileName(null);
  }, [resetForNewFile]);

  const foundCount = useMemo(() => fields.length, [fields.length]);
  const keptFields = useMemo(() => fields.filter((f) => f.keep), [fields]);
  const skippedCount = useMemo(() => fields.length - keptFields.length, [fields.length, keptFields.length]);
  const blockingFields = useMemo(() => fields.filter(fieldIsBlocking), [fields]);
  const distinctLabels = useMemo(() => [...new Set(fields.map((f) => f.label))], [fields]);

  const openReview = useCallback(() => { setReviewOpen(true); }, []);
  const closeReview = useCallback(() => { setReviewOpen(false); }, []);

  const submitConfirm = useCallback(async () => {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const res = await request("/api/documents/pdf-imports/confirm", {
        method: "POST",
        body: {
          importId,
          confirmedFields: keptFields.map(toWireField),
          paragraphs: pageTexts.map((p) => ({ page: p.page, text: p.text })),
        },
      });
      setReviewOpen(false);
      onRefetch?.();
      onNavigate?.(`/documents/templates/${res.templateId}`);
    } catch (err) {
      setConfirmError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setConfirmBusy(false);
    }
  }, [importId, keptFields, pageTexts, onRefetch, onNavigate]);

  const updateField = useCallback((idx, updates) => {
    setFields((prev) => {
      const newFields = [...prev];
      newFields[idx] = { ...newFields[idx], ...updates };
      return newFields;
    });
  }, []);

  return (
    <div
      className="flex flex-col gap-6 max-w-2xl mx-auto px-6 py-6"
      data-testid="docs-pdf-import"
      data-phase={phase}
    >
      {phase === "error" && (
        <Card data-testid="docs-pdf-import-error-card">
          <CardContent className="flex flex-col">
            <ErrorPanel
              error={error}
              subject="This document"
              onRetry={chooseAgain}
              testId="docs-pdf-import-error"
            />
          </CardContent>
        </Card>
      )}

      {phase === "idle" && (
        <FileDropZoneRoot
          id={UPLOAD_INPUT_ID}
          accept="application/pdf"
          onUpload={handleUpload}
          onFileRejected={onFileRejected}
        >
          <Card data-testid="docs-pdf-import-idle">
            <CardContent className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-medium text-ink m-0">Use a document you already have</h2>
                <p className="text-sm text-ink-muted leading-relaxed mt-3 m-0">
                  Upload the PDF you&rsquo;ve been printing and signing by hand. We&rsquo;ll find the
                  places that need filling in and make them fill themselves.
                </p>
              </div>
              <FileDropZoneTrigger
                className="flex flex-col items-center justify-center gap-1 min-h-30 border border-dashed border-line rounded-lg bg-paper hover:cursor-pointer text-ink-muted text-sm"
                data-testid="docs-pdf-import-drop"
              >
                <b className="font-medium text-ink-2">Drop the PDF here</b>
                <span>or browse files</span>
              </FileDropZoneTrigger>
            </CardContent>
          </Card>
          <FileDropZoneDragOverlay>
            <span>Drop the PDF to read it</span>
          </FileDropZoneDragOverlay>
        </FileDropZoneRoot>
      )}

      {phase === "reading" && (
        <Card data-testid="docs-pdf-import-reading">
          <CardContent className="flex flex-col gap-6">
            <b className="text-ink font-medium break-words" data-testid="docs-pdf-import-filename">{fileName}</b>
            <div>
              <span className="text-sm text-ink-muted" data-testid="docs-pdf-import-reading-label">
                Reading page {reading.page} of {reading.total}
              </span>
              <Progress
                value={reading.page}
                max={Math.max(reading.total, 1)}
                className="mt-3"
                data-testid="docs-pdf-import-reading-progress"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "uploading" && (
        <Card data-testid="docs-pdf-import-uploading">
          <CardContent className="flex flex-col gap-6">
            <b className="text-ink font-medium break-words">{fileName}</b>
            {uploadStep === "put" ? (
              <div>
                <span className="text-sm text-ink-muted" data-testid="docs-pdf-import-put-label">
                  Uploading &mdash; {putPercent}%
                </span>
                <Progress value={putPercent} max={100} className="mt-3" data-testid="docs-pdf-import-put-progress" />
              </div>
            ) : (
              <div>
                <span className="text-sm text-ink-muted" data-testid="docs-pdf-import-step-label">
                  {uploadStep === "ticket" ? "Getting ready to upload…" : "Saving what we found…"}
                </span>
                <div className="mt-3">
                  <Spinner data-testid="docs-pdf-import-step-spinner" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === "found" && (
        <Card data-testid="docs-pdf-import-found">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <b className="text-ink font-medium break-words">{fileName}</b>
              <StatusBadge label="Read" tone="ok" testId="docs-pdf-import-read-badge" />
            </div>
            <Separator />
            <p className="text-sm text-ink leading-relaxed m-0" data-testid="docs-pdf-import-found-summary">
              <b>We found {numberWord(foundCount)} thing{foundCount === 1 ? "" : "s"} to fill in.</b>
              {distinctLabels.length > 0 && (
                <> {distinctLabels.join(", ")}.</>
              )}
              {" "}You&rsquo;ll check each one on the next screen before anything is used.
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <Button
                variant="outline"
                data-testid="docs-pdf-import-cancel"
                onClick={chooseAgain}
              >
                Cancel
              </Button>
              <Button
                data-testid="docs-pdf-import-open-review"
                onClick={openReview}
              >
                Check the {numberWord(foundCount)}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DocsPdfImportDocsPdfImportReviewModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        numberWord={numberWord}
        error={error}
        fields={fields}
        confirmBusy={confirmBusy}
        confirmError={confirmError}
        fieldStatusTone={fieldStatusTone}
        fieldStatusLabel={fieldStatusLabel}
        foundCount={foundCount}
        keptFields={keptFields}
        skippedCount={skippedCount}
        blockingFields={blockingFields}
        closeReview={closeReview}
        submitConfirm={submitConfirm}
        updateField={updateField}
      />
    </div>
  );
}
