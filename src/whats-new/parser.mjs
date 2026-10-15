// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.25 — Parse the whats-new.md file into structured release notes.
//
// ★★★ PARSED ONCE AT MODULE LOAD, NEVER PER REQUEST. The file is read synchronously at require
//     time and cached; every request thereafter uses the cached array. This is safe because the
//     file is authored platform-side and never written by the application.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const whatsNewPath = resolve(__dirname, "../../specs/whats-new.md");

/**
 * Parse the whats-new.md file into an array of notes.
 * Each note has the structure: { date, title, body, tags }
 * Tags are optional and parsed from a trailing `Tags: feature|fix|change` line.
 */
export function parseWhatsNewMarkdown() {
  const content = readFileSync(whatsNewPath, "utf-8");
  const lines = content.split("\n");
  const notes = [];
  let currentNote = null;
  let bodyLines = [];
  let inBody = false;

  for (const line of lines) {
    // ★ Entry headers: `## <ISO date> · <title>`
    const headerMatch = line.match(/^## (\d{4}-\d{2}-\d{2}) · (.+)$/);
    if (headerMatch) {
      // Save the previous note if it exists
      if (currentNote) {
        currentNote.body = bodyLines.join("\n").trim();
        notes.push(currentNote);
      }

      currentNote = {
        date: headerMatch[1],
        title: headerMatch[2],
        body: "",
        tags: [],
      };
      bodyLines = [];
      inBody = true;
      continue;
    }

    // ★ Skip the title line itself (it's part of the file header)
    if (line.startsWith("# Release notes")) {
      continue;
    }

    // ★ If we have an active note, collect body lines
    if (currentNote && inBody) {
      // ★ Check for trailing Tags line
      const tagsMatch = line.match(/^Tags: (.+)$/);
      if (tagsMatch) {
        currentNote.tags = tagsMatch[1].split("|").map((t) => t.trim()).filter(Boolean);
      } else if (line.trim() !== "") {
        // Collect non-empty lines as body
        bodyLines.push(line);
      } else if (bodyLines.length > 0) {
        // Empty line in body — keep it to preserve paragraph structure
        bodyLines.push(line);
      }
    }
  }

  // ★ Don't forget the last note
  if (currentNote) {
    currentNote.body = bodyLines.join("\n").trim();
    notes.push(currentNote);
  }

  return notes;
}

/**
 * Get the cached parsed notes array. Notes are ordered newest first.
 * The latestDate is the date of the most recent entry.
 */
export function getWhatsNew() {
  const notes = parseWhatsNewMarkdown();

  // ★ Notes are ALREADY in file order (newest first, as written in markdown).
  // NO REVERSE NEEDED — the file's order is the desired order.

  const latestDate = notes.length > 0 ? notes[0].date : null;

  return { notes, latestDate };
}
