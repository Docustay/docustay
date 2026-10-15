// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreement — Attach an agreement template to a service, package or plan
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte (277 lines)
// Manages loading, permission checks, error states, and form submission for agreement attachment
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { listAgreementTemplates } from "@/lib/documents/index.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import ModalAttachAgreementModal1Modal from "./ModalAttachAgreementModal1Modal.jsx";
import ModalAttachAgreementModal2Modal from "./ModalAttachAgreementModal2Modal.jsx";
import ModalAttachAgreementModal3Modal from "./ModalAttachAgreementModal3Modal.jsx";
import ModalAttachAgreementModal4Modal from "./ModalAttachAgreementModal4Modal.jsx";
import ModalAttachAgreementModal from "./ModalAttachAgreementModal.jsx";

const EDITOR_PATH_SEGMENT = { service: "services", package: "packages", plan: "plans" };

export default function ModalAttachAgreement({
  open = false,
  onOpenChange,
  itemType = "service",
  itemId,
  itemName = null,
  onClose = null,
  onAttached,
  testId = "modal-attach-agreement",
}) {
  // ★★★ Required prop validation
  useEffect(() => {
    if (open && typeof onAttached !== "function") {
      throw new Error(
        "ModalAttachAgreement: onAttached is required — a successful attach must always be handed " +
        "back to the caller, never drawn with nothing behind it."
      );
    }
  }, [open, onAttached]);

  // ── LOAD STATE ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading"); // "loading" | "denied" | "error" | "ready"
  const [loadError, setLoadError] = useState(null);
  const [resolvedName, setResolvedName] = useState(itemName);
  const [templates, setTemplates] = useState([]); // [{id, name, active}]

  async function loadAll() {
    setPhase("loading");
    setLoadError(null);
    try {
      const needsName = itemName === null;
      const editorPath = EDITOR_PATH_SEGMENT[itemType] ?? "services";

      const [templateRes, nameRes] = await Promise.all([
        listAgreementTemplates(),
        needsName
          ? request(`/api/items/${editorPath}/${encodeURIComponent(itemId)}/editor`)
          : Promise.resolve(null),
      ]);

      setTemplates((templateRes?.rows ?? []).filter((t) => t.active));
      if (needsName) {
        setResolvedName(nameRes?.item?.name ?? "this item");
      }
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
        setLoadError(err instanceof ApiError ? err : String(err?.message ?? err));
      }
    }
  }

  useEffect(() => {
    if (open && phase === "loading") {
      loadAll();
    }
  }, [open, phase]);

  // ── FORM STATE ─────────────────────────────────────────────────────────────
  const [templateId, setTemplateId] = useState("");
  const [firstBookingOnly, setFirstBookingOnly] = useState(true);
  const [holdUntilSigned, setHoldUntilSigned] = useState(false);
  const [teenTemplateId, setTeenTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const title = `Send a document when ${resolvedName ?? "this item"} is booked`;
  const subtitle = `${resolvedName ?? "This item"}. It goes out the moment someone books, not when you remember.`;

  function handleCancel() {
    if (busy) return;
    onOpenChange?.(false);
    onClose?.();
  }

  async function handleSubmit() {
    if (busy || !templateId) return;
    setSubmitError(null);
    setBusy(true);
    try {
      const res = await request("/api/items/agreements", {
        method: "POST",
        body: {
          itemType,
          itemId,
          templateId,
          firstBookingOnly,
          holdUntilSigned,
          teenTemplateId: teenTemplateId || null,
        },
        idempotencyKey: newIdempotencyKey(),
      });
      onAttached?.(res);
      onOpenChange?.(false);
      onClose?.();
    } catch (err) {
      // ★★★ THE SERVER'S OWN MESSAGE, VERBATIM, WITH ITS REQUESTID
      setSubmitError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  // Render the appropriate modal based on phase
  if (phase === "loading") {
    return (
      <ModalAttachAgreementModal1Modal
        open={open}
        onOpenChange={onOpenChange}
        testId={testId}
      />
    );
  }

  if (phase === "denied") {
    return (
      <ModalAttachAgreementModal2Modal
        open={open}
        onOpenChange={onOpenChange}
        testId={testId}
      />
    );
  }

  if (phase === "error") {
    return (
      <ModalAttachAgreementModal3Modal
        open={open}
        onOpenChange={onOpenChange}
        testId={testId}
        loadError={loadError}
        loadAll={loadAll}
      />
    );
  }

  if (phase === "ready" && templates.length === 0) {
    return (
      <ModalAttachAgreementModal4Modal
        open={open}
        onOpenChange={onOpenChange}
        testId={testId}
        templates={templates}
      />
    );
  }

  // Main form modal (phase === "ready" && templates.length > 0)
  return (
    <ModalAttachAgreementModal
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      templates={templates}
      templateId={templateId}
      firstBookingOnly={firstBookingOnly}
      holdUntilSigned={holdUntilSigned}
      teenTemplateId={teenTemplateId}
      busy={busy}
      submitError={submitError}
      title={title}
      subtitle={subtitle}
      onTemplateChange={setTemplateId}
      onFirstBookingOnlyChange={setFirstBookingOnly}
      onHoldUntilSignedChange={setHoldUntilSigned}
      onTeenTemplateChange={setTeenTemplateId}
      onCancel={handleCancel}
      onConfirm={handleSubmit}
    />
  );
}
