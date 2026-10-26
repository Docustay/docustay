// ★ the maintainer, 23 Oct 2026 — release switches the browser needs to know about, sent on GET /api/nav as `features`.
//
// runScreens: the 11 Run marketing screens (webreact/src/lib/screens/run/Run*.jsx) are designed with SAMPLE data and
// wait for a spec before real data is wired. They show only where KEYSTONE_RUN_SCREENS=on (the beta). Production shows
// Run as before. ★ Never on in production, whatever the variable says: no sample data may reach a real practice.
export function releaseFeatures(env = process.env) {
  const production = env.KEYSTONE_ENVIRONMENT === "production";
  return { runScreens: !production && env.KEYSTONE_RUN_SCREENS === "on" };
}
