// The SDK install commands. The packages are on the public registries (@docustay2026/* on npm, docustay on PyPI), so every page shows the short commands.
export const installCommand = (registry, name) => (registry === "npm" ? `npm install ${name}` : `pip install ${name}`);

// Docs use `%%NPM_INSTALL @docustay2026/sdk @docustay2026/embed%%` and `%%PIP_INSTALL docustay%%`; build-docs.mjs expands them here.
export function expandInstall(md) {
  return md.replace(/%%(NPM|PIP)_INSTALL ([^%]+)%%/g, (_, kind, pkgs) => {
    const names = pkgs.trim().split(/\s+/), npm = kind === "NPM";
    return `${npm ? "npm install" : "pip install"} ${names.join(" ")}`;
  });
}
