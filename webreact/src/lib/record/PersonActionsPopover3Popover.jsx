import { Popover, PopoverTrigger, PopoverContent } from "@/lib/components/ui/popover";
import { Button } from "@/lib/components/ui/button.jsx";

export default function PersonActionsPopover3Popover({
  open,
  onOpenChange,
  busy,
  problem,
  tagsInput,
  setTagsInput,
  openTagsEditor,
  saveTags,
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2"
        data-testid="person-tags-trigger"
        onClick={() => openTagsEditor()}
      >
        Tags
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        data-testid="person-tags-pop"
        align="end"
      >
        <label className="flex flex-col gap-1 px-1">
          <span className="text-caption font-medium text-mute">Edit tags</span>
          <input
            className="h-(--size-control) rounded-control border border-line bg-surface px-2.5 text-field outline-none focus:border-brand"
            data-testid="person-tags-input"
            type="text"
            placeholder="Comma-separated"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            autoComplete="off"
          />
        </label>
        {problem && (
          <p
            className="m-0 px-1 text-meta text-bad"
            data-testid="person-tags-error"
            role="alert"
          >
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2 px-1 pt-1">
          <Button
            type="button"
            variant="secondary"
            data-testid="person-tags-cancel"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="person-tags-save"
            disabled={busy}
            onClick={saveTags}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
