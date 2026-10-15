import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ReportsHomeReportsHomeTable from "./ReportsHomeReportsHomeTable.jsx";

const CARD_DEFS = [
  {
    name: "money",
    title: "Money",
    question: "What you took, where it came from, what it cost you, and what's still owed.",
    href: "/reports/money",
  },
  {
    name: "people",
    title: "People",
    question: "Who joined, who stopped, how long they stay, and where they came from.",
    href: "/reports/people",
  },
  {
    name: "sessions",
    title: "Sessions",
    question: "How full your week is, when people book, and what no-shows cost you.",
    href: "/reports/sessions",
  },
  {
    name: "found",
    title: "How people find you",
    question: "Rankings, reviews, what your presence produced.",
    href: "/reports/found",
  },
  {
    name: `coaches`,
    title: `Coaches`,
    question: "Who's busy, who has room, and what each one earned.",
    href: `/reports/coaches`,
  },
];

export default function ReportsHome({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [hub, setHub] = useState(null);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const data = await api.reportsHub();
      setHub(data);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err : (err?.message ?? String(err)));
      setPhase("error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Match by name, never by array position
  const availableByName = new Map((hub?.cards ?? []).map((c) => [c.name, c.available === true]));
  const cards = CARD_DEFS.filter((c) => availableByName.get(c.name) === true);
  const notEnoughYet = hub ? hub.enough_data === false : false;

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function onOffLabel(value) {
    return value ? "On" : "Off";
  }

  return (
    <ReportsHomeReportsHomeTable
      onNavigate={onNavigate}
      phase={phase}
      error={error}
      hub={hub}
      load={load}
      cards={cards}
      notEnoughYet={notEnoughYet}
      go={go}
      onOffLabel={onOffLabel}
    />
  );
}
