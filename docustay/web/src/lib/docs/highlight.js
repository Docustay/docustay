// Build-time syntax highlighting (Shiki, MIT) for the prerendered docs: one highlighter, dual themes, colours as CSS variables so light and dark both work without a second render.
import { createHighlighter } from "shiki";
let hl = null;
const LANGS = ["bash", "javascript", "python", "go", "ruby", "php", "java", "csharp", "json", "typescript", "html"];
export async function highlight(code, lang) {
  hl ??= await createHighlighter({ themes: ["github-light-high-contrast", "github-dark"], langs: LANGS });
  return hl.codeToHtml(code, { lang: LANGS.includes(lang) ? lang : "bash", themes: { light: "github-light-high-contrast", dark: "github-dark" }, defaultColor: false }).replace(/<pre /, '<pre tabindex="0" ').replace(/#66707b/gi, "#59636e");   // Run 9 (S8): the theme's comment colour is 4.45:1 on the lavender code block (WCAG AA wants 4.5); #59636e is 5.2:1

}
