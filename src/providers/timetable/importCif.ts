import { DateTime } from "luxon";

export interface TimetableRow {
  uid: string; originCrs: string; destinationCrs: string;
  departure: string; arrival: string; operator?: string;
}
export interface TimetableData {
  version: 1; source: "RDG"; importedAt: string; validFrom: string; validUntil: string;
  warnings: string[]; services: TimetableRow[];
}
type Stop = { crs?: string; arrival?: number; departure?: number };
type Schedule = { uid: string; from: string; to: string; days: string; stp: string; eligible: boolean; operator?: string; stops: Stop[] };
const isoDate = (s: string) => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
const minutes = (s: string) => /^\d{4}$/.test(s) && s !== "0000" && +s.slice(0, 2) < 24 && +s.slice(2) < 60 ? +s.slice(0, 2) * 60 + +s.slice(2) : undefined;

/** Full RDG MCA + matching MSN, RSPS5046 P-04-02. No incremental CIF support. */
export function importCif(cif: string, msn: string, now = new Date()): TimetableData {
  const locations = new Map<string, string>();
  for (const line of msn.split(/\r?\n/)) {
    const crs = line.slice(49, 52).trim();
    if (line.startsWith("A") && /^[A-Z]{3}$/.test(crs)) locations.set(line.slice(36, 43).trim(), crs);
  }
  if (!locations.size) throw new Error("Matching RDG MSN station file is required");
  const lines = cif.split(/\r?\n/);
  const header = lines.find(l => l.startsWith("HD"));
  if (!header || header[46] !== "F" || !lines.some(l => l.startsWith("ZZ"))) throw new Error("A complete full MCA extract is required; updates are not supported");
  const schedules: Schedule[] = [];
  let current: Schedule | undefined;
  let last = -1;
  let days = 0;
  const clock = (raw: string) => {
    const value = minutes(raw);
    if (value === undefined) return undefined;
    if (last >= 0 && value < last) days++;
    last = value;
    return days * 1440 + value;
  };
  for (const line of lines) {
    if (line.startsWith("BS")) {
      if (line[2] !== "N") throw new Error("Incremental/revised transactions require a fresh full extract");
      current = { uid: line.slice(3, 9).trim(), from: isoDate(line.slice(9, 15)), to: isoDate(line.slice(15, 21)), days: line.slice(21, 28), stp: line[79], eligible: line[29] === "P" && !line[28].trim(), stops: [] };
      if (!/^[01]{7}$/.test(current.days) || !"PCON".includes(current.stp)) throw new Error("Invalid schedule calendar");
      schedules.push(current); last = -1; days = 0;
    } else if (current && line.startsWith("BX")) current.operator = line.slice(11, 13).trim();
    else if (current && ["LO", "LI", "LT"].includes(line.slice(0, 2))) {
      const type = line.slice(0, 2);
      const arrival = type === "LO" ? undefined : clock(type === "LI" ? line.slice(25, 29) : line.slice(15, 19));
      const departure = type === "LT" ? undefined : clock(type === "LI" ? line.slice(29, 33) : line.slice(15, 19));
      current.stops.push({ crs: locations.get(line.slice(2, 9).trim()), arrival, departure });
    }
  }
  const start = DateTime.fromJSDate(now, { zone: "Europe/London" }).startOf("day");
  const end = start.plus({ days: 7 });
  const services: TimetableRow[] = [];
  const wanted = new Set(["LTV", "TAM", "DBY", "BUT", "EUS", "STP"]);
  for (let day = start.minus({ days: 1 }); day < end; day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    const groups = new Map<string, Schedule[]>();
    for (const s of schedules) if (date >= s.from && date <= s.to && s.days[day.weekday - 1] === "1") groups.set(s.uid, [...(groups.get(s.uid) ?? []), s]);
    for (const group of groups.values()) {
      if (group.some(s => s.stp === "C")) continue;
      const overlays = group.filter(s => s.stp !== "P");
      const choices = overlays.length ? overlays : group;
      if (choices.length !== 1 || !choices[0].eligible) continue;
      const s = choices[0];
      const dated = (value: number) => {
        const local = day.plus({ days: Math.floor(value / 1440) }).toISODate() + `T${String(Math.floor(value % 1440 / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;
        const t = DateTime.fromISO(local, { zone: "Europe/London" });
        return t.isValid && t.getPossibleOffsets().length === 1 && t.toFormat("yyyy-MM-dd'T'HH:mm:ss") === local ? t.toUTC().toISO()! : undefined;
      };
      for (let i = 0; i < s.stops.length; i++) {
        const a = s.stops[i];
        if (!a.crs || !wanted.has(a.crs) || a.departure === undefined) continue;
        const departure = dated(a.departure);
        if (!departure || Date.parse(departure) < +start || Date.parse(departure) >= +end) continue;
        for (const b of s.stops.slice(i + 1)) {
          if (!b.crs || !wanted.has(b.crs) || b.arrival === undefined) continue;
          const arrival = dated(b.arrival);
          if (arrival && arrival > departure) services.push({ uid: `${s.uid}:${date}`, originCrs: a.crs, destinationCrs: b.crs, departure, arrival, operator: s.operator });
        }
      }
    }
  }
  return { version: 1, source: "RDG", importedAt: now.toISOString(), validFrom: start.toUTC().toISO()!, validUntil: end.toUTC().toISO()!, services, warnings: ["Scheduled times only. Live cancellations, delays and platforms unavailable.", "Coverage: LTV, TAM, DBY, BUT, EUS and STP. Bank-holiday conditional schedules, ambiguous midnight calls and joining/splitting extensions are omitted."] };
}
