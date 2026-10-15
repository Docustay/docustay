// RailOverrideNote — "Your practice normally {defaultPhrase}. Go back to that". Ported from RailOverrideNote.svelte;
// onRevert is required (a "Go back to that" wired to nothing THROWS).
import { TriangleAlert } from "lucide-react";

export default function RailOverrideNote({ defaultPhrase, onRevert, testId = "rail-override-note" }) {
  if (typeof onRevert !== "function") {
    throw new Error("RailOverrideNote: onRevert is required — \"Go back to that\" must always be wired to a real revert action, never drawn with nothing behind it.");
  }
  return (
    <div className="flex gap-2 rounded-control border border-warm-border bg-warm-bg px-3 py-2.5" role="note" data-testid={testId}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <p className="m-0 text-meta text-ink-2">Your practice normally {defaultPhrase}.{" "}
        <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" data-testid={`${testId}-revert`} onClick={() => onRevert()}>Go back to that</button>
      </p>
    </div>
  );
}
