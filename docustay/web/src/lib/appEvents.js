// GA4 key events that happen INSIDE the product (demo_ready, demo_keep_complete, signup_complete, upgrade_completed). Nothing here sets a cookie or sends anything unless the visitor pressed Accept on THIS host
// (the docustay-consent=granted cookie, written by the site's consent card or the one on the sign-in pages); Do Not Track and Global Privacy Control are honoured; no email, name or workspace id is ever an event parameter.
const GA4 = "G-0MJLPKWX0S";
const granted = () => { try { return /(?:^|;\s*)docustay-consent=granted\b/.test(document.cookie) && navigator.doNotTrack !== "1" && navigator.globalPrivacyControl !== true; } catch { return false; } };
let loading = null;
function load() {
  if (window.docustayGa) return Promise.resolve();
  return (loading ??= new Promise((resolve) => {
    window.dataLayer = window.dataLayer || [];
    const gtag = function () { window.dataLayer.push(arguments); };   // gtag.js reads the Arguments object
    gtag("consent", "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    gtag("consent", "update", { analytics_storage: "granted" }); gtag("js", new Date()); gtag("config", GA4, { anonymize_ip: true, send_page_view: false });
    window.docustayGa = (name, params) => gtag("event", name, params || {});
    const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4}`; s.onload = s.onerror = () => resolve(); document.head.appendChild(s);
  }));
}
/** Fire a product event. Safe to call anywhere: it does nothing without consent and never throws. */
export async function appEvent(name, params = {}) {
  try { if (!granted()) return false; await load(); window.docustayGa(name, { ...params }); try { window.umami?.track(name, params); } catch { /* none */ } return true; } catch { return false; }
}
