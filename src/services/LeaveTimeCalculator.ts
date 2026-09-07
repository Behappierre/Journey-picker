import type {
  CandidateStation,
  LatLng,
  RailService,
  RoadJourney,
  RoadRoutingProvider,
} from "../domain/models";
import { addMinutes, minutesBetween } from "./time";
import { optimisation } from "../config/optimisation";
export function safeDeparture(
  service: RailService,
  recoveryMinutes: number,
): Date {
  return new Date(
    Math.max(
      +service.scheduledDeparture,
      +(service.estimatedDeparture ?? service.scheduledDeparture) -
        recoveryMinutes * 60000,
    ),
  );
}
export async function calculateLeaveTime(
  origin: LatLng,
  station: CandidateStation,
  service: RailService,
  recovery: number,
  roadProvider: RoadRoutingProvider,
  now: Date,
) {
  const overhead =
    station.parkingMinutes +
    station.walkToPlatformMinutes +
    station.platformSafetyMinutes;
  const safe = safeDeparture(service, recovery);
  const target = addMinutes(safe, -overhead - optimisation.roadSafetyMinutes);
  let estimate = addMinutes(target, -(station.defaultDriveMinutes ?? 30));
  let road: RoadJourney | undefined;
  const observations: RoadJourney[] = [];
  // Two fixed-point iterations and one final feasibility check at the proposed leave time.
  for (let i = 0; i < 3; i++) {
    try {
      road = await roadProvider.getTravelTime(
        origin,
        station.location,
        new Date(Math.max(+estimate, +now)),
      );
    } catch {
      if (!station.defaultDriveMinutes) return null;
      road = {
        durationMinutes: station.defaultDriveMinutes,
        status: "fallback",
        calculatedAt: now.toISOString(),
      };
    }
    observations.push(road);
    if (i < 2) estimate = addMinutes(target, -road.durationMinutes);
  }
  if (!road) return null;
  // If iteration oscillates, retain the longest observed drive. Never move departure later
  // on the final check: that would use a prediction from an unchecked later departure.
  const duration = Math.max(...observations.map((r) => r.durationMinutes));
  estimate = new Date(Math.min(+estimate, +addMinutes(target, -duration)));
  if (estimate < now) return null;
  const degraded = observations.find((r) => r.status !== "live");
  road = {
    ...road,
    durationMinutes: duration,
    status: degraded?.status ?? road.status,
    calculatedAt: observations.map((r) => r.calculatedAt).sort()[0],
  };
  return {
    leaveHomeAt: estimate,
    drivingMinutes: duration,
    stationOverheadMinutes: overhead,
    road,
    catchMarginMinutes: minutesBetween(
      safe,
      addMinutes(
        estimate,
        duration + station.parkingMinutes + station.walkToPlatformMinutes,
      ),
    ),
  };
}
