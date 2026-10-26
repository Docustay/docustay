// useSharedEngine.js — whether this practice writes documents through the shared engine (tenant setting `authoring.shared_engine`, default false).
// ★ NO CLIENT READ PATH EXISTS for a tenant setting by key (checked src/routes/settings.mjs, app.mjs: /api/settings/* answers per-card fields, none carries
//   authoring.shared_engine). Until a route exposes it this hook answers false, so every door it guards stays hidden. Wire the read in `readFlag` below.
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";

async function readFlag() {
  const r = await request("/api/settings/authoring");
  return (r?.data ?? r)?.sharedEngine === true;
}

export default function useSharedEngine() {
  const [state, setState] = useState({ enabled: false, loading: true });
  useEffect(() => {
    let alive = true;
    readFlag().then((v) => alive && setState({ enabled: v === true, loading: false })).catch(() => alive && setState({ enabled: false, loading: false }));
    return () => { alive = false; };
  }, []);
  return state;
}
