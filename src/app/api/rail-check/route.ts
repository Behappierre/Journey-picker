export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { Authorization: `Bearer ${process.env.RTT_REFRESH_TOKEN}`, Version: "2026-07-25" };
  const auth = await fetch("https://data.rtt.io/api/get_access_token", { headers, cache: "no-store" });
  if (!auth.ok) return Response.json({ stage: "authentication", status: auth.status });
  const { token } = await auth.json();
  headers.Authorization = `Bearer ${token}`;
  const provider = createRailProvider();
  const checks = await Promise.all(["LTV", "TAM", "BUT"].map(async (crs) => {
    const destination = crs === "BUT" ? "DBY" : "EUS";
    const boardResponse = await fetch(`https://data.rtt.io/gb-nr/location?code=${crs}&filterTo=${destination}&detailed=false`, { headers, cache: "no-store" });
    const boardData = boardResponse.status === 200 ? await boardResponse.json() : null;
    const results = await Promise.allSettled([provider.getDepartures(crs, destination, new Date(), 180), provider.getDisruptions(crs, new Date(), 180)]);
    return { crs, status: boardResponse.status, limits: Object.fromEntries([...boardResponse.headers].filter(([key]) => key.startsWith("x-ratelimit") || key === "retry-after")), board: boardData, results: results.map(r => r.status === "fulfilled" ? { status: r.status, count: r.value.length } : { status: r.status, error: r.reason instanceof Error ? r.reason.message : "Unknown" }) };
  }));
  const response = await fetch("https://data.rtt.io/gb-nr/location?code=DBY&filterTo=STP&detailed=false", { headers, cache: "no-store" });
  if (!response.ok || response.status === 204) return Response.json({ stage: "board", status: response.status });
  const board = await response.json();
  const identity = board.services?.[0]?.scheduleMetadata?.uniqueIdentity;
  const detail = identity ? await fetch(`https://data.rtt.io/gb-nr/service?uniqueIdentity=${encodeURIComponent(identity.replace(/^gb-nr:/, ""))}&detailed=false`, { headers, cache: "no-store" }) : undefined;
  return Response.json({ checks, status: response.status, board, detailStatus: detail?.status, detail: detail?.ok ? await detail.json() : null }, { headers: { "Cache-Control": "no-store" } });
}
import { createRailProvider } from "../../../providers/rail/createRailProvider";
