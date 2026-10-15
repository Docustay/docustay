// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocPreviewModal1Modal — "Filled in for" chooser. Built from webui/src/lib/screens/documents/
// DocPreview.svelte:256-279, then FIXED 30 Sep 2026 (documents preview brief): its own description
// used to say "there is no staff preview route yet" and offer nothing but the sample-values list —
// that route now exists (`GET /api/documents/templates/:id/preview`, src/routes/documentsPreview.mjs),
// so this is a real chooser: Sample values, or search for a real client and preview their actual
// resolved data.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/lib/components/ui/dialog.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";

export default function DocPreviewModal1Modal({
  open = false, onOpenChange, close,
  people = [], peopleLoading = false, selectedPersonId = null, onChoose,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="doc-preview-chooser">
        <DialogHeader>
          <DialogTitle>Filled in for</DialogTitle>
          <DialogDescription>
            Sample values shows what every variable can look like. Pick a real client to see their
            actual data in place — the same values a real send would use.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant={selectedPersonId ? "outline" : "default"}
            className="justify-start"
            data-testid="doc-preview-chooser-sample"
            onClick={() => onChoose?.(null)}
          >
            Sample values
          </Button>
          <Combobox
            testId="doc-preview-chooser-people"
            placeholder={peopleLoading ? "Loading people…" : "Search for a real client…"}
            value={selectedPersonId ?? ""}
            options={people.map((p) => ({ value: p.id, label: p.display_name ?? p.name }))}
            onValueChange={(v) => onChoose?.(v || null)}
          />
        </div>
        <DialogFooter>
          <Button type="button" data-testid="doc-preview-chooser-close" onClick={() => close?.()}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
