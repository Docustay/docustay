// InlineValidation — the field's error, with the request id when the server gave one. Ported from InlineValidation.svelte.
import { FieldError } from "@/lib/components/ui/field.jsx";

export default function InlineValidation({ message = null, requestId = null, testId = "inline-validation" }) {
  if (!message) return null;
  return (
    <div className="mt-1.5" id={testId} data-testid={testId}>
      <FieldError errors={[{ message }]} className="text-meta text-required" data-testid={`${testId}-message`} />
      {requestId && <p className="m-0 text-meta text-mute" data-testid={`${testId}-ref`}>Reference: <code>{requestId}</code></p>}
    </div>
  );
}
