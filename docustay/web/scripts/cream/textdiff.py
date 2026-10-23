#!/usr/bin/env python3
"""Cream restyle proof (specs/SITE-CREAM-RESTYLE.md §6): a word-for-word diff of every page before and after.
Compares the page title, the meta description and share titles, every alt / aria-label / title / placeholder,
and the rendered body text line by line. Usage: textdiff.py <before/text.json> <after/text.json> [--md out.md]"""
import difflib, json, sys

a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
md = sys.argv[sys.argv.index("--md") + 1] if "--md" in sys.argv else None
rows, changed, lines = [], 0, 0
for path in sorted(set(a) | set(b)):
    if path not in a or path not in b:
        rows.append((path, "page only in " + ("after" if path in b else "before"), [])); changed += 1; continue
    diffs = []
    for field in ("title", "meta", "attrs", "body"):
        x, y = a[path][field], b[path][field]
        x, y = ([x], [y]) if isinstance(x, str) else (x, y)
        lines += len(y)
        if x != y:
            diffs += [f"{field}: {d}" for d in difflib.unified_diff(x, y, lineterm="", n=0) if d[:1] in "+-" and not d.startswith(("+++", "---"))]
    if diffs: changed += 1; rows.append((path, f"{len(diffs)} differing lines", diffs))
print(f"pages {len(set(a) | set(b))}, lines compared {lines}, pages with a difference {changed}")
for p, s, d in rows:
    print(f"\n{p}: {s}"); [print("   ", x[:160]) for x in d[:12]]
if md:
    with open(md, "w") as f:
        f.write(f"pages {len(set(a) | set(b))} · lines compared {lines} · pages with a difference {changed}\n")
        for p, s, d in rows: f.write(f"\n{p}: {s}\n" + "".join(f"    {x[:200]}\n" for x in d))
