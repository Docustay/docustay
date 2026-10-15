// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.040 — `/platform/flags`. FEATURE SWITCHES: THE TABLE AND THE BLOCKED NOTE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import PlatFlagsLedgerPlatformFlagsTable from "@/lib/screens/PlatFlagsLedgerPlatformFlagsTable.jsx";
import PlatFlagsTable2Table from "@/lib/screens/PlatFlagsTable2Table.jsx";
import PlatFlagsTable3Table from "@/lib/screens/PlatFlagsTable3Table.jsx";
import PlatFlagsTable4Table from "@/lib/screens/PlatFlagsTable4Table.jsx";
import PlatFlagsTable5Table from "@/lib/screens/PlatFlagsTable5Table.jsx";

export default function PlatFlags({ app = null, testFlags = null }) {
  // Global catalog (flags without tenantId)
  const [flags, setFlags] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);

  // Per-practice state
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [practice, setPractice] = useState(null);
  const [loadingPractice, setLoadingPractice] = useState(false);
  const [practiceError, setPracticeError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [reasonDrafts, setReasonDrafts] = useState({});

  // One idempotency key per pending write, keyed by flag key
  const setKeys = {};

  // Set initial flags from testFlags if provided
  useEffect(() => {
    if (testFlags !== null) {
      setFlags(testFlags);
    }
  }, [testFlags]);

  // Load catalog on mount (unless testFlags was provided)
  useEffect(() => {
    if (testFlags !== null) return; // Skip loading if test data provided
    let live = true;
    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const r = await api.platformFlags();
        if (live) {
          setFlags(r?.flags ?? []);
        }
      } catch (err) {
        if (live) {
          if (err instanceof ApiError && err.status === 403) {
            setCatalogError({ status: 403 });
          } else {
            setCatalogError(err instanceof ApiError ? err.message : String(err?.message ?? err));
          }
        }
      } finally {
        if (live) setCatalogLoading(false);
      }
    };
    loadCatalog();
    return () => { live = false; };
  }, [testFlags]);

  // Load tenants
  useEffect(() => {
    let live = true;
    api.tenants()
      .then((r) => { if (live) setTenants(r?.tenants ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function loadPractice(tenantId) {
    setSelectedTenantId(tenantId);
    setPracticeError(null);
    if (!tenantId) {
      setPractice(null);
      return;
    }
    setLoadingPractice(true);
    try {
      const r = await api.platformFlags(tenantId);
      setPractice(r?.practice ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPracticeError({ status: 403 });
      } else {
        setPracticeError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
      setPractice(null);
    } finally {
      setLoadingPractice(false);
    }
  }

  async function toggle(key, on) {
    if (!selectedTenantId) {
      setPracticeError("Choose a practice first — a flag is switched per practice, never globally, from this screen.");
      return;
    }
    if (busyKey) return;
    setBusyKey(key);
    setPracticeError(null);
    setKeys[key] ??= newIdempotencyKey();
    try {
      await api.setPlatformFlag(
        { key, tenantId: selectedTenantId, on, reason: reasonDrafts[key]?.trim() || null },
        setKeys[key]
      );
      delete setKeys[key];
      await loadPractice(selectedTenantId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Flag is blocked or being_built — cannot change
        setPracticeError(err.message);
      } else {
        setPracticeError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setBusyKey(null);
    }
  }

  function overrideFor(key) {
    return practice?.overrides?.find((o) => o.flag_key === key) ?? null;
  }

  function effectiveFor(key) {
    if (!practice) return null;
    return practice.effective?.[key] ?? null;
  }

  function formatSince(isoDate) {
    if (!isoDate) return "—";
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { month: "short", year: "numeric" });
  }

  function formatOnFor(count) {
    if (count === 0) return "Nobody";
    if (count === 1) return "1 practice";
    return `${count} practices`;
  }

  function wordCount(n) {
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    return words[n] ?? String(n);
  }

  function getStateBadge(flag) {
    if (flag.availability === "available") {
      if (flag.onFor > 0) {
        return { label: "On", tone: "ok" };
      } else {
        return { label: "Off", tone: "neutral" };
      }
    } else if (flag.availability === "trial") {
      return { label: "Trying it out", tone: "act" };
    } else if (flag.availability === "blocked") {
      return { label: "Blocked", tone: "bad" };
    } else if (flag.availability === "being_built") {
      return { label: "Being built", tone: "neutral" };
    }
    return { label: "Unknown", tone: "neutral" };
  }

  const blockedFlags = flags.filter((f) => f.availability === "blocked");
  const summary = flags.length > 0
    ? `${wordCount(flags.length)} things that can be turned on for one practice without touching the rest.`
    : null;

  if (catalogLoading) {
    return <ScreenState phase="loading" />;
  }

  if (catalogError && typeof catalogError === "object" && catalogError.status === 403) {
    return <ScreenState phase="no-permission" />;
  }

  if (catalogError && typeof catalogError === "string") {
    return <ErrorPanel error={new Error(catalogError)} />;
  }

  return (
    <LedgerPage
      title="Feature switches"
      summary={summary}
      primary={{
        label: "New switch",
        disabled: true,
        disabledReason: "New switches are added with a release",
      }}
      testId="ledger-platform-flags"
    >
      {flags.length === 0 ? (
        <ScreenState phase="empty" title="No feature switches yet" />
      ) : (
        <>
          {/* Main catalog table */}
          <PlatFlagsLedgerPlatformFlagsTable
            flags={flags}
            practice={practice}
            formatSince={formatSince}
            formatOnFor={formatOnFor}
            getStateBadge={getStateBadge}
            blockedFlags={blockedFlags}
            summary={summary}
          />

          {/* Blocked flags reasons */}
          {blockedFlags.length > 0 && (
            <div className="mt-4.5 flex flex-col gap-4">
              {blockedFlags.map((flag) => {
                const firstSentence = flag.availabilityReason.split(".")[0] + ".";
                return (
                  <div
                    key={flag.key}
                    data-testid={`platflags-blocked-reason-${flag.key}`}
                    className="rounded-card border border-bad-soft bg-bad-soft px-4.5 py-4 text-sm text-bad"
                  >
                    <strong className="block font-medium">{firstSentence}</strong>
                    {flag.availabilityReason.length > firstSentence.length && (
                      <div className="mt-1">
                        {flag.availabilityReason.substring(firstSentence.length).trim()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Per-practice picker and panel */}
      <div className="mt-4.5">
        {practiceError && typeof practiceError === "string" && (
          <ErrorPanel error={new Error(practiceError)} />
        )}

        <div className="mb-4.5 flex items-center gap-4" data-testid="platflags-picker">
          <label htmlFor="platflags-tenant" className="font-medium text-ink">
            Inspect / change for practice
          </label>
          <select
            id="platflags-tenant"
            data-testid="platflags-tenant-select"
            value={selectedTenantId}
            onChange={(e) => loadPractice(e.currentTarget.value)}
            className="h-10 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 py-2.5 text-ui text-ink"
          >
            <option value="">Choose a practice…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))}
          </select>
          {loadingPractice && (
            <span data-testid="platflags-loading" className="text-sm text-mute">
              Loading…
            </span>
          )}
        </div>

        {practice && (
          <>
            {/* Per-practice table */}
            <PlatFlagsTable2Table
              flags={flags}
              practice={practice}
              busyKey={busyKey}
              reasonDrafts={reasonDrafts}
              toggle={toggle}
              overrideFor={overrideFor}
              effectiveFor={effectiveFor}
            />

            {/* Change log */}
            {(practice.changeLog ?? []).length > 0 && (
              <>
                <h3 className="mt-4.5 mb-4 text-ui font-medium text-ink">
                  Change log — {practice.tenantId}
                </h3>
                <PlatFlagsTable3Table
                  practice={practice}
                  formatSince={formatSince}
                />
              </>
            )}
            {(practice.changeLog ?? []).length === 0 && (
              <p data-testid="platflags-log-empty" className="mt-4.5 text-ui text-mute">
                No changes recorded yet for this practice.
              </p>
            )}
          </>
        )}
      </div>

      {/* Footer text */}
      <p
        data-testid="live-charges-footer"
        className="mt-4.5 border-t border-hair pt-4.5 text-meta text-mute"
      >
        Live card charges: Off · Needs the maintainer in session
      </p>
    </LedgerPage>
  );
}
