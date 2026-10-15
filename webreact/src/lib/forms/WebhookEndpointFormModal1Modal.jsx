// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WebhookEndpointFormModal1Modal — the webhook endpoint form modal
// Ported from webui/src/lib/forms/WebhookEndpointForm.svelte:147-287 (the form element)
// Built on AlertDialog (the kit primitive); uses kit components only (Button, Input, etc.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogFooter,
} from "@/lib/components/ui/alert-dialog.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Field, FieldLabel, FieldDescription, FieldContent } from "@/lib/components/ui/field.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function WebhookEndpointFormModal1Modal({
  open = false,
  onOpenChange,
  onCancel,
  name = "",
  url = "",
  filter = "",
  chosen = new Set(),
  busy = false,
  error = null,
  created = null,
  copied = false,
  firstField = null,
  visible = [],
  count = 0,
  ready = false,
  toggle,
  toggleSection,
  sectionState,
  submit,
  copySecret,
  finish,
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  const handleSubmit = (e) => {
    e.preventDefault();
    submit?.();
  };

  const getTotalTopicCount = () => {
    return visible.reduce((sum, g) => sum + (g.topics?.length || 0), 0);
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal">
        <form onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-label="Add endpoint" data-testid="webhook-form" className="flex flex-col w-full">
          <AlertDialogHeader className="px-6 pt-5.5 pb-1.5 text-left flex items-center justify-between">
            <AlertDialogTitle className="text-modal-title font-medium text-ink">
              {created ? "Endpoint added" : "Add endpoint"}
            </AlertDialogTitle>
            {!created && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid="webhook-form-cancel"
                onClick={() => onCancel?.()}
                disabled={busy}
                aria-label="Close"
              >
                ×
              </Button>
            )}
          </AlertDialogHeader>

          <div className="px-6 pt-3 pb-1.5 flex-1 overflow-y-auto">
            {created ? (
              // SECRET AND FINGERPRINT STATE
              <>
                <p
                  className="mb-4 rounded-sm border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm text-yellow-800"
                  data-testid="webhook-secret-warning"
                  role="alert"
                >
                  This is the only time this secret is shown. Copy it now.
                </p>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-ink mb-2">
                    Signing secret
                  </label>
                  <div className="flex gap-2 items-start">
                    <code
                      className="flex-1 px-2.5 py-1 text-sm font-mono rounded-lg border border-input bg-muted/50 break-all"
                      data-testid="webhook-secret"
                    >
                      {created.secret}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="webhook-secret-copy"
                      onClick={copySecret}
                    >
                      {copied ? "Copied" : "Copy secret"}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your endpoint uses this to verify that a delivery really came from us. Store
                    it wherever the receiving system keeps its credentials — in n8n, that is the
                    webhook node's secret.
                  </p>
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-ink mb-2">Fingerprint</label>
                  <p
                    className="px-2.5 py-1 text-sm rounded-lg border border-input bg-muted/50"
                    data-testid="webhook-fingerprint"
                  >
                    {created.fingerprint}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This is what you will see in the list from now on. It lets you confirm both
                    sides hold the same secret without either of you sending it.
                  </p>
                </div>

                {error && (
                  <p
                    className="rounded-sm border border-destructive bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                    data-testid="webhook-form-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
              </>
            ) : (
              // FORM STATE
              <>
                <div className="flex flex-col gap-5">
                  <Field>
                    <FieldLabel>Name</FieldLabel>
                    <FieldContent>
                      <Input
                        data-testid="webhook-name"
                        ref={firstField}
                        value={name}
                        required
                        maxLength="120"
                        autoComplete="off"
                      />
                    </FieldContent>
                    <FieldDescription>
                      What this endpoint is, so you can tell it from the others later.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>URL</FieldLabel>
                    <FieldContent>
                      <Input
                        data-testid="webhook-url"
                        type="url"
                        inputMode="url"
                        value={url}
                        required
                        maxLength="2000"
                        autoComplete="off"
                        placeholder="https://"
                      />
                    </FieldContent>
                    <FieldDescription>
                      Where we POST each event. For n8n this is the workflow's production webhook
                      URL.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>Events</FieldLabel>
                    <FieldDescription>
                      {count} of {getTotalTopicCount()} selected
                    </FieldDescription>
                    <FieldContent>
                      <Input
                        data-testid="webhook-topic-filter"
                        type="search"
                        value={filter}
                        placeholder="Filter events…"
                        autoComplete="off"
                        aria-label="Filter events"
                      />
                    </FieldContent>
                    <p data-testid="webhook-topic-count" className="text-sm text-muted-foreground">
                      {count} of {getTotalTopicCount()} selected
                    </p>
                    <p
                      data-testid="webhook-payload-note"
                      className="text-sm text-muted-foreground"
                    >
                      Each event carries ids, not names or text. Use the id to look up the current
                      name or title.
                    </p>

                    <div className="mt-4" data-testid="webhook-topics">
                      {visible && visible.length > 0 ? (
                        visible.map((g) => {
                          const state = sectionState?.(g);
                          return (
                            <div key={g.section} className="mb-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-ink">{g.section}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`webhook-section-${g.section}`}
                                  aria-pressed={state === "all"}
                                  onClick={() => toggleSection?.(g)}
                                >
                                  {state === "all" ? "Clear all" : "Select all"}
                                </Button>
                              </div>
                              <div className="space-y-2">
                                {g.topics &&
                                  g.topics.map((t) => (
                                    <label
                                      key={t}
                                      className="flex items-center gap-2 cursor-pointer"
                                    >
                                      <Checkbox
                                        data-testid={`webhook-topic-${t}`}
                                        checked={chosen?.has(t) ?? false}
                                        onCheckedChange={() => toggle?.(t)}
                                      />
                                      <span className="text-sm">{t}</span>
                                    </label>
                                  ))}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p data-testid="webhook-topics-nomatch" className="text-sm text-muted-foreground">
                          No event matches "{filter}".
                        </p>
                      )}
                    </div>
                  </Field>

                  {error && (
                    <p
                      className="rounded-sm border border-destructive bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                      data-testid="webhook-form-error"
                      role="alert"
                    >
                      {error}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <AlertDialogFooter className="flex-row justify-end gap-2.5 px-6 pt-4.5 pb-5.5">
            {created ? (
              <Button
                type="button"
                variant="default"
                data-testid="webhook-form-done"
                onClick={finish}
              >
                Done
              </Button>
            ) : (
              <>
                {count === 0 && (
                  <p
                    data-testid="webhook-needs-topic"
                    className="text-sm text-muted-foreground flex-1"
                  >
                    Choose at least one event — an endpoint with none would never be sent anything.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  data-testid="webhook-form-cancel-2"
                  onClick={() => onCancel?.()}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  data-testid="webhook-form-submit"
                  disabled={busy || !ready}
                >
                  {busy ? "Adding…" : "Add endpoint"}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
