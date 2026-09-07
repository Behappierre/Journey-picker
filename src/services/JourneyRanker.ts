import type { JourneyOption, Objective } from "../domain/models";
import { optimisation } from "../config/optimisation";
export function rankJourneys(
  options: JourneyOption[],
  objective: Objective,
): JourneyOption[] {
  if (!options.length) return [];
  const eligible = options.filter((o) => o.confidence !== "low");
  const pool = eligible.length ? eligible : options;
  const fastest = Math.min(...pool.map((o) => +o.londonArrival));
  const window =
    objective === "balanced"
      ? optimisation.balancedWindowMinutes
      : objective === "least_driving"
        ? optimisation.leastDrivingWindowMinutes
        : 0;
  const preferred = (o: JourneyOption) =>
    +o.londonArrival <= fastest + window * 60000;
  const compare = (a: JourneyOption, b: JourneyOption) => {
    const risk =
      Number(a.confidence === "low") - Number(b.confidence === "low");
    if (risk) return risk;
    if (objective === "fastest")
      return (
        +a.londonArrival - +b.londonArrival ||
        a.drivingMinutes - b.drivingMinutes
      );
    const group = Number(preferred(b)) - Number(preferred(a));
    if (group) return group;
    if (!preferred(a)) return +a.londonArrival - +b.londonArrival;
    return (
      a.drivingMinutes - b.drivingMinutes ||
      a.changes - b.changes ||
      b.catchMarginMinutes - a.catchMarginMinutes ||
      a.disruptionMessages.length - b.disruptionMessages.length ||
      +a.londonArrival - +b.londonArrival
    );
  };
  return [...options]
    .sort(compare)
    .map((o) => ({
      ...o,
      score: (+o.londonArrival - fastest) / 60000,
      explanation:
        objective === "fastest"
          ? "Earliest London arrival among options meeting the confidence threshold."
          : objective === "balanced"
            ? "Less driving among safe options arriving within 10 minutes of the fastest; then fewer changes and more margin."
            : "Least driving among safe options arriving within 30 minutes of the fastest.",
    }));
}
