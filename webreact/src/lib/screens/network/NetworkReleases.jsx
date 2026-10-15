// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.021 — NetworkReleases — the pointer surface for consent releases.
// Ported from webui/src/lib/screens/network/NetworkReleases.svelte: same props (onNavigate),
// testids, copy. Built on LedgerPage archetype. Composes R4.021.T1 (table).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import NetworkReleasesNetworkReleasesTable from "./NetworkReleasesNetworkReleasesTable.jsx";

export default function NetworkReleases({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  function go(href) {
    onNavigate?.(href);
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const result = await api.view("/documents/contracts/all");
      const allRows = result?.kind === "list" ? (result.data?.rows ?? []) : [];
      // Filter client-side by type_key === "release"
      const filtered = allRows.filter((row) => row?.type_key === "release");
      setRows(filtered);
      setPhase(filtered.length === 0 ? "empty" : "ready");
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
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <NetworkReleasesNetworkReleasesTable
      onNavigate={go}
      go={go}
      phase={phase}
      error={error}
      rows={rows}
    />
  );
}
