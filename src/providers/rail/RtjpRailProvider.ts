import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DateTime } from "luxon";
import type { RailProvider, RailService } from "../../domain/models";
import { TtlCache } from "../cache";
import { RailProviderError } from "./RailProviderError";
const parser = new XMLParser({removeNSPrefix:true,ignoreAttributes:true,parseTagValue:false,processEntities:false});
const list = (value: any): any[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const time = (value: unknown): Date | undefined => {
  if (typeof value !== "string") return;
  const d = DateTime.fromISO(value,{zone:"Europe/London"});
  return d.isValid ? d.toJSDate() : undefined;
};
export function parseRtjp(xml:string, origin:string, destination:string, now:Date):RailService[] {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid RTJP XML");
  const body = parser.parse(xml)?.Envelope?.Body;
  if (body?.Fault) throw new Error("RTJP SOAP fault");
  const response = body?.RealtimeJourneyPlanResponse;
  if (!response || response.response !== "Ok") throw new Error("RTJP request unsuccessful");
  const generated = time(response.generatedTime) ?? now;
  const services = new Map<string,RailService>();
  for (const journey of list(response.outwardJourney)) {
    const legs = list(journey.leg);
    // The existing planner joins explicit interchange segments itself. Never represent
    // a multi-leg or replacement-bus journey as a direct train.
    if (legs.length !== 1) continue;
    const leg = legs[0];
    const from = leg.board?.crsCode ?? leg.origin;
    const to = leg.alight?.crsCode ?? leg.destination;
    if (leg.mode !== "TRAIN" || from !== origin || to !== destination) continue;
    const departure = time(leg.timetable?.scheduled?.departure);
    const arrival = time(leg.timetable?.scheduled?.arrival);
    if (!departure || !arrival || arrival <= departure) throw new Error("Invalid RTJP train times");
    const classification = String(leg.realtimeClassification ?? journey.realtimeClassification ?? "").toUpperCase();
    const cancelled = /CANCEL/.test(classification) || /CANCEL/.test(String(journey.realtimeClassification));
    const onTime = classification === "ONTIME";
    const estimatedDeparture = time(leg.timetable?.realtime?.departure) ?? (onTime ? departure : undefined);
    const estimatedArrival = time(leg.timetable?.realtime?.arrival) ?? (onTime ? arrival : undefined);
    const operator = typeof leg.operator === "string" ? leg.operator : leg.operator?.name ?? leg.operator?.code;
    const serviceId = `rtjp:${origin}:${destination}:${departure.toISOString()}:${operator ?? ""}`;
    services.set(serviceId,{
      serviceId,originCrs:origin,destinationCrs:destination,scheduledDeparture:departure,scheduledArrival:arrival,
      estimatedDeparture,estimatedArrival,operator,cancelled,
      delayed:/DELAY|LATE/.test(classification) || !!(estimatedDeparture && estimatedDeparture>departure) || !!(estimatedArrival && estimatedArrival>arrival),
      departureUncertain:!estimatedDeparture,arrivalUncertain:!estimatedArrival,
      delayMinutes:estimatedDeparture ? Math.max(0,(+estimatedDeparture-+departure)/60000) : undefined,
      calculatedAt:generated.toISOString(),dataSource:"live",
      // Do not publish platforms until the account's WSDL suppression semantics are verified.
      disruptionMessages:cancelled ? ["Train cancelled."] : [],
    });
  }
  return [...services.values()];
}
export function rtjpEndpointFromWsdl(xml:string):string {
  if (xml.length>2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true) throw new Error("Invalid RTJP WSDL");
  const wsdl = new XMLParser({removeNSPrefix:true,ignoreAttributes:false,parseTagValue:false,processEntities:false}).parse(xml);
  for (const service of list(wsdl.definitions?.service)) for (const port of list(service.port)) {
    const location = port.address?.["@_location"];
    if (typeof location !== "string") continue;
    const url=new URL(location);
    if (url.username || url.password || !(url.hostname === "nationalrail.co.uk" || url.hostname.endsWith(".nationalrail.co.uk"))) continue;
    // Legacy WSDLs advertise HTTP. Never transmit credentials without TLS.
    if (url.protocol === "http:") url.protocol="https:";
    if (url.protocol === "https:") return url.toString();
  }
  throw new Error("No approved RTJP SOAP endpoint found in WSDL");
}
export class RtjpRailProvider implements RailProvider {
  readonly name = "National Rail RTJP";
  private resolvedEndpoint?:Promise<string>;
  private cache = new TtlCache<RailService[]>();
  constructor(private endpoint:string,private username:string,private password:string,private fetcher:typeof fetch=fetch) {}
  async discoverEndpoint():Promise<string> {
    if (this.endpoint) return this.endpoint;
    if (!this.username || !this.password) throw new RailProviderError("credentials",this.name);
    if (!this.resolvedEndpoint) this.resolvedEndpoint=(async()=>{
      const response=await this.fetcher("https://ojp.nationalrail.co.uk/webservices/jpdlr.wsdl",{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000),headers:{Authorization:`Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`}});
      if (response.status===401 || response.status===403) throw new RailProviderError("credentials",this.name);
      if (!response.ok) throw new Error("RTJP WSDL unavailable");
      return rtjpEndpointFromWsdl(await response.text());
    })().catch(error=>{this.resolvedEndpoint=undefined;throw error;});
    return this.resolvedEndpoint;
  }
  async getDepartures(origin:string,destination:string,now:Date,horizon:number):Promise<RailService[]> {
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !Number.isFinite(+now) || horizon<1 || horizon>180) throw new Error("Invalid rail search");
    if (!this.username || !this.password) throw new RailProviderError("credentials",this.name);
    const endpoint = new URL(await this.discoverEndpoint());
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || !(endpoint.hostname === "nationalrail.co.uk" || endpoint.hostname.endsWith(".nationalrail.co.uk"))) throw new Error("RTJP requires an approved HTTPS National Rail endpoint");
    const key = `${origin}:${destination}:${Math.floor(+now/60000)}:${horizon}`;
    const services = await this.cache.resolve(key,60000,async()=>{
      const departBy = DateTime.fromJSDate(now).setZone("Europe/London").toISO({suppressMilliseconds:true});
      const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:jps="http://www.thalesgroup.com/ojp/jpdlr" xmlns:com="http://www.thalesgroup.com/ojp/common"><soap:Header/><soap:Body><jps:RealtimeJourneyPlanRequest><jps:origin><com:stationCRS>${origin}</com:stationCRS></jps:origin><jps:destination><com:stationCRS>${destination}</com:stationCRS></jps:destination><jps:realtimeEnquiry>STANDARD</jps:realtimeEnquiry><jps:outwardTime><jps:departBy>${departBy}</jps:departBy></jps:outwardTime><jps:directTrains>true</jps:directTrains></jps:RealtimeJourneyPlanRequest></soap:Body></soap:Envelope>`;
      // One request per segment; no automatic retry or timetable harvesting.
      const response = await this.fetcher(endpoint,{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(12000),headers:{Authorization:`Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,"Content-Type":"text/xml; charset=utf-8",SOAPAction:'""'},body:xml});
      if (response.status === 401 || response.status === 403) throw new RailProviderError("credentials",this.name);
      if (response.status === 429) throw new RailProviderError("rate_limit",this.name);
      if (!response.ok) throw new Error("RTJP service unavailable");
      return parseRtjp(await response.text(),origin,destination,now);
    });
    return services.filter(s=>+(s.estimatedDeparture ?? s.scheduledDeparture)>=+now && +s.scheduledDeparture<=+now+horizon*60000);
  }
  async getServiceDetails(serviceId:string) { return {serviceId,services:[]}; }
  async getDisruptions() { return []; }
}
