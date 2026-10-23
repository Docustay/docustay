// The nine tabs of the home page's code windows (BLUEPRINT §5.1 sections 1 and 2). Every tab sends the same thing: a template to one person. Every sample here is RUN by scripts/snippets-run.mjs against a local server that checks the request against
// the OpenAPI file's SendRequest schema (and, where a key and the sandbox are available, against the sandbox). Env: DOCUSTAY_API_KEY, DOCUSTAY_TEMPLATE_ID, optional DOCUSTAY_URL. Never type a number here: counts come from facts.gen.json.
import { SIGNPDF } from "./signpdf.js";
import { CURL_SEND } from "./pages/snippets.js";
const by = Object.fromEntries(SIGNPDF.map((s) => [s.slug, s.code]));
import { GO, PHP, CSHARP } from "./send-samples.js";
export { GO, PHP, CSHARP };
export const CLI = `npx docustay login   # paste a key from Settings, Developers
npx docustay send --test TEMPLATE_ID --party signer_1="Pat Example <pat@example.com>"`;
export const MCP = `{
  "mcpServers": {
    "docustay": {
      "command": "npx",
      "args": ["-y", "@docustay2026/mcp"],
      "env": { "DOCUSTAY_API_KEY": "dsk_test_..." }
    }
  }
}`;
// the order of the tabs, and the file each one is run as
export const SEND_TABS = [
  { label: "cURL", ext: "sh", code: CURL_SEND },
  { label: "Node", ext: "mjs", code: by.javascript },
  { label: "Python", ext: "py", code: by.python },
  { label: "Go", ext: "go", code: GO },
  { label: "PHP", ext: "php", code: PHP },
  { label: "C#", ext: "cs", code: CSHARP },
  { label: "CLI", ext: "sh", code: CLI, runs: false },
  { label: "MCP", ext: "json", code: MCP, runs: false },
];
export const SEND_RESPONSE = `// 201 Created
{ "id": "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e", "state": "sent", "emailed": 1, "notEmailed": [] }`;
// Standard Webhooks check, as docs/tutorial-nextjs.md shows it (event.topic and event.subject_id are the real field names)
export const VERIFY_NODE = `import { verifyWebhook } from "@docustay2026/sdk";

// read the RAW body as text first, then check the three webhook-* headers against it
export async function POST(req) {
  try {
    const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, await req.text());
    if (event.topic === "documents.document.executed") queueSignedCopy(event.subject_id);
    return new Response(null, { status: 204 }); // answer fast, work later
  } catch { return new Response("bad signature", { status: 400 }); }
}`;
export const VERIFY_PY = `from docustay import verify_webhook

event = verify_webhook(secret, headers, raw_body)   # raises on a changed body, a wrong secret or an old timestamp
if event["topic"] == "documents.document.executed":
    queue_signed_copy(event["subject_id"])`;
