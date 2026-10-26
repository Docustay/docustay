import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://app.example.com/", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent, MessageEvent: dom.window.MessageEvent });
await import("../src/index.js");
const URL_OK = "https://app.docustay.test/sign/pdf?t=abc&embed=1&parent=https%3A%2F%2Fapp.example.com";
const make = (attrs = {}) => { const el = document.createElement("docustay-sign"); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); document.body.append(el); return el; };
const frameOf = (el) => el.shadowRoot.querySelector("iframe");
const post = (el, data, { origin = "https://app.docustay.test", source = frameOf(el).contentWindow } = {}) => window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
const msg = (type, extra = {}) => ({ source: "docustay", version: 1, type, documentId: "d1", ...extra });

test("the element is defined and frames the session url, sandboxed, with a title", () => {
  const el = make({ url: URL_OK });
  const f = frameOf(el);
  assert.equal(f.getAttribute("src"), URL_OK);
  assert.match(f.getAttribute("sandbox"), /allow-scripts/); assert.ok(!/allow-top-navigation/.test(f.getAttribute("sandbox")));
  assert.equal(f.getAttribute("title"), "Sign this document");
  assert.equal(el.style.height, "720px");
});

test("a url that is not https (or localhost) is not loaded; positive control: https is", () => {
  assert.equal(frameOf(make({ url: "http://evil.example.net/x" })).getAttribute("src"), null);
  assert.equal(frameOf(make({ url: "javascript:alert(1)" })).getAttribute("src"), null);
  assert.equal(frameOf(make({ url: "http://localhost:5180/sign/pdf?t=1" })).getAttribute("src"), "http://localhost:5180/sign/pdf?t=1");
  assert.ok(frameOf(make({ url: URL_OK })).getAttribute("src"));
});

test("events from the form become element events with the payload; completed also reaches the generic 'docustay' event", () => {
  const el = make({ url: URL_OK }); const got = [];
  el.addEventListener("completed", (e) => got.push(["completed", e.detail.documentId]));
  el.addEventListener("docustay", (e) => got.push(["docustay", e.detail.type]));
  post(el, msg("completed"));
  assert.deepEqual(got, [["completed", "d1"], ["docustay", "completed"]]);
});

test("messages from another origin, another window, or in another shape are ignored (positive control: the right one is heard)", () => {
  const el = make({ url: URL_OK }); const got = [];
  el.addEventListener("docustay", (e) => got.push(e.detail.type));
  post(el, msg("completed"), { origin: "https://evil.example.net" });
  post(el, msg("completed"), { source: window });
  post(el, { ...msg("completed"), source: "other" });
  post(el, { ...msg("completed"), version: 2 });
  post(el, msg("not-an-event"));
  post(el, "completed");
  assert.deepEqual(got, []);
  post(el, msg("ready"));
  assert.deepEqual(got, ["ready"]);
});

test("auto-height follows the form's resize events within limits; a fixed height does not", () => {
  const auto = make({ url: URL_OK, "auto-height": "" }); post(auto, msg("resize", { height: 1234.2 }));
  assert.equal(auto.style.height, "1235px"); post(auto, msg("resize", { height: 5 })); assert.equal(auto.style.height, "320px");
  const fixed = make({ url: URL_OK, height: "640" }); post(fixed, msg("resize", { height: 1500 }));
  assert.equal(fixed.style.height, "640px");
});

test("removing the element stops listening", () => {
  const el = make({ url: URL_OK }); const got = [];
  el.addEventListener("ready", () => got.push(1)); const f = frameOf(el);
  el.remove(); window.dispatchEvent(new MessageEvent("message", { data: msg("ready"), origin: "https://app.docustay.test", source: f.contentWindow }));
  assert.deepEqual(got, []);
});

test("events do not bubble (a framework wrapper with an output of the same name is not told twice)", () => {
  const el = make({ url: URL_OK }); const wrap = document.createElement("div"); wrap.append(el); document.body.append(wrap);
  const heard = []; wrap.addEventListener("completed", () => heard.push("bubbled")); el.addEventListener("completed", () => heard.push("own"));
  post(el, msg("completed"));
  assert.deepEqual(heard, ["own"]);
});

// ── <docustay-builder> ──
const BURL = "https://app.docustay.test/embed/builder?o=https%3A%2F%2Fapp.example.com&e=9999999999&s=abc";
const makeB = (attrs = {}) => { const el = document.createElement("docustay-builder"); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); document.body.append(el); return el; };
const bmsg = (type, extra = {}) => ({ source: "docustay", version: 1, type, ...extra });
test("the builder element frames the link, sandboxed, and refuses a url that is not https", () => {
  const el = makeB({ url: BURL }); const f = frameOf(el);
  assert.equal(f.getAttribute("src"), BURL); assert.match(f.getAttribute("sandbox"), /allow-scripts/); assert.ok(!/allow-top-navigation/.test(f.getAttribute("sandbox")));
  assert.equal(frameOf(makeB({ url: "http://evil.example.net/x" })).getAttribute("src"), null);
  assert.equal(el.style.height, "640px");
});
test("a saved event reaches the page with the template id; a message from another origin or another frame is ignored (controls)", () => {
  const el = makeB({ url: BURL }); const got = [];
  el.addEventListener("saved", (e) => got.push(e.detail));
  post(el, bmsg("saved", { templateId: "t1", name: "NDA", fields: 2 }));
  assert.deepEqual(got, [{ templateId: "t1", name: "NDA", fields: 2 }]);
  post(el, bmsg("saved", { templateId: "evil" }), { origin: "https://evil.example.net" });
  post(el, bmsg("saved", { templateId: "evil" }), { source: window });
  post(el, { ...bmsg("saved", { templateId: "evil" }), version: 2 });
  post(el, bmsg("completed", { templateId: "evil" }));   // an event the builder does not have
  assert.equal(got.length, 1);
});

import { mock } from "node:test";
test("LAUNCH (G3): a frame that never speaks (link refused, expired, website not allowed) tells the host page with an error event after 15 s; one that says ready first does not", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const silent = make({ url: URL_OK }), seen = []; silent.addEventListener("error", (e) => seen.push(e.detail.message));
    mock.timers.tick(14000); assert.equal(seen.length, 0, "not before 15 s");
    mock.timers.tick(2000); assert.equal(seen.length, 1); assert.match(seen[0], /did not load/);
    const alive = make({ url: URL_OK }), none = []; alive.addEventListener("error", (e) => none.push(e));
    post(alive, msg("ready")); mock.timers.tick(30000); assert.equal(none.length, 0, "positive control: a frame that answered gets no error");
  } finally { mock.timers.reset(); }
});
