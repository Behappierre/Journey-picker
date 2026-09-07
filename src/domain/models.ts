export interface LatLng {
  lat: number;
  lng: number;
}
export type Objective = "fastest" | "balanced" | "least_driving";
export type Confidence = "high" | "medium" | "low";
export type RailStrategy =
  | { type: "direct"; destinationCrs: string }
  | {
      type: "one_change";
      interchangeCrs: string;
      destinationCrs: string;
      minimumConnectionMinutes: number;
    };
export interface CandidateStation {
  id: string;
  name: string;
  crs: string;
  location: LatLng;
  enabled: boolean;
  parkingMinutes: number;
  walkToPlatformMinutes: number;
  platformSafetyMinutes: number;
  defaultDriveMinutes?: number;
  railStrategies: RailStrategy[];
}
export interface Settings {
  home: LatLng | null;
  stations: CandidateStation[];
  objective: Objective;
  lateTrainRecoveryBufferMinutes: number;
  minimumConnectionMinutes: number;
  planningHorizonMinutes: number;
  alternativesCount: number;
}
export interface RoadJourney {
  durationMinutes: number;
  staticDurationMinutes?: number;
  distanceKm?: number;
  calculatedAt: string;
  status: "live" | "cached" | "fallback";
}
export interface RoadRoutingProvider {
  getTravelTime(
    origin: LatLng,
    destination: LatLng,
    departureTime: Date,
  ): Promise<RoadJourney>;
}
export interface RailService {
  serviceId: string;
  originCrs: string;
  destinationCrs: string;
  scheduledDeparture: Date;
  estimatedDeparture?: Date;
  scheduledArrival?: Date;
  estimatedArrival?: Date;
  operator?: string;
  platform?: string;
  cancelled: boolean;
  delayed: boolean;
  arrivalUncertain?: boolean;
  departureUncertain?: boolean;
  delayMinutes?: number;
  calculatedAt: string;
  disruptionMessages: string[];
}
export interface RailServiceDetails {
  serviceId: string;
  services: RailService[];
}
export interface RailDisruption {
  message: string;
}
export interface RailProvider {
  readonly name?: string;
  getDepartures(
    originCrs: string,
    destinationCrs: string,
    now: Date,
    horizon: number,
  ): Promise<RailService[]>;
  getServiceDetails(
    serviceId: string,
    originCrs: string,
    now: Date,
  ): Promise<RailServiceDetails>;
  getDisruptions(
    crs: string,
    now: Date,
    horizon: number,
  ): Promise<RailDisruption[]>;
}
export interface JourneyOption {
  id: string;
  station: CandidateStation;
  leaveHomeAt: Date;
  drivingMinutes: number;
  stationOverheadMinutes: number;
  trainDeparture: Date;
  scheduledTrainDeparture: Date;
  londonArrival: Date;
  changes: number;
  services: RailService[];
  catchMarginMinutes: number;
  connectionMarginMinutes?: number;
  confidence: Confidence;
  confidenceReasons: string[];
  disruptionMessages: string[];
  score: number;
  road: RoadJourney;
  railUpdatedAt: string;
  explanation: string;
}
export interface PlanRequest {
  origin: LatLng;
  mode: "next" | "arrive_by";
  objective: Objective;
  arrivalBy?: string | null;
  settings: Settings;
}
export interface PlanResult {
  railSource?: string;
  generatedAt: string;
  recommended: JourneyOption | null;
  alternatives: JourneyOption[];
  roadDataStatus: "live" | "degraded" | "unavailable";
  railDataStatus: "live" | "partial" | "unavailable";
  messages: string[];
}
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;
export type ClientPlan = Jsonify<PlanResult>;
export type ClientJourney = Jsonify<JourneyOption>;
