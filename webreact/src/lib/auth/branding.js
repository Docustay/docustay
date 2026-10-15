// MS-18.2 — whose screen is this?
//
// ★★ UNAUTHENTICATED BY NECESSITY. It is read to DRAW the form, before any credential exists. The
//    server returns `null` for an unknown subdomain, a SUSPENDED tenant, a reserved name and the
//    apex alike — it deliberately does not distinguish them (migration 0121 collapses them in one
//    WHERE clause, because telling them apart is a directory of every practice on the platform and
//    its account standing).
// ★ FAILS SOFT. A branded screen that cannot reach the branding endpoint must still let people sign
//   in. Failing soft on presentation is right; failing soft on an authorisation decision never is.
export async function loadBranding() {
  try {
    const res = await fetch("/api/auth/branding", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json())?.tenant ?? null;
  } catch {
    return null;
  }
}
