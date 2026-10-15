// AfterSavePanel — "Saved." and what people usually do next; focus lands on the first next action (or
// Keep editing). Ported from AfterSavePanel.svelte: same props, testids, copy.
import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function AfterSavePanel({ headline = "Saved.", sentence = "", nextActions = [], onKeepEditing = null, testId = "after-save-panel" }) {
  const actionsEl = useRef(null);
  const keepEl = useRef(null);
  useEffect(() => {
    if (nextActions.length > 0) actionsEl.current?.querySelector(`[data-testid="${testId}-action-0"]`)?.focus();
    else keepEl.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount, as the Svelte onMount did
  return (
    <div className="mx-auto flex w-full max-w-160 flex-col gap-3 py-10" data-testid={testId}>
      <h1 className="m-0 text-page-title font-medium text-ink" data-testid={`${testId}-headline`}>{headline}</h1>
      {sentence && <p className="m-0 text-ui text-ink-2" data-testid={`${testId}-sentence`}>{sentence}</p>}
      {nextActions.length > 0 && (
        <>
          <div className="mt-3 text-caption font-medium text-mute" data-testid={`${testId}-nextlabel`}>What people usually do next</div>
          <div className="flex flex-col gap-2.5" ref={actionsEl} data-testid={`${testId}-actions`}>
            {nextActions.map((action, i) => (
              <Card key={action.title} className="rounded-card border-line py-0" data-testid={`${testId}-card-${i}`}>
                <CardContent className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex flex-1 flex-col"><b className="text-ui font-medium text-ink">{action.title}</b>{action.why && <span className="text-meta text-mute">{action.why}</span>}</div>
                  <Button type="button" variant="outline" size="sm" data-testid={`${testId}-action-${i}`} onClick={() => action.onClick?.()}>{action.label}</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      <div className="mt-3"><Button type="button" variant="outline" ref={keepEl} data-testid={`${testId}-keep-editing`} onClick={() => onKeepEditing?.()}>Keep editing</Button></div>
    </div>
  );
}
