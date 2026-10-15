// HeroNumber — the one bold figure with its label (Fraunces via Figure). Absent → "—", never a fabricated 0.
// Ported from webui/src/lib/components/kit/HeroNumber.svelte: same props and testids.
import { Button } from "@/lib/components/ui/button.jsx";
import Figure from "./Figure.jsx";

export default function HeroNumber({ figure, label, sub = "", action = null, testId = "hero-number" }) {
  const absent = figure === null || figure === undefined || figure === "";
  return (
    <div className="flex items-end gap-4" data-testid={testId}>
      <div className="flex flex-col">
        {absent
          ? <span className="text-figure-md text-faint" data-testid={`${testId}-figure`} data-absent="true" title="Not shown">—</span>
          : <Figure size="md" testId={`${testId}-figure`}>{figure}</Figure>}
        <span className="text-ui text-ink-2" data-testid={`${testId}-label`}>{label}</span>
        {sub && <span className="text-meta text-mute" data-testid={`${testId}-sub`}>{sub}</span>}
      </div>
      {action && <Button type="button" variant="outline" size="sm" data-testid={`${testId}-action`} onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
