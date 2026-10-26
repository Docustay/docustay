// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.006.M2 — DocumentAxesScreen › DocumentAxesScreenDocTypeSheet: the surface as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef, useEffect } from "react";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function DocumentAxesScreenDocTypeSheet({
  open = false,
  onOpenChange = null,
  categories = [],
  vocab = {},
  busy = false,
  problem = null,
  label = "",
  onLabelChange = null,
  categoryId = "",
  onCategoryIdChange = null,
  signerConfig = "",
  onSignerConfigChange = null,
  audience = "",
  onAudienceChange = null,
  division = "",
  onDivisionChange = null,
  appliesTo = "",
  onAppliesToChange = null,
  assignedTo = "",
  onAssignedToChange = null,
  derivedKey = "",
  typeReady = false,
  onCancel = null,
  onSubmit = null,
  pretty = null,
}) {
  const labelInputRef = useRef(null);

  // Focus the label field on open
  useEffect(() => {
    if (open && labelInputRef.current) {
      labelInputRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const footerNote =
    categories.length === 0
      ? "Create a category first — a document type has to belong to one."
      : typeReady
        ? null
        : "Every axis has to be set: an unset one has no defined signing behaviour.";

  return (
    <ActionSurface
      kind="drawer"
      title="New document type"
      testId="doc-type"
      busy={busy}
      error={problem}
      submitLabel="Create the type"
      submitDisabled={!typeReady}
      footerNote={footerNote}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      <SheetRow label="Name">
        <Input
          ref={labelInputRef}
          data-testid="doc-type-label"
          value={label}
          onChange={(e) => onLabelChange?.(e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
        <p className="mt-1.5 text-meta text-mute" data-testid="doc-type-key">
          {derivedKey
            ? `Stored as ${derivedKey}`
            : "Type a name to see its identifier."}
        </p>
      </SheetRow>

      <SheetRow label="Category">
        <select
          data-testid="doc-type-category"
          value={categoryId}
          onChange={(e) => onCategoryIdChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </SheetRow>

      {/* ═══════════════════════════════════════════════════════════════════════════════════════════
         ★★★ FIVE AXES, EVERY OPTION FROM THE SERVER'S OWN VOCABULARY. Not one of these lists is
             written in this file — see the header.
      ═══════════════════════════════════════════════════════════════════════════════════════════ */}

      <SheetRow label="Who signs">
        <select
          data-testid="doc-type-signer"
          value={signerConfig}
          onChange={(e) => onSignerConfigChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {(vocab.signer_configs ?? []).map((v) => (
            <option key={v} value={v}>
              {pretty ? pretty(v) : v}
            </option>
          ))}
        </select>
      </SheetRow>

      <SheetRow label="Audience">
        <select
          data-testid="doc-type-audience"
          value={audience}
          onChange={(e) => onAudienceChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {(vocab.audiences ?? []).map((v) => (
            <option key={v} value={v}>
              {pretty ? pretty(v) : v}
            </option>
          ))}
        </select>
      </SheetRow>

      <SheetRow label="Division">
        <select
          data-testid="doc-type-division"
          value={division}
          onChange={(e) => onDivisionChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {(vocab.divisions ?? []).map((v) => (
            <option key={v} value={v}>
              {pretty ? pretty(v) : v}
            </option>
          ))}
        </select>
      </SheetRow>

      <SheetRow label="Applies to">
        <select
          data-testid="doc-type-applies"
          value={appliesTo}
          onChange={(e) => onAppliesToChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {(vocab.applies_to ?? []).map((v) => (
            <option key={v} value={v}>
              {pretty ? pretty(v) : v}
            </option>
          ))}
        </select>
      </SheetRow>

      <SheetRow label="Assigned to by default">
        <select
          data-testid="doc-type-assigned"
          value={assignedTo}
          onChange={(e) => onAssignedToChange?.(e.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        >
          <option value="">Choose…</option>
          {(vocab.assignment_targets ?? []).map((v) => (
            <option key={v} value={v}>
              {pretty ? pretty(v) : v}
            </option>
          ))}
        </select>
      </SheetRow>
    </ActionSurface>
  );
}
