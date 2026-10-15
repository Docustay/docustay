// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.053 — PaymentLinks: rebuild from the frame on the archetype
// Ported from webui/src/lib/screens/money/PaymentLinks.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PaymentLinksPaymentLinksTable1Table from "./PaymentLinksPaymentLinksTable1Table.jsx";
import PaymentLinksPaymentLinksTable2Table from "./PaymentLinksPaymentLinksTable2Table.jsx";
import PaymentLinksPaymentLinksCreateSheet from "./PaymentLinksPaymentLinksCreateSheet.jsx";

export default function PaymentLinks({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [links, setLinks] = useState([]);
  const [error, setError] = useState(null);

  // Create sheet state
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createVariant, setCreateVariant] = useState("plain");
  const [createAmountMinor, setCreateAmountMinor] = useState("");
  const [createMinAmountMinor, setCreateMinAmountMinor] = useState("");

  async function fetchData() {
    try {
      setPhase("loading");
      setError(null);
      const res = await request("/api/money/payment-links");
      const processedLinks = (res.rows || []).map((row) => ({
        ...row,
        createdAtFormatted: new Date(row.createdAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));

      setLinks(processedLinks);

      if (processedLinks.length === 0) {
        setPhase("empty");
      } else {
        setPhase("ready");
      }
    } catch (err) {
      console.error("Error fetching payment links:", err);
      if (err.status === 403) {
        setPhase("denied");
      } else {
        setPhase("error");
      }
      setError(err);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  function formatMoney(minor) {
    if (minor === undefined || minor === null || minor === 0) return "$0";
    return `$${(minor / 100).toFixed(2)}`;
  }

  function formatMoneyLong(minor) {
    if (minor === undefined || minor === null) return "—";
    if (minor === 0) return "Free";
    return `$${(minor / 100).toFixed(2)}`;
  }

  // Handle create link submission
  async function submitCreate() {
    setCreateError(null);
    if (!createTitle.trim()) {
      setCreateError("Give it a name.");
      return;
    }

    if (createVariant === "plain" && !createAmountMinor) {
      setCreateError("Set an amount.");
      return;
    }

    setCreateBusy(true);
    try {
      await request("/api/money/payment-links", {
        method: "POST",
        body: {
          title: createTitle.trim(),
          variant: createVariant,
          amountMinor: createVariant === "plain" ? parseInt(createAmountMinor) * 100 : null,
          minAmountMinor:
            createVariant === "pick_amount"
              ? parseInt(createMinAmountMinor) * 100 || null
              : null,
        },
      });
      setCreateOpen(false);
      setCreateTitle("");
      setCreateVariant("plain");
      setCreateAmountMinor("");
      setCreateMinAmountMinor("");
      await fetchData();
    } catch (err) {
      setCreateError(err?.message ?? "Could not create payment link");
    } finally {
      setCreateBusy(false);
    }
  }

  function openCreate() {
    setCreateError(null);
    setCreateTitle("");
    setCreateVariant("plain");
    setCreateAmountMinor("");
    setCreateMinAmountMinor("");
    setCreateOpen(true);
  }

  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
  }

  // Handle deactivate action
  async function deactivateLink(row) {
    try {
      await request("/api/money/payment-links/deactivate", {
        method: "POST",
        body: { paymentLinkId: row.id },
      });
      await fetchData();
    } catch (err) {
      console.error("Error deactivating link:", err);
    }
  }

  function rowActions(row) {
    if (row.state === "inactive") return [];
    return [
      {
        id: "deactivate",
        label: "Deactivate",
        destructive: true,
        onRun: () => deactivateLink(row),
      },
    ];
  }

  function copyToClipboard(url) {
    navigator.clipboard.writeText(url).then(() => {
      // Success toast
    }).catch(() => {
      // Error toast
    });
  }

  return (
    <div data-testid="money-payment-links">
      {(phase === "loading" || phase === "denied" || phase === "error") ? (
        <ScreenState phase={phase} error={error} />
      ) : phase === "empty" ? (
        <PaymentLinksPaymentLinksTable1Table
          onNavigate={onNavigate}
          phase={phase}
          links={links}
          openCreate={openCreate}
        />
      ) : (
        <PaymentLinksPaymentLinksTable2Table
          onNavigate={onNavigate}
          links={links}
          createVariant={createVariant}
          formatMoney={formatMoney}
          formatMoneyLong={formatMoneyLong}
          openCreate={openCreate}
          rowActions={rowActions}
          copyToClipboard={copyToClipboard}
        />
      )}

      <PaymentLinksPaymentLinksCreateSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        links={links}
        error={error}
        createBusy={createBusy}
        createError={createError}
        createTitle={createTitle}
        setCreateTitle={setCreateTitle}
        createVariant={createVariant}
        setCreateVariant={setCreateVariant}
        createAmountMinor={createAmountMinor}
        setCreateAmountMinor={setCreateAmountMinor}
        createMinAmountMinor={createMinAmountMinor}
        setCreateMinAmountMinor={setCreateMinAmountMinor}
        submitCreate={submitCreate}
        closeCreate={closeCreate}
      />
    </div>
  );
}
