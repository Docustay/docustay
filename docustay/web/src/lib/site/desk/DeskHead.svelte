<script>
  // Title, description and (optionally) breadcrumbs + SoftwareApplication data for one page. The title is "<primary phrase> | Docustay", 60 characters or fewer; the description 150 to 155.
  let { title, description, crumbs = [], software = null } = $props();
  const full = $derived(title.endsWith("Docustay") ? title : `${title} | Docustay`);
  const ld = $derived(crumbs.length ? JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map(([n, h], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `https://docustay.app${h}` })) }) : "");
  const sw = $derived(software ? JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Docustay", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: "https://docustay.app", offers: software }) : "");
</script>
<svelte:head>
  <title>{full}</title><meta name="description" content={description} />
  {#if ld}{@html `<script type="application/ld+json">${ld}</script>`}{/if}
  {#if sw}{@html `<script type="application/ld+json">${sw}</script>`}{/if}
</svelte:head>
