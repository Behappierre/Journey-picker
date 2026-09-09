import { describe, it, expect, vi } from "vitest";
import { postcodeSchema, lookupPostcode } from "../services/postcode";
const result = {address_components:[{long_name:"SW1A 1AA",short_name:"SW1A 1AA",types:["postal_code"]},{long_name:"United Kingdom",short_name:"GB",types:["country"]}],geometry:{location:{lat:51.5,lng:-0.14}}};
const mock = (data:unknown) => vi.fn(async () => Response.json(data)) as unknown as typeof fetch;
describe("postcode lookup", () => {
  it("normalises full postcodes and rejects incomplete input", () => {
    expect(postcodeSchema.parse(" sw1a 1aa ")).toBe("SW1A1AA");
    expect(postcodeSchema.safeParse("SW1A").success).toBe(false);
  });
  it("returns a matching UK postcode with restricted, uncached Google request", async () => {
    const fetcher = mock({status:"OK",results:[result]});
    expect(await lookupPostcode("SW1A1AA","test-key",fetcher)).toEqual({postcode:"SW1A 1AA",location:result.geometry.location});
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toContain("country%3AGB");
    expect(options?.cache).toBe("no-store");
  });
  it("rejects partial or different postcodes", async () => {
    await expect(lookupPostcode("SW1A1AA","key",mock({status:"OK",results:[{...result,partial_match:true}]}))).rejects.toMatchObject({status:404});
    await expect(lookupPostcode("SW1A2AA","key",mock({status:"OK",results:[result]}))).rejects.toMatchObject({status:404});
  });
  it("explains denied access without exposing upstream details", async () => {
    await expect(lookupPostcode("SW1A1AA","secret",mock({status:"REQUEST_DENIED",error_message:"secret"}))).rejects.toMatchObject({status:503,message:expect.stringContaining("Enable the Geocoding API")});
  });
  it("handles quota and missing results", async () => {
    await expect(lookupPostcode("SW1A1AA","key",mock({status:"OVER_QUERY_LIMIT"}))).rejects.toMatchObject({status:429});
    await expect(lookupPostcode("SW1A1AA","key",mock({status:"ZERO_RESULTS",results:[]}))).rejects.toMatchObject({status:404});
  });
});
