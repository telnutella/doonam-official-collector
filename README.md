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

`collect.mjs` is the bundled collector. `entry.ts` and `lib/` are auditable collector-only source. Run `npm ci --ignore-scripts`, `npm run build`, then `NODE_EXTRA_CA_CERTS=certs/globalsign-intermediate.crt npm run collect`. Browser/PDF tools are required only when DDPM is explicitly enabled; source-specific TMD recovery never installs them.

The intermediate certificate is public, retrieved via HTTPS from https://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt (issuer URL in the TMD leaf certificate). It supplements the standard trusted root store. Hostname, expiry and chain verification remain enabled. Never set NODE_TLS_REJECT_UNAUTHORIZED=0 or ignoreHTTPSErrors.

Failures report a stage (TLS/HTTP/RSS/CAP/DOM/DATE/NETWORK) and do not replace the last successful source payload. No silent conversion to zero bulletins.

Source links: https://www.tmd.go.th/api/xml/CAP and https://www.disaster.go.th/home.

## Current DDPM availability

Verified 2026-09-26: public rendered articles can be read locally, but GitHub-hosted runners receive a Cloudflare human-verification challenge. Scheduled DDPM collection is disabled (`DOONAM_DDPM_ENABLED=0`) until an authorized supported channel is available. TMD collection continues. Disabled DDPM performs no fetch and sends no periodic failure to the receiver. The website marks it as disabled and preserves any previously collected records. Browser/PDF installation is skipped. Do not bypass the challenge or copy browser/API credentials.

Set `DOONAM_DDPM_ENABLED=1` on both collector and Site only after two successful full public-flow runs on the selected runner, including dates, areas and source links.

## Daily reservoirs

`reservoirs.ts` reads ThaiWater's public daily reservoir feed and publishes only RID large and medium records with verified reuse terms. RID large data is CC Attribution (https://data.go.th/dataset/big_dams_public); medium data is listed as Open Data Common without access restrictions (https://gdcatalog.go.th/dataset/gdpublish-reservoir1). EGAT-only and small-reservoir records remain pending permission verification. Catalogue size is not a claim of complete daily coverage.

The separate `Daily reservoir reports` workflow checks at approximately 06:00, 12:00 and 18:00 Thai time. Standard free public-repository runners only; actual completion time is recorded because schedules can be delayed. Existing warning collection is unchanged.

Run `npm ci --ignore-scripts`, `npm run build:reservoirs`, then `DOONAM_DRY_RUN=1 DOONAM_BACKFILL_LIMIT=0 npm run collect:reservoirs` to validate without publishing. Live ingestion uses the existing repository variable and secret above. Never commit secrets or payload signing keys.

Backfill covers at most 365 days, six reservoirs per normal run, rotates through source IDs, spaces source requests, and has a nine-minute work budget. Manual workflow inputs can select an offset and 0–50 reservoirs. Missing history remains missing; graphs and scenarios use only dated, validated observations. Snapshots preserve valid data when a source fails; backfill cannot overwrite full daily snapshots. No published numeric upstream rate limit was located; request counts and concurrency are conservatively bounded.

## Road reports and evidence

The independent `roads` job in the existing 15-minute workflow reads iTIC RSS and the public Traffy endpoint. No citizen credentials, raw addresses, reporter identities, or images are saved. Traffy coordinates remain withheld; public iTIC event coordinates are retained. iTIC attribution and source links stay attached to each record. iTIC terms: https://itic.longdo.com/opendata/ (CC BY 4.0). Traffy is used through the existing public reporting integration; case/photo links point to the original website.

Traffy uses 300 records per page and at most ten upstream page requests per run including bounded retries. Today and yesterday get up to four pages each, then an older day rotates through the seven-day window. Continuation offsets come from the site's public metadata endpoint. Pagination, changing totals, repeated pages and incomplete scans remain marked partial; only a complete stable scan can record absence. Absence/closed tickets never mean the road is dry or passable. Source failures preserve saved evidence.

Run `npm run build:roads` then `DOONAM_DRY_RUN=1 npm run collect:roads`. Live mode sends chunks of at most 25 records to the existing signed endpoint. Logs contain request counts, transmitted bytes and D1 rows written returned by the receiver, not secrets or raw reports. Seven-day history starts when collection is first enabled; no invented earlier revisions. Source schedules are approximate and standard GitHub runners can be delayed. No billing or paid Maps API is enabled.

## Province expansion and validation

ThaiWater and explicitly located iTIC reports accept canonical province codes for all 77 provinces. Traffy remains Bangkok-only. Unknown administrative codes are never truncated. Disabled DDPM logs a skip and makes no source or ingest request.

The website uses per-province latest snapshots; historical station writes stay in the original eight provinces. Collector validation uses a separate branch with forced dry-run; do not merge that validation workflow into production. Export the canonical `collector/.github/workflows/collect.yml` only after the Site release is approved.

## Source monitoring and bounded recovery

`DOONAM_MONITOR_ENABLED=1` registers TMD runs before collection and attaches their UUID, source request count and bytes to the signed import. Enable the matching Sites flag first. Success means the receiver validated and committed the import; heartbeat delivery is done by Sites after that commit, never by a green workflow or a job start. The collector receives neither Healthchecks credentials nor the recovery dispatch token.

`rain.ts` calls only the site's signed internal rain-refresh endpoint. Build with `npm run build:rain`; run with `npm run collect:rain`. The existing server adapter, source lock and eight-province history scope remain authoritative. Scheduled rain requires repository variable `DOONAM_RAIN_SCHEDULED=1` and the corresponding Sites setting, after real-import and quota verification. Manual `target=thaiwater-rain` is available for staged verification before enabling the schedule. Dry runs do not call the import endpoint.

Workflow dispatch accepts `target=all`, `tmd-cap`, or `thaiwater-rain`. Recovery selects exactly one source and includes its incident ID. Each source has its own concurrency group; road and reservoir jobs are not rerun for a source recovery. All network requests retain TLS verification. Idempotent calls retry at most three times with a fresh signing nonce per attempt; workflow dispatch itself is never blindly retried after an uncertain response.

Turning these variables off leaves the original collection path available. Do not claim independent monitoring or 48-hour acceptance until real Healthchecks delivery, restricted dispatch credentials and the actual observation window have been verified. Schedules can be delayed by GitHub.
