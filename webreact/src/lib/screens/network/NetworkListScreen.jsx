// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.018 — NetworkListScreen — who you refer to and from
// Ported from webui/src/lib/screens/network/NetworkListScreen.svelte: same props (data, onNavigate, onDone),
// testids, copy. Built on SideSheet archetype for the sheet. Composes R4.018.T1 (table) and
// R4.018.M1 (sheet).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useContext } from "react";
import { toast } from "sonner";
import { AppStateContext } from "@/lib/app/useAppState.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { savedToast } from "@/lib/hooks/savedToast.js";
import { request } from "@/lib/api.js";
import { api, ApiError } from "@/lib/api.js";
import NetworkListScreenNetworkList from "./NetworkListScreenNetworkList.jsx";
import NetworkListScreenNetworkAddSheet from "./NetworkListScreenNetworkAddSheet.jsx";
import NetworkReferOut from "./NetworkReferOut.jsx";

const NUMBER_WORDS = [null, "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function numberWord(n) {
  return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
}

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
}

const STATE_LABEL = { both_ways: "Both ways", they_send: "They send", you_send: "You send only" };
const STATE_TONE = { both_ways: "ok", they_send: "ok", you_send: "warn" };

function stateLabel(s) {
  return STATE_LABEL[s] ?? "No referrals yet";
}

function stateTone(s) {
  return STATE_TONE[s] ?? "neutral";
}

const OUTCOME_LABEL = {
  sent: "Sent",
  taken: "Taken",
  in_progress: "In progress",
  became_client: "Now a client",
  declined: "Declined",
  no_reply: "No reply",
};
const OUTCOME_TONE = {
  sent: "act",
  taken: "ok",
  in_progress: "act",
  became_client: "ok",
  declined: "bad",
  no_reply: "warn",
};

function referralLine(r) {
  const who = r.person?.name ?? "someone";
  return r.direction === "in" ? `${r.practice} → ${who}` : `${who} → ${r.practice}`;
}

export default function NetworkListScreen({ data = null, onNavigate = null, onDone = null }) {
  const rows = data?.rows ?? [];
  const emptyState = data?.emptyState ?? null;
  const summaryData = data?.summary ?? null;
  const phase = rows.length === 0 ? "empty" : "ready";
  const appState = useContext(AppStateContext);
  const bulk = useListBulk({ app: appState, path: "/network", rank: appState?.nav?.rank ?? null, rows, onChanged: onDone });

  const summaryLine = summaryData
    ? `${numberWord(summaryData.parties)} ${summaryData.parties === 1 ? "practice" : "practices"}. They've sent you ${summaryData.sent_this_year} ${summaryData.sent_this_year === 1 ? "person" : "people"} this year.`
    : null;

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [whatTheyDo, setWhatTheyDo] = useState("");
  const [email, setEmail] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactCreateName, setContactCreateName] = useState("");
  const [contactCreateBusy, setContactCreateBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Recently referred & prompts
  const [recentReferrals, setRecentReferrals] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [peopleOptions, setPeopleOptions] = useState([]);

  // Referral modal
  const [referTarget, setReferTarget] = useState(null);

  // Row actions tracking
  const [archiveBusyId, setArchiveBusyId] = useState(null);

  // Fetch recently referred
  useEffect(() => {
    let live = true;
    request("/api/list/network/referrals")
      .then((r) => {
        if (live) setRecentReferrals((r?.rows ?? []).slice(0, 5));
      })
      .catch(() => {
        if (live) setRecentReferrals([]);
      });
    return () => {
      live = false;
    };
  }, []);

  // Fetch prompts
  useEffect(() => {
    let live = true;
    api
      .prompts("network")
      .then((r) => {
        if (live) setPrompts(r?.prompts ?? []);
      })
      .catch(() => {
        if (live) setPrompts([]);
      });
    return () => {
      live = false;
    };
  }, []);

  // Fetch people options
  useEffect(() => {
    let live = true;
    request("/api/list/people/all")
      .then((r) => {
        if (!live) return;
        setPeopleOptions((r?.rows ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
      })
      .catch(() => {
        if (live) setPeopleOptions([]);
      });
    return () => {
      live = false;
    };
  }, []);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function openSheet() {
    setName("");
    setWhatTheyDo("");
    setEmail("");
    setContactId("");
    setContactCreateName("");
    setError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (busy) return;
    setSheetOpen(false);
  }

  async function createContactInline() {
    const displayName = contactCreateName.trim();
    if (!displayName || contactCreateBusy) return;
    setContactCreateBusy(true);
    setError(null);
    try {
      const created = await api.createPerson({ displayName, role: "parent", invite: false });
      setPeopleOptions([{ value: created.id, label: displayName }, ...peopleOptions]);
      setContactId(created.id);
      setContactCreateName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setContactCreateBusy(false);
    }
  }

  async function submitSheet(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createNetworkParty({
        name: name.trim(),
        kind: "referral_partner",
        whatTheyDo: whatTheyDo.trim() || undefined,
        email: email.trim() || undefined,
        primaryContactId: contactId || undefined,
      });
      setSheetOpen(false);
      onDone?.();
      savedToast(`${name.trim()} added`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function openRecord(row) {
    go(`/network/${row.id}`);
  }

  function messageRow(row) {
    throw new Error("No email on file for this practice on this list — open the record to message them.");
  }

  function referRow(row) {
    setReferTarget({ id: row.id, name: row.name });
  }

  async function archiveRow(row) {
    setArchiveBusyId(row.id);
    try {
      await api.archiveRecord({ object: "network_party", id: row.id });
      onDone?.();
      toast.success(`${row.name} archived`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setArchiveBusyId(null);
    }
  }

  function getRowActions(row) {
    return [
      { id: "open", label: "Open", onRun: () => openRecord(row) },
      { id: "message", label: "Message", onRun: () => messageRow(row) },
      { id: "refer", label: "Refer someone", onRun: () => referRow(row) },
      { id: "archive", label: "Archive", destructive: true, onRun: () => archiveRow(row) },
    ];
  }

  async function dismissPromptNow(p) {
    try {
      await api.dismissPrompt(p.kind, p.subjectId ?? null);
      setPrompts(prompts.filter((x) => x.dismissKey !== p.dismissKey));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  }

  return (
    <>
      <NetworkListScreenNetworkList
        data={data}
        onNavigate={onNavigate}
        go={go}
        rows={rows}
        emptyState={emptyState}
        phase={phase}
        summaryLine={summaryLine}
        initials={initials}
        stateLabel={stateLabel}
        stateTone={stateTone}
        OUTCOME_LABEL={OUTCOME_LABEL}
        OUTCOME_TONE={OUTCOME_TONE}
        recentReferrals={recentReferrals}
        referralLine={referralLine}
        prompts={prompts}
        dismissPromptNow={dismissPromptNow}
        openSheet={openSheet}
        openRecord={openRecord}
        rowActions={getRowActions}
        bulk={bulk}
      />

      <NetworkListScreenNetworkAddSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        data={data}
        name={name}
        whatTheyDo={whatTheyDo}
        email={email}
        contactId={contactId}
        contactCreateName={contactCreateName}
        contactCreateBusy={contactCreateBusy}
        busy={busy}
        error={error}
        peopleOptions={peopleOptions}
        onNameChange={setName}
        onWhatTheyDoChange={setWhatTheyDo}
        onEmailChange={setEmail}
        onContactIdChange={setContactId}
        onContactCreateNameChange={setContactCreateName}
        closeSheet={closeSheet}
        createContactInline={createContactInline}
        submitSheet={submitSheet}
      />

      {referTarget && (
        <NetworkReferOut
          open={true}
          partyId={referTarget.id}
          partyName={referTarget.name}
          onCancel={() => {
            setReferTarget(null);
          }}
          onDone={() => {
            setReferTarget(null);
            onDone?.();
          }}
        />
      )}
    </>
  );
}
