// ExportMenu — each format states what it includes, or it throws. Ported from webui/src/lib/lists/ExportMenu.svelte.
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/lib/components/ui/dropdown-menu.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function ExportMenu({ formats, onExport, label = "Export", busy = false, testId = "export-menu" }) {
  if (!formats || formats.length === 0) throw new Error("ExportMenu: \"formats\" must be a non-empty list.");
  if (formats.some((f) => !f.includes)) {
    throw new Error("ExportMenu: every format needs an \"includes\" sentence — an export choice that does not state what it includes is a name wearing a promise.");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid={testId} disabled={busy}>{label} <span aria-hidden="true">⌄</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid={`${testId}-content`}>
        {formats.map((f) => (
          <DropdownMenuItem key={f.key} data-testid={`${testId}-item-${f.key}`} onSelect={() => onExport?.(f.key)}>
            <span className="flex flex-col"><span className="text-ui text-ink">{f.label}</span><span className="text-meta text-mute">{f.includes}</span></span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
