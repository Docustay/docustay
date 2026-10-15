// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.009 — GtmSheet (parent screen for GTM configuration).
//
// Component that wraps the GTM configuration in a SideSheet. Manages state and API calls.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import GtmSheetGtmSheet from "./GtmSheetGtmSheet.jsx";

export default function GtmSheet({ onDone = null, onCancel = null }) {
  const [containerId, setContainerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [fieldError, setFieldError] = useState(null);

  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetBusy, setSnippetBusy] = useState(false);
  const [head, setHead] = useState("");
  const [body, setBody] = useState("");
  const [jsonLd, setJsonLd] = useState("");

  async function submit(e) {
    e?.preventDefault?.();
    if (busy) return;

    const trimmed = containerId.trim();
    if (!trimmed) {
      setError("GTM container ID is required");
      return;
    }

    setBusy(true);
    setError(null);
    setFieldError(null);
    setErrorRequestId(null);
    setShowSnippets(false);

    try {
      await api.setSetting({ key: "run.gtm_container_id", value: trimmed });

      // Fetch snippets after successful save
      setShowSnippets(false);
      setSnippetBusy(true);
      try {
        const result = await api.gtm();
        setHead(result.head || "");
        setBody(result.body || "");
        setJsonLd(result.jsonLd || "");
        setShowSnippets(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setSnippetBusy(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFieldError(err.message);
        setErrorRequestId(err.requestId || null);
      } else {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback if clipboard API is not available
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
  }

  return (
    <SideSheet
      title="Google Tag Manager"
      onCancel={onCancel}
      onSave={submit}
      busy={busy || snippetBusy}
      error={error}
      saveLabel="Save"
      testId="gtm-sheet"
    >
      <GtmSheetGtmSheet
        open={true}
        onOpenChange={() => {}}
        onCancel={onCancel}
        containerId={containerId}
        onContainerIdChange={setContainerId}
        busy={busy || snippetBusy}
        error={error}
        errorRequestId={errorRequestId}
        fieldError={fieldError}
        showSnippets={showSnippets}
        snippetBusy={snippetBusy}
        head={head}
        body={body}
        jsonLd={jsonLd}
        submit={submit}
        copyToClipboard={copyToClipboard}
      />
    </SideSheet>
  );
}
