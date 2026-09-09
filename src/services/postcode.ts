import { z } from "zod";
import { coordinatesSchema } from "../domain/validation";
export const normalisePostcode = (value: string) => value.toUpperCase().replace(/\s/g, "");
export const postcodeSchema = z.string().max(16).transform(normalisePostcode)
  .refine(value => /^(GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(value), "Enter a full UK postcode.");
export class PostcodeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const resultSchema = z.object({
  partial_match: z.boolean().optional(),
  address_components: z.array(z.object({long_name:z.string(),short_name:z.string(),types:z.array(z.string())})),
  geometry: z.object({location: coordinatesSchema}),
});
export async function lookupPostcode(postcode: string, key: string, fetcher: typeof fetch = fetch) {
  if (!key) throw new PostcodeError("Google Maps postcode lookup is not configured.", 503);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("components", `postal_code:${postcode}|country:GB`);
  url.searchParams.set("key", key);
  const response = await fetcher(url, {cache:"no-store", signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new PostcodeError("Google Maps lookup is temporarily unavailable.", 503);
  const data = await response.json();
  if (data.status === "REQUEST_DENIED") throw new PostcodeError("Google Maps denied the lookup. Enable the Geocoding API and allow it for the server API key.", 503);
  if (data.status === "OVER_QUERY_LIMIT") throw new PostcodeError("Google Maps lookup limit reached. Please try later.", 429);
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new PostcodeError("Google Maps lookup is temporarily unavailable.", 503);
  for (const raw of data.results ?? []) {
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.partial_match) continue;
    const result = parsed.data;
    const postal = result.address_components.find(c => c.types.includes("postal_code"));
    const country = result.address_components.find(c => c.types.includes("country"));
    if (postal && normalisePostcode(postal.long_name) === postcode && country?.short_name === "GB")
      return {postcode: `${postcode.slice(0,-3)} ${postcode.slice(-3)}`, location:result.geometry.location};
  }
  throw new PostcodeError("No exact UK postcode found. Check the postcode and try again.", 404);
}
