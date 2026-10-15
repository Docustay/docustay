import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";
execFileSync("npx", ["tsc", "-p", "tsconfig.test.json"], { stdio: "inherit" });
const dom = new JSDOM("<!doctype html><body><app-root></app-root></body>", { url: "https://app.example.com/", pretendToBeVisual: true });
for (const k of ["window", "document", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MessageEvent", "customElements", "MutationObserver", "getComputedStyle", "requestAnimationFrame"]) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
Object.defineProperty(globalThis, "Event", { value: dom.window.Event, configurable: true, writable: true });
await import("zone.js"); await import("@angular/compiler");
const { Component, NgZone, provideZoneChangeDetection, ApplicationRef } = await import("@angular/core");
const { bootstrapApplication } = await import("@angular/platform-browser");
const { DocustaySignComponent } = await import("../.test-build/docustay-sign.component.js");
const URL_OK = "https://app.docustay.test/sign/pdf?t=abc&embed=1&parent=https%3A%2F%2Fapp.example.com";
const msg = (type, extra = {}) => ({ source: "docustay", version: 1, type, documentId: "d5", ...extra });

test("the Angular component renders the element and emits the form's events (one frame, one origin)", async () => {
  const got = [];
  const Host = Component({ selector: "app-root", standalone: true, imports: [DocustaySignComponent], template: `<docustay-sign-form [url]="url" height="500" (completed)="done($event)" (docustayEvent)="any($event)"></docustay-sign-form>` })(class { url = URL_OK; done(d) { got.push(["completed", d.documentId]); } any(e) { got.push(["event", e.type]); } });
  const app = await bootstrapApplication(Host, { providers: [provideZoneChangeDetection({ eventCoalescing: false })] });
  const el = document.querySelector("docustay-sign"); assert.ok(el);
  assert.equal(el.getAttribute("url"), URL_OK); assert.equal(el.getAttribute("height"), "500");
  const f = el.shadowRoot.querySelector("iframe"); assert.equal(f.getAttribute("src"), URL_OK);
  window.dispatchEvent(new dom.window.MessageEvent("message", { data: msg("completed"), origin: "https://evil.example.net", source: f.contentWindow }));
  assert.deepEqual(got, []);                                              // another origin: nothing
  window.dispatchEvent(new dom.window.MessageEvent("message", { data: msg("completed"), origin: "https://app.docustay.test", source: f.contentWindow }));
  assert.deepEqual(got, [["completed", "d5"], ["event", "completed"]]);
  app.destroy(); assert.equal(document.querySelector("docustay-sign"), null);
});
