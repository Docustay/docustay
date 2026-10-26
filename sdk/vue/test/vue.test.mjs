import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><div id=root></div>", { url: "https://app.example.com/", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, SVGElement: dom.window.SVGElement, customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent, MessageEvent: dom.window.MessageEvent });
const { createApp, h, nextTick, ref } = await import("vue");
const { DocustaySign } = await import("../src/index.js");
const URL_OK = "https://app.docustay.test/sign/pdf?t=abc&embed=1&parent=https%3A%2F%2Fapp.example.com";
const msg = (type, extra = {}) => ({ source: "docustay", version: 1, type, documentId: "d7", ...extra });

test("renders the element, emits the form's events with their payload, ignores another origin (positive control: the right one is heard)", async () => {
  const got = []; const url = ref(URL_OK);
  const app = createApp({ render: () => h(DocustaySign, { url: url.value, height: 500, onReady: (d) => got.push(["ready", d.documentId]), onCompleted: (d) => got.push(["completed", d.documentId]), onEvent: (e) => got.push(["event", e.type]) }) });
  app.mount("#root"); await nextTick();
  const el = document.querySelector("docustay-sign"); assert.ok(el);
  assert.equal(el.getAttribute("url"), URL_OK); assert.equal(el.getAttribute("height"), "500");
  const f = el.shadowRoot.querySelector("iframe");
  window.dispatchEvent(new MessageEvent("message", { data: msg("ready"), origin: "https://app.docustay.test", source: f.contentWindow }));
  window.dispatchEvent(new MessageEvent("message", { data: msg("completed"), origin: "https://evil.example.net", source: f.contentWindow }));
  window.dispatchEvent(new MessageEvent("message", { data: msg("completed"), origin: "https://app.docustay.test", source: f.contentWindow }));
  assert.deepEqual(got, [["ready", "d7"], ["event", "ready"], ["completed", "d7"], ["event", "completed"]]);
  const NEXT = "https://app.docustay.test/sign/pdf?t=def&embed=1&parent=https%3A%2F%2Fapp.example.com";
  url.value = NEXT; await nextTick(); await nextTick();
  assert.equal(f.getAttribute("src"), NEXT);
  app.unmount(); assert.equal(document.querySelector("docustay-sign"), null);
});
