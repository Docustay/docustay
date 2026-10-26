<script>
  // The 20 Docustay icons: 24 px grid, 1.5 px line, one per platform feature (VisualKit board). Our own paths; Lucide is used only for anything this set lacks.
  let { name, size = 24, class: cls = "" } = $props();
  const P = {
    "file-text": "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
    signature: "M3 16c3-6 5-9 6-9s-1 8 1 8 2-5 4-5 1 3 3 3 2-1 4-2 M3 21h18",
    send: "M21 3L10 14 M21 3l-7 18-4-7-7-4z",
    seal: "M12 4.5a5 5 0 100 10 5 5 0 000-10z M9 14.2L7.5 21l4.5-2.6 4.5 2.6-1.5-6.8",
    clock: "M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2",
    users: "M9 5a3 3 0 100 6 3 3 0 000-6z M3 20c0-3 3-5 6-5s6 2 6 5 M17 6.5a2.5 2.5 0 110 5 M17 14.5c2.5 0 4 1.7 4 4.5",
    code: "M8 8l-5 4 5 4 M16 8l5 4-5 4 M14 5l-4 14",
    key: "M8 11a4 4 0 100 8 4 4 0 000-8z M11 12l9-9 M17 6l3 3 M14 9l2 2",
    webhook: "M12 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M6 15.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M18 15.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M12 8.5v3l-5 4 M12 11.5l5 4 M8.5 18h7",
    terminal: "M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z M7 9l3 3-3 3 M12 15h5",
    card: "M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z M3 10h18 M7 15h3",
    globe: "M12 3a9 9 0 100 18 9 9 0 000-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18",
    scribe: "M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
    hash: "M5 9h14 M4 15h14 M10 4L8 20 M16 4l-2 16",
    layers: "M12 3l9 5-9 5-9-5z M3 12.5l9 5 9-5 M3 16.5l9 5 9-5",
    workflow: "M4 3h6a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z M14 15h6a1 1 0 011 1v4a1 1 0 01-1 1h-6a1 1 0 01-1-1v-4a1 1 0 011-1z M7 9v3a3 3 0 003 3h3",
    lock: "M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1z M8 11V8a4 4 0 018 0v3",
    download: "M12 4v11 M7 11l5 5 5-5 M4 20h16",
    mcp: "M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l3 3 M15 15l3 3 M18 6l-3 3 M9 15l-3 3",
    stamp: "M8 21h8 M6 21v-3h12v3 M9 18c0-3 1-4 1-7a2 2 0 114 0c0 3 1 4 1 7",
    menu: "M4 7h16 M4 12h16 M4 17h16",
    check: "M5 12.5l4.5 4.5L19 7.5", arrow: "M5 12h14 M13 6l6 6-6 6", plus: "M12 5v14 M5 12h14", search: "M11 4a7 7 0 100 14 7 7 0 000-14z M16 16l5 5"
  };
</script>
<svg class={cls} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={P[name] ?? P.check} /></svg>
