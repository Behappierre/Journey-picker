import { describe, expect, it, vi } from "vitest";
import { JourneyPlanner } from "../services/JourneyPlanner";
import {
  calculateLeaveTime,
  safeDeparture,
} from "../services/LeaveTimeCalculator";
import { railTime } from "../services/time";
import { normaliseService } from "../providers/rail/NationalRailDarwinProvider";
import { GoogleRoutesProvider } from "../providers/road/GoogleRoutesProvider";
import { defaultSettings, defaultStations } from "../config/stations";
import type {
  CandidateStation,
  PlanRequest,
  RailProvider,
  RailService,
  RoadRoutingProvider,
} from "../domain/models";
const now = new Date("2026-09-07T12:00:00Z");
const at = (minutes: number) => new Date(+now + minutes * 60000);
const station: CandidateStation = {
  ...defaultStations.find(s => s.crs === "LTV")!,
  id: "a",
  crs: "AAA",
  defaultDriveMinutes: 20,
  location: { lat: 52, lng: -1 },
};
const service = (overrides: Partial<RailService> = {}): RailService => ({
  serviceId: "one",
  originCrs: "AAA",
  destinationCrs: "EUS",
  scheduledDeparture: at(60),
  estimatedDeparture: at(60),
  scheduledArrival: at(150),
  estimatedArrival: at(150),
  cancelled: false,
  delayed: false,
  calculatedAt: now.toISOString(),
  disruptionMessages: [],
  ...overrides,
});
function road(duration = 20): RoadRoutingProvider {
  return {
    getTravelTime: vi.fn(async () => ({
      durationMinutes: duration,
      staticDurationMinutes: duration,
      calculatedAt: now.toISOString(),
      status: "live" as const,
    })),
  };
}
function rail(services: RailService[]): RailProvider {
  return {
    getDepartures: vi.fn(async (origin, destination) =>
      services.filter(
        (s) => s.originCrs === origin && s.destinationCrs === destination,
      ),
    ),
    getServiceDetails: vi.fn(async (id) => ({
      serviceId: id,
      services: services.filter((s) => s.serviceId === id),
    })),
    getDisruptions: vi.fn(async () => []),
  };
}
function request(stations = [station]): PlanRequest {
  return {
    origin: { lat: 52.8, lng: -1.6 },
    mode: "next",
    objective: "balanced",
    settings: { ...defaultSettings, stations },
  };
}
describe("door-to-London planner", () => {
  it("recommends a comfortably catchable on-time train", async () => {
    const r = await new JourneyPlanner(road(), rail([service()])).plan(
      request(),
      now,
    );
    expect(r.recommended?.leaveHomeAt).toEqual(at(25));
    expect(r.recommended?.confidence).toBe("high");
  });
  it("rejects a train just missed after drive and overhead", async () => {
    const r = await new JourneyPlanner(
      road(),
      rail([
        service({ scheduledDeparture: at(34), estimatedDeparture: at(34) }),
      ]),
    ).plan(request(), now);
    expect(r.recommended).toBeNull();
    expect(r.alternatives).toHaveLength(0);
  });
  it("reserves five minutes of a twenty-minute train delay", () => {
    expect(
      safeDeparture(service({ estimatedDeparture: at(80), delayed: true }), 5),
    ).toEqual(at(75));
  });
  it("uses schedule when the departure is only Delayed", () => {
    expect(
      safeDeparture(
        service({ estimatedDeparture: undefined, delayed: true }),
        5,
      ),
    ).toEqual(at(60));
  });
  it("never recommends a cancelled train", async () => {
    const r = await new JourneyPlanner(
      road(),
      rail([service({ cancelled: true })]),
    ).plan(request(), now);
    expect(r.recommended).toBeNull();
    expect(r.alternatives).toHaveLength(0);
  });
  const connecting = {
    ...station,
    id: "b",
    crs: "BBB",
    railStrategies: [
      {
        type: "one_change" as const,
        interchangeCrs: "CCC",
        destinationCrs: "EUS",
        minimumConnectionMinutes: 8,
      },
    ],
  };
  const legs = () => [
    service(),
    service({
      serviceId: "leg1",
      originCrs: "BBB",
      destinationCrs: "CCC",
      scheduledArrival: at(80),
      estimatedArrival: at(80),
    }),
    service({
      serviceId: "leg2",
      originCrs: "CCC",
      scheduledDeparture: at(100),
      estimatedDeparture: at(100),
      scheduledArrival: at(130),
      estimatedArrival: at(130),
    }),
  ];
  it("compares a direct journey with a faster connecting journey", async () => {
    const req = {
      ...request([station, connecting]),
      objective: "fastest" as const,
    };
    const r = await new JourneyPlanner(road(), rail(legs())).plan(req, now);
    expect(r.recommended?.station.id).toBe("b");
    expect(r.recommended?.changes).toBe(1);
  });
  it("rejects an impossible connection after first-leg delay", async () => {
    const services = legs();
    services[1].estimatedArrival = at(96);
    const r = await new JourneyPlanner(road(), rail(services)).plan(
      request([connecting]),
      now,
    );
    expect(r.recommended).toBeNull();
  });
  it("does not construct a connection without a live arrival forecast", async () => {
    const services = legs();
    services[1].estimatedArrival = undefined;
    services[1].arrivalUncertain = true;
    const r = await new JourneyPlanner(road(), rail(services)).plan(
      request([connecting]),
      now,
    );
    expect(r.recommended).toBeNull();
  });
  const other = {
    ...station,
    id: "other",
    crs: "DDD",
    location: { lat: 53, lng: -1 },
  };
  const twoStations = () => [
    service(),
    service({
      serviceId: "other",
      originCrs: "DDD",
      estimatedArrival: at(155),
      scheduledArrival: at(155),
    }),
  ];
  it("heavy traffic changes the recommended station", async () => {
    const roads: RoadRoutingProvider = {
      getTravelTime: async (_o, d) => ({
        durationMinutes: d.lat === 52 ? 55 : 20,
        calculatedAt: now.toISOString(),
        status: "live",
      }),
    };
    const r = await new JourneyPlanner(roads, rail(twoStations())).plan(
      request([station, other]),
      now,
    );
    expect(r.recommended?.station.id).toBe("other");
  });
  it("balanced selects less driving within ten minutes of fastest", async () => {
    const roads: RoadRoutingProvider = {
      getTravelTime: async (_o, d) => ({
        durationMinutes: d.lat === 52 ? 35 : 20,
        calculatedAt: now.toISOString(),
        status: "live",
      }),
    };
    const r = await new JourneyPlanner(roads, rail(twoStations())).plan(
      request([station, other]),
      now,
    );
    expect(r.recommended?.station.id).toBe("other");
    expect(r.recommended?.score).toBe(5);
  });
  it("recomputes driving at a future departure, not only now", async () => {
    const queried: Date[] = [];
    const roads: RoadRoutingProvider = {
      getTravelTime: async (_o, _d, t) => {
        queried.push(t);
        return {
          durationMinutes: t > at(20) ? 30 : 20,
          status: "live",
          calculatedAt: now.toISOString(),
        };
      },
    };
    const r = await calculateLeaveTime(
      request().origin,
      station,
      service(),
      5,
      roads,
      now,
    );
    expect(queried).toHaveLength(3);
    expect(queried[0]).toEqual(at(25));
    expect(r?.leaveHomeAt).toEqual(at(15));
  });
  it("resolves a journey spanning midnight", () => {
    expect(
      railTime(
        "00:20",
        new Date("2026-09-07T22:50:00Z"),
        "after",
      )?.toISOString(),
    ).toBe("2026-09-07T23:20:00.000Z");
  });
  it("handles UK daylight-saving spring transition", () => {
    expect(
      railTime(
        "02:10",
        new Date("2026-03-29T00:50:00Z"),
        "after",
      )?.toISOString(),
    ).toBe("2026-03-29T01:10:00.000Z");
  });
  it("selects the later occurrence during the autumn clock change", () => {
    expect(
      railTime(
        "01:20",
        new Date("2026-10-25T00:50:00Z"),
        "after",
      )?.toISOString(),
    ).toBe("2026-10-25T01:20:00.000Z");
  });
  it("reports Darwin unavailable without inventing trains", async () => {
    const broken = rail([]);
    broken.getDepartures = async () => {
      throw Error("outage");
    };
    const r = await new JourneyPlanner(road(), broken).plan(request(), now);
    expect(r.railDataStatus).toBe("unavailable");
    expect(r.recommended).toBeNull();
  });
  it("falls back to configured road duration and downgrades confidence", async () => {
    const broken: RoadRoutingProvider = {
      getTravelTime: async () => {
        throw Error("outage");
      },
    };
    const r = await new JourneyPlanner(broken, rail([service()])).plan(
      request(),
      now,
    );
    expect(r.roadDataStatus).toBe("degraded");
    expect(r.recommended?.confidence).toBe("medium");
  });
  it("isolates a station failure", async () => {
    const partial = rail(twoStations());
    const get = partial.getDepartures;
    partial.getDepartures = async (...args) => {
      if (args[0] === "AAA") throw Error("station failure");
      return get(...args);
    };
    const r = await new JourneyPlanner(road(), partial).plan(
      request([station, other]),
      now,
    );
    expect(r.railDataStatus).toBe("partial");
    expect(r.recommended?.station.id).toBe("other");
  });
  it("filters arrive-by journeys against full arrival timestamps", async () => {
    const r = await new JourneyPlanner(road(), rail([service()])).plan(
      { ...request(), mode: "arrive_by", arrivalBy: at(149).toISOString() },
      now,
    );
    expect(r.recommended).toBeNull();
  });
  it("keeps stale railway information out of the recommendation", async () => {
    const r = await new JourneyPlanner(
      road(),
      rail([service({ calculatedAt: at(-5).toISOString() })]),
    ).plan(request(), now);
    expect(r.recommended).toBeNull();
    expect(r.alternatives[0].confidence).toBe("low");
  });
});
describe("provider normalization", () => {
  it("normalizes Darwin cancellation at a downstream calling point", () => {
    const normalized = normaliseService(
      {
        serviceID: "test",
        std: "13:00",
        etd: "13:20",
        subsequentCallingPoints: [
          {
            callingPoint: [
              { crs: "EUS", st: "14:30", et: "Cancelled", isCancelled: true },
            ],
          },
        ],
      },
      "AAA",
      now.toISOString(),
      now,
    );
    expect(normalized[0].cancelled).toBe(true);
    expect(normalized[0].delayMinutes).toBe(20);
  });
  it("does not claim an associated train requiring a change is direct", () => {
    expect(
      normaliseService(
        {
          serviceID: "test",
          std: "13:00",
          subsequentCallingPoints: [
            {
              serviceChangeRequired: true,
              callingPoint: [{ crs: "EUS", st: "14:30" }],
            },
          ],
        },
        "AAA",
        now.toISOString(),
        now,
      ),
    ).toEqual([]);
  });
  it("sends Google traffic options and future departure on the server", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        routes: [
          { duration: "1800s", staticDuration: "1200s", distanceMeters: 20000 },
        ],
      }),
    );
    const provider = new GoogleRoutesProvider(
      "test-key",
      fetcher as typeof fetch,
    );
    const departure = new Date(Date.now() + 3600000);
    const result = await provider.getTravelTime(
      { lat: 51.111, lng: -1 },
      { lat: 51.222, lng: -2 },
      departure,
    );
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      trafficModel: "BEST_GUESS",
      departureTime: departure.toISOString(),
    });
    expect(result.durationMinutes).toBe(30);
  });
});
