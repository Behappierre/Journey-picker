/** Public deployment URLs are trusted configuration, not forwarded client headers. */
export function isAllowedRequestOrigin(
  request: Request,
  publicUrls: Array<string | undefined> = [],
): boolean {
  const origin = request.headers.get("origin");
  // Non-browser clients are protected by the optional access token, not CORS.
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    const allowed = [new URL(request.url).origin];
    for (const value of publicUrls) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol === "https:" && !url.username && !url.password)
          allowed.push(url.origin);
      } catch { /* Invalid optional configuration cannot grant access. */ }
    }
    return allowed.includes(origin);
  } catch {
    return false;
  }
}
