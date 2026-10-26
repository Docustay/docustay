// The practice's logo block for every branded email, and the head tags that stop dark-mode clients from recolouring the card. Pure; React Email elements only (src/ has no JSX step).
// Found live 9 Oct 2026: the logo was 32 px high with no plate behind it, so in a dark-mode client it was tiny and a dark or transparent mark almost vanished. It is now 56 px high (up to 200 wide) on its own white plate with a thin border, so it reads in light and dark, and the alt text is the practice name for clients that block images.
import { Img, Text, Section } from "@react-email/components";

/** @param {Function} h createElement  @param {{logoUrl?:string|null, practiceName:string}} p */
export function logoBlock(h, { logoUrl, practiceName }) {
  if (!logoUrl) return h(Text, { style: { fontSize: "16px", fontWeight: 700, color: "#3f3f46", margin: "0 0 16px" } }, practiceName);
  return h(Section, { style: { margin: "0 0 20px" } },
    h("table", { role: "presentation", cellPadding: 0, cellSpacing: 0, style: { backgroundColor: "#ffffff", border: "1px solid #e4e4e7", borderRadius: "10px" } },
      h("tbody", null, h("tr", null, h("td", { style: { padding: "10px 16px", backgroundColor: "#ffffff", borderRadius: "10px" } },
        h(Img, { src: logoUrl, alt: practiceName, height: 56, style: { height: "56px", width: "auto", maxWidth: "200px", display: "block" } }))))));
}

/** Tells clients that honour it to keep the light card (no automatic inversion); the plate above covers the clients that do not. */
export const lightOnlyMeta = (h) => [
  h("meta", { key: "cs", name: "color-scheme", content: "light only" }),
  h("meta", { key: "scs", name: "supported-color-schemes", content: "light only" }),
];
