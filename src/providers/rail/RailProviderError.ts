/** Only allowlisted, credential-free messages may be shown to passengers. */
export class RailProviderError extends Error {
  constructor(readonly code: "rate_limit" | "credentials") {
    super(code === "rate_limit"
      ? "Realtime Trains is limiting requests. Wait before refreshing; this comparison is incomplete."
      : "Realtime Trains rejected the configured credential. Check the server token configuration.");
  }
}
