import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><div id=root></div>", { url: "https://app.example.com/", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent, MessageEvent: dom.window.MessageEvent, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react"); const { createRoot } = await import("react-dom/client"); const { act } = React;
const { DocustaySign } = await import("../src/index.js");
const URL_OK = "https://app.docustay.test/sign/pdf?t=abc&embed=1&parent=https%3A%2F%2Fapp.example.com";
const msg = (type, extra = {}) => ({ source: "docustay", version: 1, type, documentId: "d9", ...extra });

test("renders the element with the url, and callbacks fire for the form's events (one frame, one origin)", async () => {
  const got = [];
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(DocustaySign, { url: URL_OK, height: 600, onReady: (d) => got.push(["ready", d.documentId]), onCompleted: (d) => got.push(["completed", d.documentId]), onEvent: (e) => got.push(["event", e.type]) })));
  const el = document.querySelector("docustay-sign"); assert.ok(el);
  assert.equal(el.getAttribute("url"), URL_OK); assert.equal(el.getAttribute("height"), "600");
  const f = el.shadowRoot.querySelector("iframe"); assert.equal(f.getAttribute("src"), URL_OK);
  window.dispatchEvent(new MessageEvent("message", { data: msg("ready"), origin: "https://app.docustay.test", source: f.contentWindow }));
  window.dispatchEvent(new MessageEvent("message", { data: msg("completed"), origin: "https://evil.example.net", source: f.contentWindow }));   // wrong origin: ignored
  window.dispatchEvent(new MessageEvent("message", { data: msg("completed"), origin: "https://app.docustay.test", source: f.contentWindow }));
  assert.deepEqual(got, [["ready", "d9"], ["event", "ready"], ["completed", "d9"], ["event", "completed"]]);
  await act(async () => root.unmount());
});

test("a new url re-points the frame; unmounting removes the element and its listeners", async () => {
  const got = []; const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(DocustaySign, { url: URL_OK, onCompleted: () => got.push(1) })));
  const el = document.querySelector("docustay-sign"), f = el.shadowRoot.querySelector("iframe");
  const NEXT = "https://app.docustay.test/sign/pdf?t=def&embed=1&parent=https%3A%2F%2Fapp.example.com";
  await act(async () => root.render(React.createElement(DocustaySign, { url: NEXT, onCompleted: () => got.push(1) })));
  assert.equal(f.getAttribute("src"), NEXT);
  await act(async () => root.unmount());
  assert.equal(document.querySelector("docustay-sign"), null);
  window.dispatchEvent(new MessageEvent("message", { data: msg("completed"), origin: "https://app.docustay.test", source: f.contentWindow }));
  assert.deepEqual(got, []);
});
