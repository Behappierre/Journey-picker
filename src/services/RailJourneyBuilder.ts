import type {
  CandidateStation,
  RailProvider,
  RailService,
  Settings,
} from "../domain/models";
import { minutesBetween } from "./time";
import { safeDeparture } from "./LeaveTimeCalculator";
export interface RailItinerary {
  services: RailService[];
  connectionMarginMinutes?: number;
}
const usable = (s: RailService) => !s.cancelled && !!s.scheduledArrival;
export async function buildRailJourneys(
  station: CandidateStation,
  settings: Settings,
  rail: RailProvider,
  now: Date,
) {
  const results = await Promise.allSettled(
    station.railStrategies.map(async (strategy) => {
      const first = (
        await rail.getDepartures(
          station.crs,
          strategy.type === "direct"
            ? strategy.destinationCrs
            : strategy.interchangeCrs,
          now,
          settings.planningHorizonMinutes,
        )
      ).filter(usable);
      if (strategy.type === "direct")
        return first.map((s) => ({ services: [s] }) as RailItinerary);
      const second = (
        await rail.getDepartures(
          strategy.interchangeCrs,
          strategy.destinationCrs,
          now,
          settings.planningHorizonMinutes,
        )
      ).filter(usable);
      const minimum = Math.max(
        settings.minimumConnectionMinutes,
        strategy.minimumConnectionMinutes,
      );
      return first.flatMap((a) => {
        // A connection cannot be promised without a usable live arrival forecast.
        if (a.arrivalUncertain || !a.estimatedArrival) return [];
        return second
          .filter((b) => b.serviceId !== a.serviceId)
          .flatMap((b) => {
            const margin = minutesBetween(
              safeDeparture(b, settings.lateTrainRecoveryBufferMinutes),
              a.estimatedArrival!,
            );
            return margin >= minimum
              ? [
                  {
                    services: [a, b],
                    connectionMarginMinutes: margin - minimum,
                  },
                ]
              : [];
          });
      });
    }),
  );
  if (results.every((r) => r.status === "rejected"))
    throw results[0].reason;
  return {
    journeys: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    partial: results.some((r) => r.status === "rejected"),
  };
}
