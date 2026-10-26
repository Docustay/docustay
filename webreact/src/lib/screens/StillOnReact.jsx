// A path whose rebuilt screen is not finished, served by the previous interface (R3.003, StillOnReact.svelte).
// ★ src/nav/stillOnReact.mjs's list is EMPTY today ("this list must only ever shrink"), so no path reaches this —
//   kept because the gates import it by name and the list is the server's to grow, not this bundle's.
// ★ A full page load, not a client navigation: the server decides which shell serves the path.
import { ArrowRight } from "lucide-react";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { buttonVariants } from "@/lib/components/ui/button";

export default function StillOnReact({ path, label }) {
  return (
    <section className="flex flex-col gap-4" data-testid="still-on-react" data-still-react={path} data-path={path}>
      <PageTitle>{label}</PageTitle>
      <EmptyState kind="not-built" icon="IconTool" headline="This screen is still on the previous interface"
        line={`${label} works and none of its data has moved — the rebuilt version of this one screen is not finished yet. Opening it loads the previous interface.`}
        testId="still-on-react-state" />
      <p className="m-0"><a className={buttonVariants({ variant: "default" })} href={path} data-testid="still-on-react-open">Open {label} <ArrowRight aria-hidden="true" /></a></p>
    </section>
  );
}
