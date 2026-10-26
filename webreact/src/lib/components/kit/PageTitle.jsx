// PageTitle — the page's h1: Fraunces 500 28px, −0.01em (kit2 .h1). One of the three Fraunces components.
// ★ cn from @/lib/utils, NOT the bare "cn" package — see that file's F813 note: the bare package
//   doesn't know text-page-title is a font-size class and silently drops it against text-ink.
import { cn } from "@/lib/utils";

export default function PageTitle({ children, className, testId, ...rest }) {
  return <h1 data-font="fraunces" data-testid={testId} className={cn("m-0 font-figure text-page-title font-medium tracking-[-0.01em] text-ink", className)} {...rest}>{children}</h1>;
}
