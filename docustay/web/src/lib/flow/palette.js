// The Prepare palette, one list for a written document and an uploaded file. Every id is a field the placement code can draw; the "smart" ones are text fields that fill themselves from the person they belong to
// (Name, Email) or are simply labelled (Company, Title). The plain Email tile is gone: Email here is the person's own address, and "Signer can change it" turns it back into a box they type in.
export const SMART = Object.freeze({
  smart_name: { type: "text", label: "Name", autofill: "name", icon: "user" },
  smart_email: { tag: "email", type: "text", label: "Email", autofill: "email", validation: "email", icon: "at-sign" },
  company: { type: "text", label: "Company", icon: "building" },
  title: { type: "text", label: "Title", icon: "briefcase" },
});
/** the marks a person draws or stamps rather than types: no placeholder, tooltip or format applies to them */
const MARKS = new Set(["signature", "initials", "date_signed", "stamp"]);
export const isMark = (type) => MARKS.has(type);
export const PALETTE = Object.freeze([
  { id: "sign", ids: ["signature", "initials", "date_signed", "stamp"] },
  { id: "fill", ids: ["smart_name", "smart_email", "company", "title", "text", "number", "date", "phone", "zip"] },
  { id: "choose", ids: ["checkbox", "dropdown", "select", "multiselect"] },
  { id: "more", ids: ["image", "file", "payment"] },
]);
/** merge text a written document can carry (it is filled when each person's own copy is made) */
export const MERGE = Object.freeze([
  { name: "signer.name", label: "Signer name" }, { name: "signer.email", label: "Signer email" }, { name: "sender.name", label: "Sender name" },
]);
/** the engine type and extra attributes a tile stands for */
export const specOf = (id) => (SMART[id] ? { tag: SMART[id].tag ?? SMART[id].type, type: SMART[id].type, label: SMART[id].label, autofill: SMART[id].autofill, validation: SMART[id].validation } : { tag: id, type: id });
