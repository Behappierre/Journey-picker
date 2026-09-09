import "server-only";
import { timingSafeEqual } from "node:crypto";
import { isAllowedRequestOrigin } from "../../../services/requestOrigin";
import { lookupPostcode, postcodeSchema, PostcodeError } from "../../../services/postcode";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{"Cache-Control":"no-store, private"}});
export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request, [
    process.env.APP_ORIGIN,
    process.env.URL,
    process.env.DEPLOY_URL,
    process.env.DEPLOY_PRIME_URL,
  ]))
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
    if (Number(request.headers.get("content-length")) > 256) return json({error:"Request too large."},413);
    const raw = await request.text();
    if (raw.length > 256) return json({error:"Request too large."},413);
    const parsed = postcodeSchema.safeParse(JSON.parse(raw)?.postcode);
    if (!parsed.success) return json({error:"Enter a full UK postcode."},400);
    return json(await lookupPostcode(parsed.data, process.env.GOOGLE_MAPS_API_KEY ?? ""));
  } catch(error) {
    if (error instanceof SyntaxError) return json({error:"Invalid JSON request."},400);
    if (error instanceof PostcodeError) return json({error:error.message},error.status);
    return json({error:"Postcode lookup is temporarily unavailable. Please try again."},503);
  }
}
