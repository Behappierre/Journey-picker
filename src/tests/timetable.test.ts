import { describe, it, expect, vi } from "vitest";
import { importCif } from "../providers/timetable/importCif";
import { RdgTimetableProvider } from "../providers/timetable/RdgTimetableProvider";
import { TimetableFallbackProvider } from "../providers/timetable/TimetableFallbackProvider";
import type { RailProvider } from "../domain/models";
const now = new Date("2026-09-07T10:00:00Z");
function line(fields: [number,string][]) { const text = Array(80).fill(" "); for (const [pos,value] of fields) [...value].forEach((c,i) => text[pos-1+i]=c); return text.join(""); }
const stations = [line([[1,"A"],[37,"LICHFTV"],[50,"LTV"]]),line([[1,"A"],[37,"EUSTON"],[50,"EUS"]])].join("\n");
const bs = (stp="P") => line([[1,"BSN"],[4,"A12345"],[10,"260907"],[16,"260913"],[22,"1111100"],[30,"P"],[80,stp]]);
function cif(extra: string[] = []) { return [line([[1,"HD"],[47,"F"]]),bs(),line([[1,"LO"],[3,"LICHFTV"],[16,"1300"]]),line([[1,"LT"],[3,"EUSTON"],[16,"1410"]]),...extra,"ZZ"].join("\n"); }
describe("RDG fallback", () => {
  it("imports public times with BST and weekdays", () => {
    const data = importCif(cif(),stations,now);
    expect(data.services).toHaveLength(5);
    expect(data.services[0].departure).toBe("2026-09-07T12:00:00.000Z");
  });
  it("cancellations and overlays remove the permanent service even without matching stops", () => {
    expect(importCif(cif([bs("C")]),stations,now).services).toHaveLength(0);
    expect(importCif(cif([bs("O")]),stations,now).services).toHaveLength(0);
  });
  it("rejects incomplete and update files", () => {
    expect(() => importCif(cif().replace("ZZ", ""), stations, now)).toThrow();
    expect(() => importCif(cif().replace("F", "U"), stations, now)).toThrow();
  });
  it("never invents live forecasts and rejects expired snapshots", async () => {
    const provider = new RdgTimetableProvider(async () => importCif(cif(),stations,now));
    const [s] = await provider.getDepartures("LTV","EUS",now,180);
    expect(s.dataSource).toBe("timetable"); expect(s.estimatedArrival).toBeUndefined(); expect(s.platform).toBeUndefined();
    await expect(provider.getDepartures("LTV","EUS",new Date("2026-10-01"),180)).rejects.toThrow("validity");
  });
  it("does not overwrite successful empty boards and retains observed cancellations", async () => {
    const timetable = new RdgTimetableProvider(async () => importCif(cif(),stations,now));
    const [s] = await timetable.getDepartures("LTV","EUS",now,180);
    const get = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{...s,serviceId:s.serviceId.replace("rdg:","gb-nr:"),cancelled:true}]).mockRejectedValue(new Error("upstream"));
    const live = {getDepartures:get,getServiceDetails:vi.fn(),getDisruptions:vi.fn()} as RailProvider;
    const provider = new TimetableFallbackProvider(live,timetable);
    expect(await provider.getDepartures("LTV","EUS",now,180)).toEqual([]);
    await provider.getDepartures("LTV","EUS",now,180);
    expect(await provider.getDepartures("LTV","EUS",now,180)).toEqual([]);
    const fresh = new TimetableFallbackProvider({...live,getDepartures:vi.fn().mockRejectedValue(new Error("quota"))},timetable);
    expect((await fresh.getDepartures("LTV","EUS",now,180))[0].dataSource).toBe("timetable");
  });
});
