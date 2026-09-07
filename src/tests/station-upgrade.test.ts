import { expect, it } from "vitest";
import { addParkwayAndTamworth, defaultSettings } from "../config/stations";
it("adds EMD and the Burton-Tamworth connection without losing saved settings or duplicating routes", () => {
  const old = structuredClone(defaultSettings);
  old.home = { lat: 52.8, lng: -1.6 };
  old.stations = old.stations.filter(s => s.crs !== "EMD");
  const burton = old.stations.find(s => s.crs === "BUT")!;
  burton.parkingMinutes = 9;
  burton.railStrategies = burton.railStrategies.filter(s => s.type !== "one_change" || s.interchangeCrs !== "TAM");
  const upgraded = addParkwayAndTamworth(old);
  expect(upgraded.stations[0].crs).toBe("EMD");
  expect(upgraded.home).toEqual(old.home);
  expect(upgraded.stations.find(s => s.crs === "BUT")?.parkingMinutes).toBe(9);
  expect(upgraded.stations.find(s => s.crs === "BUT")?.railStrategies).toHaveLength(2);
  expect(addParkwayAndTamworth(upgraded)).toEqual(upgraded);
  expect(old.stations.some(s => s.crs === "EMD")).toBe(false);
});
