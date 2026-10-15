// EditorSection — a titled section of the editor column (kit2 .sect + .sh). Ported from EditorSection.svelte.
// ★ It renders `children` only — named snippets handed to it in Svelte were dropped (RECON §16.2 C5).
import { Separator } from "@/lib/components/ui/separator.jsx";

export default function EditorSection({ title, id = undefined, children }) {
  return (
    <section id={id} data-testid="editor-section" className="first-of-type:[&>[data-slot=separator]]:hidden">
      <Separator className="bg-hair" data-testid="editor-section-divider" />
      <div className="pt-7.5 pb-1">
        <h2 className="m-0 mb-3.5 text-heading font-medium text-ink">{title}</h2>
        <div>{children}</div>
      </div>
    </section>
  );
}
