// The code shown on the site comes from here, and every snippet here is one that was RUN (scripts/snippets-proof.mjs runs them against the sandbox API with a TEST key and fails the build's proof step when one does not make a document).
import { SIGNPDF } from "../signpdf.js";
export const SEND = Object.fromEntries(SIGNPDF.map((s) => [s.slug, s.code]));
export const SEND_NAME = Object.fromEntries(SIGNPDF.map((s) => [s.slug, s.name]));
export const CURL_SEND = `curl -X POST "$DOCUSTAY_URL/api/v1/documents/send" \\
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"templateId":"'"$DOCUSTAY_TEMPLATE_ID"'","parties":[{"seat":"signer_1","name":"Rosa Alvarez","email":"rosa@example.com"}]}'`;
