import { z } from "zod";
import { DateTime } from "luxon";
import type {
  RailProvider,
  RailService,
  RailServiceDetails,
  RailDisruption,
} from "../../domain/models";
import { TtlCache } from "../cache";
import { addMinutes, minutesBetween } from "../../services/time";

// RTT Next Generation API, official 2026-07-25 specification. Do not map
// scheduleInternal (staff/WTT timing) into a passenger's advertised departure.
const optionalText = z.string().nullish();
const temporalSchema = z.object({
  scheduleAdvertised: optionalText,
  realtimeForecast: optionalText,
  realtimeActual: optionalText,
  realtimeEstimate: optionalText,
  realtimeNoReport: z.boolean().nullish(),
  isCancelled: z.boolean().nullish(),
  cancellationReasonCode: optionalText,
});
const timeDataSchema = z.object({
  arrival: temporalSchema.nullish(),
  departure: temporalSchema.nullish(),
  scheduledCallType: optionalText,
  realtimeCallType: optionalText,
  displayAs: optionalText,
});
const reasonSchema = z.object({
  type: optionalText,
  code: optionalText,
  shortText: optionalText,
  longText: optionalText,
});
const reasonsSchema = z.array(reasonSchema).nullish();
const metadataSchema = z.object({
  uniqueIdentity: z.string().min(1),
  namespace: optionalText,
  identity: optionalText,
  departureDate: optionalText,
  operator: z.object({ name: optionalText }).nullish(),
  modeType: optionalText,
  inPassengerService: z.boolean().nullish(),
});
const locationMetadataSchema = z.object({
  platform: z
    .object({
      actual: optionalText,
      forecast: optionalText,
      planned: optionalText,
    })
    .nullish(),
});
const lineSchema = z.object({
  scheduleMetadata: metadataSchema,
  temporalData: timeDataSchema,
  locationMetadata: locationMetadataSchema.nullish(),
  reasons: reasonsSchema,
});
const statusSchema = z
  .object({ realtimeNetworkRail: optionalText, rttCore: optionalText })
  .nullish();
const boardSchema = z.object({
  systemStatus: statusSchema,
  reasons: reasonsSchema,
  services: z.array(lineSchema).nullish(),
});
const serviceSchema = z.object({
  systemStatus: statusSchema,
  service: z.object({
    scheduleMetadata: metadataSchema,
    reasons: reasonsSchema,
    locations: z.array(
      z.object({
        temporalData: timeDataSchema,
        locationMetadata: locationMetadataSchema.nullish(),
        location: z.object({ shortCodes: z.array(z.string()).nullish() }),
        reasons: reasonsSchema,
      }),
    ),
  }),
});
export type RttServiceResponse = z.infer<typeof serviceSchema>;
type RttBoard = z.infer<typeof boardSchema>;
type Cached<T> = { data: T; fetchedAt: string };
export interface RealtimeTrainsOptions {
  accessToken?: string;
  refreshToken?: string;
}
function date(value: string | null | undefined): Date | undefined {
  // Live gb-nr responses use dated UK wall-clock times without an offset,
  // even though the published schema describes RFC3339. Never use host time.
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return undefined;
  const parsed = DateTime.fromISO(value, { zone: "Europe/London", setZone: true });
  if (!parsed.isValid || parsed.getPossibleOffsets().length > 1) return undefined;
  // Luxon moves nonexistent spring-forward times; reject those instead.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) && parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== value.slice(0, 19)) return undefined;
  return parsed.toJSDate();
}
function messages(reasons: z.infer<typeof reasonsSchema>): string[] {
  return (reasons ?? [])
    .map(
      (r) =>
        r.longText ||
        r.shortText ||
        `${r.type ?? "Railway notice"}${r.code ? ` (${r.code})` : ""}`,
    )
    .map((t) => t.replace(/<[^>]*>/g, "").slice(0, 1200));
}
function statusMessages(status: z.infer<typeof statusSchema>): string[] {
  if (!status || status.rttCore !== "OK" || status.realtimeNetworkRail !== "OK")
    return ["RTT live data is limited, degraded or not confirmed available"];
  return [];
}
const passenger = (meta: z.infer<typeof metadataSchema>) =>
  meta.modeType === "TRAIN" && meta.inPassengerService === true;
const canBoard = (value: string | null | undefined) =>
  value === "ADVERTISED_OPEN" || value === "ADVERTISED_PICK_UP";
const canAlight = (value: string | null | undefined) =>
  value === "ADVERTISED_OPEN" || value === "ADVERTISED_SET_DOWN";
const cancelledDisplay = (value: string | null | undefined) =>
  value === "CANCELLED" ||
  value === "DIVERTED" ||
  value === "PASS" ||
  value === null;

/** Pure mapping exported for fixture-based tests. All times are already dated ISO values. */
export function normaliseRttService(
  input: unknown,
  originCrs: string,
  fetchedAt: string,
): RailService[] {
  const response = serviceSchema.parse(input);
  const { service, systemStatus } = response;
  const meta = service.scheduleMetadata;
  if (!passenger(meta)) return [];
  const originIndex = service.locations.findIndex(
    (l) =>
      l.location.shortCodes?.includes(originCrs) &&
      canBoard(l.temporalData.scheduledCallType),
  );
  if (originIndex < 0) return [];
  const origin = service.locations[originIndex];
  const departure = origin.temporalData.departure;
  const scheduledDeparture = date(departure?.scheduleAdvertised);
  if (
    !scheduledDeparture ||
    departure?.realtimeActual ||
    departure?.realtimeNoReport
  )
    return [];
  const forecastDeparture = date(departure?.realtimeForecast);
  const feedDegraded = statusMessages(systemStatus);
  const originCancelled =
    !!departure?.isCancelled ||
    cancelledDisplay(origin.temporalData.displayAs) ||
    origin.temporalData.displayAs === "TERMINATES" ||
    !canBoard(
      origin.temporalData.realtimeCallType ??
        origin.temporalData.scheduledCallType,
    );
  const options: RailService[] = [];
  for (const stop of service.locations.slice(originIndex + 1)) {
    const timing = stop.temporalData;
    const arrival = timing.arrival;
    const scheduledArrival = date(arrival?.scheduleAdvertised);
    const arrivalForecast =
      date(arrival?.realtimeActual) ?? date(arrival?.realtimeForecast);
    if (
      canAlight(timing.scheduledCallType) &&
      scheduledArrival &&
      scheduledArrival >= scheduledDeparture
    ) {
      for (const destinationCrs of stop.location.shortCodes ?? []) {
        if (!/^[A-Z]{3}$/.test(destinationCrs)) continue;
        const disruptionMessages = [
          ...new Set([
            ...feedDegraded,
            ...messages(service.reasons),
            ...messages(origin.reasons),
            ...messages(stop.reasons),
          ]),
        ];
        const delayMinutes = forecastDeparture
          ? Math.max(0, minutesBetween(forecastDeparture, scheduledDeparture))
          : undefined;
        options.push({
          serviceId: meta.uniqueIdentity,
          originCrs,
          destinationCrs,
          scheduledDeparture,
          estimatedDeparture: forecastDeparture,
          scheduledArrival,
          estimatedArrival: arrival?.realtimeNoReport
            ? undefined
            : arrivalForecast,
          operator: meta.operator?.name ?? undefined,
          platform:
            origin.locationMetadata?.platform?.actual ??
            origin.locationMetadata?.platform?.forecast ??
            origin.locationMetadata?.platform?.planned ??
            undefined,
          cancelled:
            originCancelled ||
            !!arrival?.isCancelled ||
            cancelledDisplay(timing.displayAs) ||
            timing.displayAs === "STARTS" ||
            !canAlight(timing.realtimeCallType ?? timing.scheduledCallType),
          delayed:
            (delayMinutes ?? 0) > 0 ||
            (service.reasons ?? []).some((r) => r.type === "DELAY"),
          delayMinutes,
          departureUncertain: !forecastDeparture || feedDegraded.length > 0,
          arrivalUncertain:
            !arrivalForecast ||
            !!arrival?.realtimeNoReport ||
            feedDegraded.length > 0,
          calculatedAt: fetchedAt,
          disruptionMessages,
        });
      }
    }
    // Do not follow associated trains or carry a passenger beyond an early termination.
    if (timing.displayAs === "TERMINATES") break;
  }
  return options;
}

export class RealtimeTrainsProvider implements RailProvider {
  readonly name = "Realtime Trains";
  private cache = new TtlCache<Cached<unknown>>();
  private token?: { value: string; expires: number };
  private refreshing?: Promise<string>;
  private cooldownUntil = 0;
  constructor(
    private options: RealtimeTrainsOptions,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async fetchJson(
    path: string,
    token: string,
  ): Promise<Cached<unknown>> {
    if (Date.now() < this.cooldownUntil)
      throw new Error("RTT rate limit; try later");
    const response = await this.fetcher(`https://data.rtt.io/${path}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(7000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Version: "2026-07-25",
      },
    });
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds =
        retry && /^\d+$/.test(retry)
          ? Number(retry)
          : retry
            ? Math.max(1, (Date.parse(retry) - Date.now()) / 1000)
            : 60;
      this.cooldownUntil =
        Date.now() +
        (Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), 3600) : 60) *
          1000;
      throw new Error("RTT rate limit; try later");
    }
    if (!response.ok) throw new Error(`RTT returned ${response.status}`);
    const age = Math.max(0, Number(response.headers.get("age")) || 0);
    return {
      data:
        response.status === 204
          ? {
              services: [],
              systemStatus: { rttCore: "OK", realtimeNetworkRail: "OK" },
            }
          : await response.json(),
      fetchedAt: new Date(Date.now() - age * 1000).toISOString(),
    };
  }
  private async accessToken(): Promise<string> {
    if (this.options.accessToken) return this.options.accessToken;
    if (!this.options.refreshToken)
      throw new Error("RTT credentials are not configured");
    if (this.token && this.token.expires > Date.now() + 60000)
      return this.token.value;
    if (!this.refreshing)
      this.refreshing = this.fetchJson(
        "api/get_access_token",
        this.options.refreshToken,
      )
        .then((response) => {
          const parsed = z
            .object({ token: z.string().min(1), validUntil: z.string() })
            .parse(response.data);
          const expiry = date(parsed.validUntil);
          if (!expiry || +expiry <= Date.now())
            throw new Error("RTT access token has expired");
          this.token = { value: parsed.token, expires: +expiry };
          return parsed.token;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    return this.refreshing;
  }
  private async request(path: string) {
    return this.cache.resolve(path, 25000, async () =>
      this.fetchJson(path, await this.accessToken()),
    );
  }
  private async board(
    crs: string,
    now: Date,
    horizon: number,
    destination?: string,
  ): Promise<Cached<RttBoard>> {
    // Bucket the query anchor so manual refreshes can reuse a warm 25-second cache.
    const start = new Date(Math.floor(+now / 60000) * 60000);
    // Include late-running services whose scheduled departure is already in the past.
    const params = new URLSearchParams({
      code: crs,
      timeFrom: addMinutes(start, -120).toISOString(),
      timeTo: addMinutes(start, horizon + 1).toISOString(),
      detailed: "false",
    });
    if (destination) params.set("filterTo", destination);
    const response = await this.request(`gb-nr/location?${params}`);
    return { ...response, data: boardSchema.parse(response.data) };
  }
  async getDepartures(
    originCrs: string,
    destinationCrs: string,
    now: Date,
    horizon: number,
  ): Promise<RailService[]> {
    const board = await this.board(originCrs, now, horizon, destinationCrs);
    const candidates = (board.data.services ?? [])
      .filter(
        (s) =>
          passenger(s.scheduleMetadata) &&
          canBoard(s.temporalData.scheduledCallType) &&
          !s.temporalData.departure?.realtimeActual &&
          !s.temporalData.departure?.realtimeNoReport &&
          +(
            date(s.temporalData.departure?.realtimeForecast) ??
            date(s.temporalData.departure?.scheduleAdvertised) ??
            new Date(0)
          ) >= +now &&
          +(
            date(s.temporalData.departure?.scheduleAdvertised) ?? new Date(0)
          ) <= +addMinutes(now, horizon),
      )
      .sort(
        (a, b) =>
          (date(a.temporalData.departure?.scheduleAdvertised)?.getTime() ??
            Infinity) -
          (date(b.temporalData.departure?.scheduleAdvertised)?.getTime() ??
            Infinity),
      );
    // Eight trains per strategy bounds detail calls; all complete itineraries still use
    // live destination forecasts from the service endpoint, never origin-board guesses.
    const details = await Promise.allSettled(
      candidates
        .slice(0, 8)
        .map((s) =>
          this.getServiceDetails(
            s.scheduleMetadata.uniqueIdentity,
            originCrs,
            now,
          ),
        ),
    );
    if (details.length && details.every((r) => r.status === "rejected"))
      throw new Error("RTT service details unavailable");
    const partial = details.some((r) => r.status === "rejected");
    const boardMessages = [
      ...statusMessages(board.data.systemStatus),
      ...messages(board.data.reasons),
    ];
    if (partial)
      boardMessages.push(
        "Some RTT service details were unavailable; this comparison is incomplete",
      );
    return details
      .flatMap((r) => (r.status === "fulfilled" ? r.value.services : []))
      .filter(
        (s) =>
          s.destinationCrs === destinationCrs &&
          (s.estimatedDeparture ?? s.scheduledDeparture) >= now &&
          s.scheduledDeparture <= addMinutes(now, horizon),
      )
      .map((s) => ({
        ...s,
        calculatedAt: [s.calculatedAt, board.fetchedAt].sort()[0],
        disruptionMessages: [
          ...new Set([...s.disruptionMessages, ...boardMessages]),
        ],
        arrivalUncertain:
          s.arrivalUncertain ||
          statusMessages(board.data.systemStatus).length > 0,
      }));
  }
  async getServiceDetails(
    serviceId: string,
    originCrs: string,
    _now: Date,
  ): Promise<RailServiceDetails> {
    const response = await this.request(
      `gb-nr/service?${new URLSearchParams({ uniqueIdentity: serviceId.replace(/^gb-nr:/, ""), detailed: "false" })}`,
    );
    return {
      serviceId,
      services: normaliseRttService(
        response.data,
        originCrs,
        response.fetchedAt,
      ),
    };
  }
  async getDisruptions(
    crs: string,
    now: Date,
    horizon: number,
  ): Promise<RailDisruption[]> {
    const response = await this.board(crs, now, horizon);
    return [
      ...new Set([
        ...messages(response.data.reasons),
        ...statusMessages(response.data.systemStatus),
      ]),
    ].map((message) => ({ message }));
  }
}
