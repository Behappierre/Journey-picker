export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { Authorization: `Bearer ${process.env.RTT_REFRESH_TOKEN}`, Version: "2026-07-25" };
  const auth = await fetch("https://data.rtt.io/api/get_access_token", { headers, cache: "no-store" });
  if (!auth.ok) return Response.json({ stage: "authentication", status: auth.status });
  const { token } = await auth.json();
  headers.Authorization = `Bearer ${token}`;
  const response = await fetch("https://data.rtt.io/gb-nr/location?code=DBY&filterTo=STP&detailed=false", { headers, cache: "no-store" });
  if (!response.ok || response.status === 204) return Response.json({ stage: "board", status: response.status });
  const board = await response.json();
  const identity = board.services?.[0]?.scheduleMetadata?.uniqueIdentity;
  const detail = identity ? await fetch(`https://data.rtt.io/gb-nr/service?uniqueIdentity=${encodeURIComponent(identity.replace(/^gb-nr:/, ""))}&detailed=false`, { headers, cache: "no-store" }) : undefined;
  return Response.json({ status: response.status, board, detailStatus: detail?.status, detail: detail?.ok ? await detail.json() : null }, { headers: { "Cache-Control": "no-store" } });
}
