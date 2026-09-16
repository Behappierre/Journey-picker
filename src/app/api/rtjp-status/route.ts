import "server-only";
import { timingSafeEqual } from "node:crypto";
import { isAllowedRequestOrigin } from "../../../services/requestOrigin";
import { RtjpRailProvider } from "../../../providers/rail/RtjpRailProvider";
import { RailProviderError } from "../../../providers/rail/RailProviderError";
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
  if (!process.env.RTJP_USERNAME || !process.env.RTJP_PASSWORD) return json({configured:false,error:"RTJP_USERNAME and RTJP_PASSWORD are required."},503);
  try {
    const provider = new RtjpRailProvider(process.env.RTJP_ENDPOINT ?? "",process.env.RTJP_USERNAME,process.env.RTJP_PASSWORD);
    const endpoint = new URL(await provider.discoverEndpoint());
    return json({configured:true,endpointHost:endpoint.hostname,endpointPath:endpoint.pathname,active:process.env.RAIL_PROVIDER === "rtjp"});
  } catch(error) {
    return json({configured:false,error:error instanceof RailProviderError ? error.message : "RTJP endpoint discovery failed. Check the supplied WSDL details."},503);
  }
}
