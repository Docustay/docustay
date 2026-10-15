// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STRIPE CONNECT APPEARANCE — ported from webui/src/lib/money/stripeAppearance.js, NOT verbatim:
//   · the token names are the React theme's (DESIGN-TOKENS.md §3), not the Svelte sheet's
//     (--primary/--ink-muted/--success… no longer exist)
//   · it is a FUNCTION called when a Stripe component mounts. The Svelte module computed its values when
//     it was IMPORTED, which can run before the stylesheet applies and silently takes every fallback.
//   · fallbacks come from design/tokens.kit2.json — no colour literal lives in this file.
// ★ Stripe's appearance API takes literal strings (its components render in Stripe's iframe, where our
//   CSS variables do not exist), so the resolved values are passed, not var() references.
// ★ fontFamily NEVER names Fraunces — the figure face is never used inside a Stripe component (brand rule).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import tokens from "@design/tokens.kit2.json";

function read(name, fallback) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name)?.trim() || fallback;
}
const c = (key) => read(`--color-${key}`, tokens.color[key]);

export function stripeAppearance() {
  return {
    variables: {
      fontFamily: tokens.font.sans,
      fontSize: tokens.text.body[0],
      colorPrimary: c("brand"),
      colorBackground: c("surface"),
      colorText: c("ink"),
      colorTextSecondary: c("mute"),
      colorBorder: c("line"),
      colorSuccess: c("ok"),
      colorWarning: c("warn"),
      colorDanger: c("bad"),
      borderRadius: read("--radius-control", tokens.radius.control),
      spacingUnit: tokens.stripe.spacingUnit,
      shadowColor: "rgba(0, 0, 0, 0.06)",
    },
  };
}

/** Font faces for Connect JS. Inter is system-available to the iframe via fontFamily's stack; none loaded. */
export const fonts = [];
