// Google's own multicolour G (R3.019, GoogleMark.svelte). ★★★ NOT A DESIGN CHOICE: Google's branding guidelines fix
// the mark and its proportions, and consent-screen verification checks it. It is an asset file, rendered as-is —
// never recoloured, never a Lucide icon, never inheriting currentColor or a filter. db/gates/ms18_login_screen.mjs.
import googleG from "@/assets/google-g.svg";

export default function GoogleMark() {
  return <img src={googleG} alt="" aria-hidden="true" className="size-4.5 shrink-0" data-testid="google-mark" />;
}
