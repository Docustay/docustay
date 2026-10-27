// What the mega-menu preview cards SAY. Nothing here is typed twice: counts come from facts.gen.json (made from the facts file), the changelog list from changelog.js, and the one API call
// shown is checked by `plumb check` (MENUS step) against the OpenAPI file: the method and path must be an operation there, and every JSON key must be in that operation's request schema.
// Visual.svelte draws these; the MENUS step renders the same cards and runs the page-text rules over them.
import facts from "../facts.gen.json";
import { CHANGES } from "../changelog.js";
import { SEND_RESPONSE } from "../home-code.js";

// The one call the API and developer-hub previews show (sending a template). Values are environment variables and a reserved example.com address, never stand-in names.
export const SEND_OP = {
  method: "POST", path: "/api/v1/documents/send",
  headers: [["Authorization", "Bearer $DOCUSTAY_API_KEY"], ["Idempotency-Key", "$(uuidgen)"]],
  body: { templateId: "$DOCUSTAY_TEMPLATE_ID", parties: [{ seat: "signer_1", name: "$SIGNER_NAME", email: "signer@example.com" }] },
};
/** Operations drawn in a preview, for the MENUS step: [method, path, body keys shown]. */
export const SHOWN_OPS = [[SEND_OP.method, SEND_OP.path, ["templateId", "parties", "seat", "name", "email"]]];

export const sendRequestText = () => {
  const b = SEND_OP.body, p = b.parties[0];
  return `${SEND_OP.method} ${SEND_OP.path}\n${SEND_OP.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n{ "templateId": "${b.templateId}",\n  "parties": [{ "seat": "${p.seat}",\n    "name": "${p.name}",\n    "email": "${p.email}" }] }`;
};
export const sendAnswerText = () => SEND_RESPONSE.replace("// 201 Created\n", "");
export const CLI_SEND = 'npx docustay send --test $DOCUSTAY_TEMPLATE_ID \\\n    --party signer_1="$SIGNER_NAME <signer@example.com>"';
// Self-host: the repository's real first commands (quickstart.sh sits at the repository root and runs init.sh itself)
export const SELFHOST_COMMANDS = [["$", "git clone https://github.com/Docustay/docustay"], ["$", "cd docustay"], ["$", "sh quickstart.sh"], ["dim", "prints the setup address and token"]];
export const WEBHOOK_EVENTS = ["documents.document.sent", "documents.document.opened", "documents.document.signed", "documents.document.executed"];
export const MCP_SAMPLE_TOOLS = ["list_documents", "get_document", "get_payments_status", "list_templates", "get_audit_log"];
export const mcpHead = () => `MCP SERVER · ${facts.mcpTools} TOOLS`;
export const MCP_NOTE = "DOCUSTAY_READ_ONLY=1 removes every tool that changes anything.";
/** The newest changelog entries, as [month, title]. */
export const changelogRows = (n = 4) => CHANGES.slice(0, n).map((c) => [c.date.slice(0, 3).toUpperCase() + " " + c.date.split(" ").pop(), c.title]);
export const timelineTitles = (n = 5) => CHANGES.slice(0, n).map((c) => c.title);
export const operationsLine = () => `${facts.operations} operations`;

// Cards added with the new Features menu (26 Oct 2026). Words that are claims were checked against the code; the API lines are checked against the OpenAPI file by the MENUS step.
export const TAG_LINE = "{{Buyer signature;type=signature;role=Buyer}}";
export const PAYMENT_OPS = [
  { method: "GET", path: "/api/v1/payments/status", answer: '{ "status": "connected", "mode": "live" }' },
  { method: "POST", path: "/api/v1/payments/{id}/refund", body: '{ "amountMinor": 500, "reason": "Charged twice" }' },
];
SHOWN_OPS.push(...PAYMENT_OPS.map((o) => [o.method, o.path, o.body ? ["amountMinor", "reason"] : []]));
export const paymentOpsText = () => PAYMENT_OPS.map((o) => `${o.method} ${o.path}\n${o.body ?? o.answer}`).join("\n\n");
export const STRIPE_SETTINGS = [["KEYSTONE_STRIPE_SECRET_KEY", "your secret key"], ["KEYSTONE_STRIPE_PUBLISHABLE_KEY", "pay inside the page"], ["KEYSTONE_STRIPE_CHARGES_ENABLED", "off until you turn it on"]];
export const ROLE_ROWS = [["Owner", "Everything"], ["Admin", "Everything except deleting the workspace"], ["Member", "Their own documents"]];
export const NEXT_ROWS = ["Reports", "Sign in person", "Your own email domain", "Public forms", "Edit email wording"];   // the first five cards of /whats-next (checked by the MENUS step)
export const CERT_ROWS = [["Seal", "Intact"], ["Fingerprint", "SHA-256"], ["Check it", "docustay.app/verify"]];
