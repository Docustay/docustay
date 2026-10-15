// `?new=1` on a path whose surface is not built yet: say so, in a dialog, rather than doing nothing
// (R3.001.M1, Screen.svelte:1043-1053). Same rule as SectionNotBuilt, applied to an action.
import ActionSurface from "@/lib/forms/ActionSurface.jsx";

export default function ScreenNewNotBuiltSheet({ open = true, onOpenChange = null, newSurface, newLabel, closeForm }) {
  if (!open || !newSurface?.notBuilt) return null;
  const close = () => { onOpenChange?.(false); closeForm(); };
  return (
    <ActionSurface kind="dialog" title={newLabel} testId="new-not-built" cancelLabel={null} submitLabel="Close" onCancel={close} onSubmit={close}>
      <p className="m-0 text-ui text-ink-2" data-testid="new-not-built-reason">{newSurface.notBuilt}</p>
    </ActionSurface>
  );
}
