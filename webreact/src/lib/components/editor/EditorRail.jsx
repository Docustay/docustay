// EditorRail — "How this behaves": the meta rail beside an editor. Always open on desktop; a collapsible
// panel on a phone (the Svelte CSS forced the same). Ported from EditorRail.svelte: same testids and copy.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible.jsx";

export default function EditorRail({ objectNoun, children, testId = "editor-rail" }) {
  const [phoneOpen, setPhoneOpen] = useState(false);
  return (
    <aside className="w-full shrink-0 border-l border-line bg-surface px-5.5 py-6 lg:w-90 lg:overflow-auto" data-testid={testId} data-phone-open={phoneOpen}>
      <Collapsible open={phoneOpen} onOpenChange={setPhoneOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-left lg:pointer-events-none" data-testid={`${testId}-trigger`}>
          <span className="text-heading font-medium text-ink">How this behaves</span>
          <ChevronDown className="size-4 text-caret transition-transform group-data-[state=open]:rotate-180 lg:hidden" aria-hidden="true" />
        </CollapsibleTrigger>
        <p className="mt-1.5 mb-4 text-meta leading-normal text-mute" data-testid={`${testId}-sub`}>
          Your <strong className="font-medium text-ink-2">practice settings</strong> apply unless you change something here, which only affects this {objectNoun}.
        </p>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden lg:data-[state=closed]:block" data-testid={`${testId}-body`}>{children}</CollapsibleContent>
      </Collapsible>
    </aside>
  );
}
