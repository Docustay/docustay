import { useState, useEffect, useContext } from "react";
import { AppStateContext } from "@/lib/app/useAppState.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { toast } from "sonner";
import GiftCardsPageItemsGiftCardsTable from "./GiftCardsPageItemsGiftCardsTable.jsx";
import GiftCardsPageItemsGiftCardsIssueSheet from "./GiftCardsPageItemsGiftCardsIssueSheet.jsx";
import GiftCardsPageItemsGiftCardsVoidModal from "./GiftCardsPageItemsGiftCardsVoidModal.jsx";

const SUMMARY_URL = "/api/items/gift-cards/summary";
const LIST_URL = "/api/list/items/gift-cards";
const ISSUE_URL = "/api/items/gift-cards";
const VOID_URL = "/api/items/gift-cards/void";
const RESEND_URL = "/api/items/gift-cards/resend";
const NUDGE_URL = "/api/items/gift-cards/nudge";
const MONEY_SETTINGS_URL = "/api/settings/money";
const SETTINGS_URL = "/api/settings";

const ISSUE_ACTION_HREF = "/items/gift-cards?new=1";
const ENABLE_HREF = "#enable-gift-cards";

export default function GiftCardsPage({ onNavigate = null }) {
  // Main state
  const [phase, setPhase] = useState("loading");
  const [errorObj, setErrorObj] = useState(null);
  const [deniedReason, setDeniedReason] = useState(null);

  // Summary and data
  const [summary, setSummary] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [emptyState, setEmptyState] = useState(null);

  // Issue sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState(null);
  const [issuedResult, setIssuedResult] = useState(null);

  // Void modal state
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState(null);

  // Enable gift cards state
  const [enabling, setEnabling] = useState(false);

  // Formatting helper
  function formatMoney(minor, cur) {
    if (minor == null || !cur) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  }

  function formatBought(iso) {
    if (!iso) return "—";
    return `Bought ${new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
    }).format(new Date(iso))}`;
  }

  // Data fetching
  async function fetchAll() {
    setPhase("loading");
    setErrorObj(null);
    setDeniedReason(null);
    try {
      const [summaryRes, moneyRes] = await Promise.all([
        request(SUMMARY_URL),
        request(MONEY_SETTINGS_URL).catch(() => null),
      ]);
      // ★ the summary route answers { data: { enabled, … } }; this read `summaryRes.enabled` — always undefined — so the page said "Turn on gift cards" for
      //   a practice that HAD turned them on, and could never show a gift card (found in the §13 sandbox test)
      const summaryData = summaryRes?.data ?? summaryRes;
      setSummary(summaryData);
      setCurrency(moneyRes?.fields?.find((f) => f.key === "money.currency")?.value ?? null);

      if (summaryData?.enabled !== true) {
        setRows([]);
        setColumns([]);
        setEmptyState(null);
        setPhase("ready");
        return;
      }

      const listRes = await request(LIST_URL);
      setRows(listRes?.rows ?? []);
      setColumns(listRes?.columns ?? []);
      setEmptyState(listRes?.emptyState ?? null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setDeniedReason(err.message || null);
      } else {
        setPhase("error");
        setErrorObj(err);
      }
    }
  }

  // Fetch on mount
  useEffect(() => {
    fetchAll();
  }, []);

  // Shared bulk selection + Delete (Owner/Admin); rows are the gift cards on screen
  const bulkApp = useContext(AppStateContext);
  const bulk = useListBulk({ app: bulkApp, path: "/items/gift-cards", rank: bulkApp?.nav?.rank ?? null, rows, onChanged: fetchAll });

  // Derived state
  const hasMoneyColumns = columns.some((c) => c.field === "issued_minor");
  const hasSyncColumn = columns.some((c) => c.field === "sync_state");

  const summaryLine = (() => {
    if (!summary) return null;
    if (summary.enabled !== true) {
      return "Sell a fixed amount once; whoever holds it spends it later against anything you invoice.";
    }
    return (
      `${formatMoney(summary.sold_year_minor, currency)} sold, ` +
      `${formatMoney(summary.unspent_minor, currency)} still unspent. ` +
      `That's money you already have.`
    );
  })();

  // State tone helper
  function stateTone(state) {
    switch (state) {
      case "Never opened":
        return "warn";
      case "Half used":
        return "ok";
      case "Unused":
        return "act";
      case "Used up":
        return "neutral";
      case "Voided":
        return "bad";
      default:
        return "neutral";
    }
  }

  // Row actions
  function rowActions(row) {
    const actions = [
      { id: "resend", label: "Resend", onRun: () => doResend(row) },
      { id: "nudge", label: "Nudge", onRun: () => doNudge(row) },
    ];
    if (row.state !== "Voided" && row.state !== "Used up") {
      actions.push({
        id: "void",
        label: "Void",
        destructive: true,
        onRun: () => openVoidModal(row),
      });
    }
    return actions;
  }

  // Resend action
  async function doResend(row) {
    await request(RESEND_URL, { method: "POST", body: { id: row.id } });
    toast.success(`A new code was emailed for ${row.number}`);
    await fetchAll();
  }

  // Nudge action
  async function doNudge(row) {
    await request(NUDGE_URL, { method: "POST", body: { id: row.id } });
    toast.success(`Nudged ${row.holder}`);
    await fetchAll();
  }

  // Void modal handlers
  function openVoidModal(row) {
    setVoidTarget(row);
    setVoidError(null);
    setVoidModalOpen(true);
  }

  function closeVoidModal() {
    if (voidBusy) return;
    setVoidModalOpen(false);
    setVoidTarget(null);
    setVoidError(null);
  }

  async function confirmVoid() {
    if (voidBusy || !voidTarget) return;
    setVoidBusy(true);
    setVoidError(null);
    try {
      await request(VOID_URL, { method: "POST", body: { id: voidTarget.id } });
      toast.success(`${voidTarget.number} voided`);
      setVoidModalOpen(false);
      setVoidTarget(null);
      await fetchAll();
    } catch (err) {
      setVoidError(
        err instanceof ApiError
          ? err.requestId
            ? `${err.message} (Reference: ${err.requestId})`
            : err.message
          : String(err?.message ?? err)
      );
    } finally {
      setVoidBusy(false);
    }
  }

  // Issue sheet handlers
  function openIssueSheet() {
    setAmountInput("");
    setHolderEmail("");
    setIssueError(null);
    setIssuedResult(null);
    setSheetOpen(true);
  }

  function closeIssueSheet() {
    if (issueBusy) return;
    setSheetOpen(false);
    setAmountInput("");
    setHolderEmail("");
    setIssueError(null);
    setIssuedResult(null);
  }

  async function submitIssue(e) {
    e?.preventDefault?.();
    if (issueBusy) return;
    const dollars = Number(amountInput);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setIssueError("Enter an amount greater than zero.");
      return;
    }
    if (!currency) {
      setIssueError("Set your practice's currency in Money settings first.");
      return;
    }
    const trimmedEmail = holderEmail.trim();
    if (trimmedEmail && !trimmedEmail.includes("@")) {
      setIssueError("Enter a valid email, or leave it blank.");
      return;
    }
    const amountMinor = Math.round(dollars * 100);
    setIssueBusy(true);
    setIssueError(null);
    try {
      const res = await request(ISSUE_URL, {
        method: "POST",
        body: { amountMinor, currency, holderEmail: trimmedEmail || null },
      });
      setIssuedResult({ number: res.number, secret: res.secret, amountMinor });
      await fetchAll();
    } catch (err) {
      setIssueError(
        err instanceof ApiError
          ? err.requestId
            ? `${err.message} (Reference: ${err.requestId})`
            : err.message
          : String(err?.message ?? err)
      );
    } finally {
      setIssueBusy(false);
    }
  }

  async function copySecret() {
    if (!issuedResult?.secret) return;
    try {
      await navigator.clipboard.writeText(issuedResult.secret);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy — select and copy it by hand.");
    }
  }

  // Enable gift cards
  async function turnOnGiftCards() {
    if (enabling) return;
    setEnabling(true);
    try {
      await request(SETTINGS_URL, {
        method: "POST",
        body: { key: "giftcards.enabled", value: true },
      });
      toast.success("Gift cards turned on");
      await fetchAll();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setEnabling(false);
    }
  }

  function handleEmptyNavigate(href) {
    if (href === ISSUE_ACTION_HREF) {
      openIssueSheet();
      return;
    }
    if (href === ENABLE_HREF) {
      turnOnGiftCards();
      return;
    }
    onNavigate?.(href);
  }

  return (
    <ScreenState
      phase={phase}
      error={errorObj}
      reason={deniedReason}
      onNavigate={onNavigate}
      onRetry={fetchAll}
      testIds={{
        error: "items-gift-cards-error",
        denied: "items-gift-cards-denied",
        loading: "items-gift-cards-loading",
      }}
    >
      {bulk.bulkBar}
      <GiftCardsPageItemsGiftCardsTable
        bulk={bulk}
        onNavigate={onNavigate}
        ENABLE_HREF={ENABLE_HREF}
        summary={summary}
        currency={currency}
        rows={rows}
        emptyState={emptyState}
        formatMoney={formatMoney}
        formatBought={formatBought}
        hasMoneyColumns={hasMoneyColumns}
        hasSyncColumn={hasSyncColumn}
        summaryLine={summaryLine}
        stateTone={stateTone}
        rowActions={rowActions}
        openIssueSheet={openIssueSheet}
        enabling={enabling}
        handleEmptyNavigate={handleEmptyNavigate}
      />

      <GiftCardsPageItemsGiftCardsIssueSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        currency={currency}
        formatMoney={formatMoney}
        amountInput={amountInput}
        holderEmail={holderEmail}
        issueBusy={issueBusy}
        issueError={issueError}
        issuedResult={issuedResult}
        closeIssueSheet={closeIssueSheet}
        submitIssue={submitIssue}
        copySecret={copySecret}
      />

      {voidModalOpen && voidTarget && (
        <GiftCardsPageItemsGiftCardsVoidModal
          open={voidModalOpen}
          onOpenChange={setVoidModalOpen}
          rows={rows}
          formatMoney={formatMoney}
          hasMoneyColumns={hasMoneyColumns}
          voidTarget={voidTarget}
          voidBusy={voidBusy}
          voidError={voidError}
          closeVoidModal={closeVoidModal}
          confirmVoid={confirmVoid}
        />
      )}
    </ScreenState>
  );
}
