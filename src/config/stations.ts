import type { CandidateStation, Settings } from "../domain/models";
function station(
  id: string,
  name: string,
  crs: string,
  lat: number,
  lng: number,
  drive: number,
  terminal: string,
): CandidateStation {
  return {
    id,
    name,
    crs,
    location: { lat, lng },
    enabled: true,
    parkingMinutes: 5,
    walkToPlatformMinutes: 3,
    platformSafetyMinutes: 4,
    defaultDriveMinutes: drive,
    railStrategies: [{ type: "direct", destinationCrs: terminal }],
  };
}
// Starting suggestions; edit car-park coordinates and overheads for your actual route.
export const defaultStations: CandidateStation[] = [
  // DfT station entrance coordinates: planning.data.gov.uk/entity/50169891
  station("east-midlands-parkway", "East Midlands Parkway", "EMD", 52.862566, -1.263608, 35, "STP"),
  station(
    "lichfield",
    "Lichfield Trent Valley",
    "LTV",
    52.6869,
    -1.8002,
    30,
    "EUS",
  ),
  station("tamworth", "Tamworth", "TAM", 52.6375, -1.6865, 30, "EUS"),
  station("derby", "Derby", "DBY", 52.9166, -1.4634, 30, "STP"),
  {
    ...station("burton", "Burton-on-Trent", "BUT", 52.8058, -1.6425, 12, "STP"),
    railStrategies: [
      {
        type: "one_change",
        interchangeCrs: "TAM",
        destinationCrs: "EUS",
        minimumConnectionMinutes: 10,
      },
      {
        type: "one_change",
        interchangeCrs: "DBY",
        destinationCrs: "STP",
        minimumConnectionMinutes: 10,
      },
    ],
  },
];
/** One-time upgrade of existing saved settings; preserve home and custom buffers. */
export function addParkwayAndTamworth(settings: Settings): Settings {
  const stations = structuredClone(settings.stations);
  const existing = stations.findIndex(s => s.crs === "EMD");
  const parkway = existing >= 0 ? stations.splice(existing, 1)[0] : structuredClone(defaultStations[0]);
  parkway.enabled = true;
  stations.unshift(parkway);
  for (const s of stations.filter(s => s.crs === "BUT")) {
    if (!s.railStrategies.some(r => r.type === "one_change" && r.interchangeCrs === "TAM" && r.destinationCrs === "EUS"))
      s.railStrategies.push({ type: "one_change", interchangeCrs: "TAM", destinationCrs: "EUS", minimumConnectionMinutes: 10 });
  }
  return { ...settings, stations };
}
export const defaultSettings: Settings = {
  home: null,
  stations: defaultStations,
  objective: "balanced",
  lateTrainRecoveryBufferMinutes: 5,
  minimumConnectionMinutes: 8,
  planningHorizonMinutes: 180,
  alternativesCount: 3,
};
export const terminalNames: Record<string, string> = {
  EUS: "London Euston",
  STP: "London St Pancras",
  MYB: "London Marylebone",
  PAD: "London Paddington",
  KGX: "London King’s Cross",
};
