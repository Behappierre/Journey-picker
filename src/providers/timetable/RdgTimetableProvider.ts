import { z } from "zod";
import type { RailProvider, RailService } from "../../domain/models";
const timestamp = z.string().datetime({ offset: true });
const schema = z.object({ version: z.literal(1), source: z.literal("RDG"), importedAt: timestamp, validFrom: timestamp, validUntil: timestamp, warnings: z.array(z.string()), services: z.array(z.object({ uid: z.string(), originCrs: z.string().regex(/^[A-Z]{3}$/), destinationCrs: z.string().regex(/^[A-Z]{3}$/), departure: timestamp, arrival: timestamp, operator: z.string().optional() })) });
export class RdgTimetableProvider implements RailProvider {
  readonly name = "RDG passenger timetable";
  private cached?: { data: z.infer<typeof schema>; expires: number };
  private pending?: Promise<z.infer<typeof schema>>;
  constructor(private load: () => Promise<unknown>) {}
  private async data(now: Date) {
    if (!this.cached || this.cached.expires < Date.now()) {
      this.pending ??= this.load().then(raw => schema.parse(raw)).then(data => {
        this.cached = { data, expires: Date.now() + 3600000 }; return data;
      }).finally(() => { this.pending = undefined; });
      await this.pending;
    }
    const data = this.cached!.data;
    if (+now < Date.parse(data.validFrom) || +now >= Date.parse(data.validUntil) || +now - Date.parse(data.importedAt) > 8 * 86400000 || Date.parse(data.importedAt) > +now + 60000) throw new Error("RDG timetable is outside its validity window");
    return data;
  }
  async getDepartures(originCrs: string, destinationCrs: string, now: Date, horizon: number): Promise<RailService[]> {
    const data = await this.data(now);
    return data.services.filter(s => s.originCrs === originCrs && s.destinationCrs === destinationCrs && Date.parse(s.departure) >= +now && Date.parse(s.departure) <= +now + horizon * 60000 && Date.parse(s.arrival) > Date.parse(s.departure)).map(s => ({
      serviceId: `rdg:${s.uid}`, originCrs, destinationCrs, scheduledDeparture: new Date(s.departure), scheduledArrival: new Date(s.arrival), operator: s.operator,
      cancelled: false, delayed: false, arrivalUncertain: true, departureUncertain: true,
      dataSource: "timetable" as const, calculatedAt: data.importedAt, disruptionMessages: data.warnings,
    })).sort((a, b) => +a.scheduledDeparture - +b.scheduledDeparture);
  }
  async getServiceDetails(serviceId: string, originCrs: string, now: Date) {
    const data = await this.data(now);
    const destinations = [...new Set(data.services.filter(s => `rdg:${s.uid}` === serviceId).map(s => s.destinationCrs))];
    const services = (await Promise.all(destinations.map(d => this.getDepartures(originCrs, d, now, 1440)))).flat().filter(s => s.serviceId === serviceId);
    return { serviceId, services };
  }
  async getDisruptions() { return []; }
}

/** The URL is private deployment configuration, never supplied by a browser request. */
export function remoteTimetable(url: string) {
  if (new URL(url).protocol !== "https:") throw new Error("RDG timetable URL must use HTTPS");
  return new RdgTimetableProvider(async () => {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("RDG timetable download failed");
    const text = await response.text();
    if (text.length > 20000000) throw new Error("RDG timetable exceeds size limit");
    return JSON.parse(text);
  });
}
