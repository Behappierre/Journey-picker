import { getStore } from "@netlify/blobs";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.RDG_TIMETABLE_ENABLED !== "true") return Response.json({ enabled: false }, { headers });
  try {
    const data = await getStore("rdg-timetable").get("current", { type: "json" });
    return Response.json({ enabled: true, available: !!data && Date.parse(data.validUntil) > Date.now(), publishedAt: data?.importedAt, validUntil: data?.validUntil, stationPairs: data?.services?.length ?? 0 }, { headers });
  } catch { return Response.json({ enabled: true, available: false }, { headers, status: 503 }); }
}
