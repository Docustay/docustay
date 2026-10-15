// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN (R3.001, Screen.svelte) — resolve the route (routes.js), load, render the variant.
// ★ The load re-runs on a navigation AND on app.refetchSignal (the chrome's only way to say "read it again", F230).
// ★ A 401 flips the whole app to signed-out; a 403 renders DENIED with the server's reason, never "not built".
// ★★ Nothing here decides what a screen is: the route row says it, the server's payload fills it.
// ★ Composites: "list" (ScreenTable1Table), "record" (RecordPage + the record's action strip + ArchiveControl);
//   `?new=1` surfaces answer through ONE switch (NEW_SURFACE_COMPONENTS); `surfaces` host a route's modals.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useSubscribed } from "@/lib/app/useAppState.js";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RecordPage from "@/lib/record/RecordPage.jsx";
import { done as doneFor } from "@/lib/app/refresh.js";
import { surfaceFor } from "@/lib/app/surfaceRegistry.js";
import { rankAtLeast } from "@/lib/permissions/can.js";
import { DeleteButton } from "@/lib/record/DeleteDialog.jsx";
import { deleteTypeForRecord, deleteTargetForPath } from "@/lib/record/deleteTypes.js";
import { RANK } from "@/lib/permissions/vocab.js";
import { resolveRoute, variantFor, NEW_SURFACE_COMPONENTS, RECORD_ACTIONS, ARCHIVE_CONTROL } from "./routes.js";
import { fileComponent, sectionComponent } from "./lazyScreens.js";
import ScreenTable1Table, { editPersonField } from "./ScreenTable1Table.jsx";
import ScreenNewNotBuiltSheet from "./ScreenNewNotBuiltSheet.jsx";

const Loading = () => <ScreenState phase="loading" />;
const componentOf = (spec, ctx) => {
  const s = typeof spec === "function" ? spec(ctx) : spec;
  return s.file ? fileComponent(s.file) : sectionComponent(s.section, s.name);
};
const Slot = ({ spec, ctx, extra }) => {
  const Comp = componentOf(spec.component, ctx);
  return <Comp {...spec.props(ctx, ...(extra ?? []))} />;
};

// ★ Surfaces that write something an Admin-or-above only may create (Screen.svelte:678-693). The permission decides
//   through can.js (rankAtLeast lives in lib/permissions — K6b), never a rank string compared here.
const ADMIN_ONLY_PATHS = ["/settings/developer/webhooks", "/money/invoices", "/money/subscriptions", "/engagements/booking/settings", "/documents/contracts/templates", "/documents/forms/templates"];
const ADMIN_ONLY = new Set(ADMIN_ONLY_PATHS.map((p) => surfaceFor(p)?.component).filter(Boolean));
// where a record page goes once its record is deleted (it no longer exists to show)
const listPathAfterDelete = (t) => ({ person: "/people/active", account: "/accounts/all", service: "/items/services", package: "/items/packages",
  plan: "/items/plans", booking: "/engagements/sessions", document: "/documents/pipeline", network_party: "/network" }[t] ?? "/home");
const RECORD_PAGE_PERSON_EDITABLE_FIELDS = ["display_name", "email", "mobile_phone"];

export default function Screen({ app, path, onNavigate }) {
  useSubscribed(app);
  const query = app.query ?? {};
  const { route, params } = useMemo(() => resolveRoute(path, query), [path, query.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState({ phase: "loading" });
  const [surface, setSurface] = useState(null); // { key, args }
  const sig = app.refetchSignal;

  const refetch = () => { app.refetchSignal += 1; };
  const closeForm = () => onNavigate(path);
  const done = () => doneFor(app, path);
  const baseCtx = { app, path, query, params, onNavigate, refetch, closeForm, done, formDone: () => { done(); closeForm(); }, rank: app.nav?.rank ?? null, me: app.me, open: (key, args) => setSurface({ key, args }) };

  useEffect(() => {
    let live = true;
    setSurface(null);
    if (!route.load) { setState({ phase: "ready", data: null, kind: null }); return undefined; }
    setState({ phase: "loading" });
    (async () => {
      try {
        const out = await route.load({ ...baseCtx });
        if (!live) return;
        if (route.id === "view") setState({ phase: "ready", kind: out.kind, data: out.data });
        else setState({ phase: "ready", kind: null, data: out });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) { app.authed = false; return; }
        if (live) setState({ phase: "error", error: err, denied: err instanceof ApiError && err.status === 403 });
      }
    })();
    return () => { live = false; };
  }, [path, sig, route.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The record's title rides into the breadcrumb tail.
  useEffect(() => {
    app.recordTitle = route.id === "record" && state.phase === "ready" ? (state.data?.shell?.header?.title ?? null) : null;
  }, [route.id, state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.phase === "loading") return <Loading />;
  if (state.phase === "error") return <ScreenState phase={state.denied ? "denied" : "error"} error={state.error} reason={state.denied ? state.error?.message : null} onNavigate={onNavigate} onRetry={refetch} />;

  const ctx = { ...baseCtx, data: state.data, kind: state.kind };
  const newSurface = query.new === "1" ? surfaceFor(path) : null;
  ctx.newSurface = newSurface;
  const variant = variantFor(route, ctx);
  if (!variant) return <ScreenState phase="error" error={new Error(`No renderer for ${path} (kind "${state.kind}").`)} />;

  const newLabel = state.data?.emptyState?.action?.label ?? "New";
  const newSurfaceSlot = variant.newSurface && newSurface ? (
    NEW_SURFACE_COMPONENTS[newSurface.component]
      ? <Slot spec={NEW_SURFACE_COMPONENTS[newSurface.component]} ctx={ctx} />
      : newSurface.notBuilt ? <ScreenNewNotBuiltSheet newSurface={newSurface} newLabel={newLabel} closeForm={closeForm} /> : null
  ) : null;

  let main;
  if (variant.component === "list") {
    const s = surfaceFor(path);
    const canAddHere = !!s?.component && s.component !== "section" && (ADMIN_ONLY.has(s.component) ? rankAtLeast(app.permissions, RANK.admin) : true);
    main = <ScreenTable1Table app={app} path={path} onNavigate={onNavigate} data={state.data} blocked={app.isBlocked(path)} canAddHere={canAddHere} newLabel={newLabel}
      rank={ctx.rank} openSectionNew={newSurface?.component === "section"} onDone={done} />;
  } else if (variant.component === "record") {
    const shell = state.data.shell;
    const actions = (
      <>
        {RECORD_ACTIONS.filter((a) => [].concat(a.type).includes(shell?.type)).map((a) => <Slot key={a.id ?? String(a.type)} spec={a} ctx={ctx} />)}
        <Slot spec={ARCHIVE_CONTROL} ctx={ctx} />
        <DeleteButton type={deleteTypeForRecord(shell?.type, shell?.role)} id={params.id} label={shell?.header?.title ?? null} rank={ctx.rank}
          onDone={() => onNavigate(listPathAfterDelete(shell?.type))} />
      </>
    );
    main = <RecordPage shell={shell} activity={state.data.activity ?? []} relatedCounts={state.data.relatedCounts ?? {}} relatedRows={state.data.relatedRows ?? {}}
      viewportWidth={app.viewportWidth} onOpenRelated={(type, id) => onNavigate(`/record/${type}/${id}`)} actions={actions} rank={ctx.rank}
      editableFields={shell?.type === "person" ? RECORD_PAGE_PERSON_EDITABLE_FIELDS : []}
      onEditField={shell?.type === "person" ? async (field, value) => { await editPersonField(app.permissions, params.id, field, value); refetch(); } : null} />;
  } else {
    main = <Slot spec={variant} ctx={ctx} />;
  }

  const surfaces = typeof route.surfaces === "function" ? route.surfaces(ctx) : route.surfaces;
  const openSurface = surface && surfaces?.[surface.key]
    ? <Slot spec={surfaces[surface.key]} ctx={ctx} extra={[surface.args, () => setSurface(null)]} />
    : null;

  return (
    <Suspense fallback={<Loading />}>
      {(variant.before ?? []).map((b, i) => <Slot key={`b${i}`} spec={b} ctx={ctx} />)}
      {/* the shared Delete for Stripe-record detail pages (payments, subscriptions, payouts, disputes) — one generic bar */}
      {(() => { const t = deleteTargetForPath(path); return t ? (
        <div className="mb-3 flex justify-end">
          <DeleteButton type={t.object} id={t.id} rank={ctx.rank} onDone={() => onNavigate(`/money/${path.split("/")[2]}`)} />
        </div>) : null; })()}
      {main}
      {(variant.after ?? []).filter((a) => !a.when || a.when(ctx)).map((a, i) => <Slot key={`a${i}`} spec={a} ctx={ctx} />)}
      {newSurfaceSlot}
      {openSurface}
    </Suspense>
  );
}
