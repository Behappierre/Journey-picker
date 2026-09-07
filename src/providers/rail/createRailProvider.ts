import type { RailProvider } from "../../domain/models";
import { NationalRailDarwinProvider } from "./NationalRailDarwinProvider";
import { HuxleyRailProvider } from "./HuxleyRailProvider";
import { RealtimeTrainsProvider } from "./RealtimeTrainsProvider";
let cached: { key: string; provider: RailProvider } | undefined;
/** Server-only configuration is read here by the API route, never by React. */
export function createRailProvider(
  env: Record<string, string | undefined> = process.env,
): RailProvider {
  const kind = env.RAIL_PROVIDER || "darwin";
  const key = JSON.stringify([
    kind,
    env.HUXLEY_BASE_URL,
    env.HUXLEY_ACCESS_TOKEN,
    env.RTT_ACCESS_TOKEN,
    env.RTT_REFRESH_TOKEN,
    env.NATIONAL_RAIL_USERNAME,
    env.NATIONAL_RAIL_PASSWORD,
  ]);
  if (cached?.key === key) return cached.provider;
  let provider: RailProvider;
  switch (kind) {
    case "huxley":
      provider = new HuxleyRailProvider({
        baseUrl: env.HUXLEY_BASE_URL || "https://huxley2.azurewebsites.net",
        accessToken: env.HUXLEY_ACCESS_TOKEN,
      });
      break;
    case "rtt":
      provider = new RealtimeTrainsProvider({
        accessToken: env.RTT_ACCESS_TOKEN,
        refreshToken: env.RTT_REFRESH_TOKEN,
      });
      break;
    case "darwin":
      provider = new NationalRailDarwinProvider(
        env.NATIONAL_RAIL_USERNAME || "",
        env.NATIONAL_RAIL_PASSWORD || "",
      );
      break;
    default:
      throw new Error("Unsupported RAIL_PROVIDER");
  }
  cached = { key, provider };
  return provider;
}
