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

## Current DDPM availability

Verified 2026-09-26: public rendered articles can be read locally, but GitHub-hosted runners receive a Cloudflare human-verification challenge. Scheduled DDPM collection is disabled (`DOONAM_DDPM_ENABLED=0`) until an authorized supported channel is available. TMD collection continues. The receiver reports DDPM ACCESS/unavailable and preserves any previously collected records. Do not bypass the challenge or copy browser/API credentials.

Set `DOONAM_DDPM_ENABLED=1` only after verifying that the normal public browser flow works on the selected runner.

## Daily reservoirs

`reservoirs.ts` reads ThaiWater's public daily reservoir feed and publishes only RID large and medium records with verified reuse terms. RID large data is CC Attribution (https://data.go.th/dataset/big_dams_public); medium data is listed as Open Data Common without access restrictions (https://gdcatalog.go.th/dataset/gdpublish-reservoir1). EGAT-only and small-reservoir records remain pending permission verification. Catalogue size is not a claim of complete daily coverage.

The separate `Daily reservoir reports` workflow checks at approximately 06:00, 12:00 and 18:00 Thai time. Standard free public-repository runners only; actual completion time is recorded because schedules can be delayed. Existing warning collection is unchanged.

Run `npm ci --ignore-scripts`, `npm run build:reservoirs`, then `DOONAM_DRY_RUN=1 DOONAM_BACKFILL_LIMIT=0 npm run collect:reservoirs` to validate without publishing. Live ingestion uses the existing repository variable and secret above. Never commit secrets or payload signing keys.

Backfill covers at most 365 days, six reservoirs per normal run, rotates through source IDs, spaces source requests, and has a nine-minute work budget. Manual workflow inputs can select an offset and 0–50 reservoirs. Missing history remains missing; graphs and scenarios use only dated, validated observations. Snapshots preserve valid data when a source fails; backfill cannot overwrite full daily snapshots. No published numeric upstream rate limit was located; request counts and concurrency are conservatively bounded.
