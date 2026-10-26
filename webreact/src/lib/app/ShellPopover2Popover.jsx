// The sidebar floor's help popover (R3.001.M2, Shell.svelte:270-285). GET /api/help is fetched on first OPEN, not
// on mount — chrome on every screen should not cost a request nobody asked for.
import { CircleHelp } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/lib/components/ui/popover";
import { ICON_STROKE } from "@/lib/icons/stroke.js";

export default function ShellPopover2Popover({ open = undefined, onOpenChange = null, path, helpInfo, helpLoading, loadHelp }) {
  void path;
  return (
    <Popover open={open} onOpenChange={(o) => { if (o) loadHelp(); onOpenChange?.(o); }}>
      <PopoverTrigger className="grid size-8 place-items-center rounded-control border border-line text-ink-2 hover:bg-mute-bg" data-testid="chrome-help" aria-label="Help">
        <CircleHelp className="size-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-control" data-testid="help-pop" align="start" side="top">
        {helpLoading ? <p className="m-0 text-mute">Loading…</p>
          : helpInfo?.configured ? <p className="m-0 text-ink-2">Need a hand? Call <a className="text-brand" href={`tel:${helpInfo.supportPhone}`}>{helpInfo.supportPhone}</a>.</p>
            : <p className="m-0 text-ink-2">No support number is set yet. <a className="text-brand" href="/settings/practice" data-testid="help-settings-link">Add one in Settings</a>.</p>}
      </PopoverContent>
    </Popover>
  );
}
