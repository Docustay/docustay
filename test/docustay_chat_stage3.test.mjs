// FINAL PUSH Stage 3 (7 Oct 2026): the chat payment field and the clickable questions. Pure parts + one scripted turn.
import test from "node:test";
import assert from "node:assert/strict";
import { runChatTurn } from "../src/documents/chat/chat.mjs";   // first: the tools import each other in a cycle that only resolves from here
import { blocksToSource, paymentAttrs } from "../src/documents/chat/blocks.mjs";
import { cleanQuestions, answersText } from "../src/documents/chat/toolsAsk.mjs";

const base = [{ type: "heading", text: "Coaching Agreement" }, { type: "paragraph", text: "Fee: $180 per session." }, { type: "signature", role: "Client" }];

test("payment block: 180 dollars becomes the editor's own payment field; bad amounts, currencies and a missing payer are refused", () => {
  const ok = blocksToSource([...base, { type: "payment", role: "Client", amount: "$180" }]);
  assert.equal(ok.ok, true, ok.errors.join());
  const tag = JSON.stringify(ok.source.content.at(-1));
  assert.match(tag, /"type":"payment"/); assert.match(tag, /"amount":"180.00"/); assert.match(tag, /"currency":"usd"/);
  for (const bad of [{ amount: "abc" }, { amount: "0.10" }, { amount: "2000000" }, { amount: "10", currency: "xyz" }, { amount: "10", role: "" }]) {
    const r = blocksToSource([...base, { type: "payment", role: "Client", ...bad }]);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(paymentAttrs({ role: "Client", amount: "49.5", currency: "EUR" }).attrs.currency, "eur");
});

test("cleanQuestions: 1–4 questions, 2–4 options each, labels required and unique; a second recommended option is dropped", () => {
  const q = (n, extra = {}) => ({ question: `Q${n}?`, options: [{ label: "A", description: "a" }, { label: "B" }], ...extra });
  assert.equal(cleanQuestions({ questions: [q(1)] }).ok, true);
  assert.equal(cleanQuestions({ questions: [] }).ok, false);
  assert.equal(cleanQuestions({ questions: [q(1), q(2), q(3), q(4), q(5)] }).ok, false);
  assert.equal(cleanQuestions({ questions: [{ question: "x", options: [{ label: "A" }] }] }).ok, false);
  assert.equal(cleanQuestions({ questions: [{ question: "x", options: [{ label: "A" }, { label: "a" }] }] }).ok, false);
  const r = cleanQuestions({ questions: [{ question: "x", options: [{ label: "A", recommended: true }, { label: "B", recommended: true }] }] });
  assert.deepEqual(r.questions[0].options.map((o) => !!o.recommended), [true, false]);
  assert.equal(answersText([{ question: "Which?" }, { question: "Many?" }], ["A", ["B", "C"]]), "Which? → A\nMany? → B, C");
});

test("a turn that asks questions ends there: one proposal of kind questions, no second model round, the tool result is stored", async () => {
  const rows = []; const db = { query: async (sql, p) => { if (/INSERT INTO keystone.document_chat_message/.test(sql)) rows.push(JSON.parse(p[4])); if (/INSERT INTO keystone.document_chat_proposal/.test(sql)) return { rows: [{ id: "p1" }] }; return { rows: /SELECT seq, role/.test(sql) ? [] : [] }; } };
  let calls = 0; const events = [];
  async function* stream() { calls++; yield { type: "tool_use", id: "t1", name: "docustay.ask.questions", input: { questions: [{ question: "What does the 180 cover?", options: [{ label: "One session" }, { label: "A monthly package" }] }] } }; yield { type: "done", content: [{ type: "tool_use", id: "t1", name: "docustay.ask.questions", input: { questions: [{ question: "What does the 180 cover?", options: [{ label: "One session" }, { label: "A monthly package" }] }] } }], usage: { input: 1, output: 1 } }; }
  await runChatTurn({ db, tenantId: "t", actorUserId: "u", can: async () => true, conversationId: "c", userText: "make a coaching agreement", cfg: {}, apiKey: "k", emit: (e) => events.push(e), streamImpl: stream });
  assert.equal(calls, 1, "the turn stopped after the question card");
  const pr = events.find((e) => e.type === "proposal");
  assert.equal(pr?.proposal.kind, "questions"); assert.equal(pr.proposal.card.questions[0].options.length, 2);
  assert.ok(rows.some((m) => Array.isArray(m) && m[0]?.type === "tool_result"), "the tool result is stored so history stays a valid pair");
});

test("attached files: only PDFs and pictures within the size and page limits are read; everything else gives no blocks and a plain note", async () => {
  const { chatFileBlocks, MAX_READ_BYTES } = await import("../src/documents/chat/files.mjs");
  const tx = (row) => ({ query: async () => ({ rows: row ? [{ kind: "original", id: "f1", ...row }] : [] }) });
  assert.equal((await chatFileBlocks(tx(null), { instanceId: "i" })).note, "no file");
  assert.equal((await chatFileBlocks(tx({ mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byte_size: 10 }), { instanceId: "i" })).note, "type not readable");
  assert.equal((await chatFileBlocks(tx({ mime: "application/pdf", byte_size: MAX_READ_BYTES + 1 }), { instanceId: "i" })).note, "too large");
  assert.equal((await chatFileBlocks(tx({ mime: "application/pdf", byte_size: 1000, page_count: 101 }), { instanceId: "i" })).note, "too many pages");
  // positive control: a small PDF passes the gates and reaches the byte read (which needs the storage port, absent here)
  await assert.rejects(() => chatFileBlocks(tx({ mime: "application/pdf", byte_size: 1000, page_count: 3 }), { instanceId: "i" }));
});
