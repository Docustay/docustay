#!/bin/sh
# NIGHTLY CANARY (Operation Live, E): the registry copies of every package must install and run, and the SANDBOX API must answer the way the
# quickstart says. Sandbox only. A failure writes the log, exits 1 and raises a macOS notification.
# usage: sdk/scripts/canary-nightly.sh [logdir]      optional env: DOCUSTAY_CANARY_KEY (a sandbox key; without it the authenticated step is skipped and said so)
# schedule (one line, per user): launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.docustay.canary.plist   (template: sdk/scripts/app.docustay.canary.plist)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); LOG=${1:-"$HERE/../../specs/proofs/stage-t/run12/canary"}; mkdir -p "$LOG"; OUT="$LOG/canary-$(date -u +%Y%m%dT%H%M%SZ).txt"
WEB=${DOCUSTAY_CANARY_WEB:-https://host.example.com}; APP=${DOCUSTAY_CANARY_APP:-https://host.example.com}
case "$WEB$APP" in *sandbox*) ;; *) echo "canary is sandbox-only" >&2; exit 2;; esac
bad=0
step() { printf '%s\n' "== $1" >>"$OUT"; }
step "registry smoke (npm + PyPI, clean rooms)"; node "$HERE/smoke-registry.mjs" >>"$OUT" 2>&1 || bad=$((bad+1))
step "sandbox app /readyz says ready (the body, not the code: the app answers 200 with its page shell for an unknown path)"; b=$(curl -s --max-time 20 "$APP/readyz"); echo "readyz $(printf '%s' "$b" | head -c 80)" >>"$OUT"; case "$b" in '{"status":"ready"'*) ;; *) bad=$((bad+1));; esac
step "API refuses a request with no key (401)"; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$WEB/api/v1/usage"); echo "no-key $c" >>"$OUT"; [ "$c" = 401 ] || bad=$((bad+1))
step "marketing SITE origin proxies /api (R10-92)"; node "$HERE/../../scripts/proofs/site-origin-gate.mjs" "${DOCUSTAY_CANARY_SITE:-https://host.example.com}" >>"$OUT" 2>&1 || bad=$((bad+1))
if [ -n "${DOCUSTAY_CANARY_KEY:-}" ]; then
  step "API answers a sandbox key (200) and the published spec lists the operations in facts.gen.json"
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $DOCUSTAY_CANARY_KEY" "$WEB/api/v1/usage"); echo "with-key $c" >>"$OUT"; [ "$c" = 200 ] || bad=$((bad+1))
  n=$(curl -s --max-time 20 "$WEB/api/v1/openapi.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).paths;console.log(Object.values(p).reduce((a,o)=>a+Object.keys(o).filter(k=>/^(get|post|put|patch|delete)$/.test(k)).length,0))})'); echo "operations $n" >>"$OUT"; want=$(node -p "require('$(cd "$(dirname "$0")" && pwd)/../../docustay/web/src/lib/site/facts.gen.json').operations"); [ "$n" = "$want" ] || bad=$((bad+1))
else echo "SKIPPED authenticated step: DOCUSTAY_CANARY_KEY not set" >>"$OUT"; fi
if [ "$bad" -eq 0 ]; then echo "CANARY OK" >>"$OUT"; else echo "CANARY FAILED ($bad step(s))" >>"$OUT"; osascript -e 'display notification "Docustay nightly canary failed; see run12/canary" with title "Docustay canary"' 2>/dev/null; fi
tail -1 "$OUT"; exit $bad
