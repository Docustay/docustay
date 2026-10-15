import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ReportLeadsWhereTheyCameFromAndWhatHappenedTable from "./ReportLeadsWhereTheyCameFromAndWhatHappenedTable.jsx";
import ReportLeadsWhoDidnTTable from "./ReportLeadsWhoDidnTTable.jsx";

export default function ReportLeads({ onNavigate = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState(null);
  const [range, setRange] = useState("this-month");
  const [compare, setCompare] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ RANGE → DATE BOUNDS. Mirrors `src/routes/reports.mjs`'s own defaults (monthStart/lastMonthStart)
  //   for "this-month" so an unfiltered call matches what the route already does with no query
  //   params. "custom" has no date-picker built anywhere yet, so it falls back to "this-month" too.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  function rangeBounds(r) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const iso = (d) => d.toISOString().slice(0, 10);
    const monthStart = new Date(y, m, 1);
    const nextMonthStart = new Date(y, m + 1, 1);
    const lastMonthStart = new Date(y, m - 1, 1);

    if (r === "last-3-months") {
      const from = new Date(y, m - 3, 1);
      const compareFrom = new Date(y, m - 6, 1);
      return { from: iso(from), to: iso(nextMonthStart), compareFrom: iso(compareFrom), compareTo: iso(from) };
    }
    if (r === "this-quarter") {
      const qStartMonth = m - (m % 3);
      const from = new Date(y, qStartMonth, 1);
      const to = new Date(y, qStartMonth + 3, 1);
      const compareFrom = new Date(y, qStartMonth - 3, 1);
      return { from: iso(from), to: iso(to), compareFrom: iso(compareFrom), compareTo: iso(from) };
    }
    // "this-month" and "custom" (no picker built yet)
    return { from: iso(monthStart), to: iso(nextMonthStart), compareFrom: iso(lastMonthStart), compareTo: iso(monthStart) };
  }

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setDenied(false);
      const reportData = await api.report("found", rangeBounds(range));
      setData(reportData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [range]);

  function handleRange(next) {
    setRange(next);
  }

  function handleCompare(next) {
    setCompare(next);
  }

  // ★ Prompt 1 action — POST saveAutomation('forms.lead_task', {enabled:true}), exact call named
  //   in field 4 / 16.17's client method (`api.js`).
  async function enableLeadTask() {
    if (savingKey) return;
    setSavingKey("forms.lead_task");
    try {
      await api.saveAutomation("forms.lead_task", { enabled: true });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  function dismissPrompt() {
    // ★ No dismissal state exists for this prompt in the payload; the click is a no-op rather than
    //   a silent failure.
  }

  // Derived values
  const enquiries = data?.enquiries ?? 0;
  const enquiriesCompare = data?.enquiries_compare ?? 0;
  const becameClients = data?.became_clients ?? 0;
  const medianDays = data?.days_to_first_session_median ?? null;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const didnt = Array.isArray(data?.didnt) ? data.didnt : [];

  const periodPhrase = range === "last-3-months" ? "in the last three months"
    : range === "this-quarter" ? "this quarter"
    : "this month";

  const headline = `Of ${enquiries} ${enquiries === 1 ? "enquiry" : "enquiries"} ${periodPhrase}, ` +
    `${becameClients} became ${becameClients === 1 ? "a client" : "clients"}.`;

  const enquiriesDelta = enquiries - enquiriesCompare;

  const sourceRows = sources.map((s, i) => ({
    id: s.source ?? `source-${i}`,
    source: s.source === "unknown" ? "Unknown" : s.source,
    enquiries: s.enquiries,
    became_clients: s.became_clients,
  }));

  const sourceColumns = [
    { key: "source", label: "Source" },
    { key: "enquiries", label: "Enquiries" },
    { key: "became_clients", label: "Became clients" },
    { key: "cost", label: "Ad cost" },
  ];

  const didntRows = didnt.map((d) => ({
    id: d.person_id,
    display_name: d.display_name,
    reason: d.reason_class === "our_fault" ? "Our fault" : "Unknown",
  }));

  const didntColumns = [
    { key: "display_name", label: "Who" },
    { key: "reason", label: "Reason" },
  ];

  // ★ Prompt evidence — both are real counts from the payload, never invented
  const ourFaultCount = didnt.filter((d) => d.reason_class === "our_fault").length;
  const unknownSource = sources.find((s) => s.source === "unknown") ?? null;
  const unknownSourceCount = unknownSource?.enquiries ?? 0;
  const unknownSourcePct = enquiries > 0 ? Math.round((unknownSourceCount / enquiries) * 100) : 0;

  const enough = data?.enough_data?.enough ?? true;
  const emptyData = {
    days: data?.enough_data?.days_going ?? 0,
    n: data?.enough_data?.payments ?? 0,
  };

  if (loading) {
    return <LedgerPage title="Where clients come from" loading={true} />;
  }

  if (denied) {
    return (
      <ScreenState
        phase="denied"
        reason="Reports are practice policy — ask an owner or admin for access."
      />
    );
  }

  if (error) {
    return (
      <ScreenState
        phase="error"
        error={error}
      />
    );
  }

  // Render the main content
  const contentChildren = (
    <div className="flex flex-col gap-5">
      {/* Trio of metrics */}
      <div className="flex gap-0 overflow-hidden rounded-card border border-line bg-surface" data-testid="leads-trio">
        <div className="flex flex-1 flex-col gap-1.75 border-r border-hair px-5.5 py-5 first:border-r last:border-r-0">
          <div className="fig text-4xl font-normal leading-none text-ink" data-testid="leads-enquiries">{enquiries}</div>
          <div className="text-sm text-mute">enquiries</div>
          <div className="text-xs text-mute" data-testid="leads-enquiries-delta">
            {enquiriesDelta > 0 ? "▲" : enquiriesDelta < 0 ? "▼" : "–"}
            {Math.abs(enquiriesDelta)} on last period
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.75 border-r border-hair px-5.5 py-5 first:border-r last:border-r-0">
          <div className="fig text-4xl font-normal leading-none text-ink" data-testid="leads-became-clients">{becameClients}</div>
          <div className="text-sm text-mute">became clients</div>
        </div>
        <div className="flex flex-1 flex-col gap-1.75 border-r border-hair px-5.5 py-5 first:border-r last:border-r-0">
          <div className="fig text-4xl font-normal leading-none text-ink" data-testid="leads-median-days">
            {medianDays === null ? "—" : `${Math.round(medianDays)} days`}
          </div>
          <div className="text-sm text-mute">from enquiry to first session</div>
        </div>
      </div>

      {/* Two columns layout */}
      <div className="flex gap-5.5 items-start">
        {/* Left column: Tables */}
        <div className="flex flex-1 min-w-0 flex-col gap-5">
          <ReportLeadsWhereTheyCameFromAndWhatHappenedTable
            enquiries={enquiries}
            sourceRows={sourceRows}
            sourceColumns={sourceColumns}
          />
          <ReportLeadsWhoDidnTTable
            didntRows={didntRows}
            didntColumns={didntColumns}
          />
        </div>

        {/* Right column: Prompts and panels */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-5">
          {ourFaultCount > 0 && (
            <PromptCard
              icon="◎"
              tone="bad"
              headline="Nobody watches the contact form"
              why={`${ourFaultCount} ${ourFaultCount === 1 ? "enquiry" : "enquiries"} went unanswered for over a week — the contact form doesn't create a task, so it lands in an inbox and dies there.`}
              action={{ label: "Make it create a task", onClick: enableLeadTask }}
              busy={savingKey === "forms.lead_task"}
              onDismiss={dismissPrompt}
              testId="leads-contact-form-prompt"
            />
          )}

          {unknownSourceCount > 0 && (
            <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-4.25 py-3.75" data-testid="leads-require-source-panel">
              <div className="flex flex-col gap-1">
                <div className="text-field font-medium text-ink">
                  {unknownSourceCount} of {enquiries} never said how they found you
                </div>
                <div className="text-meta text-mute leading-relaxed">
                  The source field isn't required, which makes {unknownSourcePct}% of this screen a guess.
                </div>
              </div>
              <DisabledWithReason
                disabled={true}
                reason="The required-fields settings screen isn't built yet"
                testId="leads-require-source"
              >
                {({ disabled }) => (
                  <Button size="sm" disabled={disabled} data-testid="leads-require-source-button">Require it</Button>
                )}
              </DisabledWithReason>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <LedgerPage
      title="Where clients come from"
      summary={headline}
      testId="leads-page"
    >
      {contentChildren}
    </LedgerPage>
  );
}
