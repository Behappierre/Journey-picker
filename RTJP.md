# National Rail RTJP

Server-side SOAP 1.1 provider using HTTP Basic authentication. Set these Netlify Production variables with Functions scope:

- `RTJP_ENDPOINT`: optional HTTPS SOAP service endpoint. If omitted, discover it from the official authenticated https://ojp.nationalrail.co.uk/webservices/jpdlr.wsdl. Never enter the WSDL URL as the endpoint.
- `RTJP_USERNAME`: issued webservice username.
- `RTJP_PASSWORD`: issued webservice password, marked secret.
- `RAIL_PROVIDER=rtjp`: activate only after credentials and endpoint are verified; redeploy after changes.

The support case reference is not an authentication credential. Never commit credentials or paste them into browser code. The configured endpoint must be on a National Rail HTTPS host. An alternative supplier hostname needs explicit verification before adding it.

One RealTimeJourneyPlan request is made for each distinct direct segment. Existing configured interchange routes are assembled by the planner (including BUT-TAM and TAM-EUS). Concurrent calls are deduplicated; cached results last up to 60 seconds within a warm instance. No automatic retries or supplementary calling-points requests are made. This is not a guaranteed account-wide spending cap: cold starts and multiple visitors can increase usage. The current page only refreshes its displayed clock automatically, not the rail request.

RTJP returns selected journeys, not necessarily every train in the requested horizon. Multi-leg and non-train results are excluded from direct segments. NORMAL classifications without explicit forecasts remain uncertain; only ONTIME permits using scheduled times as estimates. Platforms are withheld until suppression semantics in the account WSDL are confirmed. Separate station disruption feeds are not queried. Expired RDG data is never revived.

Validate the account WSDL and make a minimal live EMD-STP test before activation. Follow the signed licence, confirm the application is covered, and apply required National Rail branding before public release. This adapter does not provide a ticket retailing feature.
