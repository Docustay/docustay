// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.009.M2 — GtmSheetGtmSheet.
//
// The GTM configuration sheet content, built on SideSheet with Form/Field components.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";

export default function GtmSheetGtmSheet({
  open = false,
  onOpenChange = null,
  onCancel = null,
  containerId = "",
  onContainerIdChange = null,
  busy = false,
  error = null,
  errorRequestId = null,
  fieldError = null,
  showSnippets = false,
  snippetBusy = false,
  head = "",
  body = "",
  jsonLd = "",
  submit = null,
  copyToClipboard = null,
}) {
  return (
    <div className="flex flex-col gap-6 p-5">
      {!showSnippets ? (
        <Field orientation="horizontal" className="border-b border-line-soft pb-1.5 pt-1.5 last:border-b-0">
          <FieldLabel htmlFor="gtm-container-id">Container ID</FieldLabel>
          <FieldContent>
            <Input
              id="gtm-container-id"
              value={containerId}
              onChange={(e) => onContainerIdChange?.(e.target.value)}
              data-testid="gtm-container-id"
              placeholder="GTM-XXXXXXX"
              autoComplete="off"
            />
            <InlineValidation
              message={fieldError}
              requestId={errorRequestId}
              testId="gtm-container-id-validation"
            />
            <p className="mt-1.5 text-xs text-muted-foreground" data-testid="gtm-container-id-hint">
              Find this in your Google Tag Manager account settings.
            </p>
          </FieldContent>
        </Field>
      ) : (
        <div className="flex flex-col gap-4" data-testid="gtm-snippets">
          {head && (
            <div className="rounded-md border border-line bg-surface-sunken p-3" data-testid="gtm-snippet-head">
              <h3 className="m-0 mb-2 text-sm font-semibold text-ink">Add to &lt;head&gt;</h3>
              <div className="max-h-50 overflow-auto rounded border border-line bg-paper p-2 font-mono text-xs text-ink break-all leading-[1.4]">
                {head}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard?.(head)}
                data-testid="gtm-copy-head"
                className="mt-2"
              >
                Copy
              </Button>
            </div>
          )}

          {body && (
            <div className="rounded-md border border-line bg-surface-sunken p-3" data-testid="gtm-snippet-body">
              <h3 className="m-0 mb-2 text-sm font-semibold text-ink">Add to &lt;body&gt;</h3>
              <div className="max-h-50 overflow-auto rounded border border-line bg-paper p-2 font-mono text-xs text-ink break-all leading-[1.4]">
                {body}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard?.(body)}
                data-testid="gtm-copy-body"
                className="mt-2"
              >
                Copy
              </Button>
            </div>
          )}

          {jsonLd && (
            <div className="rounded-md border border-line bg-surface-sunken p-3" data-testid="gtm-snippet-jsonld">
              <h3 className="m-0 mb-2 text-sm font-semibold text-ink">Add structured data (optional)</h3>
              <div className="max-h-50 overflow-auto rounded border border-line bg-paper p-2 font-mono text-xs text-ink break-all leading-[1.4]">
                {jsonLd}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard?.(jsonLd)}
                data-testid="gtm-copy-jsonld"
                className="mt-2"
              >
                Copy
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
