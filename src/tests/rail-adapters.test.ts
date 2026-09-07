import { afterEach, describe, expect, it, vi } from "vitest";
import { HuxleyRailProvider } from "../providers/rail/HuxleyRailProvider";
import {
  RealtimeTrainsProvider,
  normaliseRttService,
} from "../providers/rail/RealtimeTrainsProvider";
import { createRailProvider } from "../providers/rail/createRailProvider";
const now = new Date("2026-09-07T12:00:00Z");
const goodStatus = { rttCore: "OK", realtimeNetworkRail: "OK" };
const meta = {
  uniqueIdentity: "gb-nr:A12345:2026-09-07",
  identity: "A12345",
  departureDate: "2026-09-07",
  modeType: "TRAIN",
  inPassengerService: true,
  operator: { name: "Test operator" },
};
// Synthetic fixtures in the official RTT Next Generation schema; no real credentials/data.
function fixture() {
  return {
    systemStatus: goodStatus,
    service: {
      scheduleMetadata: { ...meta },
      reasons: [],
      locations: [
        {
          location: { shortCodes: ["LTV"] },
          locationMetadata: { platform: { actual: "2", planned: "1" } },
          temporalData: {
            scheduledCallType: "ADVERTISED_OPEN",
            realtimeCallType: "ADVERTISED_OPEN",
            displayAs: "CALL",
            departure: {
              scheduleAdvertised: "2026-09-07T13:00:00Z",
              realtimeForecast: "2026-09-07T13:20:00Z",
            },
          },
        },
        {
          location: { shortCodes: ["EUS"] },
          temporalData: {
            scheduledCallType: "ADVERTISED_SET_DOWN",
            realtimeCallType: "ADVERTISED_SET_DOWN",
            displayAs: "CALL",
            arrival: {
              scheduleAdvertised: "2026-09-07T14:10:00Z",
              realtimeForecast: "2026-09-07T14:20:00Z",
            },
          },
        },
      ],
    },
  };
}
function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(input instanceof Request ? input.url : input), init),
  ) as unknown as typeof fetch;
}
afterEach(() => vi.useRealTimers());
describe("Huxley adapter", () => {
  function board() {
    return {
      generatedAt: now.toISOString(),
      trainServices: [
        {
          serviceID: "ab/c+==",
          std: "14:00",
          etd: "14:20",
          operator: "Test operator",
          subsequentCallingPoints: [
            {
              serviceType: 0,
              callingPoint: [{ crs: "EUS", st: "15:10", et: "15:20" }],
            },
          ],
        },
      ],
      nrccMessages: [{ value: "<p>Engineering work</p>" }],
    };
  }
  it("requests expansion, normalizes clocks and keeps its token server-side", async () => {
    const calls: URL[] = [];
    const fetcher = mockFetch((url) => {
      calls.push(url);
      return Response.json(board());
    });
    const provider = new HuxleyRailProvider(
      { baseUrl: "https://huxley.example/api", accessToken: "test-token" },
      fetcher,
    );
    const services = await provider.getDepartures("LTV", "EUS", now, 120);
    expect(calls[0].pathname).toBe("/api/departures/LTV/150");
    expect(calls[0].searchParams.get("expand")).toBe("true");
    expect(calls[0].searchParams.get("accessToken")).toBe("test-token");
    expect(services[0].estimatedArrival?.toISOString()).toBe(
      "2026-09-07T14:20:00.000Z",
    );
    expect(services[0].delayMinutes).toBe(20);
    expect(JSON.stringify(services)).not.toContain("test-token");
  });
  it("coalesces overlapping board/disruption calls and strips notice HTML", async () => {
    const fetcher = mockFetch(() => Response.json(board()));
    const provider = new HuxleyRailProvider(
      { baseUrl: "https://huxley.example" },
      fetcher,
    );
    const [, notices] = await Promise.all([
      provider.getDepartures("LTV", "EUS", now, 180),
      provider.getDisruptions("LTV", now, 180),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([{ message: "Engineering work" }]);
  });
  it("encodes Darwin IDs for the service endpoint", async () => {
    const calls: URL[] = [];
    const provider = new HuxleyRailProvider(
      { baseUrl: "https://huxley.example" },
      mockFetch((url) => {
        calls.push(url);
        return Response.json({
          ...board().trainServices[0],
          generatedAt: now.toISOString(),
        });
      }),
    );
    const result = await provider.getServiceDetails("ab/c+==", "LTV", now);
    expect(calls[0].pathname).toBe("/service/ab_c-");
    expect(result.services).toHaveLength(1);
  });
  it("fails visibly on upstream error, malformed data and insecure configuration", async () => {
    const provider = new HuxleyRailProvider(
      { baseUrl: "https://huxley.example" },
      mockFetch(() => new Response("Unavailable", { status: 500 })),
    );
    await expect(
      provider.getDepartures("LTV", "EUS", now, 120),
    ).rejects.toThrow("500");
    expect(
      () => new HuxleyRailProvider({ baseUrl: "http://huxley.example" }),
    ).toThrow("HTTPS");
    const malformed = new HuxleyRailProvider(
      { baseUrl: "https://huxley.example" },
      mockFetch(() => Response.json({ trainServices: [] })),
    );
    await expect(
      malformed.getDepartures("LTV", "EUS", now, 120),
    ).rejects.toThrow("timestamp");
  });
});
describe("RTT Next Generation normalisation", () => {
  it("maps dated forecasts, operator, actual platform and delay into RailService", () => {
    const [service] = normaliseRttService(fixture(), "LTV", now.toISOString());
    expect(service).toMatchObject({
      serviceId: meta.uniqueIdentity,
      originCrs: "LTV",
      destinationCrs: "EUS",
      operator: "Test operator",
      platform: "2",
      delayMinutes: 20,
      delayed: true,
      cancelled: false,
      arrivalUncertain: false,
    });
    expect(service.scheduledDeparture.toISOString()).toBe(
      "2026-09-07T13:00:00.000Z",
    );
  });
  it("rejects already-departed trains and freight/bus services", () => {
    const departed = fixture();
    Object.assign(departed.service.locations[0].temporalData.departure!, {
      realtimeActual: "2026-09-07T13:20:00Z",
    });
    expect(normaliseRttService(departed, "LTV", now.toISOString())).toEqual([]);
    const bus = fixture();
    bus.service.scheduleMetadata.modeType = "REPLACEMENT_BUS";
    expect(normaliseRttService(bus, "LTV", now.toISOString())).toEqual([]);
  });
  it("marks a cancelled downstream stop and refuses pickup-only alighting", () => {
    const cancelled = fixture();
    cancelled.service.locations[1].temporalData.displayAs = "CANCELLED";
    expect(
      normaliseRttService(cancelled, "LTV", now.toISOString())[0].cancelled,
    ).toBe(true);
    const pickup = fixture();
    pickup.service.locations[1].temporalData.scheduledCallType =
      "ADVERTISED_PICK_UP";
    expect(normaliseRttService(pickup, "LTV", now.toISOString())).toEqual([]);
  });
  it("does not promote no-report estimates to live arrival forecasts", () => {
    const noReport = fixture();
    Object.assign(noReport.service.locations[1].temporalData.arrival!, {
      realtimeNoReport: true,
      realtimeEstimate: "2026-09-07T14:21:00Z",
    });
    const [service] = normaliseRttService(noReport, "LTV", now.toISOString());
    expect(service.estimatedArrival).toBeUndefined();
    expect(service.arrivalUncertain).toBe(true);
  });
  it("flags schedule-only system status and missing forecasts", () => {
    const scheduled = fixture();
    scheduled.systemStatus = {
      rttCore: "SCHEDULE_ONLY",
      realtimeNetworkRail: "REALTIME_DATA_NONE",
    };
    const [service] = normaliseRttService(scheduled, "LTV", now.toISOString());
    expect(service.arrivalUncertain).toBe(true);
    expect(service.disruptionMessages.length).toBeGreaterThan(0);
    const missing = fixture();
    delete (
      missing.service.locations[0].temporalData.departure as {
        realtimeForecast?: string;
      }
    ).realtimeForecast;
    expect(
      normaliseRttService(missing, "LTV", now.toISOString())[0]
        .departureUncertain,
    ).toBe(true);
  });
  it("preserves UTC offsets over midnight and DST without guessing dates", () => {
    const midnight = fixture();
    Object.assign(midnight.service.locations[0].temporalData.departure!, {
      scheduleAdvertised: "2026-10-25T01:50:00+01:00",
      realtimeForecast: "2026-10-25T01:55:00+01:00",
    });
    Object.assign(midnight.service.locations[1].temporalData.arrival!, {
      scheduleAdvertised: "2026-10-25T02:10:00+00:00",
      realtimeForecast: "2026-10-25T02:15:00+00:00",
    });
    const [service] = normaliseRttService(midnight, "LTV", now.toISOString());
    expect(+service.scheduledArrival! - +service.scheduledDeparture).toBe(
      80 * 60000,
    );
  });
});
describe("RTT HTTP adapter", () => {
  it("uses bearer auth, filtered boards and complete service details", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const fetcher = mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json(
        url.pathname === "/gb-nr/location"
          ? {
              systemStatus: goodStatus,
              services: [
                {
                  scheduleMetadata: meta,
                  temporalData: fixture().service.locations[0].temporalData,
                },
              ],
            }
          : fixture(),
      );
    });
    const provider = new RealtimeTrainsProvider(
      { accessToken: "test-access" },
      fetcher,
    );
    const result = await provider.getDepartures("LTV", "EUS", now, 180);
    expect(result).toHaveLength(1);
    expect(requests[0].url.origin).toBe("https://data.rtt.io");
    expect(requests[0].url.searchParams.get("filterTo")).toBe("EUS");
    expect(new Headers(requests[0].init?.headers).get("authorization")).toBe(
      "Bearer test-access",
    );
    expect(requests[1].url.searchParams.get("uniqueIdentity")).toBe(
      "A12345:2026-09-07",
    );
    expect(JSON.stringify(result)).not.toContain("test-access");
  });
  it("refreshes once for concurrent requests and reuses access tokens", async () => {
    const fetcher = mockFetch((url) =>
      Response.json(
        url.pathname === "/api/get_access_token"
          ? {
              token: "new-access",
              validUntil: new Date(Date.now() + 3600000).toISOString(),
            }
          : { systemStatus: goodStatus, services: [] },
      ),
    );
    const provider = new RealtimeTrainsProvider(
      { refreshToken: "test-refresh" },
      fetcher,
    );
    await Promise.all([
      provider.getDisruptions("LTV", now, 120),
      provider.getDisruptions("DBY", now, 120),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await provider.getDisruptions("TAM", now, 120);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("honours rate-limit cooldown without repeated upstream requests", async () => {
    const fetcher = mockFetch(
      () =>
        new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const provider = new RealtimeTrainsProvider(
      { accessToken: "test" },
      fetcher,
    );
    await expect(provider.getDisruptions("LTV", now, 120)).rejects.toThrow(
      "rate limit",
    );
    await expect(provider.getDisruptions("TAM", now, 120)).rejects.toThrow(
      "rate limit",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("handles a valid 204 empty board", async () => {
    const provider = new RealtimeTrainsProvider(
      { accessToken: "test" },
      mockFetch(() => new Response(null, { status: 204 })),
    );
    expect(await provider.getDepartures("LTV", "EUS", now, 120)).toEqual([]);
  });
  it("rejects bad credentials without returning response bodies or secrets", async () => {
    const provider = new RealtimeTrainsProvider(
      { accessToken: "secret-value" },
      mockFetch(() => new Response("secret-value", { status: 401 })),
    );
    await expect(
      provider.getDepartures("LTV", "EUS", now, 120),
    ).rejects.toThrow("RTT returned 401");
  });
  it("selects providers only through explicit server configuration", () => {
    expect(createRailProvider({ RAIL_PROVIDER: "huxley" }).name).toContain(
      "Huxley",
    );
    expect(
      createRailProvider({ RAIL_PROVIDER: "rtt", RTT_ACCESS_TOKEN: "test" })
        .name,
    ).toBe("Realtime Trains");
    expect(createRailProvider({ RAIL_PROVIDER: "darwin" }).name).toBe(
      "National Rail Darwin",
    );
    expect(() => createRailProvider({ RAIL_PROVIDER: "typo" })).toThrow(
      "Unsupported",
    );
  });
});
