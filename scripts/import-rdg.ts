import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { importCif } from "../src/providers/timetable/importCif.ts";
const [mca, msn, output, published] = process.argv.slice(2);
if (!mca || !msn || !output || !/^\d{4}-\d{2}-\d{2}$/.test(published ?? "")) throw new Error("Usage: npm run timetable:import -- full.MCA matching.MSN output.json YYYY-MM-DD (publication date from DAT)");
const stations = await readFile(msn, "utf8");
const wanted = new Set(["EMD", "LTV", "TAM", "DBY", "BUT", "EUS", "STP"]);
const tiplocs = new Set(stations.split(/\r?\n/).filter(l => l.startsWith("A") && wanted.has(l.slice(49,52).trim())).map(l => l.slice(36,43).trim()));
const retained: string[] = [];
let block: string[] = [], relevant = false;
const flush = () => { if (block.length) retained.push(...(relevant ? block : [block[0]])); block = []; relevant = false; };
for await (const line of createInterface({ input: createReadStream(mca), crlfDelay: Infinity })) {
  const type = line.slice(0,2);
  if (type === "BS") { flush(); block = [line]; }
  else if (["BX","LO","LI","LT","CR"].includes(type) && block.length) {
    block.push(line);
    if (["LO","LI","LT"].includes(type) && tiplocs.has(line.slice(2,9).trim())) relevant = true;
  } else { flush(); if (["HD","ZZ"].includes(type)) retained.push(line); }
}
flush();
const data = importCif(retained.join("\n"), stations);
data.importedAt = `${published}T00:00:00.000Z`;
data.validUntil = new Date(Math.min(Date.parse(data.validUntil), Date.parse(data.importedAt) + 8 * 86400000)).toISOString();
if (Date.parse(data.validUntil) <= Date.now()) throw new Error("Published timetable is too old; download a current extract");
if (!data.services.length) throw new Error("No relevant services found; output was not changed");
await writeFile(output, JSON.stringify(data));
console.log(`Imported ${data.services.length} scheduled station pairs, valid until ${data.validUntil}. ${data.warnings.join(" ")}`);

