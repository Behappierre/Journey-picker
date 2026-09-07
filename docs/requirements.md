# London Train Optimiser

## 1. Objective

Build a mobile-first Progressive Web Application that answers one question extremely quickly:

**“What is the best way for me to get to London from home right now, and what time should I leave?”**

The user lives near Burton-on-Trent but is willing to drive to several different railway stations.

Different stations have:

- different driving times;
- different current traffic conditions;
- different train frequencies;
- different London journey times;
- different delays and cancellations;
- different parking/walking overheads;
- potentially different London terminals.

The application must combine **road journey time and live train information** and calculate the best complete journey, rather than simply showing the nearest station or next train.

The ideal output looks like:

> **BEST OPTION**
>
> Leave home in **18 minutes at 18:54**
>
> Drive **31 min** to [Station]
>
> Allow **8 min** to park and reach platform
>
> Catch **19:37 train**, currently expected **19:39**
>
> Arrive London **20:51**
>
> Confidence: **High**

Underneath, show the next two or three alternatives.

---

# 2. Technology

Build as an installable **PWA**, not a native Android application.

Recommended stack:

- Next.js
- React
- TypeScript
- Server-side API routes / serverless functions
- CSS/Tailwind or clean component-based CSS
- PWA manifest
- service worker
- deployable to Netlify or Vercel
- no database required for MVP

The application must work particularly well on an Android phone and be installable to the home screen.

It should open in `standalone` mode so it feels like an application rather than a website.

Do not expose Google or National Rail API credentials in browser JavaScript.

All third-party API calls requiring credentials must go through the backend.

---

# 3. External data providers

## 3.1 Road journey data

Implement a provider abstraction:

```ts
interface RoadRoutingProvider {
  getTravelTime(
    origin: LatLng,
    destination: LatLng,
    departureTime: Date
  ): Promise<RoadJourney>;
}
```

Create:

```ts
GoogleRoutesProvider
```

Use Google Routes API.

For driving calculations use:

```text
travelMode = DRIVE
routingPreference = TRAFFIC_AWARE_OPTIMAL
trafficModel = BEST_GUESS
```

The application must support future departure times.

Return:

```ts
interface RoadJourney {
  durationMinutes: number;
  staticDurationMinutes?: number;
  distanceKm?: number;
  calculatedAt: string;
}
```

Keep the provider abstraction clean so an alternative based on OpenStreetMap/National Highways data can later be implemented without changing the optimisation engine.

---

# 4. Railway data

Use the National Rail Darwin Live Departure Board JSON API.

Credentials must live server-side.

Create:

```ts
interface RailProvider {
  getDepartures(...): Promise<RailService[]>;
  getServiceDetails(...): Promise<RailServiceDetails>;
  getDisruptions(...): Promise<RailDisruption[]>;
}
```

Implement:

```ts
NationalRailDarwinProvider
```

Normalise the external API into internal objects. Do not let Darwin's response structures leak throughout the application.

Example internal structure:

```ts
interface RailService {
  serviceId: string;

  originCrs: string;
  destinationCrs: string;

  scheduledDeparture: Date;
  estimatedDeparture?: Date;

  scheduledArrival?: Date;
  estimatedArrival?: Date;

  operator?: string;
  platform?: string;

  cancelled: boolean;
  delayed: boolean;

  delayMinutes?: number;
}
```

Treat Darwin as the source of truth for live railway forecasts.

---

# 5. Station configuration

The application must support an arbitrary configurable list of stations.

Do not build optimisation logic around one particular station.

Each station configuration should contain approximately:

```ts
interface CandidateStation {
  id: string;

  name: string;
  crs: string;

  location: {
    lat: number;
    lng: number;
  };

  enabled: boolean;

  parkingMinutes: number;
  walkToPlatformMinutes: number;
  platformSafetyMinutes: number;

  defaultDriveMinutes?: number;

  railStrategies: RailStrategy[];
}
```

Example:

```ts
parkingMinutes: 5
walkToPlatformMinutes: 3
platformSafetyMinutes: 4
```

The combined station overhead would therefore be 12 minutes.

These values must be editable in Settings because real-world experience is more useful than generic station assumptions.

---

# 6. Rail strategies

The National Rail free live departure API should not be treated as a generic journey-planning engine.

Instead create configurable **rail strategies** for the relatively small number of journeys the user actually makes.

Support two strategy types in Version 1.

## Direct

```ts
{
  type: "direct",
  destinationCrs: "XXX"
}
```

## One change

```ts
{
  type: "one_change",
  interchangeCrs: "XXX",
  destinationCrs: "YYY",
  minimumConnectionMinutes: 8
}
```

This allows a local station involving a connection to compete against a farther station offering a direct train.

The optimisation engine must therefore compare **complete journeys to London**, not individual trains.

Do not assume every candidate station serves the same London terminal.

---

# 7. Journey construction

For each enabled station:

1. Obtain relevant departures.
2. Remove cancelled services.
3. Obtain service details where required.
4. Build complete possible journeys to the configured London destination.
5. For connecting journeys, use the LIVE estimated arrival at the interchange.
6. Apply the configured minimum connection time.
7. Reject connections that are no longer realistic because of delays.
8. Calculate the expected London arrival time.

Represent every complete option as:

```ts
interface JourneyOption {
  station: CandidateStation;

  leaveHomeAt: Date;

  drivingMinutes: number;

  stationOverheadMinutes: number;

  trainDeparture: Date;
  scheduledTrainDeparture: Date;

  londonArrival: Date;

  changes: number;

  services: RailService[];

  catchMarginMinutes: number;

  confidence: "high" | "medium" | "low";

  disruptionMessages: string[];

  score: number;
}
```

---

# 8. Critical calculation: when to leave home

This is the most important part of the application.

Do NOT simply:

```text
current time + current drive time
```

The application should work backwards from each viable train.

For a train departing at time `T`:

```text
Train departure
- platform safety allowance
- walking time
- parking allowance
= required arrival at station car park
```

Then calculate:

```text
Required station arrival
- predicted driving duration
= leave-home time
```

But driving time itself depends on the proposed leave-home time because traffic may change.

Therefore use an iterative calculation.

Pseudo-code:

```ts
let departureEstimate =
    trainSafeDeparture
    - stationOverhead
    - initialDriveEstimate;

for (let i = 0; i < 2; i++) {

  const traffic =
      await roadProvider.getTravelTime(
          home,
          station,
          departureEstimate
      );

  departureEstimate =
      trainSafeDeparture
      - stationOverhead
      - traffic.durationMinutes;
}
```

Two iterations should normally be sufficient.

The result is the recommended time to leave home.

---

# 9. Do not blindly trust a delayed train

This needs specific logic.

If a train is scheduled at 19:00 and currently estimated at 19:15, the application should not assume it is completely safe to arrive at 19:14.

Forecasts can recover.

Create:

```ts
lateTrainRecoveryBufferMinutes = 5
```

For an on-time train:

```text
safe departure = scheduled departure
```

For a delayed train with a precise ETD:

```text
safe departure =
max(
    scheduled departure,
    estimated departure - lateTrainRecoveryBuffer
)
```

For a service simply showing `Delayed` without a usable ETA:

```text
safe departure = scheduled departure
```

This makes the optimiser conservative rather than encouraging the user to chase a delayed train.

Make the recovery buffer configurable.

---

# 10. Optimisation criteria

Do not hide the decision behind an unexplained AI score.

The result must be understandable.

Implement three user-selectable priorities:

### Fastest

Choose the journey giving the earliest London arrival.

### Balanced — DEFAULT

Use this logic:

1. Reject journeys below the minimum catch-confidence threshold.
2. Find the earliest London arrival.
3. Any journey arriving within 10 minutes of the fastest journey enters the preferred group.
4. Within that group prefer:
   - less driving;
   - fewer changes;
   - larger catch margin;
   - lower disruption risk.

This avoids recommending a much longer drive just to arrive in London three minutes earlier.

### Least driving

Prefer the shortest driving leg unless it materially delays arrival in London.

Keep scoring weights in a separate configuration module.

---

# 11. Confidence calculation

Display:

**HIGH**

when:

- healthy road margin;
- healthy platform margin;
- no problematic connection;
- no serious disruption.

**MEDIUM**

when:

- relying partly on a delayed train;
- connection margin is modest;
- traffic is unusually heavy;
- railway forecasts are changing.

**LOW**

when:

- tight connection;
- train has significant disruption;
- recommended catch depends substantially on current delay;
- data is stale.

Low-confidence options can appear as alternatives but should not normally be the recommended journey.

---

# 12. Main application screen

The home screen should require virtually no interaction.

At the top:

```text
LONDON
Updated 18:36
```

Large central result card:

```text
LEAVE IN
18 MIN

18:54

Drive to [Station]

31 min drive
12 min park/platform

19:37 train
Expected 19:39

London 20:51

HIGH CONFIDENCE
```

Buttons:

```text
REFRESH
OPEN ROUTE
```

`OPEN ROUTE` should launch navigation to the selected station.

Below the main result show perhaps three alternatives:

```text
Alternative 1
Leave 18:43
Station X
London 20:56

Alternative 2
Leave 19:08
Station Y
London 21:07
```

The recommended option must visually dominate the screen.

Do not make the user inspect a timetable to determine the answer.

---

# 13. Modes

At the top provide two primary modes.

## NEXT BEST JOURNEY

Default.

Question being answered:

```text
If I want to travel to London next,
what should I do?
```

## ARRIVE BY

Allow the user to enter:

```text
Arrive London by 09:30
```

The optimiser then works backwards and answers:

```text
Leave home 07:42

Drive to [Station]

08:27 train

London 09:24
```

The `Arrive By` mode is important because it will often be more valuable for meetings than simply finding the next train.

---

# 14. Settings

Create a simple settings screen.

Settings should include:

### Home

- saved home coordinates;
- option `Use current location as home`.

Do not needlessly transmit or store the textual home address.

Coordinates can be stored locally on the user's phone.

### Stations

For every station:

- enabled/disabled;
- parking time;
- walking time;
- safety allowance.

### Preferences

- Fastest / Balanced / Least Driving;
- late-train recovery buffer;
- minimum connection buffer;
- maximum planning horizon;
- number of alternatives shown.

Default planning horizon:

```text
180 minutes
```

---

# 15. PWA behaviour

Include:

```text
manifest.json
```

with:

```text
display: standalone
orientation: portrait
```

Supply proper:

```text
192x192
512x512
maskable
```

application icons.

Use a service worker.

The application shell may be cached.

**Live journey results must never silently be presented as current when they are cached.**

Every result must have:

```text
Data updated 18:36:22
```

If railway or road data is older than the defined freshness limit, visibly display:

```text
LIVE DATA MAY BE STALE
```

---

# 16. API architecture

Suggested API endpoint:

```text
POST /api/plan
```

Request:

```json
{
  "origin": {
    "lat": 0,
    "lng": 0
  },
  "mode": "next",
  "objective": "balanced",
  "arrivalBy": null
}
```

Response:

```json
{
  "generatedAt": "...",
  "recommended": {},
  "alternatives": [],
  "roadDataStatus": "live",
  "railDataStatus": "live"
}
```

The browser should not orchestrate multiple Google/National Rail requests.

The backend `/api/plan` endpoint should orchestrate them and return one clean result to the UI.

---

# 17. Caching and API cost control

This is a single-user application, so API usage should be extremely modest.

Implement:

### Rail

Cache identical Darwin requests for approximately:

```text
20–30 seconds
```

### Road

Cache road requests by:

```text
origin
station
departure-time 5-minute bucket
```

for approximately:

```text
60–120 seconds
```

Do not continuously poll when the application is closed.

When the application is open, allow manual refresh.

Optional automatic refresh:

```text
60 seconds
```

but stop refreshing when the app is in the background.

---

# 18. Resilience

If road traffic API fails:

1. use a recently cached live value if available;
2. otherwise use `defaultDriveMinutes`;
3. mark the result as degraded;
4. do not label confidence HIGH.

If Darwin fails:

- do not invent live train information;
- clearly display `Live railway information unavailable`.

If one station fails:

- continue evaluating the other stations.

One external API failure must not crash the entire application.

---

# 19. Time handling

All internal times must use full ISO date/time objects.

Timezone:

```text
Europe/London
```

Do not compare railway services purely as `HH:mm` strings.

Correctly handle:

- journeys spanning midnight;
- daylight saving changes;
- services scheduled shortly after midnight;
- delayed trains crossing calendar days.

---

# 20. Testing

Create unit tests for the optimisation engine independent of external APIs.

At minimum cover:

1. On-time train comfortably catchable.
2. On-time train just missed.
3. Train delayed by 20 minutes.
4. Train marked only `Delayed`.
5. Cancelled train.
6. Direct journey versus faster connecting journey.
7. Connection becoming impossible because first train is late.
8. Heavy road traffic changing the recommended station.
9. Two routes arriving within ten minutes, where Balanced selects the route with less driving.
10. Google future traffic changing the correct leave-home time.
11. Midnight crossing.
12. UK daylight-saving transition.
13. Darwin API unavailable.
14. Google Routes API unavailable.

Mock both providers in optimisation tests.

Do not require real API calls for unit tests.

---

# 21. Suggested source structure

```text
/src
  /app
    page.tsx
    settings/
    api/
      plan/

  /components
    BestJourneyCard.tsx
    AlternativeJourneyCard.tsx
    ConfidenceBadge.tsx
    SettingsPanel.tsx

  /domain
    journey.ts
    rail.ts
    road.ts
    station.ts

  /providers
    /rail
      NationalRailDarwinProvider.ts

    /road
      GoogleRoutesProvider.ts

  /services
    JourneyPlanner.ts
    RailJourneyBuilder.ts
    LeaveTimeCalculator.ts
    JourneyRanker.ts
    ConfidenceCalculator.ts

  /config
    stations.ts
    optimisation.ts

  /tests
```

Keep optimisation logic OUT of React components.

The UI should render results. It should not calculate journeys.

---

# 22. Environment variables

Use environment variables similar to:

```text
GOOGLE_MAPS_API_KEY=
NATIONAL_RAIL_USERNAME=
NATIONAL_RAIL_PASSWORD=
```

Never commit secrets.

Provide:

```text
.env.example
```

containing variable names but no credentials.

---

# 23. Observability

In development mode log:

```text
station evaluated
road duration
rail option
calculated leave time
London arrival
rejection reason
ranking score
```

For example:

```text
Station A
drive: 31 min
station overhead: 11 min
train: 19:37 / ETD 19:39
London: 20:51
leave: 18:54
confidence: high
```

This is essential because the optimiser must be easy to audit when its recommendation looks surprising.

---

# 24. Acceptance test

The completed application must pass this human test.

When the user taps the home-screen icon, within a few seconds the screen should answer:

**When should I leave?**

**Which station should I drive to?**

**How long will the drive take with current/predicted traffic?**

**Which train am I aiming for?**

**Is that train currently on time?**

**When should I reach London?**

**Why is this better than the alternatives?**

The user should not have to mentally combine Google Maps and railway departure information themselves.

That calculation is the purpose of the application.

---

# 25. Important implementation principle

Do not build a train timetable app with a map bolted onto it.

Do not build a Google Maps screen with train departures bolted onto it.

Build a **door-to-London decision engine**.

The fundamental object being optimised is:

```text
HOME
  ↓
DRIVE
  ↓
PARK
  ↓
WALK TO PLATFORM
  ↓
TRAIN / CONNECTION
  ↓
LONDON
```

Every recommendation must be based on the performance and risk of that complete chain.

---

# 26. Phase 2 — do not implement yet

Structure the code so these can subsequently be added without major redesign:

- specific London destination rather than railway terminal;
- London Underground/TfL onward journey;
- walking/taxi leg in London;
- station parking availability;
- parking cost;
- train ticket cost;
- season-ticket preferences;
- historical reliability by individual service;
- push notification such as “traffic has worsened — leave 7 minutes earlier”;
- calendar integration, automatically using the location/time of a London meeting;
- learning from actual drive times and how long the user personally takes to park and reach the platform.

Do not implement these in the first release.

Build provider interfaces and domain models cleanly enough that they can be introduced later.