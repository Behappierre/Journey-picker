# Choosing a rail provider

All three TypeScript adapters implement the same `RailProvider` and return the same `RailService` objects. The optimiser, connection builder and UI require no provider-specific branches. Provider selection is explicit and server-side; a failure does not silently switch feeds.

## Huxley 2

```dotenv
RAIL_PROVIDER=huxley
HUXLEY_BASE_URL=https://your-trusted-huxley-host.example
HUXLEY_ACCESS_TOKEN=
```

`src/providers/rail/HuxleyRailProvider.ts` uses expanded departure boards (`expand=true`), not bare departures, so the destination calling-point arrival is available. Two overlapping 120-minute windows cover the configured three-hour horizon. Identical board and disruption requests share a 25-second cache. Service IDs are converted to URL-safe base64 for `/service/{id}`.

Mapping reuses the Darwin normalizer: `std`/`etd` at the boarding station; `st`/`et` at the destination; operator/platform/cancellations/notices; original `generatedAt`. The adapter filters downstream calling points locally, permitting interchangeable direct and one-change strategies. It excludes associated services that require an extra transfer and replacement bus groups. It never creates an arrival by adding a guessed duration to departure.

A token can be omitted **only if the Huxley host already supplies its Darwin token and permits anonymous clients**. The project's demo host has no uptime guarantee; an unauthenticated expanded LTV board returned HTTP 500 during this implementation. You can configure a trusted self-hosted instance or provide its access token. Do not send a Darwin token to an untrusted proxy. Authentication query parameters remain inside server-side requests and are never returned in errors/results.

## Realtime Trains (current API)

Register at https://api-portal.rtt.io and set one token type:

```dotenv
RAIL_PROVIDER=rtt
RTT_ACCESS_TOKEN=
# OR, if the portal gives you a refresh token:
RTT_REFRESH_TOKEN=
```

`src/providers/rail/RealtimeTrainsProvider.ts` implements the current API at `https://data.rtt.io`, pinned with `Version: 2026-07-25`:

- `GET /gb-nr/location?code=LTV&filterTo=EUS&timeFrom=...&timeTo=...` finds candidates.
- `GET /gb-nr/service?uniqueIdentity=...` supplies complete downstream arrival forecasts.
- `GET /api/get_access_token` exchanges a refresh token when necessary. Refresh requests are coalesced and the access token is reused until shortly before expiry.
- `getDisruptions` maps the station-level reasons and system status; train-specific notices are included in each service.

All calls use server-side Bearer authentication. Do not put either token in browser JavaScript or a `NEXT_PUBLIC_` variable. Account entitlements determine access; the adapter does not assume free unlimited requests. It caches requests for 25 seconds, bounds service-detail lookups to eight trains per strategy, and observes `Retry-After` cooldown without automatic retry loops. If some detail calls fail, the remaining results carry an incomplete-comparison notice and lower confidence. Cold Netlify instances do not share caches/cooldown.

### RTT field mapping

| Internal field | RTT Next Generation source |
| --- | --- |
| `serviceId` | `service.scheduleMetadata.uniqueIdentity` (includes run date) |
| `originCrs`, `destinationCrs` | Requested boarding CRS and downstream `location.shortCodes` |
| `scheduledDeparture`, `scheduledArrival` | `temporalData.departure/arrival.scheduleAdvertised` |
| `estimatedDeparture`, `estimatedArrival` | `realtimeForecast` (or actual arrival when supplied) |
| `operator` | `scheduleMetadata.operator.name` |
| `platform` | Boarding location's actual → forecast → planned platform |
| `cancelled` | Temporal cancellation flag, cancelled/diverted call, or incompatible realtime call type |
| `delayMinutes` | Forecast departure minus advertised departure, clamped at zero |
| `delayed` | Positive departure delay or explicit service delay reason |
| `disruptionMessages` | Station/service reasons and degraded system status |
| `calculatedAt` | Response retrieval time, reduced by HTTP `Age` where present |

RTT's current schema supplies full ISO dates and offsets, so no HH:mm date guessing is necessary. The adapter does not promote WTT/internal times, `realtimeEstimate` for no-report scenarios, missing forecasts or schedule-only system data into confirmed live forecasts. Already-departed trains, non-passenger trains, buses, non-public calls, pickup-only destinations and travel beyond an early termination are excluded. Associated trains are not implicitly treated as through services.

The API does not expose a per-forecast update timestamp in these documented responses; `calculatedAt` is therefore when the response was fetched, not a fabricated source event timestamp. Provider system status and uncertainty still affect confidence.

### About the legacy RTT username/password endpoints

The original `api.rtt.io/api/v1/json/...` API has closed new registrations and is scheduled to retire on **30 September 2026**, according to RTT's launch announcement. This adapter deliberately implements the current API rather than adding a soon-obsolete Basic-auth integration. Existing legacy usernames/passwords will not work with it; request a current portal token.

## Native Darwin JSON

```dotenv
RAIL_PROVIDER=darwin
NATIONAL_RAIL_USERNAME=
NATIONAL_RAIL_PASSWORD=
```

The original `NationalRailDarwinProvider` remains available. Change environment variables and redeploy to select it. A SOAP token is not a Basic-auth password; Huxley accepts a SOAP token where configured, while this native JSON adapter expects credentials for its documented service.

## Sources used for implementation

- [Huxley 2 API documentation](https://huxley2.azurewebsites.net/)
- [Huxley 2 source and demo reliability statement](https://github.com/jpsingleton/Huxley2)
- [Official RTT Next Generation OpenAPI specification](https://github.com/realtimetrains/api-specification)
- [RTT API launch and legacy retirement announcement](https://blog.realtimetrains.com/2026/03/next-generation-api-now-available/)

Tests use synthetic, schema-shaped fixtures. Authenticated live RTT/Darwin validation still requires your credentials. The public Huxley demo failed its availability check, so token-free live operation has not been verified.
