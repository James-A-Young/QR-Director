# QR Director

Short links and designer QR codes for marketing campaigns, with scan analytics broken down by
where each code was placed.

- **Campaigns with source variants.** One campaign (e.g. *Health Tech Expo 2026*) holds a short link
  and QR code per placement (*booth banner*, *programme*, *leaflet*…). Reports compare them side by
  side.
- **Editable redirects.** Change a campaign's destination, or override it per source, at any time.
  Printed codes keep working. Every change is recorded in the campaign history.
- **Scan analytics.** Each visit records the time, IP address, device type, vendor and model, OS,
  browser, language, referrer, country, region and city, plus any UTM or query parameters. Reports
  show scans over time by source, a source comparison table, device, OS, browser, location and
  referrer breakdowns, a day × hour heatmap, a raw visit log and CSV export. Bots are detected and
  excluded by default.
- **QR designer.** Foreground colour or gradient, background colour (or transparent), seven module
  shapes, independently shaped and coloured corner markers, a centred logo with an optional backing
  plate and border, and call-to-action frames with your own text. A live preview flags scannability
  risks. Designs can be saved as templates and applied to a whole campaign.
- **Print-ready downloads.** SVG (vector, text converted to outlines) or PNG at an exact pixel size,
  or a physical size in mm or inches at 150–1200 dpi, with DPI metadata embedded. PNGs are limited to
  8000 px wide and 36 megapixels; use SVG for anything larger.
- **Microsoft sign-in** via Entra ID, configured with environment variables.
- **One container.** API, redirector and UI are served by a single Node process, ready for Cloud Run.

## Architecture

| Layer   | Technology |
| ------- | ---------- |
| Server  | Node 22, Fastify 5, TypeScript |
| Data    | PostgreSQL with [Kysely](https://kysely.dev); migrations run automatically at start-up |
| Auth    | OpenID Connect authorisation code flow with PKCE (`openid-client`), stateless signed session cookies |
| QR      | Custom SVG renderer on `qrcode`'s matrix; PNG via `resvg`; frame text converted to outlines with `opentype.js` and the bundled Inter font |
| UI      | React 19, Vite, Tailwind CSS 4, TanStack Query, Recharts |
| Tests   | Vitest (server + UI), Playwright (end-to-end), ZXing decoding of rendered codes |

```
server/   Fastify app: API (/api), auth (/auth), redirector (/:code), serves the UI at /app
web/      React single-page app
e2e/      Playwright end-to-end tests against the production build
```

Short links live at the domain root (`https://go.example.com/abc123`), the UI at `/app` and the
API at `/api`. Codes are case-insensitive, so QR codes encode the URL in upper case. That lets the
symbol use the compact alphanumeric mode, which gives a less dense, easier-to-scan code.

## Local development

Prerequisites: Node 22+ and PostgreSQL 14+ (or Docker).

```bash
npm install
cp .env.example .env              # AUTH_MODE=dev signs in without Microsoft
createdb qrdirector               # or: docker compose up db -d
npm run dev                       # API on :8080, UI with hot reload on http://localhost:5173/app/
```

With `npm run dev`, set `PUBLIC_BASE_URL=http://localhost:5173`. Vite proxies `/api` and `/auth`
to the server.

To try the production container locally, with Postgres and dev sign-in:

```bash
docker compose up --build
open http://localhost:8080
```

## Tests

```bash
createdb qrdirector_test && createdb qrdirector_e2e
npm test                 # server (API, DB, QR rendering) + web (components, pages)
npm run build && npm run test:e2e
npm run lint && npm run typecheck
```

`TEST_DATABASE_URL` and `E2E_DATABASE_URL` override the default databases
(`postgres://postgres@localhost:5432/qrdirector_test` and `…/qrdirector_e2e`). Integration tests
truncate tables, so never point them at real data.

The QR test suite renders every module shape, eye combination, logo plate, frame and gradient to a
PNG and decodes it with ZXing (the engine behind most Android scanners). This proves each design
still scans.

## Microsoft Entra ID setup

1. In the Entra admin centre go to **App registrations → New registration**.
   - Supported account types: *Accounts in this organisational directory only*.
   - Redirect URI: platform **Web**, `https://<your-domain>/auth/callback`.
2. Under **Certificates & secrets**, create a client secret.
3. Set the environment variables:

   | Variable | Value |
   | -------- | ----- |
   | `AUTH_MODE` | `entra` (default) |
   | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | `AZURE_CLIENT_ID` | Application (client) ID |
   | `AZURE_CLIENT_SECRET` | The secret value |

4. Optional restrictions:
   - `AUTH_ALLOWED_EMAIL_DOMAINS=example.com,example.co.uk` limits sign-in to those domains.
   - `AUTH_REQUIRED_GROUP_ID=<group object id>` requires membership of a group. Add the *groups*
     claim under **Token configuration** (*Security groups*, ID token).
   - Alternatively, set *Assignment required* on the enterprise application and assign users there.

All signed-in users share one workspace: everyone can see and edit every campaign. Changes are
attributed to the user who made them.

## Deploying to Google Cloud Run

```bash
PROJECT=my-project REGION=europe-west2
gcloud artifacts repositories create qr-director --repository-format=docker --location=$REGION
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/qr-director/app:latest

# Secrets
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create qrd-session-secret --data-file=-
printf '%s' '<entra client secret>' | gcloud secrets create qrd-azure-secret --data-file=-
printf '%s' 'postgres://qrd:<password>@/qrdirector?host=/cloudsql/'$PROJECT:$REGION:qrd-db \
  | gcloud secrets create qrd-database-url --data-file=-

gcloud run deploy qr-director \
  --image $REGION-docker.pkg.dev/$PROJECT/qr-director/app:latest \
  --region $REGION --allow-unauthenticated \
  --add-cloudsql-instances $PROJECT:$REGION:qrd-db \
  --set-env-vars PUBLIC_BASE_URL=https://go.example.com,AZURE_TENANT_ID=...,AZURE_CLIENT_ID=... \
  --set-secrets SESSION_SECRET=qrd-session-secret:latest,AZURE_CLIENT_SECRET=qrd-azure-secret:latest,DATABASE_URL=qrd-database-url:latest \
  --min-instances 1 --cpu-boost
```

Notes:

- `--allow-unauthenticated` is required because short links are public. The UI and API enforce
  sign-in themselves.
- `--min-instances 1` avoids cold starts on the first scan, which matters for codes on printed
  material.
- Map a custom domain (Cloud Run domain mapping, or an external HTTPS load balancer) and set
  `PUBLIC_BASE_URL` to it **before printing codes**, because codes encode that domain.
- Behind an external load balancer, set `TRUST_PROXY_HOPS=2` so client IPs are read correctly.
- Migrations run on start-up (`RUN_MIGRATIONS=true`). Kysely's migration lock makes concurrent
  instances safe.
- Logs are JSON with a Cloud Logging `severity` field. `/healthz` (liveness) and `/readyz`
  (database check) can be used for probes.

### Visitor location

Country, region and city come from, in order of preference:

1. Edge headers from a proxy you trust, enabled with `GEO_HEADERS`. On a Google Cloud external load
   balancer, add custom request headers `X-Client-Region: {client_region}`,
   `X-Client-Region-Subdivision: {client_region_subdivision}` and `X-Client-City: {client_city}`,
   then set `GEO_HEADERS=google-lb`. `cloudflare`, `appengine` and `vercel` are also supported.
   These headers are ignored unless configured, because on plain Cloud Run visitors could send them
   themselves.
2. A MaxMind GeoLite2/GeoIP2 City database. Set `GEOIP_DB_PATH` to the `.mmdb` file, e.g. baked into
   a derived image or mounted from a volume. GeoLite2 needs a free MaxMind licence.

Without either, location columns stay empty and everything else still works.

## Configuration reference

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `DATABASE_URL` | *required* | PostgreSQL connection string |
| `PUBLIC_BASE_URL` | *required* | Public origin used in short links, QR codes and the OAuth redirect |
| `SESSION_SECRET` | *required* | ≥ 32 random characters; signs sessions and salts visitor IDs |
| `AUTH_MODE` | `entra` | `entra`, or `dev` for local use (refused when `NODE_ENV=production`) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | | Entra app registration |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | | Comma separated list of allowed e-mail domains |
| `AUTH_REQUIRED_GROUP_ID` | | Entra group users must belong to |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `PORT` | `8080` | Listen port (Cloud Run sets this) |
| `TRUST_PROXY_HOPS` | `1` | Reverse proxies in front of the app |
| `GEO_HEADERS` | | Trusted geo header sources: `google-lb`, `cloudflare`, `appengine`, `vercel` |
| `GEOIP_DB_PATH` | | MaxMind City database path |
| `RAW_IP_RETENTION_DAYS` | `90` | Blank stored IP addresses after N days (`0` keeps them) |
| `HIT_RETENTION_DAYS` | `0` | Delete visit records after N days (`0` keeps them) |
| `ROOT_REDIRECT_URL` | `/app` | Where the bare domain sends visitors |
| `NOT_FOUND_REDIRECT_URL` | | Send unknown or paused codes here instead of the built-in page |
| `QR_UPPERCASE_URLS` | `true` | Encode QR URLs in upper case for denser alphanumeric mode |
| `DATABASE_POOL_MAX` | `10` | Connection pool size per instance |
| `DATABASE_SSL` | `false` | Use TLS to the database |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, or `silent` |
| `RUN_MIGRATIONS` | `true` | Apply database migrations at start-up |

## Privacy

QR Director stores IP addresses and device details, which are personal data under UK/EU GDPR.
Before going live:

- Mention link tracking in your privacy notice.
- Choose `RAW_IP_RETENTION_DAYS` (default 90). A background job blanks older IPs every six hours;
  aggregate statistics and unique-visitor counts are unaffected.
- No cookies are set on visitors. Unique visitors are counted with a salted hash of IP address and
  user agent.

## Design notes

- Redirects use **302** with `Cache-Control: no-store`. A 301 would be cached by browsers and stop
  later destination changes reaching repeat visitors.
- Recording a visit never blocks or breaks a redirect. The insert is awaited, because Cloud Run
  throttles CPU after a response, but capped at 1.5 s, and failures are logged rather than shown to
  the visitor.
- `HEAD` requests (link previews, uptime checks) are not counted.
- PNG rasterising runs in a two-worker thread pool, so large exports never stall redirects. CSV
  exports stream in pages, so memory stays flat.
- A logo forces error-correction level H, and modules behind it are cleared according to the plate
  shape. The logo size slider is capped at 30 % of the code width, the largest size the decode
  tests confirm works across all shapes.
- Uploaded logos are type-sniffed from their bytes. SVGs containing scripts, event handlers, external
  references or entities are rejected. Logos are served with a sandboxing CSP.

## Licence

GPL-2.0, see [LICENSE](LICENSE). The bundled Inter font is under the SIL Open Font License
([server/src/assets/fonts/OFL.txt](server/src/assets/fonts/OFL.txt)).
