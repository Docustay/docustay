// Figure — the ONE bold number on a screen, in Fraunces, tabular (DESIGN-TOKENS §3.3). One of the only
// three components allowed to use the figure face (design-tokens-react gate). data-font lets each
// story count Fraunces uses (≤ 2 per screen).
// ★ cn from @/lib/utils, NOT the bare "cn" package — see that file's F813 note: the bare package
//   dropped text-ink here (kept the size, lost the color — the opposite failure of PageTitle's).
import { cn } from "@/lib/utils";

const SIZE = { sm: "text-figure-sm", md: "text-figure-md", lg: "text-figure-lg", xl: "text-figure-xl" };

export default function Figure({ children, size = "md", as: Tag = "span", className, testId, ...rest }) {
  return <Tag data-font="fraunces" data-testid={testId} className={cn("font-figure font-normal tabular-nums text-ink", SIZE[size], className)} {...rest}>{children}</Tag>;
}
