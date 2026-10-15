// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServiceRulesScreen — Rules per service (`/engagements/booking/rules`, `EngServiceRules`).
// Ported from webui/src/lib/screens/engagements/ServiceRulesScreen.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ServiceRulesScreenServiceRulesPageTable from "./ServiceRulesScreenServiceRulesPageTable.jsx";

export default function ServiceRulesScreen({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const load = async () => {
      setPhase("loading");
      setError(null);
      try {
        const r = await request("/api/engagements/service-rules");
        setRows(r?.rows ?? []);
        setPhase(r?.rows && r.rows.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
          setError(err);
        } else {
          setPhase("error");
          setError(
            err instanceof ApiError
              ? { message: err.message, requestId: err.requestId }
              : { message: String(err?.message ?? err) }
          );
        }
      }
    };

    load();
  }, []);

  const go = (href) => {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  };

  const whoCanBookLabel = (v) => {
    return v === "existing_clients" ? "Existing clients" : "Anyone";
  };

  const rowActions = (row) => [
    { id: "edit", label: "Open in Services", onRun: () => go("/items/services") },
  ];

  return (
    <ServiceRulesScreenServiceRulesPageTable
      onNavigate={onNavigate}
      go={go}
      phase={phase}
      error={error}
      rows={rows}
      whoCanBookLabel={whoCanBookLabel}
      rowActions={rowActions}
    />
  );
}
