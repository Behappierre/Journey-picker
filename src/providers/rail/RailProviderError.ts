/** Only allowlisted, credential-free messages may be shown to passengers. */
export class RailProviderError extends Error {
  constructor(readonly code: "rate_limit" | "credentials", provider: "Realtime Trains" | "National Rail RTJP" = "Realtime Trains") {
    super(code === "rate_limit"
      ? `${provider} is limiting requests. Wait before refreshing; this comparison is incomplete.`
      : `${provider} rejected the configured credential. Check the server token configuration.`);
  }
}
