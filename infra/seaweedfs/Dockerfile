# P18.3 — SEAWEEDFS, THE OBJECT STORE. MinIO IS DEAD (§Y8.0).
#
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# ★★★ WHY A DOCKERFILE OF OUR OWN INSTEAD OF POINTING RAILWAY AT `chrislusf/seaweedfs` DIRECTLY.
#     SeaweedFS's S3 gateway reads its identities — the access key / secret pairs — from a JSON
#     FILE named by `-s3.config`. There is no environment-variable form of that file.
#   ★★ AND WITHOUT IT THE S3 API IS ANONYMOUS. A SeaweedFS started with a bare `-s3` accepts
#      unauthenticated PUT and GET on every bucket. That is not a weak default we can live with:
#      this bucket holds **executed instruments** — signed agreements with people's names on them.
#      So a config file is mandatory, which means something has to write it.
#   ★★★ AND IT IS WRITTEN AT **RUN TIME**, FROM THE ENVIRONMENT, NOT BAKED IN AT BUILD TIME.
#      A `COPY` or a build `ARG` puts the secret in an image layer, where it survives in the
#      registry forever and is readable by anyone who can pull the image. §2.3's rule ("secrets are
#      read at runtime, never written to disk in the repo") applies to image layers too — a layer
#      is disk that gets published.
#
# ★ Pinned to an exact tag, not `latest`. A silent major bump in an object store is a silent change
#   to how our documents are addressed, and `latest` makes a redeploy a version upgrade by accident.
FROM chrislusf/seaweedfs:3.80

# ★★ THE IMAGE'S ENTRYPOINT IS A DISPATCHER (`/entrypoint.sh server|filer|s3|…`). Leaving it in place
#    means our CMD arrives as arguments to that dispatcher, which does not understand them. Clearing
#    it is what lets the start script be the process — not a cleverness, a requirement.
ENTRYPOINT []

# ★ socat forwards the ONE outward-facing port (S3) from [::]:8333 to the loopback-only S3 gateway — see
#   start.sh. Every other SeaweedFS port stays on 127.0.0.1 (Stage 2 final review, I1).
RUN apk add --no-cache socat

COPY start.sh /start.sh
RUN chmod +x /start.sh

# ★ 8333 is the S3 gateway. It is NOT published publicly — keystone-app reaches it over Railway's
#   private network (`seaweedfs.railway.internal`). An object store holding signed instruments has no
#   business on the public internet, and the S3 credentials are not a substitute for that.
EXPOSE 8333

CMD ["/start.sh"]
