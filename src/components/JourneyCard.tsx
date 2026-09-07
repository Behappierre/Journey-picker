import type { ClientJourney } from "../domain/models";
import { terminalNames } from "../config/stations";
export const clockTime = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(date));
export function JourneyCard({
  journey: j,
  now,
  primary = false,
}: {
  journey: ClientJourney;
  now: number;
  primary?: boolean;
}) {
  const remaining = Math.floor((Date.parse(j.leaveHomeAt) - now) / 60000);
  const stale = [j.road.calculatedAt, j.railUpdatedAt].some(
    (t) => now - Date.parse(t) > 120000,
  );
  const terminal =
    terminalNames[j.services.at(-1)!.destinationCrs] ??
    j.services.at(-1)!.destinationCrs;
  const route = `https://www.google.com/maps/dir/?api=1&destination=${j.station.location.lat},${j.station.location.lng}&travelmode=driving`;
  return (
    <article className={`journey-card ${primary ? "primary" : "alternative"}`}>
      <div className="card-top">
        <span className="eyebrow">
          {primary ? "YOUR BEST WAY TO LONDON" : j.station.name}
        </span>
        <span
          className={`confidence ${stale || remaining < 0 ? "low" : j.confidence}`}
        >
          {stale
            ? "STALE DATA"
            : remaining < 0
              ? "REFRESH NEEDED"
              : `${j.confidence} confidence`}
        </span>
      </div>
      {primary ? (
        <>
          <div className="leave-label">
            {remaining < 0 ? "DEPARTURE TIME PASSED" : "LEAVE HOME IN"}
          </div>
          <div className="countdown">
            {remaining < 0 ? (
              "Refresh"
            ) : remaining === 0 ? (
              "Now"
            ) : (
              <>
                {remaining}
                <span> min</span>
              </>
            )}
          </div>
          <div className="leave-at">
            at <strong>{clockTime(j.leaveHomeAt)}</strong>{" "}
            <span>· {dateLabel(j.leaveHomeAt)}</span>
          </div>
          <div className="station-title">
            Drive to {j.station.name}
            <span>→</span>
          </div>
        </>
      ) : (
        <div className="alternative-summary">
          <div>
            <small>LEAVE HOME</small>
            <strong>{clockTime(j.leaveHomeAt)}</strong>
          </div>
          <span className="arrow">→</span>
          <div>
            <small>ARRIVE LONDON</small>
            <strong>{clockTime(j.londonArrival)}</strong>
          </div>
        </div>
      )}
      <div className="journey-steps">
        <div>
          <span className="step-icon">↗</span>
          <strong>{Math.ceil(j.drivingMinutes)} min</strong>
          <small>
            {j.road.status === "live" ? "predicted drive" : "estimated drive"}
          </small>
        </div>
        <div>
          <span className="step-icon">P</span>
          <strong>{j.stationOverheadMinutes} min</strong>
          <small>park + platform</small>
        </div>
        <div>
          <span className="step-icon">⇥</span>
          <strong>{clockTime(j.scheduledTrainDeparture)}</strong>
          <small>
            {j.services[0].departureUncertain
              ? "forecast unavailable"
              : j.services[0].delayed
              ? j.services[0].estimatedDeparture
                ? `expected ${clockTime(j.trainDeparture)}`
                : "delayed · time unknown"
              : "train · on time"}
          </small>
        </div>
      </div>
      {primary && (
        <div className="arrival">
          <span>
            <small>ARRIVE AT</small>
            <strong>{terminal}</strong>
          </span>
          <b>{clockTime(j.londonArrival)}</b>
        </div>
      )}
      <p className="route-caption">
        {j.changes
          ? `Change at ${j.services[0].destinationCrs}`
          : "Direct train"}{" "}
        · {j.services[0].operator ?? "National Rail"}
        {j.services[0].platform ? ` · Platform ${j.services[0].platform}` : ""}
        {!primary ? ` · ${terminal}` : ""}
      </p>
      {primary && <p className="why">{j.explanation}</p>}
      <details>
        <summary>Journey details & confidence</summary>
        <div className="detail-body">
          <p>{j.confidenceReasons.join(". ")}.</p>
          <p>
            {Math.floor(j.catchMarginMinutes)} min at the platform before the
            conservative train departure, including 3 min road contingency.
          </p>
          {j.services.map((s, i) => (
            <p key={`${s.serviceId}:${i}`}>
              <strong>
                {s.originCrs} → {s.destinationCrs}
              </strong>
              <br />
              Departs {clockTime(
                s.estimatedDeparture ?? s.scheduledDeparture,
              )}{" "}
              · arrives {clockTime(s.estimatedArrival ?? s.scheduledArrival!)}
              {s.arrivalUncertain ? " (scheduled; forecast uncertain)" : ""}
            </p>
          ))}
          {j.disruptionMessages.map((m, i) => (
            <p key={i} className="notice">
              {m}
            </p>
          ))}
          <p>
            Road updated {clockTime(j.road.calculatedAt)} · rail updated{" "}
            {clockTime(j.railUpdatedAt)}
          </p>
        </div>
      </details>
      <a
        className={primary ? "route-button" : "text-link"}
        href={route}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open driving route <span>↗</span>
      </a>
    </article>
  );
}
