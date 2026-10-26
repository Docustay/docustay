import { verifyWebhook } from "@docustay2026/sdk";

// The signature is over the exact bytes Docustay sent, so read the body as text and do not parse it first.
export async function POST(req) {
  try {
    const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, await req.text());
    console.log("webhook", event.topic, event.subject_id);
    return new Response(null, { status: 204 });
  } catch (e) { return new Response("bad signature", { status: 400 }); }
}
