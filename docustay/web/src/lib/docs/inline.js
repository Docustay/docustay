// The OpenAPI file's descriptions are written with a little Markdown (`code` and **bold**). This turns exactly those two into HTML after escaping everything else, so the text never shows backticks or asterisks and nothing in it can add markup.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
