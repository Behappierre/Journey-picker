# London, next. — Journey Picker

A mobile-first, installable PWA that compares the complete drive → park → platform → train → London journey. Built with Next.js, React and TypeScript for Netlify. No database and no browser-side provider credentials.

## Run locally

Use Node 22 or later:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`. Add credentials to `.env.local`, then open http://localhost:3000. Set your home coordinates in Settings. The app also builds without credentials and reports unavailable rail information rather than inventing results.

```sh
npm test
npm run typecheck
npm run build
npm start
```

## Deploy on Netlify

1. Import `Behappierre/Journey-picker` from GitHub in Netlify. Use the repository root as the base directory.
2. `netlify.toml` supplies the build command `npm run build`, publish directory `.next`, and Node 22. Netlify automatically supplies its OpenNext adapter. **Do not use static export or a generic SPA redirect**: `/api/plan` must execute server-side.
3. In **Project configuration → Environment variables**, add the variables below with **Functions** scope (or all scopes) and select the deployment contexts where they should be available. Keep values out of Git and out of `netlify.toml`.
4. Deploy. After changing environment variables, redeploy so the function receives them.
5. Open the HTTPS site on Android Chrome, configure your home and stations, and select **Add to Home screen / Install app**.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Google Routes API key, server-side only |
| `RAIL_PROVIDER` | `darwin` (default), `huxley`, or `rtt` |
| `HUXLEY_BASE_URL`, `HUXLEY_ACCESS_TOKEN` | Trusted Huxley 2 endpoint and optional host/Darwin token |
| `RTT_ACCESS_TOKEN` or `RTT_REFRESH_TOKEN` | Current RTT API bearer/refresh token; choose one |
| `NATIONAL_RAIL_USERNAME` | Username for the National Rail LDBWS JSON service |
| `NATIONAL_RAIL_PASSWORD` | Password for the National Rail LDBWS JSON service |
| `JOURNEY_ACCESS_TOKEN` | Optional personal access code protecting planning requests; enter it in Settings |

For a CLI preview, authenticate with `npx netlify-cli login`, link the project with `npx netlify-cli link`, then run `npx netlify-cli deploy --build`. Publish with `npx netlify-cli deploy --build --prod` when ready. Git-connected deployments build pushes and pull-request previews using the same configuration.

### Google setup

Enable **Routes API** and billing in the Google Cloud project that owns the key. Restrict the key to Routes API and set appropriate quotas. This is a server-side key: browser HTTP-referrer restrictions do not authenticate serverless requests. Do not add a `NEXT_PUBLIC_` prefix. The app uses `DRIVE`, `TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`, a future `departureTime` and a minimal field mask.

### National Rail setup

**Interim alternatives are implemented:** select `RAIL_PROVIDER=huxley` or `RAIL_PROVIDER=rtt`. See [rail provider configuration and field mapping](docs/rail-providers.md). Huxley token-free access depends on its host; RTT uses its current token API because legacy registrations are closed. Provider credentials remain server-side.

The adapter implements the documented **LDBWS JSON 20220120** API with Basic authentication at `https://realtime.nationalrail.co.uk/LDBWS/api/20220120`. Obtain credentials for that service; a Google key cannot provide Darwin rail data. A legacy SOAP access token or Rail Data Marketplace `x-apikey` subscription is not interchangeable with these credentials. If your subscription uses a different endpoint/auth scheme, adapt the provider to that product before enabling live use.

Missing/invalid railway credentials produce **Live railway information unavailable**. Missing Google credentials use the editable per-station default drive estimate, visibly marked degraded and never high confidence. Actual provider access requires your credentials and has to be verified on your deployment.

## How the recommendation works

- Station definitions and rail strategies are data, not hard-coded optimiser logic. Initial suggestions: Lichfield Trent Valley, Tamworth and Derby direct; Burton via Derby. Verify the car park coordinates and overheads for your route. Add/remove stations and direct/one-change strategies in Settings.
- For a delayed train, conservative departure is `max(schedule, estimate − recovery buffer)`. A vague `Delayed` uses the schedule.
- Work backwards through platform safety, walking, parking and a 3-minute road contingency. Query predicted traffic twice at revised departure times, then check once more, retaining the conservative observed drive duration. Reject a departure that is already too late.
- Connections require a usable live first-leg arrival and the larger of the global/station connection minimum. Extra margin and disruption affect confidence.
- Fastest chooses the earliest arrival among options meeting the confidence threshold. Balanced first forms a group within 10 minutes of fastest, then sorts by driving, changes, catch margin and disruption. Least driving allows up to 30 minutes after fastest. Low-confidence options appear only as alternatives. Constants live in `src/config/optimisation.ts`.
- Arrive by filters complete London arrivals against a dated deadline, then applies the selected priority. It is limited to the live departure horizon (30–180 minutes), **not an advance timetable search**. A tomorrow-morning meeting cannot yet be planned from tonight's live board. Ambiguous/nonexistent UK clock-change input hours require a different time.

## Architecture and operational limits

- `src/domain`: serializable settings, typed provider interfaces, full Date-based domain objects and validated API input.
- `src/providers`: Google and Darwin adapters; normalisation stays here. Darwin board-with-details includes calling points without a service-detail request for every train.
- `src/services`: journey construction, departure calculation, confidence and ranking, independent of React.
- `POST /api/plan`: one server-side orchestration request; no-store responses, bounded input, upstream timeouts, optional access code and same-origin browser enforcement.
- `src/components`: result cards and local settings. Home is saved locally and sent to the planning server/Google only as coordinates. The optional access code is session-only. No provider key entry in the UI.
- `public/sw.js`: caches the shell and static assets; never caches the API or live results. All results carry provider timestamps and visibly age after two minutes. No periodic API polling; manual refresh and one refresh when opening the app.
- Warm-instance caches coalesce identical requests: rail 25 seconds; road 90 seconds by coordinates and five-minute departure bucket. Recent same-bucket traffic can be reused for five minutes on error, labelled cached. Serverless cold starts reset caches; this is not a durable cross-instance cache or rate limiter.
- Maximum 12 configured stations, four strategies per station, and ten candidate itineraries per station per request bound work. Station tasks and candidate calculations run concurrently. Development logs include station, drive, leave time, arrival, confidence, ranking and rejection reasons, without logging home coordinates or secrets.
- Provider failures are isolated by station/strategy. All disruption notices conservatively lower confidence because the feed does not guarantee an app-specific severity. Unknown arrival forecasts remain low confidence; they never support a connection recommendation.

For a publicly discoverable personal site, set `JOURNEY_ACCESS_TOKEN` to limit who can incur routing requests. Origin checks alone are not authentication. Do not put paid API credentials in public build-time variables.

## Verification

The mocked-provider test suite covers the requested 14 cases plus live connection uncertainty, partial station outages, arrival deadlines, stale forecasts, Darwin normalization and Google request parameters. GitHub Actions runs tests, TypeScript and the production build. Live API account entitlement and timings cannot be validated by the mocked tests.

PWA icons are committed at 192 and 512 pixels, including a maskable variant. `scripts/icons.mjs` reproduces them using Sharp (available through Next.js). No live journey result is persisted in browser storage.

## Provider and hosting references

- [Netlify Next.js support and automatic adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Google traffic model request configuration](https://developers.google.com/maps/documentation/routes/traffic-model)
- [National Rail JSON authentication documentation](https://realtime.nationalrail.co.uk/LDBWS/docs/documentation.html)
- [National Rail API schema](https://realtime.nationalrail.co.uk/LDBWS/static/ldbws.json)

Phase two items (TfL, fares, parking availability, calendar integration and notifications) are intentionally outside this release.
