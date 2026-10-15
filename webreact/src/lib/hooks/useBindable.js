// Svelte's `$bindable` prop in React: `value` + `onChange`. Controlled when the parent passes onChange;
// otherwise the component keeps its own copy (initialised from `value`, re-synced when `value` changes).
import { useEffect, useState } from "react";

export function useBindable(value, onChange, fallback) {
  const [own, setOwn] = useState(value ?? fallback);
  useEffect(() => { if (value !== undefined) setOwn(value); }, [value]);
  const controlled = typeof onChange === "function";
  return [controlled ? (value ?? fallback) : own, (v) => { if (controlled) onChange(v); else setOwn(v); }];
}
