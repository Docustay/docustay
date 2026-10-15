// Documents' generic "used for" labels, island side. A template's `labels` is a list of opaque strings; empty = used for
// everyone. The host decides what the strings mean (ports.js); this file only compares them. NEVER used to block a send.
import { useEffect, useState } from "react";
import { labelsForPerson } from "@/lib/documents/ports.js";

/** true when the template is for everyone (no labels) or shares at least one label with the person. */
export function labelsMatch(templateLabels, personLabels) {
  const t = Array.isArray(templateLabels) ? templateLabels : [];
  if (t.length === 0) return true;
  const have = new Set(personLabels ?? []);
  return t.some((l) => have.has(l));
}

/** True when the template names labels and none of them applies to the person — the only case worth a warning. */
export const labelsMismatch = (templateLabels, personLabels) => (templateLabels?.length ?? 0) > 0 && !labelsMatch(templateLabels, personLabels);

/** `{ [personId]: string[] }` for the given people, loaded once each. A person not loaded yet is simply absent. */
export function usePersonLabels(personIds) {
  const [byId, setById] = useState({});
  const key = (personIds ?? []).filter(Boolean).join("|");
  useEffect(() => {
    let live = true;
    for (const id of (personIds ?? []).filter(Boolean)) {
      if (byId[id]) continue;
      labelsForPerson(id).then((l) => { if (live) setById((cur) => (cur[id] ? cur : { ...cur, [id]: l })); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return byId;
}
