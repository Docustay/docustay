// @ts-check
// lead-intake brief, 30 Sep 2026 — THE SHARED BRANDED FRAME, GENERALIZED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NOT A REFACTOR OF `signLinkEmail.mjs`'s `SignLinkEmail`. That component is deliberately
//     single-purpose — a fixed "Review and sign" button that file's own header says must never be
//     built from the message text or made editable, because it is what keeps the sign link
//     un-deletable. Repurposing it for an unrelated email risks that guarantee for no benefit.
//     This is a NEW, narrower component with no button by default — visually the same frame
//     (identical BRAND_COLOR, fonts, container styling) so a lead's email looks like the same
//     product, without touching the signing path at all.
//
// ★ Same reason `signLinkEmail.mjs` gives for `React.createElement` over JSX: `src/` has no
//   build/transform step.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createElement as h } from "react";
import { logoBlock, lightOnlyMeta } from "./emailLogo.mjs";
import { render } from "@react-email/render";
import { Html, Head, Preview, Body, Container, Img, Heading, Text, Button, Hr, Link } from "@react-email/components";

const BRAND_COLOR = "#5A3AC1"; // ★ same constant signLinkEmail.mjs uses — one visual identity, two files

/** @param {{practiceName:string, logoUrl?:string|null, heading:string, bodyText:string, ctaLabel?:string|null, ctaHref?:string|null, preview?:string}} props */
function BrandedEmail({ practiceName, logoUrl, heading, bodyText, ctaLabel = null, ctaHref = null, preview }) {
  return h(Html, null,
    h(Head, null, ...lightOnlyMeta(h)),
    h(Preview, null, preview || heading),
    h(Body, { style: { backgroundColor: "#f4f4f5", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", margin: 0, padding: "32px 0" } },
      h(Container, { style: { backgroundColor: "#ffffff", borderRadius: "12px", maxWidth: "480px", margin: "0 auto", padding: "32px" } },
        logoBlock(h, { logoUrl, practiceName }),
        h(Heading, { style: { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 16px" } }, heading),
        h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 24px", whiteSpace: "pre-wrap" } },
          bodyText),
        ctaHref
          ? h(Button, {
              href: ctaHref,
              style: {
                backgroundColor: BRAND_COLOR, color: "#ffffff", fontSize: "15px", fontWeight: 600,
                borderRadius: "8px", padding: "12px 24px", textDecoration: "none", display: "inline-block",
              },
            }, ctaLabel || "View")
          : null,
        h(Hr, { style: { borderColor: "#e4e4e7", margin: "24px 0" } }),
        h(Text, { style: { fontSize: "12px", color: "#a1a1aa", margin: 0 } }, `Sent by ${practiceName} via Workbench.`),
      ),
    ),
  );
}

/**
 * Render both HTML and plain-text bodies through the shared frame.
 * @returns {Promise<{html:string, text:string}>}
 */
export async function renderBrandedEmail(props) {
  const html = await render(h(BrandedEmail, props));
  const text = await render(h(BrandedEmail, props), { plainText: true });
  return { html, text };
}
