// A SCRIPTED ASSISTANT: the chat stream of the assistant, answered from fixed rules instead of a model. Used where a model must not be called (the public demo, once a visitor has used the real prompts they were given, or when the
// service has no AI key): it costs nothing, never leaves the machine, and still does the real work through the real tools — "make a lease" runs the same draft tool a model would, from the built-in template of that name.
// It says what it is ("Demo AI") in every answer. Pure apart from the stream it wraps; the fake stream (fake.mjs) supplies the tool-call shapes and is never reached from production by itself (only this wrapper is, and it calls no provider).
import { fakeStream } from "./fake.mjs";

const SCRIPTED_NAME = "Demo AI";
const RULES = [
  [/\b(pet|animal|dog|cat)\b/i, "[fake:fromlib=lease-addendum]", "a lease addendum"],
  [/\b(application|apply|applicant)\b/i, "[fake:fromlib=rental-application]", "a rental application"],
  [/\b(lease|rent(al)?\s+agreement|tenancy|tenant)\b/i, "[fake:fromlib=residential-lease-agreement]", "a residential lease"],
  [/\b(addendum|amendment)\b/i, "[fake:fromlib=lease-addendum]", "a lease addendum"],
  [/\b(remind|nudge|chase)\b/i, "[fake:remind_many=lease]", null],
  [/\b(find|show|list|which|waiting|unsigned)\b/i, "[fake:find=|sent]", null],
];
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).at(-1) ?? "");   // the person's own words are the LAST text block; anything before it is context the app added
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
// "Draft a rental application for Tom Whitaker" → a title "Rental application - Tom Whitaker" and a sample signer, so the draft in the list reads like real work
function shaped(label, text) {
  const who = /\bfor\s+((?:[A-Z][\w'’-]+)(?:\s+[A-Z][\w'’-]+){0,2})/.exec(text)?.[1] ?? null;
  const email = who ? `${who.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@example.com` : "jordan.lee@example.com";
  return { title: `${cap(label.replace(/^a /, ""))}${who ? ` - ${who}` : ""}`, person: `${who ?? "Jordan Lee"}|${email}` };
}

/** The chat stream (same events as the real one). `args` are the real stream's: { model, system, messages, tools, … }. */
export async function* scriptedStream(args) {
  const messages = args.messages ?? [];
  const lastIdx = messages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && m.content.some((b) => b?.type === "text"))))?.i ?? -1;
  const lastText = lastIdx >= 0 ? textOf(messages[lastIdx]) : "";
  const afterTool = messages.at(-1)?.role === "user" && Array.isArray(messages.at(-1).content) && messages.at(-1).content.every((b) => b?.type === "tool_result");
  const rule = afterTool ? null : RULES.find(([re]) => re.test(lastText)) ?? null;
  const shape = rule?.[2] ? shaped(rule[2], lastText) : null;
  const patched = rule && lastIdx >= 0 ? messages.map((m, i) => (i === lastIdx ? { ...m, content: `${rule[1]}${shape ? `[fake:person=${shape.person}]` : ""} ${shape ? shape.title : lastText}` } : m)) : messages;
  let tool = false;
  for await (const ev of fakeStream({ ...args, model: "demo-ai", messages: patched })) {
    if (ev.type === "text") continue;   // the fake's own words are replaced by ours
    if (ev.type === "tool_use") tool = true;
    if (ev.type === "done" && ev.stopReason !== "tool_use") {
      const said = afterTool
        ? `${SCRIPTED_NAME}: done. I made it from the built-in template, so you can read it and send it. A real workspace's assistant writes from your own words; this demo answers from a short script.`
        : `${SCRIPTED_NAME}: I am a scripted assistant, so this demo costs nothing and calls no model. Try “Make a lease for a one-year rental”, “Draft a pet addendum” or “Create a rental application”. A real workspace's assistant writes from whatever you ask.`;
      for (const part of said.match(/.{1,28}/g) ?? [said]) yield { type: "text", text: part };
      yield { ...ev, content: [...(ev.content ?? []).filter((b) => b.type !== "text"), { type: "text", text: said }], model: "demo-ai" };
      continue;
    }
    yield ev.type === "done" ? { ...ev, model: "demo-ai" } : ev;
  }
  void tool;
}
