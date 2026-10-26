// EditorRail — "How this behaves": the meta rail beside an editor. Always open on desktop; a collapsible
// panel on a phone (the Svelte CSS forced the same). Ported from EditorRail.svelte: same testids and copy.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible.jsx";

// ★ F95: `stackBelow="xl"` keeps the rail stacked under the form (collapsible) until 1280px, for editors whose
//   form is too tight beside a 360px rail at 1024. Class names are written out in full so Tailwind sees them.
const RAIL_AT = {
  lg: {
    aside: "border-l lg:w-90 lg:overflow-auto",
    trigger: "lg:pointer-events-none",
    chevron: "lg:hidden",
    body: "lg:data-[state=closed]:block",
  },
  xl: {
    aside: "border-t xl:border-t-0 xl:border-l xl:w-90 xl:overflow-auto",
    trigger: "xl:pointer-events-none",
    chevron: "xl:hidden",
    body: "xl:data-[state=closed]:block",
  },
};

export default function EditorRail({ objectNoun, children, testId = "editor-rail", stackBelow = "lg" }) {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const at = RAIL_AT[stackBelow] ?? RAIL_AT.lg;
  return (
    <aside className={`w-full shrink-0 border-line bg-surface px-5.5 py-6 ${at.aside}`} data-testid={testId} data-phone-open={phoneOpen}>
      <Collapsible open={phoneOpen} onOpenChange={setPhoneOpen}>
        <CollapsibleTrigger className={`group flex w-full items-center justify-between text-left ${at.trigger}`} data-testid={`${testId}-trigger`}>
          <span className="text-heading font-medium text-ink">How this behaves</span>
          <ChevronDown className={`size-4 text-caret transition-transform group-data-[state=open]:rotate-180 ${at.chevron}`} aria-hidden="true" />
        </CollapsibleTrigger>
        <p className="mt-1.5 mb-4 text-meta leading-normal text-mute" data-testid={`${testId}-sub`}>
          Your <strong className="font-medium text-ink-2">practice settings</strong> apply unless you change something here, which only affects this {objectNoun}.
        </p>
        <CollapsibleContent forceMount className={`data-[state=closed]:hidden ${at.body}`} data-testid={`${testId}-body`}>{children}</CollapsibleContent>
      </Collapsible>
    </aside>
  );
}
