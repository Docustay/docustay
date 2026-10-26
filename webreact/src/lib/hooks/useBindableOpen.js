// Svelte's `bind:open` in React: controlled when the parent passes onOpenChange, otherwise the component
// keeps its own copy (initialised from `open`, re-synced when `open` changes) so Cancel/Escape still close it.
import { useEffect, useState } from "react";

export function useBindableOpen(open, onOpenChange) {
  const [own, setOwn] = useState(!!open);
  useEffect(() => { setOwn(!!open); }, [open]);
  const controlled = typeof onOpenChange === "function";
  return [controlled ? !!open : own, (v) => { if (controlled) onOpenChange(v); else setOwn(v); }];
}
