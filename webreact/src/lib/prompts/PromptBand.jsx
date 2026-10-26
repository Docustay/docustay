// PromptBand — at most `limit` (3 on Home, the engine's own ceiling) prompts in the ENGINE'S order, then
// "N more things need you". Ported from webui/src/lib/prompts/PromptBand.svelte: same props and testids.
// ★ The prop is `prompts`. Svelte's Home handed it `items` and the band was always empty (RECON §16.2 C2).
import PromptCard from "./PromptCard.jsx";

export default function PromptBand({ prompts = [], limit = 3, moreCount = 0, moreHref, moreLabel, onDismiss }) {
  if (prompts.length === 0) return null;
  return (
    <div className="mb-7.5 flex flex-col gap-2.5" data-testid="prompt-band">
      {prompts.slice(0, limit).map((p) => <PromptCard key={p.id} {...p} onDismiss={onDismiss} testId={`prompt-card-${p.id}`} />)}
      {moreCount > 0 && (
        <div className="pl-0.5 text-control text-mute"><a href={moreHref} data-testid="home-needs-more">{moreLabel || `${moreCount} more things need you`}</a></div>
      )}
    </div>
  );
}
