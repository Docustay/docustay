// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Campaigns — the growth campaigns list screen. Ported from
// webui/src/lib/screens/growth/Campaigns.svelte (469 lines).
// Props: onNavigate. Loads campaigns data via api.campaigns, api.campaignAudience, api.emailSettings, api.segments.
// Archetype: none (part — composes kit components).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import CampaignsTable1Table from "./CampaignsTable1Table.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

const SEED_SEGMENTS = [
  { name: "Everyone", description: "Every active client", seedKey: "everyone" },
  { name: "Gone quiet", description: "No booking in six weeks, and didn't cancel", seedKey: "gone_quiet" },
  { name: "Block running low", description: "Two sessions or fewer left", seedKey: "block_running_low" },
  { name: "Owing money", description: "An invoice past its due date", seedKey: "owing_money" },
  { name: "Never booked", description: "A lead who hasn't been in yet", seedKey: "never_booked" },
  { name: "On the waitlist", description: "Waiting for a time", seedKey: "on_the_waitlist" },
];

export default function Campaigns({ onNavigate = null }) {
  const [campaigns, setCampaigns] = useState([]);
  const [screenPhase, setScreenPhase] = useState("loading");
  const [errorInfo, setErrorInfo] = useState(null);
  const [deniedReason, setDeniedReason] = useState(null);
  const [emailSettings, setEmailSettings] = useState(null);
  const [liveListCounts, setLiveListCounts] = useState({});
  const app = useContext(AppStateContext);

  async function fetchCampaigns() {
    try {
      setScreenPhase("loading");
      setErrorInfo(null);
      setDeniedReason(null);

      const data = await api.campaigns();

      setCampaigns(data.rows || []);
      setScreenPhase("ready");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setScreenPhase("denied");
          setDeniedReason(`Coaches cannot access campaigns.`);
        } else {
          setScreenPhase("error");
          setErrorInfo(err.message ?? `Failed to load campaigns (${err.status})`);
        }
      } else {
        setScreenPhase("error");
        setErrorInfo(err?.message ?? "Failed to load campaigns");
      }
      setCampaigns([]);
    }
  }

  async function fetchEmailSettings() {
    try {
      const settings = await api.emailSettings();
      setEmailSettings(settings);
    } catch (err) {
      console.error("Failed to load email settings:", err);
      setEmailSettings(null);
    }
  }

  async function fetchLiveListCounts() {
    const counts = {};
    let byName = {};
    try {
      const lists = await api.segments();
      byName = Object.fromEntries((lists.rows ?? []).map((r) => [r.name, r.id]));
    } catch (err) {
      console.error("Failed to load lists:", err);
    }
    for (const segment of SEED_SEGMENTS) {
      const id = byName[segment.name];
      if (!id) { counts[segment.seedKey] = null; continue; }
      try {
        const result = await api.campaignAudience({ segmentId: id });
        counts[segment.seedKey] = result.audience?.count ?? null;
      } catch (err) {
        console.error(`Failed to fetch audience for ${segment.seedKey}:`, err);
        counts[segment.seedKey] = null;
      }
    }
    setLiveListCounts(counts);
  }

  useEffect(() => {
    fetchCampaigns();
    fetchEmailSettings();
    fetchLiveListCounts();
  }, []);

  function navigateToNewCampaign() {
    // ★ FOUND LIVE, 28 Sep 2026 — was "/run/campaigns/new", a path nothing registers. The real
    //   route (routes.js) is "/growth/campaigns/new" — matching this screen's own "/growth/campaigns".
    onNavigate?.("/growth/campaigns/new");
  }

  function formatNumber(n) {
    return typeof n === "number" ? n.toLocaleString() : "—";
  }

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: "/run/campaigns", rank: app?.nav?.rank ?? null, rows: campaigns, onChanged: fetchCampaigns });

  return (
    <ScreenState phase={screenPhase} empty={null} error={errorInfo} reason={deniedReason} onNavigate={onNavigate}
      testIds={{ loading: "campaigns-loading", error: "campaigns-error", denied: "campaigns-denied", empty: "campaigns-empty" }}>
      <div className="flex flex-col gap-6 px-[30px] py-6 pb-[70px]">
        <div className="flex justify-between items-start gap-6">
          <div>
            <h1 className="text-2xl font-medium text-ink m-0 -tracking-[0.01em]">Campaigns</h1>
            <p className="mt-[5px] text-meta text-mute m-0">
              {campaigns.length === 0
                ? "Create your first campaign to reach your audience."
                : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}${
                  campaigns.some(c => c.state === "sent") ? ` · ${campaigns.filter(c => c.state === "sent").length} sent this year` : ""
                }`
              }
            </p>
          </div>
          <button
            className="h-[38px] px-[17px] border border-brand bg-brand text-white rounded-[8px] font-medium text-sm cursor-pointer inline-flex items-center justify-center gap-2"
            onClick={navigateToNewCampaign}
            data-testid="campaigns-new-btn"
          >
            New campaign
          </button>
        </div>

        {campaigns.length === 0 ? (
          <EmptyState kind="first-run" headline="No campaigns yet"
            line="A campaign is one email to one of your lists. Pick a list below, or start a new campaign." />
        ) : (
          <>
            {bulk.bulkBar}
            <CampaignsTable1Table campaigns={campaigns} formatNumber={formatNumber} bulk={bulk} />
          </>
        )}

        {/* Living lists section - shown even when campaigns are empty */}
        <div className="flex gap-[22px]">
          <div className="flex gap-[22px] w-full">
            <div className="flex-1 min-w-0">
              <div className="bg-surface border border-line rounded-[12px] mb-[18px]">
                <div className="flex items-center gap-[10px] p-[14px_17px] border-b border-hair font-medium text-[14.5px]">
                  <b>Lists that keep themselves up to date</b>
                </div>
                <div className="p-[6px_17px_14px]">
                  {SEED_SEGMENTS.map((segment) => (
                    <div
                      key={segment.seedKey}
                      className="flex items-center gap-3 py-[11px] border-b border-hair text-sm last:border-b-0"
                      data-testid={`seed-segment-${segment.seedKey}`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="block font-medium">{segment.name}</span>
                        <span className="block text-meta text-mute mt-[2px] leading-[1.55]">{segment.description}</span>
                      </div>
                      <span className="tabular-nums text-ink-2 flex-shrink-0">
                        {formatNumber(liveListCounts[segment.seedKey])}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-80 flex-shrink-0">
              <div className="bg-surface border border-line rounded-[12px] mb-[18px]">
                <div className="flex items-center gap-[10px] p-[14px_17px] border-b border-hair font-medium text-[14.5px]">
                  <b>How they send</b>
                </div>
                <div className="p-[6px_17px_14px]">
                  <div className="flex items-center gap-3 py-[11px] border-b border-hair text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="block font-medium">By email</span>
                      {emailSettings?.mailbox ? (
                        <span className="block text-meta text-mute mt-[2px] leading-[1.55]">From {emailSettings.mailbox}</span>
                      ) : (
                        <span className="block text-meta text-mute mt-[2px] leading-[1.55]">No email address configured</span>
                      )}
                    </div>
                    {emailSettings?.mailbox && (
                      <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-xs bg-ok-soft text-ok flex-shrink-0">
                        Verified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 py-[11px] border-b border-hair text-sm last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <span className="block font-medium">Unsubscribing</span>
                      <span className="block text-meta text-mute mt-[2px] leading-[1.55]">One click, on every one. Required by law and by decency.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScreenState>
  );
}
