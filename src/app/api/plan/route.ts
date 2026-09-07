import "server-only";
import { timingSafeEqual } from "node:crypto";
import { planSchema } from "../../../domain/validation";
import { JourneyPlanner } from "../../../services/JourneyPlanner";
import { GoogleRoutesProvider } from "../../../providers/road/GoogleRoutesProvider";
import { createRailProvider } from "../../../providers/rail/createRailProvider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Request origin is not permitted." }, 403);
  const token = process.env.JOURNEY_ACCESS_TOKEN;
  if (token) {
    const supplied = Buffer.from(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
    );
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return json(
        { error: "Enter your deployment access code in Settings." },
        401,
      );
  }
  try {
    if (Number(request.headers.get("content-length")) > 50000)
      return json({ error: "Request too large." }, 413);
    const raw = await request.text();
    if (raw.length > 50000) return json({ error: "Request too large." }, 413);
    const parsed = planSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return json(
        { error: "Check your coordinates, station settings and arrival time." },
        400,
      );
    const planner = new JourneyPlanner(
      new GoogleRoutesProvider(process.env.GOOGLE_MAPS_API_KEY ?? ""),
      createRailProvider(),
    );
    return json(await planner.plan(parsed.data));
  } catch (error) {
    if (error instanceof SyntaxError)
      return json({ error: "Invalid JSON request." }, 400);
    // Never return upstream response bodies, credentials, or home coordinates.
    return json(
      {
        error: "Journey planning is temporarily unavailable. Please try again.",
      },
      503,
    );
  }
}
