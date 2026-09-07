import type {
  JourneyOption,
  PlanRequest,
  PlanResult,
  RailProvider,
  RoadRoutingProvider,
} from "../domain/models";
import { buildRailJourneys } from "./RailJourneyBuilder";
import { calculateLeaveTime } from "./LeaveTimeCalculator";
import { calculateConfidence } from "./ConfidenceCalculator";
import { rankJourneys } from "./JourneyRanker";
import { optimisation } from "../config/optimisation";
export class JourneyPlanner {
  constructor(
    private road: RoadRoutingProvider,
    private rail: RailProvider,
  ) {}
  async plan(request: PlanRequest, now = new Date()): Promise<PlanResult> {
    const result: PlanResult = {
      railSource: this.rail.name ?? "National Rail Darwin",
      generatedAt: now.toISOString(),
      recommended: null,
      alternatives: [],
      roadDataStatus: "unavailable",
      railDataStatus: "unavailable",
      messages: [],
    };
    const stations = request.settings.stations.filter((s) => s.enabled);
    if (!stations.length)
      return {
        ...result,
        messages: ["Enable at least one station in Settings."],
      };
    if (
      request.mode === "arrive_by" &&
      (!request.arrivalBy || Date.parse(request.arrivalBy) <= +now)
    )
      return { ...result, messages: ["Choose an arrival time in the future."] };
    const evaluated = await Promise.allSettled(
      stations.map(async (station) => {
        const [{ journeys, partial }, notices] = await Promise.all([
          buildRailJourneys(station, request.settings, this.rail, now),
          this.rail.getDisruptions(
            station.crs,
            now,
            request.settings.planningHorizonMinutes,
          ),
        ]);
        const viable = journeys.filter(
          (j) =>
            request.mode !== "arrive_by" ||
            +(
              j.services.at(-1)!.estimatedArrival ??
              j.services.at(-1)!.scheduledArrival!
            ) <= Date.parse(request.arrivalBy!),
        );
        viable.sort(
          (a, b) =>
            +(
              a.services.at(-1)!.estimatedArrival ??
              a.services.at(-1)!.scheduledArrival!
            ) -
            +(
              b.services.at(-1)!.estimatedArrival ??
              b.services.at(-1)!.scheduledArrival!
            ),
        );
        const options: JourneyOption[] = [];
        // Bound provider work without stopping at the first already-missed train.
        await Promise.all(
          viable
            .slice(0, optimisation.maxOptionsPerStation)
            .map(async (itinerary) => {
              const services = itinerary.services;
              const first = services[0];
              const leave = await calculateLeaveTime(
                request.origin,
                station,
                first,
                request.settings.lateTrainRecoveryBufferMinutes,
                this.road,
                now,
              );
              if (!leave) {
                if (process.env.NODE_ENV === "development")
                  console.info("Journey rejected", {
                    station: station.crs,
                    service: first.serviceId,
                    reason: "Cannot reach platform in time or road unavailable",
                  });
                return;
              }
              const disruptions = [
                ...new Set([
                  ...notices.map((n) => n.message),
                  ...services.flatMap((s) => s.disruptionMessages),
                ]),
              ];
              const confidence = calculateConfidence(
                leave.road,
                services,
                itinerary.connectionMarginMinutes,
                disruptions,
                now,
              );
              const last = services.at(-1)!;
              const option: JourneyOption = {
                ...leave,
                id: `${station.id}:${services.map((s) => s.serviceId).join(":")}`,
                station,
                trainDeparture:
                  first.estimatedDeparture ?? first.scheduledDeparture,
                scheduledTrainDeparture: first.scheduledDeparture,
                londonArrival: last.estimatedArrival ?? last.scheduledArrival!,
                changes: services.length - 1,
                services,
                connectionMarginMinutes: itinerary.connectionMarginMinutes,
                confidence: confidence.confidence,
                confidenceReasons: confidence.reasons,
                disruptionMessages: disruptions,
                score: 0,
                explanation: "",
                railUpdatedAt: services.map((s) => s.calculatedAt).sort()[0],
              };
              options.push(option);
              if (process.env.NODE_ENV === "development")
                console.info("Station evaluated", {
                  station: station.crs,
                  drive: leave.drivingMinutes,
                  leave: leave.leaveHomeAt.toISOString(),
                  arrival: option.londonArrival.toISOString(),
                  confidence: option.confidence,
                });
            }),
        );
        return { options, partial };
      }),
    );
    const successful = evaluated.filter((r) => r.status === "fulfilled");
    if (!successful.length)
      return {
        ...result,
        messages: [
          `Live railway information unavailable. Check ${result.railSource} configuration and try again.`,
        ],
      };
    result.railDataStatus =
      successful.length < stations.length ||
      successful.some((r) => r.value.partial)
        ? "partial"
        : "live";
    const ranked = rankJourneys(
      successful.flatMap((r) => r.value.options),
      request.objective,
    );
    result.recommended = ranked.find((o) => o.confidence !== "low") ?? null;
    result.alternatives = ranked
      .filter((o) => o.id !== result.recommended?.id)
      .slice(0, request.settings.alternativesCount);
    const displayed = [result.recommended, ...result.alternatives].filter(
      (o): o is JourneyOption => !!o,
    );
    result.roadDataStatus = !displayed.length
      ? "unavailable"
      : displayed.some((o) => o.road.status !== "live")
        ? "degraded"
        : "live";
    if (result.railDataStatus === "partial")
      result.messages.push(
        "Some station data is unavailable. Comparing the stations that responded.",
      );
    if (!ranked.length)
      result.messages.push(
        request.mode === "arrive_by"
          ? "No catchable journey meets this arrival time in the live planning window. Darwin is not an advance timetable planner."
          : "No catchable London journey found in the live planning window. Try refreshing or adjusting your stations.",
      );
    else if (!result.recommended)
      result.messages.push(
        "Only low-confidence journeys are available. Check the details before travelling.",
      );
    if (request.mode === "arrive_by")
      result.messages.push(
        `Arrive by compares live departures in the next ${request.settings.planningHorizonMinutes} minutes only; later services may not yet be published.`,
      );
    if (process.env.NODE_ENV === "development")
      console.info(
        "Journey ranking",
        ranked.map((o) => ({
          station: o.station.crs,
          minutesAfterFastest: o.score,
        })),
      );
    return result;
  }
}
