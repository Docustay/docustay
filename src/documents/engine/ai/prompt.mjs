// THE SHARED DOCUMENT ENGINE — prompts. Pure. Generated from the vocabulary and the closed source format, never hand-retyped per product.
const FORMAT = [
  'The document is a JSON object { "type":"doc", "content":[ block, ... ] }. Blocks:',
  '- { "type":"heading", "attrs":{ "level":2 }, "content":[ { "type":"text","text":"..." } ] }   (plain text only)',
  '- { "type":"paragraph", "content":[ inline, ... ] }',
  '- { "type":"bulletList" | "orderedList", "content":[ { "type":"listItem", "content":[ { "type":"paragraph","content":[inline,...] } ] } ] }   (one paragraph per item, no nesting)',
  '- { "type":"horizontalRule" } | { "type":"pageBreak" }',
  '- { "type":"signatureBlock", "attrs":{ "slots":[ { "key":"lowercase_key","label":"...","role":"...","required":true } ] } }',
  'Inline: { "type":"text","text":"...","marks":[ {"type":"bold"} | {"type":"italic"} | {"type":"underline"} ] } | { "type":"hardBreak" } | variableChip | fieldTag (see the rules).',
  "Never put text in a node that does not take text. Never invent other node types.",
].join("\n");

export function draftSystem(vocab) {
  return [
    vocab.intro,
    "Reply with ONLY one JSON object and nothing outside it: { \"title\": \"short name\", \"source\": <the document>, \"notes\": [ \"things the person must check or fill in\" ] }.",
    FORMAT,
    "Rules:", ...vocab.rules.map((r) => `- ${r}`),
    "A person will read and edit this before anything is sent; say in notes anything you were unsure of. Never put [[FILL IN]] markers in the text.",
  ].join("\n");
}

export function editSystem(vocab, { withVariables = false } = {}) {
  return [
    vocab.intro,
    "You change an existing document by listing PATCHES, never by rewriting it. Reply with ONLY one JSON object: { \"message\": \"one sentence on what you changed\", \"patches\": [ patch, ... ]" + (withVariables ? ", \"values\": { \"question_key\": \"answer\" }" : "") + " }.",
    ...(withVariables ? ["The template asks the person some QUESTIONS (listed as variables). When the request gives an answer to one, put it in values under that question's key, exactly as the person wrote it; never invent an answer, never compute or change an amount, and leave a question out when the request does not answer it."] : []),
    "Block numbers start at 1 and count top-level blocks in order.",
    "A patch is one of:",
    '- { "op":"replace_text", "block":N, "before":"exact existing words", "after":"new words" }   (before must appear in that block exactly)',
    '- { "op":"insert_block", "after":N, "node": <block> }   (after:0 inserts at the start)',
    '- { "op":"replace_block", "block":N, "node": <block> }',
    '- { "op":"remove_block", "block":N }',
    FORMAT,
    "Rules:", ...vocab.rules.map((r) => `- ${r}`),
    "Change only what was asked. Keep everything else exactly as it is.",
  ].join("\n");
}

/** The user message for a draft: the request, the clause names the workspace has (names only), nothing about people. */
export const draftUser = ({ request, clauses = [], base = null }) => JSON.stringify({ request, workspace_clauses: clauses.slice(0, 40), existing_document: base });
/** The user message for an edit: the numbered blocks as plain text plus the request. */
export const editUser = ({ request, numbered, variables = null }) => JSON.stringify({ request, document_blocks: numbered, ...(variables?.length ? { variables: variables.map((v) => ({ key: v.key, question: v.label, kind: v.kind })) } : {}) });
