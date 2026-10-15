// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LandingPagesSheet — the landing page create/edit sheet component. Ported from
// webui/src/lib/screens/growth/LandingPages.svelte lines 256-303. Uses SideSheet archetype.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function LandingPagesSheet({
  open = false,
  onOpenChange = null,
  error = null,
  showCreateSheet = false,
  editingPageId = null,
  createError = null,
  createBusy = false,
  formData = { slug: "", title: "", body: "" },
  handleSaveDraft = null,
  resetForm = null,
  onCancel = null,
  onFormChange = null,
}) {
  if (!showCreateSheet) return null;

  return (
    <SideSheet
      title={editingPageId ? "Edit page" : "New page"}
      saveLabel={editingPageId ? "Save draft" : "Create page"}
      busy={createBusy}
      error={createError}
      onSave={handleSaveDraft}
      onCancel={onCancel}
      testId="landing-pages-sheet"
    >
      <SheetRow label="Slug *" htmlFor="slug" required>
        <Input
          id="slug"
          type="text"
          placeholder="e.g., welcome"
          value={formData.slug}
          onChange={(e) => onFormChange?.("slug", e.target.value)}
          disabled={createBusy}
          required
        />
      </SheetRow>

      <SheetRow label="Title *" htmlFor="title" required>
        <Input
          id="title"
          type="text"
          placeholder="Page title"
          value={formData.title}
          onChange={(e) => onFormChange?.("title", e.target.value)}
          disabled={createBusy}
          required
        />
      </SheetRow>

      <SheetRow label="Content" htmlFor="body">
        <textarea
          id="body"
          placeholder="Page content (optional)"
          value={formData.body}
          onChange={(e) => onFormChange?.("body", e.target.value)}
          disabled={createBusy}
          rows={6}
          className="h-auto w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
        />
      </SheetRow>
    </SideSheet>
  );
}
