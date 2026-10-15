// kit2 EDITOR geometry, shared by the editor kit (DESIGN-TOKENS §3.4): a 190px label column beside the
// field; fields 40px min-height, 8px radius, brand ring on focus, error edge on invalid.
export const ROW = "flex items-start gap-5 py-2.5";
export const LABEL = "w-(--size-field-label) shrink-0 pt-2.5 text-ui font-normal text-ink-2";
export const CONTROL = "flex min-h-(--size-control-field) items-center gap-2 rounded-control border border-line bg-surface px-3 text-field data-[focus=true]:border-brand data-[focus=true]:ring-3 data-[focus=true]:ring-brand-soft data-[err=true]:border-error-edge data-[disabled=true]:opacity-60";
export const HINT = "mt-1.5 text-meta leading-normal text-mute";
export const AFFIX = "flex items-center gap-1.5 border-l border-hair pl-2.75 text-meta text-mute";
