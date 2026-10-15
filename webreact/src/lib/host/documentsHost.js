// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE HOST'S SIDE OF THE DOCUMENTS ISLAND'S PORTS (QUEUE §4, 2 Oct 2026). the platform plugs its own words into
// Documents' generic labels HERE and nowhere else: Documents only ever sees opaque strings.
//
//   program:<uuid>                          a Program (name from the one programs list)
//   type:adult|adolescent|parent|lead       a client type (word from the practice's terminology)
//
// Imported once, for its side effect, by `main.jsx`. The island's own files never import programs/* or terminology
// for this — they call `labelOptions()` / `labelsForPerson()` in `@/lib/documents/ports.js`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { request } from "@/lib/api.js";
import { plugDocumentsHost } from "@/lib/documents/ports.js";
import { loadPrograms } from "@/lib/programs/programs.js";
import { term } from "@/lib/terminology/terms.js";
import { HOST_VARIABLES, HOST_NEVER_RESOLVES } from "@keystone/ports/documentsVariables.mjs";

const TYPES = ["adult", "adolescent", "parent", "lead"];

async function labelOptions() {
  const programs = await loadPrograms();
  return [
    ...programs.map((p) => ({ key: `program:${p.id}`, label: p.name, group: "Programs" })),
    ...TYPES.map((t) => ({ key: `type:${t}`, label: term(`userType.${t}`), group: "Client types" })),
  ];
}

// The clients list already carries each person's `tags` (adult / adolescent / parent / lead); one fetch, shared.
let clientsPromise = null;
const clientRows = () => (clientsPromise ??= request("/api/list/people/clients").then((r) => r?.rows ?? []).catch(() => { clientsPromise = null; return []; }));

async function labelsForPerson(personId) {
  const out = [];
  try {
    const res = await request(`/api/people/programs?personId=${encodeURIComponent(personId)}`);
    for (const p of res?.data ?? []) out.push(`program:${p.id}`);
  } catch { /* no programs readable — type labels may still apply */ }
  const row = (await clientRows()).find((r) => r.id === personId);
  for (const t of row?.tags ?? []) if (TYPES.includes(t)) out.push(`type:${t}`);
  return out;
}

plugDocumentsHost({ labelOptions, labelsForPerson, variables: { entries: HOST_VARIABLES, neverResolves: HOST_NEVER_RESOLVES } });
