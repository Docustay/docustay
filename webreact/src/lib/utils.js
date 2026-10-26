import { clsx, } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// ★★★ the maintainer, 29 Sep 2026 — F813. `theme.css`'s custom `--text-*` scale (text-page-title, text-editor-name,
//   text-figure-sm/md/lg/xl, text-ui, text-meta, text-control, text-caption, text-micro, text-field,
//   text-body, text-heading, text-empty-title, text-sheet-title, text-modal-title) shares Tailwind's
//   `text-` prefix with COLOR utilities (text-ink, text-primary-foreground, …) by Tailwind v4 design —
//   `@theme` namespaces both `--color-*` and `--text-*` under the one `text-*` utility. Plain
//   `twMerge`/the bare "cn" package have no way to know that, since they classify class names from a
//   hardcoded table of STOCK Tailwind names — an unrecognised `text-{word}` reads as "probably a color",
//   so pairing a custom size class with a real color class in one `cn()` call silently drops ONE of
//   them (whichever comes first). MEASURED: `cn("text-page-title font-medium text-ink")` returned with
//   `text-page-title` gone — every `<PageTitle>` on the site had been rendering at inherited body text
//   size, never its real 28px, because of this, not because the token value itself was too small.
//   `extendTailwindMerge` below is the documented fix (cn's own README, "Custom themes"): register the
//   whole custom scale under Tailwind's real "font-size" conflict group, so it no longer collides with
//   "text-color" no matter which comes first or last in the class list.
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [{ text: [
				"micro", "caption", "meta", "control", "ui", "field", "body", "heading",
				"empty-title", "editor-name", "page-title",
				"figure-sm", "figure-md", "figure-lg", "figure-xl",
				"sheet-title", "modal-title",
			] }],
		},
	},
});

export function cn(...inputs) {
	return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any