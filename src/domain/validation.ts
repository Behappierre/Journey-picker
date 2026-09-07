import { z } from "zod";
const minutes = z.number().int().min(0).max(60);
const crs = z.string().regex(/^[A-Z]{3}$/);
export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const strategySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("direct"), destinationCrs: crs }),
  z.object({
    type: z.literal("one_change"),
    destinationCrs: crs,
    interchangeCrs: crs,
    minimumConnectionMinutes: minutes,
  }),
]);
export const settingsSchema = z.object({
  home: coordinatesSchema.nullable(),
  stations: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().min(1).max(80),
        crs,
        location: coordinatesSchema,
        enabled: z.boolean(),
        parkingMinutes: minutes,
        walkToPlatformMinutes: minutes,
        platformSafetyMinutes: z.number().int().min(1).max(60),
        defaultDriveMinutes: z.number().min(1).max(240).optional(),
        railStrategies: z.array(strategySchema).min(1).max(4),
      }),
    )
    .min(1)
    .max(12)
    .refine(
      (s) => new Set(s.map((x) => x.id)).size === s.length,
      "Station IDs must be unique",
    ),
  objective: z.enum(["fastest", "balanced", "least_driving"]),
  lateTrainRecoveryBufferMinutes: minutes,
  minimumConnectionMinutes: z.number().int().min(1).max(60),
  planningHorizonMinutes: z.number().int().min(30).max(180),
  alternativesCount: z.number().int().min(1).max(5),
});
export const planSchema = z
  .object({
    origin: coordinatesSchema,
    mode: z.enum(["next", "arrive_by"]),
    objective: z.enum(["fastest", "balanced", "least_driving"]),
    arrivalBy: z.string().datetime({ offset: true }).nullable().optional(),
    settings: settingsSchema,
  })
  .refine(
    (r) => r.mode !== "arrive_by" || !!r.arrivalBy,
    "An arrival time is required",
  );
