// Run 9 Part 3.7 (board W3): "Get Pro" on the website remembers the plan through sign-up, then the app goes straight to Stripe's checkout. Kept only in this tab, for an hour.
const KEY = "docustay:want-pro";
export function rememberPro(interval = "month") { try { sessionStorage.setItem(KEY, JSON.stringify({ interval: interval === "year" ? "year" : "month", at: Date.now() })); } catch { /* storage blocked: Billing still offers Pro */ } }
export function wantedPro() { try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); return v && Date.now() - v.at < 36e5 ? v : null; } catch { return null; } }
export function takePro() { const v = wantedPro(); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } return v; }
