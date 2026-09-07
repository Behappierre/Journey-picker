import { DateTime } from "luxon";
export const minutesBetween = (a: Date, b: Date) =>
  (a.getTime() - b.getTime()) / 60000;
export const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60000);
// Resolve rail clock times against a full dated anchor. Enumerate both fall-back offsets;
// reject nonexistent spring-forward times instead of silently shifting the train.
export function railTime(
  value: string | undefined,
  anchor: Date,
  kind: "nearest" | "after" = "nearest",
): Date | undefined {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) return undefined;
  const base = DateTime.fromJSDate(anchor, { zone: "Europe/London" });
  const candidates: Date[] = [];
  for (const day of [-1, 0, 1, 2]) {
    const d = base
      .plus({ days: day })
      .set({ hour, minute, second: 0, millisecond: 0 });
    if (d.hour !== hour || d.minute !== minute) continue;
    for (const possible of d.getPossibleOffsets())
      candidates.push(possible.toJSDate());
  }
  const viable = candidates.filter((d) => kind !== "after" || d >= anchor);
  viable.sort((a, b) =>
    kind === "after"
      ? +a - +b
      : Math.abs(+a - +anchor) - Math.abs(+b - +anchor),
  );
  return viable[0];
}
