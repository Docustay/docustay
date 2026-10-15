# Put Docustay behind your own address

The web container listens on port 8080 (change it with `DOCUSTAY_PORT` in `.env`). Everything people use goes through that one port. Put a reverse proxy in front of it to get your own domain and HTTPS.

## Tell Docustay its address

Set the address people will type, with no trailing slash, in `.env`, then restart:

```bash
KEYSTONE_PUBLIC_URL=https://sign.example.com
```

This is the start of every signing link and reset link in an email. If it is wrong, the links in emails will not open.

## Caddy

Caddy gets and renews the certificate for you.

```caddyfile
sign.example.com {
  reverse_proxy localhost:8080
}
```

## nginx

```nginx
server {
  listen 443 ssl http2;
  server_name sign.example.com;
  ssl_certificate     /etc/letsencrypt/live/sign.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sign.example.com/privkey.pem;
  client_max_body_size 50m;                        # uploaded documents
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

## Traefik (labels on the web service)

```yaml
services:
  web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.docustay.rule=Host(`sign.example.com`)
      - traefik.http.routers.docustay.tls.certresolver=letsencrypt
      - traefik.http.services.docustay.loadbalancer.server.port=3000
```

## Check

- Open `https://sign.example.com/login`. The sign-in page should load over HTTPS with no certificate warning.
- Send yourself a document and open the link in the email. It must start with your address.
- If you use embedded signing, list your own website under Settings → Developers → Embedding.

## Keep the proxy honest

Pass `X-Forwarded-Proto` and `X-Forwarded-For` as shown, **and add `DOCUSTAY_CLIENT_IP_HEADER=X-Forwarded-For` to `.env`** (then `docker compose up -d`). Docustay uses the first to know a request was secure and the second for the address in the audit trail, on the signing certificate and in the rate limits; without the setting it can only see the proxy's own address. Set it only when a proxy you control is in front (otherwise anyone could write their own address into the header); `DOCUSTAY_PROXY_COUNT` is how many proxies there are (default 1). Do not expose ports 5432 (database), 8333 (file store) or 3000 (web) directly.

## Public form links

Forms need nothing extra on your own servers. A published form is served at `/f/<workspace>/<link name>` by the same web container as the rest of the app, and the people who fill it in never sign in. Two things to keep in mind at the proxy: pass `/f/` through like any other path, and do not add your own `X-Frame-Options` or `frame-ancestors` header, because Docustay sets `frame-ancestors` itself (only the websites listed on a form may show it in a frame; with none listed, nobody can).
