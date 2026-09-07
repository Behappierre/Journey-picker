import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin } from "../services/requestOrigin";
const publicUrl = "https://journey-picker.netlify.app";
const request = (origin?: string, extra: Record<string,string> = {}) => new Request("http://localhost:3000/api/plan", {
  method: "POST", headers: { ...(origin ? { origin } : {}), ...extra },
});
describe("planning request origin behind Netlify", () => {
  it("accepts the configured public origin despite an internal request URL", () => {
    expect(isAllowedRequestOrigin(request(publicUrl), [publicUrl])).toBe(true);
  });
  it("rejects unrelated origins even with forged forwarded headers", () => {
    expect(isAllowedRequestOrigin(request("https://evil.example", { "x-forwarded-host": "evil.example" }), [publicUrl])).toBe(false);
  });
  it("accepts a configured preview URL without allowing arbitrary netlify sites", () => {
    const preview = "https://deploy--journey-picker.netlify.app";
    expect(isAllowedRequestOrigin(request(preview), [publicUrl,preview])).toBe(true);
    expect(isAllowedRequestOrigin(request("https://other.netlify.app"), [publicUrl,preview])).toBe(false);
  });
  it("preserves same-origin local development and non-browser clients", () => {
    expect(isAllowedRequestOrigin(request("http://localhost:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(request())).toBe(true);
  });
  it("rejects opaque and malformed origins", () => {
    for (const value of ["null", "not-a-url", `${publicUrl}/path`, `${publicUrl}.evil.example`])
      expect(isAllowedRequestOrigin(request(value), [publicUrl])).toBe(false);
  });
});
