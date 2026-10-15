// EditorName — the object's name in an editor header: Fraunces 500 19px (kit2 .nm). One of the three.
// ★ cn from @/lib/utils, NOT the bare "cn" package — see that file's F813 note.
import { cn } from "@/lib/utils";

export default function EditorName({ children, className, testId, ...rest }) {
  return <div data-font="fraunces" data-testid={testId} className={cn("font-figure text-editor-name font-medium tracking-[-0.005em] text-ink", className)} {...rest}>{children}</div>;
}
