// Which hero scene a page gets (SITE-V2-BLUEPRINT §3, "Identity per page type"). Docs get none. First match wins.
const MAP = [
  [/^\/docs(\/|$)/, null],
  [/^\/features\/scribe/, "cards"], [/^\/features\/payments/, "rings"], [/^\/features\/proof/, "seal"], [/^\/features\/automations/, "lattice"],
  [/^\/features\/embedded-signing/, "cube"], [/^\/features\/test-mode/, "rings"], [/^\/features\/agent-ready/, "lattice"], [/^\/features\/white-label/, "D"], [/^\/features/, "papers"],
  [/^\/developers/, "lattice"], [/^\/sign-pdf\/?$/, "D"], [/^\/sign-pdf\//, "lattice"],
  [/^\/(free-templates|templates|document-templates|form-templates|use-cases)/, "papers"],
  [/^\/self-host/, "cube"], [/^\/(open-[s]ource|licensing)/, "cube"], [/^\/pricing/, "rings"],
  [/^\/(trust|verify|legal)/, "seal"], [/^\/product\/scribe/, "cards"], [/^\/product\/payments/, "rings"], [/^\/product\/proof/, "seal"], [/^\/product/, "papers"],
  [/^\/(changelog|about|contact|status|facts)/, "papers"], [/^\/(tools|guides)/, "D"],
];
export function sceneFor(path) { for (const [re, s] of MAP) if (re.test(path)) return s; return "D"; }
