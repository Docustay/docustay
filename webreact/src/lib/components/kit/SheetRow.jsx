// SheetRow / SheetSection — the create sheet's label-left / field-right rows (CLAUDE.md vocabulary 4;
// replaces ks-sheet-row*, ks-sheet-section, ks-label, ks-hint, ks-optional). kit2 .f: 190px label column.
export function SheetSection({ title = null, children, testId = undefined }) {
  return (
    <section className="border-b border-hair py-4 last:border-b-0" data-testid={testId}>
      {title && <h3 className="m-0 mb-2 text-heading font-medium text-ink">{title}</h3>}
      {children}
    </section>
  );
}
export default function SheetRow({ label, htmlFor = undefined, required = false, optional = false, hint = null, children, testId = undefined }) {
  return (
    <div className="flex items-start gap-5 py-2.5" data-testid={testId}>
      <label htmlFor={htmlFor} className="w-(--size-field-label) shrink-0 pt-2.5 text-ui text-ink-2">
        {label}{required && <span className="ml-0.5 text-required" aria-hidden="true">*</span>}{optional && <span className="ml-1.25 text-caption text-placeholder">optional</span>}
      </label>
      <div className="min-w-0 flex-1">{children}{hint && <p className="mt-1.5 text-meta leading-normal text-mute">{hint}</p>}</div>
    </div>
  );
}
