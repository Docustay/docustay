// Helpers for the list inputs: the same checks the server makes (so a bad entry is red as it is typed), and readers for the formats the server already saves (a newline or comma string).
const ORIGIN = /^(https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/i;
export const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
export const splitLines = (v) => (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean);
export const normOrigin = (v) => String(v).trim().replace(/\/+$/, "");
export const originProblem = (v) => (ORIGIN.test(v) ? null : "not a website address like https://app.example.com (no path; http only for localhost)");
const v4 = (a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a) && a.split(".").every((n) => Number(n) <= 255 && String(Number(n)) === n);
const v6 = (a) => { if (!a.includes(":") || /[^0-9a-f:.]/i.test(a)) return false; try { new URL(`http://[${a}]/`); return true; } catch { return false; } };
export function rangeProblem(raw) {
  const [addr, len, extra] = String(raw).trim().split("/");
  if (extra !== undefined || !addr) return "not an address or a range like 203.0.113.0/24";
  const four = v4(addr), six = !four && v6(addr);
  if (!four && !six) return "not an address or a range like 203.0.113.0/24";
  if (len === undefined) return null;
  const max = four ? 32 : 128;
  return /^\d{1,3}$/.test(len) && Number(len) <= max ? null : `the length after / must be 0 to ${max}`;
}
export const rolesProblem = () => null;   // roles are free words; the count and repeats are handled by the input (max 6, no repeats)
