# ดูน้ำ: ตัวดึงประกาศทางการ

Public collector only. The website source, databases, and secrets are not included.

- TMD official CAP RSS + CAP documents. Preserves sent/effective/expires/references.
- DDPM public rendered news lists and article pages. No accounts or copied API credentials.
- Flood, heavy rain, flash flood and landslide only. Last 7 days. Uncertain areas stay general.
- Daily summaries are situation reports, never counted as active alerts without explicit validity.
- PDF text is read transiently for classification; full PDFs/images are not saved or republished.
- GitHub-hosted standard `ubuntu-latest`, every 15 minutes. Schedules can be delayed.
- No billing setup, no paid runners, no push notifications.

Configure repository variable `DOONAM_INGEST_URL` and Actions secret `DOONAM_INGEST_SECRET`.
The matching secret must be stored in Sites, never in files or logs. Payloads are HMAC-SHA256 signed with time and nonce. The receiver checks size, source, freshness and replay.

`collect.mjs` is the bundled collector. `entry.ts` and `lib/` are auditable collector-only source. Build with esbuild (external playwright), then run `npm ci`, `npx playwright install --with-deps chromium`, `python3 -m pip install pypdf==6.10.0` and `NODE_EXTRA_CA_CERTS=certs/globalsign-intermediate.crt npm run collect`.

The intermediate certificate is public, retrieved via HTTPS from https://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt (issuer URL in the TMD leaf certificate). It supplements the standard trusted root store. Hostname, expiry and chain verification remain enabled. Never set NODE_TLS_REJECT_UNAUTHORIZED=0 or ignoreHTTPSErrors.

Failures report a stage (TLS/HTTP/RSS/CAP/DOM/DATE/NETWORK) and do not replace the last successful source payload. No silent conversion to zero bulletins.

Source links: https://www.tmd.go.th/api/xml/CAP and https://www.disaster.go.th/home.
