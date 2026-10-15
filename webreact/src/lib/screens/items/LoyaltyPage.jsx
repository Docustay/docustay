import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { formatValue } from "@/lib/format.js";
import { toast } from "sonner";
import LoyaltyPageItemsLoyaltyTable from "./LoyaltyPageItemsLoyaltyTable.jsx";
import LoyaltyPageLoyaltyRewardSheet from "./LoyaltyPageLoyaltyRewardSheet.jsx";

export default function LoyaltyPage({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Loading and error state
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [loyalty, setLoyalty] = useState(null);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Idempotency keys for retries
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [actionKeys, setActionKeys] = useState({});
  const keyFor = useCallback((id) => {
    const key = actionKeys[id];
    if (key) return key;
    const newKey = newIdempotencyKey();
    setActionKeys((prev) => ({ ...prev, [id]: newKey }));
    return newKey;
  }, [actionKeys]);
  const clearKey = useCallback((id) => {
    setActionKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Utility functions
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const NUMBER_WORDS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  ];
  const numberWord = useCallback((n, { capitalize = false } = {}) => {
    const word = Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
    return capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }, []);

  const numberFigure = useCallback((v) => {
    return v === null || v === undefined ? undefined : formatValue(v, "number");
  }, []);

  const deltaText = useCallback((n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return "No change this month";
    return v > 0 ? `▲ ${v} this month` : `▼ ${Math.abs(v)} this month`;
  }, []);

  function normalizeError(err) {
    return err instanceof ApiError
      ? { message: err.message, requestId: err.requestId }
      : { message: String(err?.message ?? err) };
  }

  function go(href) {
    if (onNavigate) onNavigate(href);
    else if (typeof window !== "undefined") window.location.assign(href);
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Load data
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const r = await request("/api/items/loyalty");
      setLoyalty(r?.data ?? null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(normalizeError(err));
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Derived state
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const enabled = loyalty?.enabled === true;
  const figures = loyalty?.figures ?? null;
  const rules = loyalty?.rules ?? [];
  const rewards = loyalty?.rewards ?? [];
  const claimable = loyalty?.claimable ?? [];
  const nothingYet = enabled && figures && Number(figures.collecting) === 0;
  const showDashboard = enabled && figures && Number(figures.collecting) > 0;

  const summaryText = (() => {
    if (!showDashboard) return null;
    const collecting = figures.collecting;
    const canClaim = figures.can_claim;
    const collectingPart = `${collecting} client${collecting === 1 ? "" : "s"} collecting.`;
    const claimPart = canClaim === 0
      ? "Nobody has enough to claim something yet."
      : `${numberWord(canClaim, { capitalize: true })} ${canClaim === 1 ? "has" : "have"} enough for a free session.`;
    return `${collectingPart} ${claimPart}`;
  })();

  const canClaimSub = figures && Number(figures.can_claim) > 0 ? "Tell them — they probably don't know" : "";

  const RULE_LABEL = {
    per_dollar: { headline: "A point for every dollar", helper: "On anything actually paid, not invoiced." },
    per_visit: { headline: "Ten points a visit", helper: "Whether they paid that day or used a package session." },
    per_referral: {
      headline: "Fifty for a referral",
      helper: "When someone they sent books their first session.",
    },
  };
  const RULE_SEED_POINTS = { per_dollar: 1, per_visit: 10, per_referral: 50 };

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Rules toggle
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [ruleBusy, setRuleBusy] = useState({});
  const [ruleErrors, setRuleErrors] = useState({});

  const toggleRule = useCallback(async (row) => {
    if (ruleBusy[row.kind]) return;
    setRuleBusy((prev) => ({ ...prev, [row.kind]: true }));
    setRuleErrors((prev) => ({ ...prev, [row.kind]: null }));
    const nextActive = !row.active;
    const points = row.points ?? RULE_SEED_POINTS[row.kind];
    try {
      await request("/api/items/loyalty/rules", {
        method: "POST",
        body: { kind: row.kind, points, active: nextActive },
        idempotencyKey: keyFor(`rule:${row.kind}`),
      });
      clearKey(`rule:${row.kind}`);
      await load();
      onRefetch?.();
    } catch (err) {
      setRuleErrors((prev) => ({ ...prev, [row.kind]: normalizeError(err) }));
    } finally {
      setRuleBusy((prev) => ({ ...prev, [row.kind]: false }));
    }
  }, [ruleBusy, keyFor, clearKey, load, onRefetch]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Reward sheet
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [rewardSheetOpen, setRewardSheetOpen] = useState(false);
  const [rewardName, setRewardName] = useState("");
  const [rewardPointsInput, setRewardPointsInput] = useState("");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardError, setRewardError] = useState(null);

  const openRewardSheet = useCallback(() => {
    setRewardName("");
    setRewardPointsInput("");
    setRewardError(null);
    setRewardSheetOpen(true);
  }, []);

  const closeRewardSheet = useCallback(() => {
    if (rewardBusy) return;
    setRewardSheetOpen(false);
  }, [rewardBusy]);

  const submitRewardSheet = useCallback(async (e) => {
    e?.preventDefault?.();
    if (rewardBusy) return;
    if (!rewardName.trim()) {
      setRewardError({ message: "A reward needs a name." });
      return;
    }
    const pointsCost = parseInt(rewardPointsInput, 10);
    if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
      setRewardError({ message: "The cost needs to be a positive whole number of points." });
      return;
    }
    setRewardBusy(true);
    setRewardError(null);
    try {
      await request("/api/items/loyalty/rewards", {
        method: "POST",
        body: { name: rewardName.trim(), pointsCost },
        idempotencyKey: keyFor("reward-create"),
      });
      clearKey("reward-create");
      toast.success(`${rewardName.trim()} added`);
      setRewardSheetOpen(false);
      await load();
      onRefetch?.();
    } catch (err) {
      setRewardError(normalizeError(err));
    } finally {
      setRewardBusy(false);
    }
  }, [rewardBusy, rewardName, rewardPointsInput, keyFor, clearKey, load, onRefetch]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Tell person
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [tellBusy, setTellBusy] = useState({});
  const [tellErrors, setTellErrors] = useState({});

  const tellPersonRow = useCallback(async (person) => {
    if (tellBusy[person.app_user_id]) return;
    setTellBusy((prev) => ({ ...prev, [person.app_user_id]: true }));
    setTellErrors((prev) => ({ ...prev, [person.app_user_id]: null }));
    try {
      await request("/api/items/loyalty/tell", {
        method: "POST",
        body: { appUserId: person.app_user_id },
        idempotencyKey: keyFor(`tell:${person.app_user_id}`),
      });
      clearKey(`tell:${person.app_user_id}`);
      toast.success(`${person.display_name} told`);
    } catch (err) {
      setTellErrors((prev) => ({ ...prev, [person.app_user_id]: normalizeError(err) }));
    } finally {
      setTellBusy((prev) => ({ ...prev, [person.app_user_id]: false }));
    }
  }, [tellBusy, keyFor, clearKey]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Tell all and prompt
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [tellAllBusy, setTellAllBusy] = useState(false);

  const promptHeadline = claimable.length === 1
    ? "One person is sitting on a free session"
    : `${numberWord(claimable.length, { capitalize: true })} people are sitting on a free session`;

  const promptWhy = claimable.length === 1
    ? "They haven't been told. A free session claimed is a session booked."
    : "None of them has been told. A free session claimed is a session booked.";

  const handleTellAll = useCallback(async () => {
    if (tellAllBusy) return;
    setTellAllBusy(true);
    try {
      const r = await request("/api/items/loyalty/tell-all", {
        method: "POST",
        body: {},
        idempotencyKey: keyFor("tell-all"),
      });
      clearKey("tell-all");
      const told = r?.told?.length ?? 0;
      const skipped = r?.skipped?.length ?? 0;
      toast.success(
        skipped > 0
          ? `Told ${told} of ${told + skipped} — ${skipped} told recently, skipped.`
          : `Told ${told}.`
      );
      await load();
      onRefetch?.();
    } catch (err) {
      toast.error(normalizeError(err).message);
    } finally {
      setTellAllBusy(false);
    }
  }, [tellAllBusy, keyFor, clearKey, load, onRefetch]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Enable loyalty
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState(null);

  const handleEnable = useCallback(async () => {
    if (enabling) return;
    setEnabling(true);
    setEnableError(null);
    try {
      await request("/api/settings", {
        method: "POST",
        body: { key: "loyalty.enabled", value: true },
        idempotencyKey: keyFor("enable"),
      });
      clearKey("enable");
      await load();
      onRefetch?.();
    } catch (err) {
      setEnableError(normalizeError(err));
    } finally {
      setEnabling(false);
    }
  }, [enabling, keyFor, clearKey, load, onRefetch]);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Scroll to rules
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const scrollToRules = useCallback(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("loyalty-rules-block");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <LoyaltyPageItemsLoyaltyTable
        onNavigate={onNavigate}
        go={go}
        numberWord={numberWord}
        phase={phase}
        error={error}
        loyalty={loyalty}
        enabled={enabled}
        figures={figures}
        rules={rules}
        rewards={rewards}
        claimable={claimable}
        nothingYet={nothingYet}
        showDashboard={showDashboard}
        summaryText={summaryText}
        numberFigure={numberFigure}
        deltaText={deltaText}
        canClaimSub={canClaimSub}
        scrollToRules={scrollToRules}
        RULE_LABEL={RULE_LABEL}
        ruleBusy={ruleBusy}
        ruleErrors={ruleErrors}
        toggleRule={toggleRule}
        openRewardSheet={openRewardSheet}
        tellBusy={tellBusy}
        tellErrors={tellErrors}
        tellPersonRow={tellPersonRow}
        promptDismissed={promptDismissed}
        onPromptDismiss={() => setPromptDismissed(true)}
        tellAllBusy={tellAllBusy}
        promptHeadline={promptHeadline}
        promptWhy={promptWhy}
        handleTellAll={handleTellAll}
        enabling={enabling}
        enableError={enableError}
        handleEnable={handleEnable}
      />
      {rewardSheetOpen && (
        <LoyaltyPageLoyaltyRewardSheet
          open={rewardSheetOpen}
          onOpenChange={setRewardSheetOpen}
          error={error}
          loyalty={loyalty}
          rewardName={rewardName}
          rewardPointsInput={rewardPointsInput}
          rewardBusy={rewardBusy}
          rewardError={rewardError}
          closeRewardSheet={closeRewardSheet}
          submitRewardSheet={submitRewardSheet}
          onNameChange={setRewardName}
          onPointsChange={setRewardPointsInput}
        />
      )}
    </>
  );
}
