// ═══════════════════════════════════════════════════════════════════════════════════════════════
// REPORTS CSV EXPORT — toCsv(name, reportJson)
//
// Flattens a report's array fields into one CSV string. The header row uses raw JSON field names
// (no canonical ExportMenu column-name source found in the codebase as of implementation).
// RFC 4180 CSV formatting (quoting/escaping for commas, quotes, and newlines) is delegated to
// `csv-stringify` — see `toCsv` below.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { stringify } from "csv-stringify/sync";

/**
 * Coerces a raw field value to the string `csv-stringify` should quote/escape, matching the
 * pre-existing hand-written `escapeCSVField`'s value handling exactly (null/undefined → "",
 * everything else → `String(value)`) — done here, ahead of the library, so the library only ever
 * sees plain strings and its own default (number/boolean/etc.) casting never runs.
 * @param {*} value
 * @returns {string}
 */
function toCsvFieldString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/**
 * Extracts the array field from a report that should be flattened into rows.
 * Different reports have different array names (rows, by_month, by_item, etc.).
 * @param {string} name - The report name (money, people, sessions, found, coaches)
 * @param {object} reportJson - The report JSON object
 * @returns {array} The array of row objects to export, or empty array if none found
 */
function getReportRows(name, reportJson) {
  // Try common array field names in order
  const candidates = ["rows", "by_month", "by_item", "owed_by_person", "stopped", "sources", "didnt", "by_weekday", "no_show_rows", "by_location", "payouts"];
  for (const key of candidates) {
    if (Array.isArray(reportJson[key])) {
      return reportJson[key];
    }
  }
  return [];
}

/**
 * Converts a report to CSV format.
 * @param {string} name - The report name (e.g., 'coaches', 'money', 'people')
 * @param {object} reportJson - The parsed JSON report response
 * @returns {string} CSV-formatted data (empty string if no rows)
 */
export function toCsv(name, reportJson) {
  const rows = getReportRows(name, reportJson);

  if (rows.length === 0) {
    return "";
  }

  // Header row from the first data row's keys — same column order the old buildHeaderRow used.
  const headers = Object.keys(rows[0]);
  if (headers.length === 0) {
    return "";
  }

  const table = rows.map((row) => headers.map((key) => toCsvFieldString(row[key])));

  // `eof: false` — no trailing record_delimiter after the last row, matching the old
  // `[headerRow, ...dataRows].join("\n")` (no trailing newline). `record_delimiter: "\n"` is the
  // library default, named explicitly here to match today's line ending.
  return stringify([headers, ...table], { record_delimiter: "\n", eof: false });
}
