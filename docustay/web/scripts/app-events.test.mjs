// appEvent fires only with consent: granted cookie, no Do Not Track, no Global Privacy Control. Positive control in each case.
import test from "node:test"; import assert from "node:assert/strict";
const setup = ({ cookie = "", dnt = "0", gpc = false } = {}) => {
  const calls = [];
  globalThis.document = { cookie, head: { appendChild: (s) => { setTimeout(() => s.onload?.(), 0); } }, createElement: () => ({}) };
  Object.defineProperty(globalThis, "navigator", { value: { doNotTrack: dnt, globalPrivacyControl: gpc }, configurable: true, writable: true });
  globalThis.window = { dataLayer: [], umami: { track: () => {} } }; globalThis.window.docustayGa = (n, p) => calls.push([n, p]);
  return calls;
};
const mod = await import("../src/lib/appEvents.js");
test("no consent: nothing is sent", async () => { const calls = setup({ cookie: "" }); assert.equal(await mod.appEvent("demo_ready"), false); assert.equal(calls.length, 0); });
test("declined: nothing is sent", async () => { const calls = setup({ cookie: "docustay-consent=denied" }); assert.equal(await mod.appEvent("demo_ready"), false); assert.equal(calls.length, 0); });
test("granted: the event is sent", async () => { const calls = setup({ cookie: "x=1; docustay-consent=granted" }); assert.equal(await mod.appEvent("signup_complete", { via: "signup" }), true); assert.deepEqual(calls, [["signup_complete", { via: "signup" }]]); });
test("granted but Do Not Track: nothing is sent", async () => { const calls = setup({ cookie: "docustay-consent=granted", dnt: "1" }); assert.equal(await mod.appEvent("upgrade_completed"), false); assert.equal(calls.length, 0); });
test("granted but Global Privacy Control: nothing is sent", async () => { const calls = setup({ cookie: "docustay-consent=granted", gpc: true }); assert.equal(await mod.appEvent("demo_keep_complete"), false); assert.equal(calls.length, 0); });
