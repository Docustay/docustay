// A small argument reader: `--flag value`, `--flag=value`, `--switch`, repeated flags become lists, everything else is a positional argument.
const SWITCHES = new Set(["json", "live", "help", "version", "quiet", "no-forward", "emails", "yes", "clear"]);
export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { rest.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("="), name = a.slice(2, eq === -1 ? undefined : eq);
    let value;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (SWITCHES.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) value = true;
    else value = argv[++i];
    flags[name] = name in flags ? [].concat(flags[name], value) : value;
  }
  return { flags, positional: rest };
}
export const list = (v) => (v === undefined ? [] : [].concat(v));
/** "signer_1=Pat Example<pat@example.com>" → { seat, name, email } */
export function parseParty(text) {
  const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*<\s*([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)\s*>\s*$/.exec(String(text));
  if (!m) throw new Error(`--party must look like  signer_1="Pat Example <pat@example.com>"  (got: ${text})`);
  return { seat: m[1], name: m[2], email: m[3] };
}
