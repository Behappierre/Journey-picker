import {describe,it,expect,vi} from "vitest";
import {parseRtjp,RtjpRailProvider,rtjpEndpointFromWsdl} from "../providers/rail/RtjpRailProvider";
const now=new Date("2026-09-16T07:00:00Z");
const leg=(status="ONTIME",mode="TRAIN")=>`<j:leg><j:board><j:crsCode>EMD</j:crsCode></j:board><j:alight><j:crsCode>STP</j:crsCode></j:alight><j:mode>${mode}</j:mode><j:operator><c:code>EM</c:code><c:name>East Midlands Railway</c:name></j:operator><j:realtimeClassification>${status}</j:realtimeClassification><j:timetable><j:scheduled><j:departure>2026-09-16T08:30:00+01:00</j:departure><j:arrival>2026-09-16T10:00:00+01:00</j:arrival></j:scheduled><j:realtime/></j:timetable><j:originPlatform>2</j:originPlatform></j:leg>`;
const envelope=(legs=leg(),code="Ok")=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:j="http://www.thalesgroup.com/ojp/jpdlr" xmlns:c="http://www.thalesgroup.com/ojp/common"><s:Body><j:RealtimeJourneyPlanResponse><c:response>${code}</c:response><j:outwardJourney>${legs}</j:outwardJourney></j:RealtimeJourneyPlanResponse></s:Body></s:Envelope>`;
describe("RTJP provider",()=>{
 it("discovers the SOAP address and upgrades legacy HTTP without leaking credentials",()=>{
  expect(rtjpEndpointFromWsdl('<definitions><service><port><address location="http://ojp.nationalrail.co.uk/webservices/rtjp"/></port></service></definitions>')).toBe("https://ojp.nationalrail.co.uk/webservices/rtjp");
  expect(()=>rtjpEndpointFromWsdl('<definitions><service><port><address location="https://example.com/steal"/></port></service></definitions>')).toThrow();
 });
 it("maps official times, nested operators and omits unverified platforms",()=>{
  const [s]=parseRtjp(envelope(),"EMD","STP",now);
  expect(s.scheduledDeparture.toISOString()).toBe("2026-09-16T07:30:00.000Z");
  expect(s.estimatedArrival).toEqual(s.scheduledArrival);
  expect(s.operator).toBe("East Midlands Railway");expect(s.platform).toBeUndefined();
 });
 it("does not invent forecasts for NORMAL or cancelled services",()=>{
  expect(parseRtjp(envelope(leg("NORMAL")),"EMD","STP",now)[0].arrivalUncertain).toBe(true);
  expect(parseRtjp(envelope(leg("CANCELLED")),"EMD","STP",now)[0].cancelled).toBe(true);
 });
 it("never presents connections or replacement buses as direct trains",()=>{
  expect(parseRtjp(envelope(leg()+leg()),"EMD","STP",now)).toEqual([]);
  expect(parseRtjp(envelope(leg("NORMAL","BUS")),"EMD","STP",now)).toEqual([]);
  expect(parseRtjp(envelope(),"BUT","TAM",now)).toEqual([]);
 });
 it("rejects malformed XML, entities and upstream errors",()=>{
  for(const xml of ["<broken>","<!DOCTYPE a>"+envelope(),envelope(leg(),"OJP_OTHER_ERROR")]) expect(()=>parseRtjp(xml,"EMD","STP",now)).toThrow();
 });
 it("deduplicates concurrent paid calls and filters departure horizon",async()=>{
  const fetcher=vi.fn(async()=>new Response(envelope()));
  const provider=new RtjpRailProvider("https://ojp.nationalrail.co.uk/test","username","password",fetcher);
  const [a,b]=await Promise.all([provider.getDepartures("EMD","STP",now,120),provider.getDepartures("EMD","STP",now,120)]);
  expect(a).toEqual(b);expect(fetcher).toHaveBeenCalledTimes(1);
  const options=(fetcher.mock.calls as unknown as [unknown,RequestInit][])[0][1];
  expect(options.redirect).toBe("error");expect(options.body).toContain("<jps:directTrains>true");
  expect(options.headers).toHaveProperty("Authorization","Basic "+Buffer.from("username:password").toString("base64"));
 });
 it("keeps credential and quota errors safe without retries",async()=>{
  for(const [status,code] of [[401,"credentials"],[429,"rate_limit"]] as const){
   const fetcher=vi.fn(async()=>new Response("private details",{status}));
   const provider=new RtjpRailProvider("https://ojp.nationalrail.co.uk/test","u","p",fetcher);
   await expect(provider.getDepartures("EMD","STP",now,120)).rejects.toMatchObject({code,message:expect.stringContaining("National Rail RTJP")});
   expect(fetcher).toHaveBeenCalledTimes(1);
  }
 });
 it("refuses insecure or unrelated credential destinations",async()=>{
  const fetcher=vi.fn();
  for(const url of ["http://ojp.nationalrail.co.uk/test","https://example.com/test"]){
   await expect(new RtjpRailProvider(url,"u","p",fetcher).getDepartures("EMD","STP",now,120)).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
 });
});
