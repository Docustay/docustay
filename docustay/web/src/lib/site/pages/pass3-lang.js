// Site pass 3: the extra sections on each "Sign a document from <language>" page. The facts are the ones in signpdf.js (which signpdf-proof.mjs runs) and docs/webhooks.md and docs/sdks.md; no new snippet is shown that has not been run or printed in those docs.
const SCREEN = { javascript: "email", typescript: "fields", python: "audit", go: "email", php: "phone", csharp: "certificate" };
const WHY = { javascript: "Your call sends the email. Their click does the rest.", typescript: "A wrong field name fails in your editor, not at 2 a.m.", python: "Your script sends it. The record tells you what happened.", go: "A typed client generated from the API description: every operation is there.", php: "One composer require, and a plain script or a framework app sends it.", csharp: "A .NET client from NuGet: send from a service, a job or a console app." };
const SUB = {
  javascript: "The call makes a document from the template and emails the person. They sign on any device with no account. {{F-SEND}}",
  typescript: "The types describe what you send and what comes back, and the fields are the ones the template declares. {{F-SDK}}",
  python: "Each action is a row on the document's record: sent, opened, signed, sealed. {{F-AUDIT}}",
  go: "The person you named signs on a phone or a computer from the link. {{F-SIGN}}",
  php: "The signer needs no account and nothing installed; you read the result from the document. {{F-SIGN}}",
  csharp: "When everyone has signed, the sealed PDF and its certificate go to everyone. {{F-CERT}}",
};
const RECEIVER = {
  javascript: "import { verifyWebhook } from \"@docustay2026/sdk\";\nconst event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, rawBody);",
  typescript: "import { verifyWebhook } from \"@docustay2026/sdk\";\nconst event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET!, req.headers, rawBody);",
  python: "from docustay import verify_webhook\nevent = verify_webhook(secret, headers, raw_body)",
};
export const langExtra = (l) => {
  const out = [
    { t: "screen", kind: SCREEN[l.slug], eyebrow: "What happens next", h2: WHY[l.slug], sub: SUB[l.slug], caption: `FIG. 02 · AFTER THE ${l.name.toUpperCase()} CALL`, note: "SAMPLE DATA" },
  ];
  if (RECEIVER[l.slug]) {
    out.push({ t: "code", eyebrow: "When they sign", h2: "Receive the result in " + l.name + ".", sub: "Every document event (sent, opened, signed, completed, declined, voided and more) is signed with the Standard Webhooks headers. Verify the raw body, then fetch the document. {{F-WEBHOOKS}}", tabs: [{ label: l.name, code: RECEIVER[l.slug] }], after: "A body that was changed, a wrong secret or a timestamp more than five minutes old is refused." });
  } else {
    out.push({ t: "matrix", eyebrow: "The request, by hand", h2: "What the " + l.name + " program sends.", caption: "FIG. 03 · THE REQUEST", head: ["Part", "Value"], rows: [["Method and path", "POST /api/v1/documents/send"], ["Authorization", "Bearer, then your API key"], ["Content-Type", "application/json"], ["Idempotency-Key", "A fresh UUID for each document; keep it if you retry"], ["Body", "templateId and parties: a seat, a name and an email for each person"]], foot: "The same request works from any language that can make an HTTPS call. {{F-API}}" });
  }
  return out;
};
