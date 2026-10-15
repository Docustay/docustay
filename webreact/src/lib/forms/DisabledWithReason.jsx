// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DisabledWithReason — a missing PREREQUISITE renders the control DISABLED with the reason beside it.
// Ported from webui/src/lib/forms/DisabledWithReason.svelte (same props, same testids, same refusal).
// ★★★ The other half of the maintainer's rule: a PERMISSION renders nothing (<Can>, WriteButton's `hidden`); a
//     prerequisite renders this. Getting them the wrong way round is a defect.
// ★ `children` is a function ({ disabled, describedBy }) => node, exactly as the Svelte snippet was, so
//   the child wires aria-describedby onto its own control.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export default function DisabledWithReason({ disabled, reason = "", children, testId = "disabled-with-reason" }) {
  if (disabled && !reason) {
    throw new Error(
      "DisabledWithReason: disabled is true but reason is empty — a disabled control with " +
      "nothing said beside it is hidden information, not a disabled control.");
  }
  const describedBy = `${testId}-reason`;
  return (
    <span className="inline-flex items-center gap-2.5" data-testid={testId} data-disabled={disabled ? "true" : undefined}>
      <span className="inline-flex">{typeof children === "function" ? children({ disabled, describedBy }) : children}</span>
      {disabled && (
        <span id={describedBy} className="text-meta text-mute" data-testid={`${testId}-reason`}>{reason}</span>
      )}
    </span>
  );
}
