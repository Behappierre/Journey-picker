import type {
  RailProvider,
  RailService,
  RailServiceDetails,
  RailDisruption,
} from "../../domain/models";
import { TtlCache } from "../cache";
import {
  normaliseService,
  type Board,
  type RawService,
} from "./NationalRailDarwinProvider";
import { addMinutes } from "../../services/time";

export interface HuxleyOptions {
  baseUrl: string;
  accessToken?: string;
}
const textOnly = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .slice(0, 1200);
/** Huxley 2 public (non-staff) JSON adapter. Tokens never leave the server. */
export class HuxleyRailProvider implements RailProvider {
  readonly name = "National Rail Darwin via Huxley";
  private cache = new TtlCache<Board & RawService>();
  private baseUrl: URL;
  constructor(
    private options: HuxleyOptions,
    private fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = new URL(
      options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
    );
    if (
      this.baseUrl.protocol !== "https:" ||
      this.baseUrl.username ||
      this.baseUrl.password ||
      this.baseUrl.search ||
      this.baseUrl.hash
    )
      throw new Error("Huxley requires a trusted HTTPS base URL");
  }
  private async request(path: string): Promise<Board & RawService> {
    return this.cache.resolve(path, 25000, async () => {
      const url = new URL(path, this.baseUrl);
      if (this.options.accessToken)
        url.searchParams.set("accessToken", this.options.accessToken);
      const response = await this.fetcher(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(7000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Huxley returned ${response.status}`);
      const body = (await response.json()) as Board & RawService;
      if (
        !body ||
        typeof body !== "object" ||
        !body.generatedAt ||
        !Number.isFinite(Date.parse(body.generatedAt))
      )
        throw new Error("Invalid Huxley timestamp");
      if (body.areServicesAvailable === false)
        throw new Error("Huxley railway data unavailable");
      if (body.trainServices != null && !Array.isArray(body.trainServices))
        throw new Error("Invalid Huxley board");
      return body;
    });
  }
  private boards(crs: string, horizon: number) {
    // expand=true is essential: an ordinary departure board has no London arrival.
    return Promise.all(
      (horizon > 120 ? [0, 60] : [0]).map((offset) =>
        this.request(
          `departures/${encodeURIComponent(crs)}/150?expand=true&timeOffset=${offset}&timeWindow=${Math.min(120, horizon - offset)}`,
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
    for (const board of boards)
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
          )
            unique.set(service.serviceId, service);
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
    // URL-safe base64 avoids embedded '/' path delimiters for Darwin service IDs.
    const safeId = serviceId
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const raw = await this.request(`service/${encodeURIComponent(safeId)}`);
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
            (b.nrccMessages ?? []).map((m) =>
              textOnly(m.Value ?? m.value ?? ""),
            ),
          )
          .filter(Boolean),
      ),
    ].map((message) => ({ message }));
  }
}
