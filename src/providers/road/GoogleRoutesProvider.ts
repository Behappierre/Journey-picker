import type {
  LatLng,
  RoadJourney,
  RoadRoutingProvider,
} from "../../domain/models";
import { TtlCache } from "../cache";
import { optimisation } from "../../config/optimisation";
const cache = new TtlCache<RoadJourney>();
export class GoogleRoutesProvider implements RoadRoutingProvider {
  constructor(
    private apiKey: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async getTravelTime(
    origin: LatLng,
    destination: LatLng,
    departureTime: Date,
  ): Promise<RoadJourney> {
    const departure = new Date(Math.max(+departureTime, Date.now() + 1000));
    const key = JSON.stringify([
      origin,
      destination,
      Math.floor(+departure / 300000),
    ]);
    try {
      return await cache.resolve(
        key,
        optimisation.roadCacheSeconds * 1000,
        async () => {
          if (!this.apiKey) throw new Error("Google Routes is not configured");
          const waypoint = (point: LatLng) => ({
            location: { latLng: { latitude: point.lat, longitude: point.lng } },
          });
          const response = await this.fetcher(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            {
              method: "POST",
              cache: "no-store",
              signal: AbortSignal.timeout(7000),
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": this.apiKey,
                "X-Goog-FieldMask":
                  "routes.duration,routes.staticDuration,routes.distanceMeters",
              },
              body: JSON.stringify({
                origin: waypoint(origin),
                destination: waypoint(destination),
                travelMode: "DRIVE",
                routingPreference: "TRAFFIC_AWARE_OPTIMAL",
                trafficModel: "BEST_GUESS",
                departureTime: departure.toISOString(),
              }),
            },
          );
          if (!response.ok)
            throw new Error(`Google Routes returned ${response.status}`);
          const json = await response.json();
          const route = json.routes?.[0];
          const duration =
            typeof route?.duration === "string" &&
            /^\d+(\.\d+)?s$/.test(route.duration)
              ? parseFloat(route.duration) / 60
              : NaN;
          if (!Number.isFinite(duration) || duration <= 0)
            throw new Error("No road route available");
          return {
            durationMinutes: duration,
            staticDurationMinutes: route.staticDuration
              ? parseFloat(route.staticDuration) / 60
              : undefined,
            distanceKm: route.distanceMeters / 1000,
            calculatedAt: new Date().toISOString(),
            status: "live",
          };
        },
      );
    } catch (error) {
      const recent = cache.get(
        key,
        optimisation.roadFallbackCacheSeconds * 1000,
      );
      if (recent) return { ...recent, status: "cached" };
      throw error;
    }
  }
}
