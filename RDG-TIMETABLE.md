# RDG timetable fallback

Registration and the timetable subscription are required at the National Rail Data Portal. Download using an authenticated request, not a plain browser link. Do not store credentials or the source ZIP in this repository.

Extract the full MCA, matching MSN and DAT files. Read the publication date from DAT (the MCA header dates are legacy constants). Run:

```powershell
npm run timetable:import -- full.MCA matching.MSN output.json YYYY-MM-DD
npx netlify-cli blobs:set rdg-timetable current --input output.json
```

Link Netlify CLI to the production site before uploading. Enable `RDG_TIMETABLE_ENABLED=true` in Functions environment and redeploy once. Subsequent uploads persist across deployments; warm workers refresh their snapshot within one hour. `/api/timetable-status` reports availability without using RTT.

The importer handles full snapshots only; never apply an incremental CFA as a replacement. Reimport a new download at least weekly. Imported results expire after at most eight days from the source publication date and cover at most seven days from import. Expired data is not used.

Coverage is limited to LTV, TAM, DBY, BUT, EUS and STP. Source calendars, public times, STP overlays and cancellations are applied before route filtering. Bank-holiday conditional schedules and ambiguous midnight/DST times are omitted conservatively. Joining/splitting associations, bus/ferry links and additional stations are not supported. This is a limited fallback, not a complete national journey planner.

Live successful responses (including empty and cancelled boards) are authoritative. Failed requests can use scheduled data, with no live forecasts or platform claims. Observed cancellations are retained within the warm provider instance; cold starts cannot retain live observations. Scheduled connections require extra margin and remain low confidence. Google road estimates remain independent. Data is stored privately in Netlify Blobs; passengers receive only computed journey results. Follow the National Rail licence and attribution requirements.

The current import is manually refreshed. It does not periodically log into RDG or download updates automatically.
