// The Anthropic messages API, streamed. An async generator of plain events so the orchestrator (and its tests) never touch the wire format.
//   {type:"text", text} · {type:"tool_use", id, name, input} · {type:"done", stopReason, content, usage:{input, output, cacheRead, cacheCreation}} · {type:"error", status, kind, message}
// A provider failure never throws: it ends the stream with an "error" event whose message is plain words.
const URL_DEFAULT = "https://api.anthropic.com/v1/messages";
const plain = (status) => status === 401 || status === 403 ? "The AI provider refused the key." : status === 429 ? "The AI provider is busy; try again in a minute." : status === 529 || (status >= 500 && status < 600) ? "The AI provider did not answer; try again." : "The AI provider could not take that request.";

// Anthropic accepts tool names of letters, digits, _ and - only, so the dotted `docustay.doc.get` goes over the wire as `docustay__doc__get` (in the tool list, in earlier tool_use blocks and in any prose naming one) and comes back decoded.
const enc = (n) => String(n).replace(/\./g, "__");
const dec2 = (n) => String(n).replace(/__/g, ".");
const encText = (t) => typeof t === "string" ? t.replace(/\bdocustay(\.[a-z_]+)+/g, enc) : t;
const wireSystem = (sys) => typeof sys === "string" ? encText(sys) : Array.isArray(sys) ? sys.map((b) => b?.text ? { ...b, text: encText(b.text) } : b) : sys;
const wireTools = (ts) => Array.isArray(ts) ? ts.map((t) => ({ ...t, name: enc(t.name), description: encText(t.description) })) : ts;
const wireMessages = (ms) => Array.isArray(ms) ? ms.map((m) => Array.isArray(m.content) ? { ...m, content: m.content.map((b) => b?.type === "tool_use" ? { ...b, name: enc(b.name) } : b?.type === "text" ? { ...b, text: encText(b.text) } : b) } : m) : ms;

export async function* streamAnthropic({ apiKey, model, effort = null, system, tools, messages, maxTokens = 2048, signal, fetchImpl = fetch, url = URL_DEFAULT }) {
  let res;
  try {
    res = await fetchImpl(url, { method: "POST", signal, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, ...(effort && process.env.KEYSTONE_AI_EFFORT !== "off" ? { output_config: { effort } } : {}), system: wireSystem(system), tools: wireTools(tools), messages: wireMessages(messages), stream: true }) });
  } catch (e) { yield { type: "error", status: 0, kind: e?.name === "AbortError" ? "aborted" : "network", message: e?.name === "AbortError" ? "Stopped." : "The AI provider could not be reached; try again." }; return; }
  if (!res.ok) { if (res.status < 500 && res.status !== 429) console.error(`chat provider ${res.status}: ${(await Promise.resolve(res.text?.()).catch(() => "") ?? "").slice(0, 300)}`); yield { type: "error", status: res.status, kind: res.status === 429 ? "rate_limited" : "provider", message: plain(res.status) }; return; }
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }; const content = []; let cur = null, stopReason = null, buf = "";
  const reader = res.body.getReader(); const dec = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim(); if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === "message_start") { const u = ev.message?.usage ?? {}; usage.input = u.input_tokens ?? 0; usage.cacheRead = u.cache_read_input_tokens ?? 0; usage.cacheCreation = u.cache_creation_input_tokens ?? 0; usage.output = u.output_tokens ?? 0; }
        else if (ev.type === "content_block_start") { const b = ev.content_block ?? {}; cur = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: dec2(b.name), input: {}, _json: "" } : { type: "text", text: "" }; }
        else if (ev.type === "content_block_delta" && cur) {
          if (ev.delta?.type === "text_delta") { cur.text += ev.delta.text; yield { type: "text", text: ev.delta.text }; }
          else if (ev.delta?.type === "input_json_delta") cur._json += ev.delta.partial_json ?? "";
        } else if (ev.type === "content_block_stop" && cur) {
          if (cur.type === "tool_use") { try { cur.input = cur._json ? JSON.parse(cur._json) : {}; } catch { cur.input = {}; cur.badJson = true; } delete cur._json; content.push({ type: "tool_use", id: cur.id, name: cur.name, input: cur.input }); yield { type: "tool_use", id: cur.id, name: cur.name, input: cur.input, badJson: cur.badJson === true }; }
          else if (cur.text) content.push({ type: "text", text: cur.text });
          cur = null;
        } else if (ev.type === "message_delta") { stopReason = ev.delta?.stop_reason ?? stopReason; if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens; }
        else if (ev.type === "error") { yield { type: "error", status: 0, kind: "provider", message: plain(ev.error?.type === "overloaded_error" ? 529 : 500) }; return; }
      }
    }
  } catch (e) { yield { type: "error", status: 0, kind: e?.name === "AbortError" ? "aborted" : "network", message: e?.name === "AbortError" ? "Stopped." : "The connection to the AI provider dropped; try again." }; return; }
  yield { type: "done", stopReason, content, usage };
}
