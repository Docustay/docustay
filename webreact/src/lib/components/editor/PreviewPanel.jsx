// PreviewPanel — "what the client sees", with Print. Ported from PreviewPanel.svelte.
import { Card, CardHeader, CardTitle, CardContent } from "@/lib/components/ui/card.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function PreviewPanel({ title, subtitle = "", printable = true, children = null, testId = "preview-panel" }) {
  return (
    <Card className="rounded-card border-line" data-testid={testId}>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="flex flex-1 flex-col">
          <CardTitle className="text-heading font-medium text-ink" data-testid={`${testId}-title`}>{title}</CardTitle>
          {subtitle && <p className="m-0 text-meta text-mute" data-testid={`${testId}-subtitle`}>{subtitle}</p>}
        </div>
        {printable && <Button type="button" variant="outline" data-testid={`${testId}-print`} onClick={() => window.print()}>Print</Button>}
      </CardHeader>
      <CardContent data-testid={`${testId}-body`}>{children}</CardContent>
    </Card>
  );
}
