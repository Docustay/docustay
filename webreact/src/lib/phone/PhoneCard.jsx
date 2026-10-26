// PhoneCard — a card component for phone-optimized screens. Variants: plain (default), warm, act, bad.
// Ported from webui/src/lib/phone/PhoneCard.svelte.

const TONE = {
  plain: "border-line bg-surface",
  warm: "border-warm-border bg-warm-bg",
  act: "border-act-border bg-act-bg",
  bad: "border-bad-border bg-bad-bg",
};

export default function PhoneCard({ variant = "plain", label, children }) {
  return (
    <div className={`border rounded-[14px] p-[15px] mb-[11px] ${TONE[variant] ?? TONE.plain}`}>
      {label && <div className="font-medium text-body">{label}</div>}
      {children}
    </div>
  );
}
