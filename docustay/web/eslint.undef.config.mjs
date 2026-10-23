// Used only by scripts/undef-gate.mjs: no-undef over every Svelte and JS file under src/. (The Forms removal left `kind` in the Templates page; the page crashed in the browser and nothing caught it.)
import svelte from "eslint-plugin-svelte";
import parser from "svelte-eslint-parser";
import globals from "globals";
export default [
  ...svelte.configs["flat/base"],
  { ignores: ["src/lib/site/desk/DeskHead.svelte", "src/lib/site/desk/Faq.svelte", "src/routes/(site)/+page.svelte", "src/routes/(site)/developers/+page.svelte", "src/routes/(site)/free-templates/+page.svelte"] },   // these emit JSON-LD through {@html `<script…>`}, which the parser cannot read
  { files: ["src/**/*.svelte", "src/**/*.svelte.js", "src/**/*.js"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node, $state: "readonly", $derived: "readonly", $effect: "readonly", $props: "readonly", $bindable: "readonly", $inspect: "readonly", $host: "readonly" } }, rules: { "no-undef": "error" } },
  { files: ["src/**/*.svelte"], languageOptions: { parser } },
];
