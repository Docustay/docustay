// ITEM 10 (d), BETA: the error paths for a payment field. Run after relinking the workspace to the state under test (see /tmp/la/relink.mjs). Prints what Send answers.
import { chromium } from "playwright";
import { BETA_WEB as BASE, WS, contextFor, call } from "./pm-lib.mjs";
const W = process.argv[2] ?? "payg";
const browser = await chromium.launch(); const ctx = await contextFor(browser, WS[W], { base: BASE });
console.log("payments status:", JSON.stringify((await call(ctx, "GET", "/api/product/docustay/payments")).data));
const tpls = (await call(ctx, "GET", "/api/documents/pdf/templates")).json?.templates ?? []; const tpl = tpls.find((t) => t.seats === 1 && t.active && t.approval_status === "approved") ?? tpls[0];
const f = await call(ctx, "POST", "/api/documents/pdf/from-template", { templateId: tpl.id, title: `Beta payment error ${W} ${Date.now() % 1e6}` }); const id = f.data?.instanceId ?? f.data?.id;
const d = (await call(ctx, "GET", `/api/documents/pdf/${id}`)).json;
const body = { ...(d.body ?? {}), suggestions: undefined, fields: [{ id: "sig-1", type: "signature", role: "signer_1", page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, required: true }, { id: "pay-1", type: "payment", role: "signer_1", page: 1, x: 0.1, y: 0.3, w: 0.4, h: 0.08, required: true, amount_minor: 5000, currency: "usd", label: "Deposit" }] };
const sv = await call(ctx, "POST", "/api/documents/pdf/save", { instanceId: id, title: d.title, body, parties: [{ role: "signer_1", name: "Test Payer", email: `trtheking97+pay${W}@gmail.com` }], sendOptions: { in_person: ["signer_1"] } }); console.log("save:", sv.status);
const chk = await call(ctx, "GET", `/api/documents/pdf/${id}/send-check`); console.log("check:", JSON.stringify((chk.json?.items ?? chk.data?.items ?? []).filter((i) => !i.ok).map((i) => [i.code, i.text])).slice(0, 500));
const sent = await call(ctx, "POST", "/api/documents/pdf/send", { instanceId: id }); console.log("send:", sent.status, JSON.stringify(sent.json)?.slice(0, 400));
await call(ctx, "POST", "/api/documents/pdf/discard", { instanceId: id });
await browser.close();
