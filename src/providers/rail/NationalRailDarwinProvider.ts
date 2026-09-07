import type {
  RailProvider,
  RailService,
  RailServiceDetails,
  RailDisruption,
} from "../../domain/models";
import { TtlCache } from "../cache";
import { railTime, addMinutes, minutesBetween } from "../../services/time";
type Point = {
  crs?: string;
  st?: string;
  et?: string;
  at?: string;
  isCancelled?: boolean;
  adhocAlerts?: string[];
};
export type RawService = {
  serviceID?: string;
  std?: string;
  etd?: string;
  atd?: string;
  operator?: string;
  platform?: string;
  isCancelled?: boolean;
  cancelReason?: string;
  delayReason?: string;
  adhocAlerts?: string[];
  subsequentCallingPoints?: {
    callingPoint?: Point[];
    serviceChangeRequired?: boolean;
    assocIsCancelled?: boolean;
    serviceType?: string | number;
  }[];
};
export type Board = {
  generatedAt?: string;
  trainServices?: RawService[];
  nrccMessages?: { Value?: string; value?: string }[];
  areServicesAvailable?: boolean;
};
const cache = new TtlCache<Board>();
const clean = (text: string) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .slice(0, 1200);
export function normaliseService(
  raw: RawService,
  originCrs: string,
  generatedAt: string,
  anchor: Date,
): RailService[] {
  if (!raw.serviceID || raw.atd) return [];
  const scheduledDeparture = railTime(raw.std, anchor);
  if (!scheduledDeparture) return [];
  const estimatedDeparture =
    raw.etd === "On time"
      ? scheduledDeparture
      : railTime(raw.etd, scheduledDeparture);
  const delayed =
    raw.etd === "Delayed" ||
    !!(estimatedDeparture && estimatedDeparture > scheduledDeparture);
  const services: RailService[] = [];
  for (const group of raw.subsequentCallingPoints ?? []) {
    // Associated services requiring an extra transfer are not direct journeys.
    if (
      group.serviceChangeRequired ||
      group.assocIsCancelled ||
      (group.serviceType && group.serviceType !== "train")
    )
      continue;
    let previous = scheduledDeparture;
    for (const point of group.callingPoint ?? []) {
      const scheduledArrival = railTime(point.st, previous, "after");
      if (
        !point.crs ||
        !scheduledArrival ||
        minutesBetween(scheduledArrival, scheduledDeparture) > 600
      )
        continue;
      previous = scheduledArrival;
      const estimatedArrival =
        point.et === "On time"
          ? scheduledArrival
          : railTime(point.at || point.et, scheduledArrival);
      const arrivalUncertain = !estimatedArrival || point.et === "Delayed";
      services.push({
        serviceId: raw.serviceID,
        originCrs,
        destinationCrs: point.crs,
        scheduledDeparture,
        estimatedDeparture,
        scheduledArrival,
        estimatedArrival,
        operator: raw.operator,
        platform: raw.platform,
        cancelled:
          !!raw.isCancelled ||
          !!point.isCancelled ||
          raw.etd === "Cancelled" ||
          point.et === "Cancelled",
        delayed,
        arrivalUncertain,
        departureUncertain: !estimatedDeparture,
        delayMinutes: estimatedDeparture
          ? Math.max(0, minutesBetween(estimatedDeparture, scheduledDeparture))
          : undefined,
        calculatedAt: generatedAt,
        disruptionMessages: [
          raw.cancelReason,
          raw.delayReason,
          ...(raw.adhocAlerts ?? []),
          ...(point.adhocAlerts ?? []),
        ]
          .filter((x): x is string => !!x)
          .map(clean),
      });
    }
  }
  return services;
}
export class NationalRailDarwinProvider implements RailProvider {
  readonly name = "National Rail Darwin";
  constructor(
    private username: string,
    private password: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string): Promise<Board> {
    return cache.resolve(path, 25000, async () => {
      if (!this.username || !this.password)
        throw new Error("National Rail is not configured");
      const response = await this.fetcher(
        `https://realtime.nationalrail.co.uk/LDBWS/api/20220120/${path}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(7000),
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error(`National Rail returned ${response.status}`);
      const board = (await response.json()) as Board;
      if (!board.generatedAt || !Number.isFinite(Date.parse(board.generatedAt)))
        throw new Error("Invalid railway timestamp");
      if (board.areServicesAvailable === false)
        throw new Error("Railway services unavailable");
      return board;
    });
  }
  private boards(crs: string, horizon: number): Promise<Board[]> {
    // The live service supports 120-minute windows; overlap the second window.
    const offsets = horizon > 120 ? [0, 60] : [0];
    return Promise.all(
      offsets.map((offset) =>
        this.request(
          `GetDepBoardWithDetails/${encodeURIComponent(crs)}?numRows=150&timeOffset=${offset}&timeWindow=${Math.min(120, horizon - offset)}`,
        ),
      ),
    );
  }
  async getDepartures(
    originCrs: string,
    destinationCrs: string,
    now: Date,
    horizon: number,
  ): Promise<RailService[]> {
    const boards = await this.boards(originCrs, horizon);
    const unique = new Map<string, RailService>();
    for (const board of boards) {
      for (const raw of board.trainServices ?? []) {
        for (const service of normaliseService(
          raw,
          originCrs,
          board.generatedAt!,
          now,
        )) {
          if (
            service.destinationCrs === destinationCrs &&
            (service.estimatedDeparture ?? service.scheduledDeparture) >= now &&
            service.scheduledDeparture <= addMinutes(now, horizon)
          ) {
            unique.set(service.serviceId, service);
          }
        }
      }
    }
    return [...unique.values()].sort(
      (a, b) => +a.scheduledDeparture - +b.scheduledDeparture,
    );
  }
  async getServiceDetails(
    serviceId: string,
    originCrs: string,
    now: Date,
  ): Promise<RailServiceDetails> {
    const raw = (await this.request(
      `GetServiceDetails/${encodeURIComponent(serviceId)}`,
    )) as Board & RawService;
    return {
      serviceId,
      services: normaliseService(
        { ...raw, serviceID: serviceId },
        originCrs,
        raw.generatedAt!,
        now,
      ),
    };
  }
  async getDisruptions(
    crs: string,
    _now: Date,
    horizon: number,
  ): Promise<RailDisruption[]> {
    const boards = await this.boards(crs, horizon);
    return [
      ...new Set(
        boards
          .flatMap((b) =>
            (b.nrccMessages ?? []).map((m) => clean(m.Value ?? m.value ?? "")),
          )
          .filter(Boolean),
      ),
    ].map((message) => ({ message }));
  }
}
