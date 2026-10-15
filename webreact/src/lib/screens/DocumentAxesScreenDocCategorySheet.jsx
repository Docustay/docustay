// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.006.M1 — DocumentAxesScreen › DocumentAxesScreenDocCategorySheet: the surface as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef, useEffect } from "react";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function DocumentAxesScreenDocCategorySheet({
  open = false,
  onOpenChange = null,
  busy = false,
  problem = null,
  label = "",
  onLabelChange = null,
  derivedKey = "",
  categoryReady = false,
  onCancel = null,
  onSubmit = null,
}) {
  const labelInputRef = useRef(null);

  // Focus the label field on open
  useEffect(() => {
    if (open && labelInputRef.current) {
      labelInputRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <ActionSurface
      kind="dialog"
      title="New category"
      testId="doc-category"
      busy={busy}
      error={problem}
      submitLabel="Create the category"
      submitDisabled={!categoryReady}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      <SheetRow label="Name">
        <Input
          ref={labelInputRef}
          data-testid="doc-category-label"
          value={label}
          onChange={(e) => onLabelChange?.(e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
        {/* ★ THE DERIVED IDENTIFIER, VISIBLE BEFORE SAVING. Never asked for, never a surprise. */}
        <p className="mt-1.5 text-meta text-mute" data-testid="doc-category-key">
          {derivedKey
            ? `Stored as ${derivedKey}`
            : "Type a name to see its identifier."}
        </p>
      </SheetRow>
    </ActionSurface>
  );
}
