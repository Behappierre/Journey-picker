import { z } from "zod";
import { coordinatesSchema } from "../domain/validation";
import { PostcodeError } from "./postcode";
export const stationQuerySchema = z.string().trim().min(2).max(100);
import { type StationResult } from "../domain/stationLookup";
const googleResultSchema = z.object({
  place_id:z.string(), formatted_address:z.string(), types:z.array(z.string()),
  partial_match:z.boolean().optional(),
  address_components:z.array(z.object({long_name:z.string(),short_name:z.string(),types:z.array(z.string())})),
  geometry:z.object({location:coordinatesSchema}),
});
export async function lookupStation(query:string, key:string, fetcher:typeof fetch = fetch):Promise<StationResult[]> {
  if (!key) throw new PostcodeError("Google Maps station lookup is not configured.",503);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${query} railway station`);
  url.searchParams.set("components", "country:GB");
  url.searchParams.set("key",key);
  const response = await fetcher(url,{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new PostcodeError("Google Maps lookup is temporarily unavailable.",503);
  const data = await response.json();
  if (data.status === "REQUEST_DENIED") throw new PostcodeError("Google Maps denied the lookup. Enable the Geocoding API and allow it for the server API key.",503);
  if (data.status === "OVER_QUERY_LIMIT") throw new PostcodeError("Google Maps lookup limit reached. Please try later.",429);
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new PostcodeError("Google Maps lookup is temporarily unavailable.",503);
  const results:StationResult[] = [];
  for (const raw of data.results ?? []) {
    const parsed = googleResultSchema.safeParse(raw);
    if (!parsed.success) continue;
    const r = parsed.data;
    const name = r.address_components.find(c=>c.types.some(t=>["train_station","point_of_interest","establishment"].includes(t)))?.long_name ?? r.formatted_address.split(",")[0];
    const normalise = (value:string) => value.toLowerCase().replace(/\b(railway|rail|train|station)\b/g, "").replace(/[^a-z0-9]/g, "");
    const exactName = normalise(name) === normalise(query);
    const railway = r.types.includes("train_station") || (r.types.includes("transit_station") && /\b(railway|rail|train) station\b/i.test(name));
    if (!railway || (r.partial_match && !exactName) || !r.address_components.some(c=>c.types.includes("country") && c.short_name === "GB")) continue;
    if (!results.some(s=>s.id===r.place_id)) results.push({id:r.place_id,name,address:r.formatted_address,location:r.geometry.location});
  }
  if (!results.length) throw new PostcodeError("No UK railway station found. Try the full station name, including its town.",404);
  return results.slice(0,5);
}
