// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WriteButton — a button that writes. It cannot render without its permission having been asked.
//   write.hidden  → renders NOTHING (a permission renders nothing)
//   write.blocked → DisabledWithReason with the reason (a missing prerequisite renders disabled + why)
//   otherwise     → the Button, disabled and aria-busy while write.busy
// `write` is the object useWrite() returns. REACT-PLAN §4.5 item 4, R-35.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function WriteButton({ write, children, busyLabel = "Saving…", testId, disabled = false, ...rest }) {
  if (!write || typeof write.hidden !== "boolean") {
    throw new Error("WriteButton: pass the object useWrite() returns as `write` — a write control must ask its permission");
  }
  if (write.hidden) return null;
  if (write.blocked) {
    return (
      <DisabledWithReason disabled reason={write.blocked.reason} testId={testId ? `${testId}-blocked` : undefined}>
        {({ describedBy }) => (
          <Button {...rest} data-testid={testId} disabled aria-describedby={describedBy}>{children}</Button>
        )}
      </DisabledWithReason>
    );
  }
  return (
    <Button {...rest} data-testid={testId} disabled={disabled || write.busy} aria-busy={write.busy || undefined}>
      {write.busy ? busyLabel : children}
    </Button>
  );
}
