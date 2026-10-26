import { programName } from '@/lib/programs/programs.js';
import { term } from '@/lib/terminology/terms.js';

// The four system tags read through the practice's own words (terminology overrides); anything else keeps sentence-casing.
const TAG_TERM = { adult: 'userType.adult', adolescent: 'userType.adolescent', parent: 'userType.parent', lead: 'userType.lead' };
const tagLabel = (t) => (TAG_TERM[String(t)] ? term(TAG_TERM[String(t)]) : sentenceCase(String(t)));
// P15 — THE VALUE FORMATTER. One place, for highlights, panel fields and list cells.
//
// ★★★ WHY THIS FILE EXISTS AT ALL. The defect CLAUDE.md records from the PIR portal is a page
// that "rendered `[object Object]` and a raw `1` where the question said `1 — Not at all`", while
// every source-level check passed. A formatter that lives in three components is three chances to
// render the raw value, and the one that gets it wrong is always the one nobody looked at.
//
// ★★ IT NEVER RETURNS AN EMPTY STRING. Every branch returns either a formatted value or the
// caller's stated empty words. B2.5: "a printed token at least announces itself as a bug; A BLANK
// ROW READS AS A RENDERING GLITCH AND WILL BE 'FIXED' IN CSS."

/** ★ The one place the two-column breakpoint is written down. U4: "collapsing to one below
 *  1080px". ★★ CSS keys off `data-columns`, which this number produces — there is deliberately
 *  NO `@media` rule carrying 1080 as well, because two copies of a breakpoint drift and the
 *  drift is invisible until someone resizes a window at exactly the wrong width. */
export const COLLAPSE_BELOW = 1080;

/** @returns {'1'|'2'} — and an empty related rail is ALWAYS one column, at any width. */
export function columnsFor(viewportWidth, relatedCount) {
  if (!relatedCount) return '1';
  return viewportWidth > COLLAPSE_BELOW ? '2' : '1';
}

const MONEY_FALLBACK = 'Unpriced';

/**
 * @param value     the raw value from the row
 * @param format    one of shell.mjs's FIELD_FORMATS
 * @param opts      { empty, currency }
 */
export function formatValue(value, format, { empty = '—', currency = null } = {}) {
  if (value === null || value === undefined || value === '') return empty;

  switch (format) {
    case 'money': {
      // ★★ MINOR UNITS. `amount_minor` is an integer count of cents — every money column in this
      //    schema is (0009, 0015). Dividing by 100 at render is correct; storing a float never is.
      // ★★★ AND A MISSING CURRENCY IS NOT SILENTLY USD. An amount with no currency is a number,
      //     and 1200 is not a price. shell.mjs refuses a money field that does not name its
      //     currency column, so reaching here with none means the QUERY did not supply it.
      if (!currency) return MONEY_FALLBACK;
      const n = Number(value) / 100;
      if (!Number.isFinite(n)) return empty;
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency', currency, currencyDisplay: 'narrowSymbol',
        }).format(n);
      } catch {
        // ★ An unknown ISO code must not throw a record page off the screen.
        return `${n.toFixed(2)} ${currency}`;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ★★★ L9 — A PHONE NUMBER A PERSON CAN READ, FROM A VALUE THE DATABASE NORMALISED.
    //
    //   `keystone.normalise_phone_e164` stores E.164 — "+1-555-0164" typed becomes "+15550164"
    //   stored. That is CORRECT and must not change: one canonical form is what makes a number
    //   comparable, dedupable and diallable. ★★ But E.164 is a STORAGE format, not a reading
    //   format, and the client list was rendering it raw — an unbroken run of digits in the one
    //   column somebody uses when they need to ring a client back.
    //
    // ★★★ IT GROUPS, IT DOES NOT REWRITE. The digits are never altered, nothing is inferred about
    //     the country beyond the leading `+1` NANP case, and **anything it does not recognise is
    //     returned EXACTLY AS STORED.** A formatter that guessed would show a number that cannot be
    //     dialled, which is worse than one that is hard to read.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    case 'phone': {
      const raw = String(value).trim();
      const e164 = /^\+(\d{7,15})$/.exec(raw);
      if (!e164) return raw;                       // ★ not E.164 — show what is stored, untouched
      const d = e164[1];
      // ★ NANP: +1 then 10 digits → +1 (555) 012-3456. The only grouping this product can make
      //   safely without a country database.
      if (d.length === 11 && d.startsWith('1')) {
        return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
      }
      // ★★ EVERYTHING ELSE GETS READABLE GROUPING WITHOUT A CLAIM ABOUT ITS SHAPE: the country code
      //    cannot be split off without a table, so the digits are chunked from the RIGHT, which
      //    keeps the subscriber number intact however long the prefix is.
      const tail = d.replace(/(\d{1,3})(?=(\d{3})+$)/g, '$1 ');
      return `+${tail}`;
    }

    case 'date': {
      const d = asDate(value);
      return d ? d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : empty;
    }

    case 'datetime': {
      const d = asDate(value);
      return d
        ? d.toLocaleString('en-US',
            { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : empty;
    }

    // ★ A boolean renders a WORD. "false" under a heading called Bookable is not an answer, and
    //   `false` is falsy — a naive renderer drops it entirely and the row looks unanswered.
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : empty;

    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : empty;
    }

    // ★★ An ENUM is a closed set, so it is safe to prettify: 'partially_signed' → 'Partially
    //    signed'. A free-text column must NEVER be treated this way, which is why `text` and
    //    `enum` are different formats rather than one with a flag.
    case 'enum':
      return sentenceCase(String(value));

    // ★ the maintainer, 29 Sep 2026 — the four system tags (Adult/Adolescent/Parent/Lead), an array because a
    //   person may carry more than one. Sentence-cased and joined, same prettifying `enum` does,
    //   since this is also a closed, known set — never applied to free text.
    case 'tags':
      return Array.isArray(value) && value.length
        ? value.map(tagLabel).join(', ')
        : empty;

    // ★ QUEUE §4 — a program id (or ids) shown by NAME, read from the one shared programs list. Unknown ids read as "—", never a raw uuid.
    case 'program':
      return programName(value) ?? empty;
    case 'programs':
      return Array.isArray(value) && value.length ? (value.map((v) => programName(v)).filter(Boolean).join(', ') || empty) : empty;

    case 'text':
    default:
      return String(value);
  }
}

function asDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sentenceCase(s) {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}
