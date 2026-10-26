// LAUNCH step 8: the guided tour of the demo (driver.js, MIT), loaded only when someone asks for it. Seven short steps that point at real things on the real screen; a step whose target is not on this screen
// is shown in the middle instead, so the tour never breaks on a narrow phone or a changed layout.
import { t } from "$lib/i18n/index.svelte.js";

export async function startTour() {
  const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);
  const has = (sel) => { const e = document.querySelector(sel); return e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" ? sel : undefined; };   // present AND on screen (the sidebar is a drawer on a phone)
  const d = driver({
    showProgress: true, allowClose: true, overlayOpacity: 0.55, popoverClass: "ds-tour",
    nextBtnText: t("Next"), prevBtnText: t("Back"), doneBtnText: t("Done"),
    steps: [
      { popover: { title: t("Welcome to Maple Street"), description: t("This is a small property-management workspace with sample leases and applications. Two minutes, seven stops.") } },
      { element: has('nav a[href="/documents"]'), popover: { title: t("Documents"), description: t("Every document you send lives here, grouped by where it is: draft, waiting, done.") } },
      { element: has('[data-testid="board"]') ?? has('[data-testid="documents-areas"]'), popover: { title: t("Waiting for signature"), description: t("Open one to see who has signed, resend it, or download the sealed PDF with its certificate.") } },
      { element: has('nav a[href="/templates"]'), popover: { title: t("Templates"), description: t("Start from a built-in template or upload your own PDF and drag fields onto it.") } },
      { element: has(".ask-go"), popover: { title: t("Scribe"), description: t("Ask for a document in plain words, for example: draft a rental application. Scribe makes a real draft you can edit.") } },
      { element: has('[data-demo="inbox"]'), popover: { title: t("The demo inbox"), description: t("Nothing is emailed in a demo. Each signing email lands here with a button that opens the signing page, so you can sign as the signer yourself. A few are waiting already.") } },
      { element: has('[data-demo="keep"]'), popover: { title: t("Keep my work"), description: t("When you are ready, enter your email and a code and this workspace becomes your free account.") } },
    ].map((s) => (s.element ? s : { popover: s.popover })),
  });
  d.drive();
  return d;
}
