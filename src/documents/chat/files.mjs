// A file the person attached, as content the model can see for ONE message (FINAL PUSH Stage 3, report §14.9). The file is already stored as their draft; this reads its original bytes back, checks the size,
// and returns Anthropic content blocks. Nothing here is stored in the chat history. Word, Excel and other office files are not sent (the model reads PDFs and pictures only).
import { filesOf, readFileBytes } from "../files.mjs";

export const MAX_READ_BYTES = 24 * 1024 * 1024;   // the provider's request ceiling is 32 MB; base64 adds a third
const MAX_READ_PAGES = 100;
const IMAGE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** → { blocks: [content block], note?: string }. An unreadable, oversize or unsupported file gives no blocks and a plain note the route can log; it never throws. */
export async function chatFileBlocks(tx, { instanceId, maxBytes = MAX_READ_BYTES, maxPages = MAX_READ_PAGES }) {
  const files = await filesOf(tx, { instanceId });
  const f = files.find((x) => x.kind === "original") ?? files[0];
  if (!f) return { blocks: [], note: "no file" };
  const mime = String(f.mime ?? "").toLowerCase();
  const isPdf = mime === "application/pdf", isImage = IMAGE.has(mime);
  if (!isPdf && !isImage) return { blocks: [], note: "type not readable" };
  if ((f.byte_size ?? 0) > maxBytes) return { blocks: [], note: "too large" };
  if (isPdf && (f.page_count ?? 0) > maxPages) return { blocks: [], note: "too many pages" };
  const { bytes } = await readFileBytes(tx, { fileId: f.id });
  const data = Buffer.from(bytes).toString("base64");
  return { blocks: [isPdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } } : { type: "image", source: { type: "base64", media_type: mime, data } }] };
}
