import { z } from "zod";
import { coordinatesSchema } from "./validation";
export const stationResultSchema = z.object({
  id: z.string(), name: z.string(), address: z.string(), location: coordinatesSchema,
});
export type StationResult = z.infer<typeof stationResultSchema>;
