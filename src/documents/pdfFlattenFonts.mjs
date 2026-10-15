// src/documents/pdfFlattenFonts.mjs — SERVER ONLY. Gives pdfFlatten.mjs its fallback fonts (fontkit + the font files in ./fonts). Imported by the server modules that flatten (pdfArchive.mjs, pdf.mjs); never by the browser bundle.
import * as fontkit from "fontkit";
import { fallbackBytes, splitRuns } from "./textFonts.mjs";
import { setFlattenFontProvider } from "./pdfFlatten.mjs";
setFlattenFontProvider({ fontkit, fallbackBytes, splitRuns });
