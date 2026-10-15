// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatGrantAccess — the "Ask to look" sheet for platform operators to request temporary access
// to a practice account. Ported from webui/src/lib/screens/platform/PlatGrantAccess.svelte.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api } from "@/lib/api.js";
import PlatGrantAccessPlatGrantAccessSheet from "./PlatGrantAccessPlatGrantAccessSheet.jsx";
import { savedToast } from "@/lib/hooks/savedToast.js";

export default function PlatGrantAccess({
  tenantId,
  practiceName,
  open = false,
  onClose,
  onAsked,
}) {
  const [why, setWhy] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [isLoading, setIsLoading] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [conflictError, setConflictError] = useState(null);

  const durationOptions = [
    { value: "60", label: "One hour" },
    { value: "120", label: "Two hours" },
    { value: "240", label: "Four hours" },
    { value: "480", label: "Eight hours" },
  ];

  const isWhyValid = () => why.trim().length >= 10;

  const handleClose = () => {
    setWhy("");
    setDurationMinutes("60");
    setFieldError(null);
    setConflictError(null);
    onClose?.();
  };

  const handleSubmit = async () => {
    setFieldError(null);
    setConflictError(null);

    if (!isWhyValid()) {
      setFieldError("Why must be at least 10 characters");
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.askForAccess({
        tenantId,
        why: why.trim(),
        durationMinutes: parseInt(durationMinutes, 10),
      });

      if (result) {
        savedToast("Access request sent");
        onAsked?.(result);
        setWhy("");
        setDurationMinutes("60");
        setFieldError(null);
        setConflictError(null);
      }
    } catch (err) {
      // Handle 409 conflict (already asked)
      if (err?.status === 409) {
        setConflictError("You already asked — they haven't answered yet.");
      } else if (err?.status === 400) {
        setFieldError(err?.message || "Invalid request");
      } else {
        setFieldError(err?.message || "An error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PlatGrantAccessPlatGrantAccessSheet
      open={open}
      onOpenChange={(value) => {
        if (!value) handleClose();
      }}
      practiceName={practiceName}
      why={why}
      durationMinutes={durationMinutes}
      isLoading={isLoading}
      fieldError={fieldError}
      conflictError={conflictError}
      durationOptions={durationOptions}
      handleClose={handleClose}
      handleSubmit={handleSubmit}
      onWhyChange={setWhy}
      onDurationMinutesChange={setDurationMinutes}
    />
  );
}
