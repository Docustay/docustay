<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { DEV_ADD } from "$lib/site/pages/pass3-dev.js";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import SiteIcon from "$lib/site/desk/SiteIcon.svelte";
  let { data } = $props();
</script>
<DeskHead title="Sign documents from your code" description="Send a document for signature from JavaScript, TypeScript, Python, Go, PHP or C#. Each program was run against the Docustay API with a test key before it was published." crumbs={[["Docustay", "/"], ["Sign documents from your code", "/sign-pdf"]]} />
<section class="d-wrap sp" data-page="/sign-pdf" data-voice="V2" data-template="T8 index">
  <p class="d-eyebrow">SIGN A PDF WITH…</p>
  <h1 class="d-h1 sm">Sign documents from your code</h1>
  <p class="d-sub" data-feature="F-API F-TESTMODE">One template, one call, in the language you write. Every program was run against the API with a test key before it was published here.</p>
</section>
<Sec eyebrow="Pick yours" title="Pick yours." tight><div class="d-grid d-g3">{#each data.langs as l}<a class="tile" href="/sign-pdf/{l.slug}"><SiteIcon name="code" size={24} /><b>{l.name}</b><span>Send a document from {l.name}</span></a>{/each}</div></Sec>
<Blocks blocks={DEV_ADD["/sign-pdf"]} />
<Closing title="Make a test key." label="Create an API key" href="/signup" keep={[["REST API", "/developers/api"], ["SDKs", "/developers/sdks"], ["Test mode", "/developers/test-mode"], ["Quickstart", "/docs/quickstart"], ["API reference", "/docs/api-reference"]]} />
<style> .sp { padding-top: 56px; } .tile { display: grid; gap: 8px; border: 1px solid var(--hairline); background: #ffffff; padding: 20px; border-radius: 6px; text-decoration: none; color: var(--tx-1); } .tile:hover { border-color: rgb(90 58 193 / 0.5); } .tile b { font: 600 18px/1.2 var(--font-sans); } .tile span { color: var(--tx-3); font-size: 14.5px; } </style>
