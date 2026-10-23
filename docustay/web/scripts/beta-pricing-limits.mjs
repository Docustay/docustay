// BETA, PRICING WORDS (21 Oct 2026): the Free signers limit through the real send path, the status/preflight words, and the PAYG/Pro/Lifetime behaviour. One workspace at a time, one run at a time.
// node scripts/beta-pricing-limits.mjs <free|payg|pro|lifetime> [tag]
import { chromium } from "playwright";
import { BETA_WEB as BASE, WS, contextFor, call, preflight, status } from "./pm-lib.mjs";
const W = process.argv[2] ?? "free", TAG = process.argv[3] ?? String(Date.now() % 1e6);
const out = []; const ok = (name, pass, info = "") => { out.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`); };
const browser = await chromium.launch(); const ctx = await contextFor(browser, WS[W], { base: BASE });
const st = await status(ctx);
console.log("plan", st.plan?.key, "usage", JSON.stringify({ s: st.usage?.signersThisMonth, sl: st.usage?.signersLimit, t: st.usage?.templatesThisMonth, tl: st.usage?.templatesLimit, d: st.usage?.documentsThisMonth }), "started", st.words?.newLimitsStarted);
ok("status carries the shared words and the compare table", st.words?.compare?.length === 8 && /Fair use applies to Unlimited/.test(st.words.footnote));
ok("no old price words in the compare table", !/a person a month|seat/i.test(JSON.stringify(st.words)));
ok("limits are live on this environment", st.words?.newLimitsStarted === true);
const em = (n) => `trtheking97+sg${TAG}x${n}@gmail.com`;
const tpls = (await call(ctx, "GET", "/api/documents/pdf/templates")).json?.templates ?? [];
const tpl = tpls.find((t) => t.seats === 1 && t.active && t.approval_status === "approved") ?? tpls[0];
async function sendTo(emails, title) {
  const f = await call(ctx, "POST", "/api/documents/pdf/from-template", { templateId: tpl.id, title }); const id = f.data?.instanceId ?? f.data?.id;
  const d = (await call(ctx, "GET", `/api/documents/pdf/${id}`)).json;
  const fields = emails.map((_, i) => ({ id: `sig-${i + 1}`, type: "signature", role: `signer_${i + 1}`, page: 1, x: 0.05 + (i % 5) * 0.18, y: 0.2 + Math.floor(i / 5) * 0.06, w: 0.16, h: 0.04, required: true }));
  const body = { ...(d.body ?? {}), suggestions: undefined, fields };
  const sv = await call(ctx, "POST", "/api/documents/pdf/save", { instanceId: id, title: d.title, body, parties: emails.map((e, i) => ({ role: `signer_${i + 1}`, name: `Signer ${i + 1}`, email: e })), sendOptions: {} });
  if (sv.status >= 300) return { id, save: sv };
  const sent = await call(ctx, "POST", "/api/documents/pdf/send", { instanceId: id });
  return { id, sent };
}
const cap = st.usage?.signersLimit;
if (W === "free") {
  const used0 = st.usage.signersThisMonth, room = cap - used0;
  console.log("signers used", used0, "room", room);
  const pf = (n, extra = {}) => preflight(ctx, "send_document", { recipients: Array.from({ length: n }, (_, i) => em(`p${i}`)), ...extra });
  const over = await pf(room + 1); ok("preflight blocks one new signer past the limit", over.allowed === false && over.reason === "plan_signer_limit" && over.options.map((o) => o.key).join() === "payg,pro", over.message?.slice(0, 120));
  const fits = await pf(room); ok("preflight allows exactly the room that is left", fits.allowed === true);
  const same = await pf(room + 1, {}); void same;
  // the real send path: too many new people is refused with the stable code and nothing is sent
  if (room >= 1) {
    const big = await sendTo(Array.from({ length: room + 1 }, (_, i) => em(`b${i}`)), `Limit proof ${TAG}`);
    const body = big.sent?.json ?? big.sent?.data ?? {};
    ok("sending to one signer too many is refused (403 plan_signer_limit)", big.sent?.status === 403 && /plan_signer_limit/.test(JSON.stringify(body)), JSON.stringify(body).slice(0, 200));
    await call(ctx, "POST", "/api/documents/pdf/discard", { instanceId: big.id });
    const fit = await sendTo(Array.from({ length: room }, (_, i) => em(`f${i}`)), `Limit fill ${TAG}`);
    ok(`sending to exactly the ${room} left is accepted`, fit.sent?.status < 300, `${fit.sent?.status} ${JSON.stringify(fit.sent?.json ?? fit.sent?.data ?? fit.save?.json ?? "").slice(0, 160)}`);
  }
  const s2 = await status(ctx); ok("usage shows the limit used", s2.usage.signersThisMonth === cap, `${s2.usage.signersThisMonth}/${cap}`);
  // the same person counts once, and sending again is allowed
  const again = await sendTo([em("f0")], `Resend proof ${TAG}`); ok("sending again to someone already counted is allowed", again.sent?.status < 300 || /plan_document_limit/.test(JSON.stringify(again.sent?.json ?? "")), String(again.sent?.status));
  const s3 = await status(ctx); ok("the same person is counted once", s3.usage.signersThisMonth === cap);
  const newone = await sendTo([em("zz")], `New person proof ${TAG}`); ok("a new person after the limit is refused", newone.sent?.status === 403 && /plan_signer_limit/.test(JSON.stringify(newone.sent?.json ?? "")));
  await call(ctx, "POST", "/api/documents/pdf/discard", { instanceId: newone.id });
  const u = await call(ctx, "GET", "/api/product/docustay/usage"); void u;
} else {
  ok("no signer limit on this plan", st.usage.signersLimit == null);
  const pf = await preflight(ctx, "send_document", { recipients: Array.from({ length: 40 }, (_, i) => em(`m${i}`)) }); ok("forty new signers never block", pf.allowed === true && pf.reason == null);
  if (W === "payg") { const t = await preflight(ctx, "create_template"); console.log("templates preflight", JSON.stringify({ allowed: t.allowed, meter: t.meter, options: t.options?.map((o) => o.key) })); ok("PAYG sees the 25-template meter", t.meter?.included === 25); }
  else { const t = await preflight(ctx, "create_template"); ok("no template meter", t.meter == null && t.allowed); }
}
console.log(out.every(Boolean) ? "ALL PASS" : `FAILED ${out.filter((x) => !x).length}`);
await browser.close(); process.exit(out.every(Boolean) ? 0 : 1);
