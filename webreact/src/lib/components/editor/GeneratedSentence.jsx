// GeneratedSentence — a sentence assembled from parts, blanks dropped, bold parts in <b>. Ported from
// GeneratedSentence.svelte.
const partText = (p) => (typeof p === "string" ? p : (p?.text ?? null));
const isBlank = (t) => t === null || t === undefined || t === "";
export default function GeneratedSentence({ parts = [], testId = "generated-sentence" }) {
  return (
    <p className="m-0 text-ui text-ink-2" data-testid={testId}>
      {parts.filter((p) => !isBlank(partText(p))).map((p, i) => (typeof p !== "string" && p.bold ? <b key={i} className="font-medium text-ink" data-testid={`${testId}-bold`}>{partText(p)}</b> : <span key={i}>{partText(p)}</span>))}
    </p>
  );
}
