import { useEffect, useState, useRef } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import WaitlistScreenWaitlistPageTable from "./WaitlistScreenWaitlistPageTable.jsx";
import WaitlistScreenWaitlistAddSheet from "./WaitlistScreenWaitlistAddSheet.jsx";
import OfferTimeSheet from "./OfferTimeSheet.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

export default function WaitlistScreen({ onNavigate = null, onDone = null, myAppUserId = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ★ the closed vocabulary, `src/booking/waitlist.mjs:56` (`PREFERENCES`), MEASURED.
  const PREFERENCES = ["evenings", "mornings", "weekends", "flexible", "specific"];
  const PREFERENCE_LABEL = {
    evenings: "Evenings",
    mornings: "Mornings",
    weekends: "Weekends",
    flexible: "Flexible",
    specific: "Specific",
  };

  // ★ only evenings carries a warn tone — the frame's own two chip treatments
  function preferenceTone(pref) {
    return pref === "evenings" ? "warn" : "neutral";
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // FETCH PHASE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ waiting: 0, byPreference: {} });
  const [prompts, setPrompts] = useState([]);
  const [offerMinutes, setOfferMinutes] = useState(60);
  const [services, setServices] = useState([]);
  const [hosts, setHosts] = useState([]);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [wl, promptRes] = await Promise.all([
        request("/api/engagements/waitlist"),
        api.prompts("waitlist"),
      ]);
      setRows(wl?.rows ?? []);
      setSummary(wl?.summary ?? { waiting: 0, byPreference: {} });
      setPrompts(promptRes?.prompts ?? []);
      setPhase("ready");
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
      return;
    }

    // ★ NON-FATAL — see header. A Coach's 403 here falls back to the 60-minute default.
    try {
      const bs = await request("/api/engagements/booking-settings");
      setOfferMinutes(Number(bs?.keys?.["booking.waitlist_offer_minutes"] ?? 60));
    } catch {
      setOfferMinutes(60);
    }

    // ★ NON-FATAL — services drives "Add someone"'s Service select and the id-recovery lookup
    try {
      const svc = await request("/api/list/items/services");
      setServices((svc?.rows ?? []).map((r) => ({ id: r.id, name: r.name, program_id: r.program_id ?? null })));
    } catch {
      setServices([]);
    }

    // ★ NON-FATAL — `/people/team` is admin-only; falls back to `[]`.
    try {
      const team = await request("/api/list/people/team");
      setHosts((team?.rows ?? []).map((r) => ({ id: r.id, displayName: r.display_name ?? r.displayName })));
    } catch {
      setHosts([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resolveServiceId(row) {
    return services.find((s) => s.name === row.serviceName)?.id ?? null;
  }

  function resolveHostId(row) {
    if (!row.hostName) return null;
    return hosts.find((h) => h.displayName === row.hostName)?.id ?? null;
  }

  // ─── preference filter (field 14: filtered-to-nothing) ─────────────────────────────────────────
  const [preferenceFilter, setPreferenceFilter] = useState("all");
  const isFiltered = preferenceFilter !== "all";
  const filtered = isFiltered ? rows.filter((r) => r.preference === preferenceFilter) : rows;
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;

  function clearFilters() {
    setPreferenceFilter("all");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches this filter",
        line: "Try a different preference or clear it.",
        action: null,
      };
    }
    return {
      kind: "first-run",
      headline: "Nobody is waiting",
      line: "When you don't have a slot for someone, add them here — the next free time that matches what they asked for is offered automatically.",
      action: null,
    };
  }

  // ─── the summary sentence ───
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

  function numberText(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return String(n ?? "0");
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }

  function capitalize(s) {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
  }

  const eveningsCount = (() => {
    const hasPrompt = prompts.some((p) => p.kind === "waitlist_evenings");
    if (!hasPrompt) return null;
    return Number(summary?.byPreference?.evenings ?? 0);
  })();

  const summaryText = (() => {
    const n = Number(summary?.waiting ?? 0);
    const base = `${capitalize(numberText(n))} ${n === 1 ? "person" : "people"} waiting.`;
    if (eveningsCount != null && eveningsCount > 0) {
      return `${base} ${capitalize(numberText(eveningsCount))} of them want evenings you don't offer yet.`;
    }
    return base;
  })();

  // ─── "what happens automatically"'s hour sentence ──────────────────────────────────
  function offerWindowText(minutes) {
    if (minutes === 60) return "an hour";
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  // ─── "Added {ago}." ────────
  function ago(iso) {
    if (!iso) return "recently";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "recently";
    const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
    if (minutes < 60) return minutes <= 1 ? "a minute ago" : `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return days === 1 ? "a day ago" : `${days} days ago`;
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  }

  // ─── prompt dismiss ────────────────────────────────────
  function dismissPrompt(p) {
    setPrompts((prev) => prev.filter((x) => x.dismissKey !== p.dismissKey));
    api.dismissPrompt(p.kind, p.subjectId).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ADD SOMEONE — SideSheet, POST /api/engagements/waitlist
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addMode, setAddMode] = useState("existing"); // "existing" | "new"
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState([]);
  const [addSelectedPerson, setAddSelectedPerson] = useState(null); // {id, label, detail}
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addServiceId, setAddServiceId] = useState("");
  const [addHostId, setAddHostId] = useState("");
  const [addPreference, setAddPreference] = useState("flexible");
  const [addNote, setAddNote] = useState("");

  async function onAddQueryInput(q) {
    setAddQuery(q);
    if (!q.trim()) {
      setAddResults([]);
      return;
    }
    try {
      const res = await api.search(q);
      setAddResults(res?.hits ?? []);
    } catch {
      setAddResults([]);
    }
  }

  function pickPerson(hit) {
    setAddSelectedPerson(hit);
  }

  function openAdd() {
    setAddOpen(true);
    setAddError(null);
    setAddMode("existing");
    setAddQuery("");
    setAddResults([]);
    setAddSelectedPerson(null);
    setAddName("");
    setAddEmail("");
    setAddPhone("");
    setAddServiceId("");
    setAddHostId("");
    setAddPreference("flexible");
    setAddNote("");
  }

  function closeAdd() {
    setAddOpen(false);
  }

  async function submitAdd() {
    setAddError(null);
    let personId = null;

    if (addMode === "existing") {
      if (!addSelectedPerson) {
        setAddError("Pick someone from the list.");
        return;
      }
      personId = addSelectedPerson.id;
    } else {
      // new person
      if (!addName.trim()) {
        setAddError("Name is required.");
        return;
      }
      if (!addEmail.trim()) {
        setAddError("Email is required.");
        return;
      }
      // ★ [TY, RULED 2 Oct 2026] email and phone are both required for every person.
      if (!addPhone.trim()) {
        setAddError("Phone is required.");
        return;
      }
    }

    if (!addServiceId) {
      setAddError("Pick a service.");
      return;
    }

    setAddBusy(true);
    try {
      await request("/api/engagements/waitlist", {
        method: "POST",
        body: {
          personId,
          // ★★★ FOUND LIVE, 2 Oct 2026, fixing the phone requirement below — this sent `name`, but
          //   addToWaitlist (src/booking/waitlist.mjs) and its own route schema both expect
          //   `displayName`. A mismatched key means Zod's validated body never carried a name at
          //   all for a new person — createPerson would then throw "missing required fields:
          //   first_name" every time, a PRE-EXISTING bug unrelated to today's phone-requirement
          //   change (confirmed by reading the schema/route directly, not assumed).
          displayName: addMode === "new" ? addName : undefined,
          email: addMode === "new" ? addEmail : undefined,
          // ★ [TY, RULED 2 Oct 2026] email and phone are both required for every person.
          phone: addMode === "new" ? addPhone : undefined,
          serviceId: addServiceId,
          hostId: addHostId || null,
          preference: addPreference,
          note: addNote || null,
        },
      });
      closeAdd();
      await load();
      onDone?.();
    } catch (err) {
      setAddError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setAddBusy(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // OFFER — pick a time for someone on the waitlist
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const [offerEntry, setOfferEntry] = useState(null);

  function openOffer(row) {
    setOfferEntry({
      id: row.id,
      displayName: row.displayName,
      serviceId: resolveServiceId(row),
      serviceName: row.serviceName,
      hostId: resolveHostId(row),
      hostName: row.hostName,
    });
  }

  function closeOffer() {
    setOfferEntry(null);
  }

  async function onOffered() {
    setOfferEntry(null);
    await load();
    onDone?.();
  }

  // ─── REMOVE — overflow action ───
  async function removeEntry(row) {
    await request("/api/engagements/waitlist/remove", {
      method: "POST",
      body: { entryId: row.id },
    });
    await load();
    onDone?.();
  }

  function rowActions(row) {
    return [{ id: "remove", label: "Remove", destructive: true, onRun: () => removeEntry(row) }];
  }

  // ─── controls snippet ───
  const controls = displayPhase === "ready" ? (
    <NativeSelect value={preferenceFilter} onChange={(e) => setPreferenceFilter(e.target.value)} data-testid="waitlist-filter-preference">
      <NativeSelectOption value="all">Preference: All</NativeSelectOption>
      {PREFERENCES.map((p) => (
        <NativeSelectOption key={p} value={p}>
          Preference: {PREFERENCE_LABEL[p]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  ) : null;

  return (
    <>
      <LedgerPage
        title="Waitlist"
        summary={displayPhase === "ready" || displayPhase === "empty" ? summaryText : null}
        primary={{ label: "Add someone", onClick: openAdd }}
        controls={controls}
        testId="waitlist-page"
      >
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? error : null}
          reason={phase === "denied" ? error?.message ?? null : null}
          empty={emptyPropFor()}
          onClearFilters={clearFilters}
          onNavigate={go}
        >
          {displayPhase === "ready" && (
            <WaitlistScreenWaitlistPageTable
              onNavigate={go}
              go={go}
              PREFERENCE_LABEL={PREFERENCE_LABEL}
              preferenceTone={preferenceTone}
              phase={phase}
              error={error}
              summary={summary}
              prompts={prompts}
              offerMinutes={offerMinutes}
              filtered={filtered}
              displayPhase={displayPhase}
              clearFilters={clearFilters}
              emptyPropFor={emptyPropFor}
              summaryText={summaryText}
              offerWindowText={offerWindowText}
              ago={ago}
              dismissPrompt={dismissPrompt}
              openAdd={openAdd}
              openOffer={openOffer}
              rowActions={rowActions}
            />
          )}
        </ScreenState>
      </LedgerPage>

      {addOpen && (
        <WaitlistScreenWaitlistAddSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          PREFERENCES={PREFERENCES}
          PREFERENCE_LABEL={PREFERENCE_LABEL}
          error={addError}
          services={services}
          hosts={hosts}
          addBusy={addBusy}
          addError={addError}
          addMode={addMode}
          addQuery={addQuery}
          addResults={addResults}
          addSelectedPerson={addSelectedPerson}
          addName={addName}
          addEmail={addEmail}
          addPhone={addPhone}
          addServiceId={addServiceId}
          addHostId={addHostId}
          addPreference={addPreference}
          addNote={addNote}
          closeAdd={closeAdd}
          onAddQueryInput={onAddQueryInput}
          pickPerson={pickPerson}
          submitAdd={submitAdd}
          setAddMode={setAddMode}
          setAddName={setAddName}
          setAddEmail={setAddEmail}
          setAddPhone={setAddPhone}
          setAddServiceId={setAddServiceId}
          setAddHostId={setAddHostId}
          setAddPreference={setAddPreference}
          setAddNote={setAddNote}
        />
      )}

      {offerEntry && (
        <OfferTimeSheet
          entry={offerEntry}
          hosts={hosts}
          myAppUserId={myAppUserId}
          onCancel={closeOffer}
          onOffered={onOffered}
        />
      )}
    </>
  );
}
