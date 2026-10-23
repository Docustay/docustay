// THE SHARED DOCUMENT ENGINE — AI vocabulary. Pure, no imports of the host except the tag grammar. A skin hands the model ITS OWN words: Docustay gets the text-tag
// grammar, free-form roles and the island's merge names; the platform gets its CRM merge names and the coaching rules that used to be hard-coded in ai.mjs.
// Nothing here ever carries a person's data: the model is told what KINDS of fields exist, never given values.
import { TAG_TYPES } from "../../textTags.mjs";

const COMMON = [
  "Write original plain-language prose; do not reproduce a real company's terms or a published form.",
  "Never write a real person's name, date of birth, address or any other personal detail: the document holds MERGE FIELDS and FIELD TAGS, not values.",
  "Use they/them for an unnamed person.",
  "Keep each section short; number the headings in the heading text itself (for example \"1. What this covers\") when the document is an agreement.",
];

const VOCABULARIES = Object.freeze({
  docustay: (mergeNames = [], { unset = [] } = {}) => ({
    name: "docustay",
    intro: "You write documents that people sign online with Docustay: agreements, consents, waivers, notices, onboarding forms. The document is read by the people who sign it.",
    rules: [
      ...COMMON,
      `A FIELD TAG is a blank a signer or sender fills in: { "type":"fieldTag", "attrs":{ "name": "...", "type": one of ${TAG_TYPES.join(", ")}, "role": "who fills it (any words: Tenant, Landlord, Client)", "required": "true"|"false", "label": "caption", "options": "a,b,c for dropdown/multiselect" } }. A tag needs a type.`,
      "Roles are free-form words. The FIRST role you write is the first person to sign. Every person who signs needs a signature slot in a signatureBlock (or a signature fieldTag).",
      `In a reusable template only these merge fields have a value when it is saved: ${["org.name", "org.address", "sender.name", "sender.email", "document.title"].filter((n) => !unset.includes(n)).join(", ")}. For anything else (the signer's name, any date, an address, an amount) use a fieldTag instead: text for names and addresses, number for amounts, date for a chosen date, date_signed for the date of signing.`,
      ...(unset.includes("org.address") ? ["This workspace has NO organisation address set. Never write an address for the organisation, never use the merge field org.address, and never invent one (not even an example street). Where the document needs the organisation's address, write a blank for the sender to fill in: a box the sender fills in. In the plain-text format write it as {{Organisation address;type=text;role=Sender;filled=sender;label=Organisation address}}; in the JSON format it is a fieldTag with attrs type text, role Sender, filled sender, label Organisation address. Or leave it out and ask in open_questions."] : []),
      "Prefer a signatureBlock at the end: { \"type\":\"signatureBlock\", \"attrs\":{ \"slots\":[ { \"key\":\"tenant_sig\", \"label\":\"Tenant\", \"role\":\"Tenant\" } ] } } with a heading \"Signatures\" before it.",
      mergeNames.length ? `A MERGE FIELD is { "type":"variableChip", "attrs":{ "name": "...", "label": "..." } } and its name MUST be one of: ${mergeNames.join(", ")}. custom.<lowercase_key> is also allowed for a value the sender supplies per send.` : "A MERGE FIELD is { \"type\":\"variableChip\", \"attrs\":{ \"name\": \"signer.name\", \"label\": \"Signer name\" } }; custom.<lowercase_key> is allowed for a value the sender supplies per send.",
    ],
  }),
  workbench: (mergeNames = [], { practiceKind = "a coaching practice" } = {}) => ({
    name: "workbench",
    intro: `You draft agreements and forms for ${practiceKind}. This is deliberately NOT therapy: never write clinical, diagnostic, therapeutic or medical-advice language.`,
    rules: [
      ...COMMON,
      mergeNames.length ? `A MERGE FIELD is { "type":"variableChip", "attrs":{ "name": "...", "label": "..." } } and its name MUST be one of: ${mergeNames.join(", ")}.` : "Use merge fields only where a value comes from the system.",
      "Who signs is a signatureBlock at the end: slots with a label (for example \"Client signature\") and an owner (client, parent, coach). Every agreement needs at least one signature slot.",
      "Do not use field tags; a form's blanks are merge fields or sections the signer reads.",
    ],
  }),
});

export function vocabularyFor(name, mergeNames = [], opts = {}) {
  const make = VOCABULARIES[name];
  if (!make) throw new Error(`unknown vocabulary ${JSON.stringify(name)}`);
  return make(mergeNames, opts);
}
