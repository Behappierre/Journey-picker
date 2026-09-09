import {describe,it,expect,vi} from "vitest";
import {lookupStation,stationQuerySchema} from "../services/stationLookup";
const station = {place_id:"emd",formatted_address:"East Midlands Parkway, Derby, UK",types:["train_station","transit_station"],address_components:[{long_name:"East Midlands Parkway",short_name:"EMD",types:["establishment"]},{long_name:"United Kingdom",short_name:"GB",types:["country"]}],geometry:{location:{lat:52.862,lng:-1.263}}};
const mock=(data:unknown)=>vi.fn(async()=>Response.json(data)) as unknown as typeof fetch;
describe("station lookup",()=>{
  it("validates and trims station names",()=>{
    expect(stationQuerySchema.parse("  Derby  ")).toBe("Derby");
    expect(stationQuerySchema.safeParse(" ").success).toBe(false);
    expect(stationQuerySchema.safeParse("a".repeat(101)).success).toBe(false);
  });
  it("returns railway stations and restricts Google to GB without caching",async()=>{
    const fetcher=mock({status:"OK",results:[station,station]});
    expect(await lookupStation("East Midlands Parkway","test",fetcher)).toEqual([{id:"emd",name:"East Midlands Parkway",address:station.formatted_address,location:station.geometry.location}]);
    const [url,options]=vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toContain("country%3AGB");
    expect(options?.cache).toBe("no-store");
  });
  it.each([
    {...station,types:["locality"]},
    {...station,partial_match:true},
    {...station,address_components:[]},
    {...station,geometry:{location:{lat:999,lng:0}}},
  ])("rejects towns, partial matches, unverified countries and invalid locations",async(result)=>{
    await expect(lookupStation("Derby","key",mock({status:"OK",results:[result]}))).rejects.toMatchObject({status:404});
  });
  it("accepts Google's EMD transit classification only with an exact railway name",async()=>{
    const googleEmd = {...station,partial_match:true,types:["establishment","point_of_interest","transit_station"],address_components:[{long_name:"East Midlands Parkway railway station",short_name:"East Midlands Parkway railway station",types:["establishment"]},station.address_components[1]]};
    expect(await lookupStation("East Midlands Parkway","key",mock({status:"OK",results:[googleEmd]}))).toHaveLength(1);
    await expect(lookupStation("Derby","key",mock({status:"OK",results:[googleEmd]}))).rejects.toMatchObject({status:404});
    await expect(lookupStation("East Midlands Parkway","key",mock({status:"OK",results:[{...googleEmd,address_components:station.address_components}]}))).rejects.toMatchObject({status:404});
  });
  it("handles quota and denied access without exposing upstream messages",async()=>{
    await expect(lookupStation("Derby","secret",mock({status:"REQUEST_DENIED",error_message:"secret"}))).rejects.toMatchObject({status:503,message:expect.stringContaining("Enable the Geocoding API")});
    await expect(lookupStation("Derby","key",mock({status:"OVER_QUERY_LIMIT"}))).rejects.toMatchObject({status:429});
  });
});
