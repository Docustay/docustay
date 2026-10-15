// Docustay + Express: send a document from a template, show it for signing inside your page, and check webhooks.
//   DOCUSTAY_API_KEY=dsk_test_… DOCUSTAY_TEMPLATE_ID=… DOCUSTAY_WEBHOOK_SECRET=whsec_… node server.mjs
import express from "express";
import { Docustay, verifyWebhook } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const app = express();
const ORIGIN = process.env.PUBLIC_ORIGIN || "http://localhost:3000"; // the website you listed in Settings → Developers → Embedding

// The webhook route needs the RAW body: the signature is over the exact bytes Docustay sent.
app.post("/webhooks", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, req.body.toString("utf8"));
    console.log("webhook", event.topic, event.subject_id);
    res.sendStatus(204);
  } catch (e) { console.warn("rejected webhook:", e.message); res.sendStatus(400); }
});

app.use(express.json());

// 1. Send. The seat is embedded: nobody is emailed, your page shows the form.
app.post("/send", async (req, res) => {
  try {
    const { name, email } = req.body;
    const doc = await docustay.sendDocument({ templateId: process.env.DOCUSTAY_TEMPLATE_ID, embedded: ["signer_1"], parties: [{ seat: "signer_1", name, email }] });
    res.json({ id: doc.id });
  } catch (e) { res.status(e.status ?? 500).json({ error: e.message }); }
});

// 2. A one-hour link for that seat, made on YOUR server (the API key never reaches the browser).
app.get("/sign/:id", async (req, res) => {
  try {
    const { url } = await docustay.embedSession(req.params.id, { seat: "signer_1", origin: ORIGIN });
    res.type("html").send(`<!doctype html><meta charset=utf-8><title>Sign</title>
<script type="module" src="https://esm.sh/@docustay2026/embed"></script>
<docustay-sign url="${url}" height="720"></docustay-sign>
<script>document.querySelector("docustay-sign").addEventListener("completed", () => { document.body.insertAdjacentHTML("beforeend", "<p>Signed. Thank you.</p>"); });</script>`);
  } catch (e) { res.status(e.status ?? 500).send(e.message); }
});

app.listen(Number(process.env.PORT || 3000), () => console.log(`example on ${ORIGIN}`));
