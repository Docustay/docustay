#!/bin/sh
# P18.3 — SEAWEEDFS START. FAIL LOUD IF A CREDENTIAL IS MISSING; NEVER START ANONYMOUS.
#
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# ★★★ THE FAIL-CLOSED RULE, APPLIED TO A THIRD-PARTY BINARY.
#     `weed server -s3` with no `-s3.config` starts a FULLY ANONYMOUS S3 endpoint and says nothing
#     about it. So the dangerous outcome here is not a crash, it is a SUCCESSFUL START — and that is
#     exactly the shape this project keeps getting caught by. If either credential is missing this
#     script exits non-zero and Railway shows a failed deploy, which is the loud, visible answer.
#   ★ §2.3: no `${VAR:-literal}` fallback anywhere below. A defaulted object-store credential means
#     every deployment shares one, which is worse than none because it looks configured.
set -eu

if [ -z "${KEYSTONE_S3_ACCESS_KEY_ID:-}" ]; then
  echo "FATAL: KEYSTONE_S3_ACCESS_KEY_ID is not set. Refusing to start: a SeaweedFS started without" >&2
  echo "       an -s3.config accepts UNAUTHENTICATED PUT and GET on every bucket, and this bucket" >&2
  echo "       holds executed instruments. Set the variable on this service and redeploy." >&2
  exit 1
fi
if [ -z "${KEYSTONE_S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "FATAL: KEYSTONE_S3_SECRET_ACCESS_KEY is not set. Refusing to start (see above)." >&2
  exit 1
fi

# ★★ THE CONFIG GOES TO /etc, NOT TO THE DATA VOLUME. Two reasons, both measured decisions rather
#    than taste: a file on the volume SURVIVES a credential rotation (so an old key keeps working
#    until someone remembers to delete it), and it would be readable by anything that later gets a
#    path into the volume. Writing it to the container filesystem means it is rebuilt from the
#    environment on every boot and dies with the container — which makes rotation a redeploy.
CONFIG=/etc/seaweedfs-s3.json
umask 077

# ★ Actions are enumerated rather than granted as a wildcard: Read/Write/List/Tagging on the one
#   bucket. No Admin — nothing in this product needs to create or delete a bucket at runtime, and a
#   credential that can delete the bucket is a credential that can erase every signed agreement.
cat > "$CONFIG" <<JSON
{
  "identities": [
    {
      "name": "keystone",
      "credentials": [
        {
          "accessKey": "${KEYSTONE_S3_ACCESS_KEY_ID}",
          "secretKey": "${KEYSTONE_S3_SECRET_ACCESS_KEY}"
        }
      ],
      "actions": [
        "Read:${KEYSTONE_S3_BUCKET}",
        "Write:${KEYSTONE_S3_BUCKET}",
        "List:${KEYSTONE_S3_BUCKET}",
        "Tagging:${KEYSTONE_S3_BUCKET}"
      ]
    }
  ]
}
JSON

echo "[seaweedfs] config written for bucket '${KEYSTONE_S3_BUCKET}' (1 identity, 4 scoped actions)."
echo "[seaweedfs] ★ the secret is NOT echoed and is NOT on the data volume — it is rebuilt from the"
echo "[seaweedfs]   environment on every boot, so rotating it is a redeploy."

# ★★ `-s3.allowEmptyFolder=false` keeps the listing honest: SeaweedFS otherwise leaves directory
#    placeholder entries behind after a delete, and a bucket that lists keys nobody wrote is a bucket
#    whose listing cannot be used as evidence of anything.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# ★★★ WHAT LISTENS WHERE — AND WHY ONLY ONE PORT FACES THE PRIVATE NETWORK (Stage 2, twice over).
#
#   HISTORY, BECAUSE IT WAS WRONG IN BOTH DIRECTIONS. Until 17 Sep 2026 this ran `-ip.bind=0.0.0.0` with a
#   comment claiming that was "so Railway's private network can reach it". Railway's private network is
#   IPv6-ONLY, so nothing outside this container could reach ANY port. Stage 2 changed it to `-ip.bind=::`
#   — which made S3 reachable (keystone-app's /readyz storage check proves it) but ALSO opened the master
#   (9333), volume server (8080) and filer (8888) to every service in the project. The filer and volume
#   server serve files over plain HTTP with NO authentication: n8n, or anything else on the private network,
#   could have read or deleted every signed agreement without the S3 key. (Stage 2 final review, I1.)
#
#   ★★ SO: EVERY SeaweedFS COMPONENT BINDS TO LOOPBACK, AND ONLY THE S3 GATEWAY IS FORWARDED OUT.
#     · `-ip=127.0.0.1 -ip.bind=127.0.0.1` — master, volume server, filer and S3 all listen on 127.0.0.1
#       and advertise 127.0.0.1 to each other (they share this container, so loopback is all they need).
#     · S3 listens INTERNALLY on 8433 (gRPC on 18433).
#     · socat listens on [::]:8333 — the one address other services use, seaweedfs.railway.internal:8333,
#       unchanged — and forwards to 127.0.0.1:8433. S3 enforces the scoped credential above; nothing
#       else is reachable from outside.
#   ★ Measured, not assumed, after deploy: the startup log must say every "Start Seaweed …" is on
#     127.0.0.1, and keystone-app's /readyz storage check must still answer through :8333.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#
# ★★★ NOT `exec` — THE SERVER RUNS IN THE BACKGROUND SO THE BUCKET CAN BE CREATED AFTER IT IS UP.
#     The reason is the scoped credential above: `keystone` has Read/Write/List/Tagging on ONE bucket
#     and deliberately NO `Admin`, so it **cannot create a bucket itself** — a PutObject to a
#     non-existent bucket answers NoSuchBucket. Creating it here, out of band via `weed shell`, is what
#     lets the runtime credential stay unable to create or delete one.
#   ★ Signals are forwarded to BOTH processes so Railway's stop is a clean shutdown rather than a kill.
S3_INTERNAL_PORT=8433
weed server \
  -dir=/data \
  -ip=127.0.0.1 \
  -ip.bind=127.0.0.1 \
  -master.volumeSizeLimitMB=1024 \
  -volume.max=0 \
  -s3 \
  -s3.port="$S3_INTERNAL_PORT" \
  -s3.config="$CONFIG" \
  -s3.allowEmptyFolder=false &
SERVER_PID=$!
FORWARD_PID=""
trap 'kill -TERM "$SERVER_PID" $FORWARD_PID 2>/dev/null; wait "$SERVER_PID"' TERM INT

# ★★ WAIT FOR THE S3 PORT, THEN CREATE. A fixed `sleep` here would be the kind of guess that passes on
#    a fast boot and fails on a slow one — and the failure mode is a bucket that silently does not
#    exist, which reads downstream as "storage is broken" rather than "the boot raced".
i=0
while [ "$i" -lt 60 ]; do
  if wget -q -O /dev/null "http://127.0.0.1:${S3_INTERNAL_PORT}/" 2>/dev/null \
     || wget -q -S -O /dev/null "http://127.0.0.1:${S3_INTERNAL_PORT}/" 2>&1 | grep -q "HTTP/"; then
    break
  fi
  i=$((i + 1)); sleep 1
done
echo "[seaweedfs] S3 port answered on 127.0.0.1:${S3_INTERNAL_PORT} after ${i}s"

# ★ IDEMPOTENT. `s3.bucket.create` on an existing bucket is not an error, so this is safe on every
#   boot — which matters because a redeploy must not need a human to remember this step.
echo "s3.bucket.create -name ${KEYSTONE_S3_BUCKET}" | weed shell -master=127.0.0.1:9333 2>&1 \
  | sed 's/^/[seaweedfs][bucket] /' || echo "[seaweedfs] bucket create reported a problem — see above"

# ★★ THE ONE OUTWARD-FACING LISTENER. `[::]` because Railway's private network is IPv6-only; `fork` so
#    each connection gets its own child; `reuseaddr` so a restart is not refused by a socket in TIME_WAIT.
#    If socat cannot start, the service must FAIL, not run with its S3 unreachable and look healthy.
socat TCP6-LISTEN:8333,fork,reuseaddr,ipv6only=0 TCP4:127.0.0.1:"$S3_INTERNAL_PORT" &
FORWARD_PID=$!
sleep 1
if ! kill -0 "$FORWARD_PID" 2>/dev/null; then
  echo "FATAL: socat could not listen on [::]:8333 — S3 would be unreachable from other services." >&2
  kill -TERM "$SERVER_PID" 2>/dev/null
  exit 1
fi

echo "[seaweedfs] ready. bucket='${KEYSTONE_S3_BUCKET}'. Only S3 faces the private network ([::]:8333 → 127.0.0.1:${S3_INTERNAL_PORT}); master, volume and filer are loopback-only."
wait "$SERVER_PID"
