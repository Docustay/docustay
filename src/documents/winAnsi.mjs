// src/documents/winAnsi.mjs — which characters a PDF standard font (Helvetica, Times, Courier: WinAnsi) can draw. Pure, no imports: safe in the browser (the free "sign a PDF" page runs pdfFlatten.mjs there).
const WIN_ANSI_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);
/** Can a PDF standard font (Helvetica, Times, Courier: WinAnsi) draw this code point? */
export const winAnsiHas = (cp) => (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || WIN_ANSI_EXTRA.has(cp);
