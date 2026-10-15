// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.25 — PEOPLE LIST (AppStaffPeople, PhonePeople, PhoneEmpty)
//
// ★★★ THE STAFF APP'S PEOPLE TAB. Shows a list of people with their key facts (sessions, owing,
//     block remaining, parent/payer line) filtered by view (Everyone, Mine, Owing, Gone quiet,
//     Leads). Search filters rows, voice input fills the search box. Rows navigate to the person's
//     record (18.26); "+" creates a client (Stage 12's create sheet at phone width).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { request } from "@/lib/api";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

const VIEWS = [
  { label: "Everyone", value: "all" },
  { label: "Mine", value: "mine" },
  { label: "Owing", value: "owing" },
  { label: "Gone quiet", value: "quiet" },
  { label: "Leads", value: "leads" },
];

export default function StaffPeople({ app, path, onNavigate }) {
  // ★ State for the list load, search, and view selection.
  const [viewData, setViewData] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState("all");
  const [recognition, setRecognition] = useState(null);
  const [isListening, setIsListening] = useState(false);

  // ★ Initialize speech recognition if available.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0].transcript)
            .join("");
          setSearch(transcript);
        };
        rec.onerror = () => {
          setIsListening(false);
        };
        rec.onend = () => {
          setIsListening(false);
        };
        setRecognition(rec);
      }
    }
  }, []);

  // ★ Load view data from the API based on the active view.
  const loadView = async (view) => {
    setPhase("loading");
    setError(null);

    try {
      // Map view names to list paths. These paths correspond to the list descriptors
      // in src/records/lists/people.mjs.
      const pathMap = {
        all: "/people/all",
        mine: "/people/clients",
        owing: "/people/clients",
        quiet: "/people/clients",
        leads: "/people/leads",
      };

      const listPath = pathMap[view] || "/people/all";
      const response = await request(`/api/list${listPath}`);

      // ★ Filter the rows based on the view.
      let rows = response.rows || [];

      if (view === "mine") {
        const userId = app?.auth?.userId || app?.userId;
        rows = rows.filter((row) => row.owner_user_id === userId);
      } else if (view === "owing") {
        rows = rows.filter((row) => (row.owes_minor || 0) > 0);
      } else if (view === "quiet") {
        rows = rows.filter((row) => row.status?.startsWith("quiet_"));
      }

      setViewData({
        ...response,
        rows,
      });

      setPhase("success");
    } catch (err) {
      setError(err);
      setPhase("error");
    }
  };

  // ★ Load the view data when the active view changes.
  useEffect(() => {
    loadView(activeView);
  }, [activeView]);

  // ★ Derived filtered rows based on search input.
  const filteredRows = useMemo(() => {
    if (!viewData?.rows) return [];
    const q = search.toLowerCase();
    return viewData.rows.filter(
      (row) =>
        row.display_name.toLowerCase().includes(q) ||
        row.email?.toLowerCase().includes(q)
    );
  }, [viewData?.rows, search]);

  // ★ Summary information: count of clients and count of "gone quiet".
  const summary = useMemo(() => {
    if (!viewData?.summary) return { clients: 0, quiet: 0 };
    return viewData.summary;
  }, [viewData?.summary]);

  // ★ Start or stop voice recognition.
  const toggleVoice = () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      recognition.start();
      setIsListening(true);
    }
  };

  // ★ Navigate to a person's record.
  const openPerson = (personId) => {
    onNavigate(`/staff/people/${personId}`);
  };

  // ★ Navigate to the create client sheet.
  const addClient = () => {
    if (app?.nav?.staff) {
      onNavigate("/staff/people?new=1");
    }
  };

  // ★ Clear search filters.
  const clearFilters = () => {
    setSearch("");
  };

  // ★ Format the fact line from list row columns.
  const getFactLine = (row) => {
    const facts = [];

    if (row.sessions !== null && row.sessions !== undefined) {
      facts.push(`${row.sessions} session${row.sessions !== 1 ? "s" : ""}`);
    }

    if ((row.owes_minor || 0) > 0 && row.owes_currency) {
      const amount = (row.owes_minor / 100).toFixed(2);
      facts.push(`$${amount} owing`);
    }

    if (row.who_pays) {
      facts.push(row.who_pays);
    }

    return facts.join(" · ");
  };

  // ★ Get the badge chip based on status or payment state.
  const getBadge = (row) => {
    if ((row.owes_minor || 0) > 0) return { text: "Owes", variant: "warn" };
    if (row.status?.startsWith("quiet_")) {
      const weeks = row.status.split("_")[1];
      return { text: `${weeks} weeks`, variant: "bad" };
    }
    if (row.status === "consent_unsigned") return { text: "Unsigned", variant: "warn" };
    if (row.status === "active") return { text: "Active", variant: "ok" };
    if (row.type === "parent") return { text: "Payer", variant: "mute" };
    if (row.type === "lead") return { text: "Lead", variant: "act" };
    return null;
  };

  // ★ Get initials from a person's display name.
  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // ★ Handle view change.
  const selectView = (view) => {
    setActiveView(view);
    setSearch("");
  };

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="The people list is for the practice's team."
      />
    );
  }

  if (phase === "error") {
    return (
      <ScreenState
        phase="error"
        error={error}
        subject="Your people list"
        onRetry={() => loadView(activeView)}
      />
    );
  }

  return (
    <>
      {/* ★ Header: count of clients and "gone quiet" count */}
      <div className="flex items-center justify-between px-[18px] py-4 gap-3">
        <div className="flex flex-col gap-1">
          <div
            className="text-[17px] font-medium text-ink"
          >
            People
            <span
              className="block text-[13px] text-mute font-normal"
            >
              {summary.clients} clients · {summary.quiet} gone quiet
            </span>
          </div>
        </div>
        <button
          onClick={addClient}
          className="w-8 h-8 rounded-lg bg-transparent border border-line flex items-center justify-center text-xl text-ink cursor-pointer flex-shrink-0"
        >
          +
        </button>
      </div>

      {viewData?.rows.length === 0 ? (
        // First-time empty for the view
        <div className="px-[18px] mt-10">
          <EmptyState
            kind="first-run"
            headline="No clients yet"
            line="Add someone, or bring your list over from wherever it is now."
            action={{ label: "Add a client", href: "#" }}
            onNavigate={() => addClient()}
          />
          <button
            className="w-full mt-3 inline-flex items-center justify-center gap-2 h-[38px] px-[17px] rounded-lg font-medium text-[14px] border border-line bg-surface text-mute cursor-pointer hover:bg-mute-bg"
          >
            Import a list
          </button>
        </div>
      ) : (
        <>
          {/* ★ Search box with optional voice input */}
          <div className="flex items-center px-[18px] pb-3 gap-2">
            {recognition && (
              <button
                onClick={toggleVoice}
                title="Search by voice"
                aria-label="Search by voice"
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-base cursor-pointer flex-shrink-0 transition-all ${
                  isListening
                    ? "bg-action-50 border border-action-600 text-action-600"
                    : "bg-transparent border border-line text-mute"
                }`}
              >
                🎤
              </button>
            )}
            <input
              type="text"
              placeholder="Search, or say a name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 h-9 border border-line rounded-lg px-[11px] text-[13.5px] text-ink bg-surface placeholder:text-mute"
            />
          </div>

          {/* ★ View pills */}
          <div className="flex gap-2 px-[18px] pb-3 overflow-x-auto scroll-smooth">
            {VIEWS.map((view) => (
              <button
                key={view.value}
                onClick={() => selectView(view.value)}
                className={`flex-shrink-0 px-3 py-[7px] rounded-full whitespace-nowrap transition-all text-[12.5px] font-medium ${
                  activeView === view.value
                    ? "bg-action-600 border border-action-600 text-white"
                    : "bg-surface border border-line text-mute"
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>

          {filteredRows.length === 0 ? (
            // Filtered-to-nothing state
            <div className="px-[18px] mt-10">
              <EmptyState
                kind="filtered"
                headline={`Nobody matches '${search}'`}
                line=""
                action={null}
                onClearFilters={clearFilters}
              />
            </div>
          ) : (
            // ★ List rows
            <div className="flex flex-col">
              {filteredRows.map((row) => {
                const badge = getBadge(row);
                const badgeColorClass = badge
                  ? badge.variant === "warn"
                    ? "bg-warn-soft text-warn"
                    : badge.variant === "bad"
                      ? "bg-bad-soft text-bad"
                      : badge.variant === "ok"
                        ? "bg-ok-soft text-ok"
                        : badge.variant === "act"
                          ? "bg-action-50 text-action-600"
                          : "bg-mute-bg text-mute"
                  : "";

                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openPerson(row.id)}
                    aria-label={`Open ${row.display_name}`}
                    className="flex items-center gap-[11px] py-3 px-0 border-0 border-b border-hair cursor-pointer transition-colors bg-transparent text-left font-inherit text-inherit w-full last:border-b-0 hover:bg-mute-bg"
                  >
                    <div className="w-10 h-10 rounded-full bg-mute-bg flex items-center justify-center text-[13px] font-medium text-ink flex-shrink-0">
                      {getInitials(row.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-ink m-0">
                        {row.display_name}
                      </div>
                      <div className="text-[12.5px] text-mute mt-[3px] leading-[1.45] whitespace-normal">
                        {getFactLine(row)}
                      </div>
                    </div>
                    {badge && (
                      <div
                        className={`inline-flex items-center h-[21px] px-[9px] rounded text-[12px] font-medium flex-shrink-0 whitespace-nowrap ${badgeColorClass}`}
                      >
                        {badge.text}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
