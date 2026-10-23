// Colour by area (VISUAL-DIRECTION-V3 section 4; CREAM 16 Oct 2026, specs/SITE-CREAM-RESTYLE.md 2). Violet stays the brand; each area gets ONE accent for its objects and its eyebrow text, never for page glows. The ground is the cream #f7f6fc.
// `accent` is the object/eyebrow colour (at least 4.5:1 on the page ground #f7f6fc, checked by the visual gate), `soft` a quiet tint for borders and fills, `edge` the line colour.
export const GROUND = "#f7f6fc";
export const AREA = {
  home: { name: "Home and Features", accent: "#5a3ac1", soft: "#ece8fb", edge: "#5a3ac1" },
  developers: { name: "Developers", accent: "#0b6f7a", soft: "#e3f2f3", edge: "#0b6f7a" },
  templates: { name: "Templates", accent: "#8a5208", soft: "#f6ecdf", edge: "#8a5208" },
  selfhost: { name: "Self-host", accent: "#1c7448", soft: "#e2f1e8", edge: "#1c7448" },
  pricing: { name: "Pricing", accent: "#4c4a5e", soft: "#ecebf2", edge: "#5a3ac1" },
  trust: { name: "Trust", accent: "#1a6f4c", soft: "#e1f0e9", edge: "#1a6f4c" },
  company: { name: "Company", accent: "#565467", soft: "#ecebf2", edge: "#565467" },
};
// Which area a page path belongs to.
export function areaOf(path) {
  if (/^\/(developers|sign-pdf|docs)(\/|$)/.test(path)) return "developers";
  if (/^\/(free-templates|templates|document-templates|form-templates|use-cases)(\/|$)/.test(path)) return "templates";
  if (/^\/(self-host|open-source|licensing)(\/|$)/.test(path)) return "selfhost";
  if (/^\/pricing/.test(path)) return "pricing";
  if (/^\/(trust|verify|legal)(\/|$)/.test(path)) return "trust";
  if (/^\/(about|contact|status|changelog|facts|guides|tools)(\/|$)/.test(path)) return "company";
  return "home";
}
