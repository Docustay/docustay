// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE CATCH-ALL (R3.020, webui routes/[...path]/+page.svelte) — ONE entry for every path the server answers with
// app.html. Public pages (invite, book, sign, unsubscribe, waitlist) first — they need no session — then <App>.
// ★ `/` is not a nav row: → /home (replace). The Owner who has not answered the intake lands on /signup/questions
//   once. A section header forwards to its first child KEEPING the query string (`/accounts?new=1` must still open
//   the create sheet). All three are replaceState: a header in history would pin Back.
// ★ The URL guard compares pathname + search (F441) — see useLocation.js.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useSyncExternalStore } from "react";
import App from "@/lib/app/App.jsx";
import { AppState } from "@/lib/app/appState.js";
import { useLocation } from "@/lib/app/useLocation.js";
import { resolvePublic } from "@/lib/app/publicRoutes.js";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import { redirectFor } from "@keystone/nav/sectionRedirects.mjs";
import InvitePage from "./invite.jsx";
import BookPage from "./book.jsx";
import BookCoachPage from "./book/coachSlug.jsx";
import SignPdfPage from "./signPdf.jsx";
import VerifyPage from "./verify.jsx";
import VerifyDocPage from "./verifyDoc.jsx";
import SelfServePage from "./selfServe.jsx";
import ToolSignPdfPage from "./toolSignPdf.jsx";
import ToolSignatureMakerPage from "./toolSignatureMaker.jsx";
import SignPage from "./sign.jsx";
import UnsubscribePage from "./u/token.jsx";
import WaitlistClaimPage from "./waitlist/claim.jsx";

const PUBLIC_PAGES = { invite: InvitePage, book: BookPage, "book-coach": BookCoachPage, sign: SignPage, "sign-pdf": SignPdfPage, verify: VerifyPage, "verify-doc": VerifyDocPage, "self-serve": SelfServePage, "tool-sign-pdf": ToolSignPdfPage, "tool-signature-maker": ToolSignatureMakerPage, unsubscribe: UnsubscribePage, "waitlist-claim": WaitlistClaimPage };

function PublicPage({ hit, search, navigate }) {
  const [data, setData] = useState(undefined);
  useEffect(() => {
    let live = true;
    setData(undefined);
    if (!hit.route.load) { setData(null); return undefined; }
    hit.route.load({ params: hit.params, query: new URLSearchParams(search) }).then((d) => {
      if (!live) return;
      if (d?.redirect) { navigate(d.redirect, { replace: true }); return; }
      setData(d);
    });
    return () => { live = false; };
  }, [hit.route.id, search]); // eslint-disable-line react-hooks/exhaustive-deps
  if (data === undefined) return <div className="grid h-dvh place-items-center"><AppSpinner /></div>;
  const Page = PUBLIC_PAGES[hit.route.id];
  return <Page data={data} />;
}

function Staff({ path, search, query, navigate }) {
  const [app] = useState(() => new AppState());
  useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  useEffect(() => { app.query = query; }, [app, query]);
  useEffect(() => {
    const onResize = () => { app.viewportWidth = window.innerWidth; };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [app]);
  const needsIntake = app.me?.needsIntake === true;
  useEffect(() => {
    if (path === "/" || path === "") { navigate("/home", { replace: true }); return; }
    if (path === "/home" && needsIntake) { navigate("/signup/questions", { replace: true }); return; }
    const to = redirectFor(path);
    if (to && to !== path) navigate(to + search, { replace: true });
  }, [path, search, needsIntake, navigate]);
  return <App app={app} path={path} onNavigate={navigate} boot />;
}

export default function CatchAll() {
  const { path, search, query, navigate } = useLocation();
  const hit = resolvePublic(path);
  return hit ? <PublicPage hit={hit} search={search} navigate={navigate} /> : <Staff path={path} search={search} query={query} navigate={navigate} />;
}
