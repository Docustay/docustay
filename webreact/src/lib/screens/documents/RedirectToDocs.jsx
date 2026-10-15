// Redirect — the maintainer, 29 Sep 2026 (documents island ruling): "redirect every old address." A tiny,
// generic stand-in for a route that moved: it renders nothing and calls onNavigate to the new
// address on mount, so a stale bookmark or an old link lands on the real screen instead of a 404
// or a dead sidebar-less page.
import { useEffect } from "react";

export default function Redirect({ to, onNavigate = null }) {
  useEffect(() => {
    onNavigate?.(to);
  }, [to, onNavigate]);
  return null;
}
