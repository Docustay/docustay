// THE ONE SWITCH for the SDK install commands. Published 15 Oct 2026: @docustay2026/* on npm and docustay on PyPI (installed from the public registries in Run 13 INST-001..012, 23 Oct).
// While this is false, every page that would show `npm install @docustay2026/sdk` or `pip install docustay` says "coming soon" and shows the
// source install from a clone of the repository (both commands below work today: sdk/js and sdk/python are real packages).
// After the maintainer publishes the packages, set this to true, rebuild and deploy (RELEASE-STEPS.md, "Package install commands").
export const PACKAGES_PUBLISHED = true;
const SOURCE = { npm: "npm install ./sdk/js", pip: "pip install ./sdk/python" };
export const installCommand = (registry, name) => (PACKAGES_PUBLISHED ? (registry === "npm" ? `npm install ${name}` : `pip install ${name}`) : SOURCE[registry]);
export const installNote = (registry) => (PACKAGES_PUBLISHED ? "" : `Coming soon to ${registry === "npm" ? "npm" : "PyPI"}. Until then, install from a clone of the repository:`);

// Docs use `%%NPM_INSTALL @docustay2026/sdk @docustay2026/embed%%` and `%%PIP_INSTALL docustay%%`; build-docs.mjs expands them here.
const FOLDER = { "@docustay2026/sdk": "./sdk/js", "@docustay2026/embed": "./sdk/embed", docustay: "./sdk/python" };
export function expandInstall(md) {
  return md.replace(/%%(NPM|PIP)_INSTALL ([^%]+)%%/g, (_, kind, pkgs) => {
    const names = pkgs.trim().split(/\s+/), npm = kind === "NPM";
    if (PACKAGES_PUBLISHED) return `${npm ? "npm install" : "pip install"} ${names.join(" ")}`;
    return `# Coming soon to ${npm ? "npm" : "PyPI"}. For now, from a clone of the repository:\n${npm ? "npm install" : "pip install"} ${names.map((n) => FOLDER[n] ?? n).join(" ")}`;
  });
}
