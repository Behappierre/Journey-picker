import type { Confidence, RailService, RoadJourney } from "../domain/models";
import { optimisation } from "../config/optimisation";
export function calculateConfidence(
  road: RoadJourney,
  services: RailService[],
  connectionMargin: number | undefined,
  disruptions: string[],
  now: Date,
): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  let low = false;
  if (services.some(s => s.dataSource === "timetable")) {
    low = true;
    reasons.push("Scheduled timetable only; live running and cancellations are unconfirmed");
  }
  if (road.status !== "live")
    reasons.push("Driving time is a cached or configured estimate");
  if (
    road.staticDurationMinutes &&
    road.durationMinutes > road.staticDurationMinutes * 1.4
  )
    reasons.push("Traffic is unusually heavy");
  if (services.some((s) => s.delayed))
    reasons.push(
      "Train delay may recover; an earlier departure buffer is included",
    );
  if (services.some((s) => s.arrivalUncertain)) {
    low = true;
    reasons.push("Arrival forecast is uncertain; scheduled arrival shown");
  }
  if (services.some((s) => s.departureUncertain)) {
    low = true;
    reasons.push("No usable live departure forecast");
  }
  if (services.some((s) => s.delayed && !s.estimatedDeparture)) {
    low = true;
    reasons.push("Departure is delayed without a precise forecast");
  }
  if (connectionMargin !== undefined && connectionMargin < 5)
    reasons.push("Connection has less than five extra minutes");
  if (connectionMargin !== undefined && connectionMargin < 2) low = true;
  if (disruptions.length) {
    reasons.push("Railway disruption reported; read the notices");
    low = true;
  }
  if (
    [road.calculatedAt, ...services.map((s) => s.calculatedAt)].some(
      (t) =>
        !Number.isFinite(Date.parse(t)) ||
        +now - Date.parse(t) > optimisation.freshnessMinutes * 60000,
    )
  ) {
    low = true;
    reasons.push("Live data may be stale");
  }
  return {
    confidence: low ? "low" : reasons.length ? "medium" : "high",
    reasons: reasons.length
      ? reasons
      : [
          "Road and platform buffers included",
          "Live forecasts and a comfortable connection, where needed",
        ],
  };
}
