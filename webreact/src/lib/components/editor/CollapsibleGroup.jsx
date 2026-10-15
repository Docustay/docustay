// CollapsibleGroup — an editor group that opens (kit2 group()): label, intro, Add, "Nothing here yet."
// Ported from CollapsibleGroup.svelte (open was $bindable → open + onOpenChange).
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";

export default function CollapsibleGroup({ label, intro = "", addLabel = null, onAdd = null, open, onOpenChange, children = undefined }) {
  const [isOpen, setOpen] = useBindable(open, onOpenChange, false);
  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} className="my-2 rounded-card border border-line bg-surface" data-testid="collapsible-group">
      <div className="flex items-center gap-3 px-4 py-3">
        <CollapsibleTrigger type="button" className="group flex flex-1 items-center gap-3 text-left" data-testid="collapsible-group-trigger" aria-expanded={isOpen}>
          <span className="flex flex-1 flex-col"><b className="text-ui font-medium text-ink">{label}</b>{intro && <span className="text-meta text-mute">{intro}</span>}</span>
          <ChevronDown className="size-4 text-caret transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" data-open={isOpen} />
        </CollapsibleTrigger>
        {addLabel && <Button type="button" variant="outline" size="sm" data-testid="collapsible-group-add" onClick={() => onAdd?.()}>{addLabel}</Button>}
      </div>
      <CollapsibleContent data-testid="collapsible-group-body">
        <Separator className="bg-hair" />
        <div className="px-4 py-3">
          {children ?? (
            <div className="flex items-center justify-between gap-3" data-testid="collapsible-group-empty">
              <p className="m-0 text-ui text-mute">Nothing here yet.</p>
              {addLabel && <Button type="button" variant="outline" size="sm" onClick={() => onAdd?.()}>{addLabel}</Button>}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
