"use client";
import { useState } from "react";
import type { CandidateStation, Settings } from "../domain/models";
import { StationLookup } from "./StationLookup";
import { defaultStations } from "../config/stations";
import { settingsSchema } from "../domain/validation";
export function SettingsPanel({
  initial,
  accessToken,
  onSave,
  onClose,
}: {
  initial: Settings;
  accessToken: string;
  onSave: (settings: Settings, token: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(initial));
  const [token, setToken] = useState(accessToken);
  const [postcode, setPostcode] = useState(initial.homePostcode ?? "");
  const [lookingUp, setLookingUp] = useState(false);
  const [message, setMessage] = useState("");
  const updateStation = (id: string, value: Partial<CandidateStation>) =>
    setDraft((d) => ({
      ...d,
      stations: d.stations.map((s) => (s.id === id ? { ...s, ...value } : s)),
    }));
  async function findPostcode() {
    setLookingUp(true);
    setMessage("Looking up your postcode...");
    try {
      const response = await fetch("/api/postcode", {
        method: "POST",
        headers: {"Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {})},
        body: JSON.stringify({postcode}),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Postcode lookup failed.");
      setDraft(d => ({...d, home:data.location, homePostcode:data.postcode}));
      setPostcode(data.postcode);
      setMessage(`Found ${data.postcode}. Save to use this approximate starting point.`);
    } catch(error) {
      setMessage(error instanceof Error && error.name === "Error" ? error.message : "Postcode lookup is unavailable. Please try again.");
    } finally { setLookingUp(false); }
  }
  function locate() {
    setPostcode("");
    setMessage("Finding your location…");
    if (!navigator.geolocation)
      return setMessage("Location is not supported. Enter coordinates below.");
    setLookingUp(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLookingUp(false);
        setDraft((d) => ({
          ...d,
          homePostcode: undefined,
          home: { lat: p.coords.latitude, lng: p.coords.longitude },
        }));
        setMessage("Location found. Save to use it as home.");
      },
      () => {
        setLookingUp(false);
        setMessage(
          "Location unavailable. Allow location access or enter coordinates below.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  return (
    <section className="settings">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MAKE IT YOUR JOURNEY</p>
          <h1>Settings</h1>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (lookingUp) return;
          if (postcode.trim() && postcode.replace(/\s/g, "").toUpperCase() !== (draft.homePostcode ?? "").replace(/\s/g, "").toUpperCase())
            return setMessage("Look up your postcode before saving.");
          const result = settingsSchema.safeParse(draft);
          if (!result.success) {
            setMessage(
              result.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(". "),
            );
            return;
          }
          if (!draft.home)
            return setMessage("Look up your postcode or use your current location first.");
          onSave(result.data, token);
        }}
      >
        <fieldset>
          <legend>Your starting point</legend>
          <p>
            Your starting point is saved on this device. Postcodes are sent to Google
            Maps for lookup; coordinates are sent to Google when planning a journey.
          </p>
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
          <label>
            Home postcode
            <input type="text" autoComplete="postal-code" placeholder="e.g. SW1A 1AA"
              maxLength={16} value={postcode} disabled={lookingUp}
              onChange={e => setPostcode(e.target.value)} />
          </label>
          <button type="button" className="secondary-button" disabled={lookingUp || !postcode.trim()} onClick={findPostcode}>
            {lookingUp ? "Looking up..." : "Find postcode"}
          </button>
          <p>Google Maps - Postcodes give an approximate location. Use your current location for a more precise starting point.</p>
          <button type="button" className="secondary-button" disabled={lookingUp} onClick={locate}>
            ⌖ Use current location as home
          </button>
          <details><summary>Enter coordinates manually (optional)</summary>
          <div className="field-grid">
            <label>
              Latitude
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                value={draft.home?.lat ?? ""}
                disabled={lookingUp}
                onChange={(e) => {
                  setPostcode("");
                  setDraft({
                    ...draft,
                    homePostcode: undefined,
                    home: {
                      lat: Number(e.target.value),
                      lng: draft.home?.lng ?? 0,
                    },
                  });
                }}
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                value={draft.home?.lng ?? ""}
                disabled={lookingUp}
                onChange={(e) => {
                  setPostcode("");
                  setDraft({
                    ...draft,
                    homePostcode: undefined,
                    home: {
                      lat: draft.home?.lat ?? 0,
                      lng: Number(e.target.value),
                    },
                  });
                }}
              />
            </label>
          </div>
          </details>
        </fieldset>
        <fieldset>
          <legend>Travel preferences</legend>
          <label>
            What matters most?
            <select
              value={draft.objective}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  objective: e.target.value as Settings["objective"],
                })
              }
            >
              <option value="balanced">Balanced</option>
              <option value="fastest">Fastest arrival</option>
              <option value="least_driving">Least driving</option>
            </select>
          </label>
          <div className="field-grid">
            {(
              [
                [
                  "lateTrainRecoveryBufferMinutes",
                  "Delay recovery buffer",
                  0,
                  60,
                ],
                ["minimumConnectionMinutes", "Minimum connection", 1, 60],
                ["planningHorizonMinutes", "Look ahead (minutes)", 30, 180],
                ["alternativesCount", "Alternatives to show", 1, 5],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  required
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <p>
            Live planning covers up to three hours of departures. Balanced
            favours less driving within 10 minutes of the fastest arrival. Least
            driving allows up to 30 minutes.
          </p>
        </fieldset>
        <fieldset>
          <legend>Candidate stations</legend>
          <p>
            Starting suggestions near Burton-on-Trent. Adjust the car park
            location and allowances to match your experience. Fallback drive
            times are estimates, not live traffic.
          </p>
          {draft.stations.map((s) => (
            <div className="station-setting" key={s.id}>
              <div className="section-heading">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) =>
                      updateStation(s.id, { enabled: e.target.checked })
                    }
                  />
                  {s.name}
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      stations: draft.stations.filter((x) => x.id !== s.id),
                    })
                  }
                  aria-label={`Remove ${s.name}`}
                >
                  Remove
                </button>
              </div>
              <details open={!s.crs || undefined}>
                <summary>Edit station, buffers & route</summary>
                <StationLookup name={s.name} token={token} onSelect={result => {
                  const nearby = (location: {lat:number;lng:number}) =>
                    Math.abs(location.lat-result.location.lat)<0.005 && Math.abs(location.lng-result.location.lng)<0.008;
                  const normaliseName = (name:string) => name.toLowerCase().replace(/\b(railway|rail|train|station)\b/g, "").replace(/[^a-z0-9]/g, "");
                  const matches = (name:string) => normaliseName(name) === normaliseName(result.name);
                  const known = defaultStations.find(station=>matches(station.name) && nearby(station.location));
                  const sameStation = matches(s.name) && nearby(s.location) && !!s.crs;
                  updateStation(s.id, {
                    name:known?.name ?? result.name, location:result.location,
                    crs:known?.crs ?? (sameStation ? s.crs : ""),
                    railStrategies: sameStation ? s.railStrategies : known ? structuredClone(known.railStrategies) : [{type:"direct",destinationCrs:""}],
                    enabled: sameStation ? s.enabled : false,
                  });
                }}/>
                <p>For a new station, check the CRS code and route below, then tick the station to include it.</p>
                <div className="field-grid">
                  <label>
                    Name
                    <input
                      required
                      value={s.name}
                      onChange={(e) =>
                        updateStation(s.id, { name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Station CRS
                    <input
                      required
                      pattern="[A-Z]{3}"
                      maxLength={3}
                      value={s.crs}
                      onChange={(e) =>
                        updateStation(s.id, {
                          crs: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                  <label>
                    Car park latitude
                    <input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      required
                      value={s.location.lat}
                      onChange={(e) =>
                        updateStation(s.id, {
                          location: {
                            ...s.location,
                            lat: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Car park longitude
                    <input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      required
                      value={s.location.lng}
                      onChange={(e) =>
                        updateStation(s.id, {
                          location: {
                            ...s.location,
                            lng: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  {(
                    [
                      ["parkingMinutes", "Parking (min)"],
                      ["walkToPlatformMinutes", "Walking (min)"],
                      ["platformSafetyMinutes", "Platform safety (min)"],
                      ["defaultDriveMinutes", "Fallback drive (min)"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        required
                        min={
                          key === "platformSafetyMinutes" ||
                          key === "defaultDriveMinutes"
                            ? 1
                            : 0
                        }
                        max={key === "defaultDriveMinutes" ? 240 : 60}
                        value={s[key] ?? 30}
                        onChange={(e) =>
                          updateStation(s.id, { [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                {s.railStrategies.map((strategy, index) => {
                  const update = (value: typeof strategy) =>
                    updateStation(s.id, {
                      railStrategies: s.railStrategies.map((r, i) =>
                        i === index ? value : r,
                      ),
                    });
                  return (
                    <div className="strategy" key={index}>
                      <label>
                        Train route
                        <select
                          value={strategy.type}
                          onChange={(e) =>
                            update(
                              e.target.value === "direct"
                                ? {
                                    type: "direct",
                                    destinationCrs: strategy.destinationCrs,
                                  }
                                : {
                                    type: "one_change",
                                    destinationCrs: strategy.destinationCrs,
                                    interchangeCrs: "DBY",
                                    minimumConnectionMinutes: 10,
                                  },
                            )
                          }
                        >
                          <option value="direct">Direct</option>
                          <option value="one_change">One change</option>
                        </select>
                      </label>
                      <div className="field-grid">
                        <label>
                          London terminal CRS
                          <input
                            required
                            pattern="[A-Z]{3}"
                            maxLength={3}
                            value={strategy.destinationCrs}
                            onChange={(e) =>
                              update({
                                ...strategy,
                                destinationCrs: e.target.value.toUpperCase(),
                              })
                            }
                          />
                        </label>
                        {strategy.type === "one_change" && (
                          <>
                            <label>
                              Change at CRS
                              <input
                                required
                                pattern="[A-Z]{3}"
                                maxLength={3}
                                value={strategy.interchangeCrs}
                                onChange={(e) =>
                                  update({
                                    ...strategy,
                                    interchangeCrs:
                                      e.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Connection minimum (min)
                              <input
                                type="number"
                                required
                                min={1}
                                max={60}
                                value={strategy.minimumConnectionMinutes}
                                onChange={(e) =>
                                  update({
                                    ...strategy,
                                    minimumConnectionMinutes: Number(
                                      e.target.value,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </>
                        )}
                      </div>
                      {s.railStrategies.length > 1 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            updateStation(s.id, {
                              railStrategies: s.railStrategies.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          Remove route
                        </button>
                      )}
                    </div>
                  );
                })}
                {s.railStrategies.length < 4 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateStation(s.id, {
                        railStrategies: [
                          ...s.railStrategies,
                          { type: "direct", destinationCrs: "EUS" },
                        ],
                      })
                    }
                  >
                    + Add rail strategy
                  </button>
                )}
              </details>
            </div>
          ))}
          {draft.stations.length < 12 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  stations: [
                    ...draft.stations,
                    {
                      id: crypto.randomUUID(),
                      name: "New station",
                      crs: "",
                      location: { lat: 0, lng: 0 },
                      enabled: false,
                      parkingMinutes: 5,
                      walkToPlatformMinutes: 3,
                      platformSafetyMinutes: 4,
                      defaultDriveMinutes: 30,
                      railStrategies: [
                        { type: "direct", destinationCrs: "" },
                      ],
                    },
                  ],
                })
              }
            >
              + Add a station
            </button>
          )}
        </fieldset>
        <fieldset>
          <legend>Deployment access</legend>
          <label>
            Access code (if enabled by the owner)
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p>
            This is your optional app access code. Google and National Rail
            credentials belong in Netlify environment variables.
          </p>
        </fieldset>
        <button className="save-button" type="submit" disabled={lookingUp}>
          Save settings & plan journey →
        </button>
      </form>
    </section>
  );
}
