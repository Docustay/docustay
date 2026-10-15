// People and send choices for a draft, as plain data (no imports but one pure helper): shared by the chat tool and the developer draft API.
import { slugWord } from "../engine/rolesOfSource.mjs";
export const ACTIONS = ["signer", "approver", "viewer", "cc"];
/** A play's defaults, as the send choices the draft API takes. */
export const playChoice = (d = {}) => ({ ...(d.expiry_days != null ? { expiryDays: d.expiry_days } : {}), ...(d.order ? { signingOrder: d.order === "sequential" ? "sequential" : "any" } : {}), ...(d.email_subject ? { subject: d.email_subject } : {}), ...(d.email_message ? { message: d.email_message } : {}) });
const fakeEmail = (name, n) => `${slugWord(name)}${n ? `.${n}` : ""}.test@example.test`;

/** people in → people out, ready for the document API. In a test document a missing address gets a clearly fake one; otherwise a missing address is refused by name. */
export function readPeople(raw, { test }) {
  const list = Array.isArray(raw) ? raw : []; const errors = [];
  const people = list.slice(0, 30).map((p, i) => {
    const name = String(p?.name ?? "").trim(); if (!name) { errors.push(`person ${i + 1} has no name`); return null; }
    let email = String(p?.email ?? "").trim().toLowerCase();
    if (!email) { if (test) email = fakeEmail(name, i + 1); else { errors.push(`${name} has no email address; ask for it`); return null; } }
    return { name, email, ...(p.role ? { role: String(p.role).trim() } : {}), action: ACTIONS.includes(p.action) ? p.action : "signer", ...(Number.isInteger(p.order) ? { order: p.order } : {}) };
  }).filter(Boolean);
  return { people, errors };
}

