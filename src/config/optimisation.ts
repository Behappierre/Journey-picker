export const optimisation = {
  balancedWindowMinutes: 10,
  leastDrivingWindowMinutes: 30,
  freshnessMinutes: 2,
  roadCacheSeconds: 90,
  roadFallbackCacheSeconds: 300,
  railCacheSeconds: 25,
  // Lexicographic ranking is deliberately transparent; score is minutes after fastest.
  minimumRecommendedConfidence: "medium",
  roadSafetyMinutes: 3,
  maxStations: 12,
  maxOptionsPerStation: 10,
} as const;
