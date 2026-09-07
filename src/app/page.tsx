"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { ClientPlan, Settings } from "../domain/models";
import { defaultSettings } from "../config/stations";
import { settingsSchema } from "../domain/validation";
import { JourneyCard } from "../components/JourneyCard";
import { SettingsPanel } from "../components/SettingsPanel";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function Home() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"next" | "arrive_by">("next");
  const [arrival, setArrival] = useState("");
  const [result, setResult] = useState<ClientPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [accessToken, setAccessToken] = useState("");
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const abort = useRef<AbortController | null>(null);
  const initialLoad = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("london-settings-v1");
      if (saved) {
        const parsed = settingsSchema.safeParse(JSON.parse(saved));
        if (parsed.success) setSettings(parsed.data);
      }
      setAccessToken(sessionStorage.getItem("journey-access") ?? "");
    } catch {
      setError("Saved settings could not be loaded. You can set them again.");
    }
    setReady(true);
    setOnline(navigator.onLine);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const connection = () => setOnline(navigator.onLine);
    const installHandler = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("beforeinstallprompt", installHandler);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("beforeinstallprompt", installHandler);
      abort.current?.abort();
    };
  }, []);
  const plan = useCallback(
    async (current = settings, token = accessToken) => {
      if (!current.home) {
        setShowSettings(true);
        return;
      }
      let arrivalBy: string | null = null;
      if (mode === "arrive_by") {
        const london = DateTime.fromISO(arrival, { zone: "Europe/London" });
        if (
          !london.isValid ||
          london.toFormat("yyyy-MM-dd'T'HH:mm") !== arrival ||
          london.getPossibleOffsets().length > 1 ||
          london.toMillis() <= Date.now()
        ) {
          setError(
            "Choose a future, unambiguous London arrival time. Clock-change hours may be invalid or occur twice.",
          );
          return;
        }
        arrivalBy = london.toISO();
      }
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      setError("");
      setResult(null);
      try {
        const response = await fetch("/api/plan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            origin: current.home,
            mode,
            objective: current.objective,
            arrivalBy,
            settings: current,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Could not plan your journey.");
        setResult(data);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to connect. Try again.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [settings, accessToken, mode, arrival],
  );
  useEffect(() => {
    if (ready && settings.home && !initialLoad.current) {
      initialLoad.current = true;
      void plan();
    }
  }, [ready, settings.home, plan]);
  function save(updated: Settings, token: string) {
    try {
      localStorage.setItem("london-settings-v1", JSON.stringify(updated));
      sessionStorage.setItem("journey-access", token);
    } catch {
      setError(
        "Browser storage is unavailable. Settings will last for this visit only.",
      );
    }
    initialLoad.current = true;
    setSettings(updated);
    setAccessToken(token);
    setShowSettings(false);
    void plan(updated, token);
  }
  function resetPlan() {
    abort.current?.abort();
    setLoading(false);
    setResult(null);
    setError("");
  }
  const stale = result && now - Date.parse(result.generatedAt) > 120000;
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="London next home">
          <span className="logo-mark">↗</span> journey
          <span className="wordmark-light">picker</span>
        </a>
        <button
          className="icon-button"
          onClick={() => setShowSettings(!showSettings)}
          aria-label="Open settings"
        >
          ⚙
        </button>
      </header>
      <main>
        {showSettings ? (
          <SettingsPanel
            initial={settings}
            accessToken={accessToken}
            onSave={save}
            onClose={() => setShowSettings(false)}
          />
        ) : (
          <>
            <section className="intro">
              <p className="eyebrow">FROM YOUR DOOR TO THE CAPITAL</p>
              <h1>
                London, <em>next.</em>
              </h1>
              <p>The right station. The right train. Time to go.</p>
            </section>
            <div className="mode-switch" role="group" aria-label="Journey mode">
              <button
                aria-pressed={mode === "next"}
                onClick={() => {
                  resetPlan();
                  setMode("next");
                }}
              >
                Next best journey
              </button>
              <button
                aria-pressed={mode === "arrive_by"}
                onClick={() => {
                  resetPlan();
                  setMode("arrive_by");
                }}
              >
                Arrive by <span>◷</span>
              </button>
            </div>
            {mode === "arrive_by" && (
              <div className="arrival-picker">
                <label>
                  Arrive in London by (London local time)
                  <input
                    type="datetime-local"
                    value={arrival}
                    onChange={(e) => {
                      resetPlan();
                      setArrival(e.target.value);
                    }}
                  />
                </label>
                <p>
                  Uses live departures within the next{" "}
                  {settings.planningHorizonMinutes} minutes.
                </p>
              </div>
            )}
            <div className="status-row">
              <span className={`status-dot ${!online ? "offline" : ""}`} />
              <span>
                {!online
                  ? "Offline · live journeys unavailable"
                  : loading
                    ? "Checking roads and rail…"
                    : result
                      ? `Data updated ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(result.generatedAt))}`
                      : "Your next journey starts here"}
              </span>
              <button
                className="text-button"
                disabled={loading || !online}
                onClick={() => void plan()}
              >
                ↻ {loading ? "Checking" : "Refresh"}
              </button>
            </div>
            {(stale || (!online && result)) && (
              <p className="notice" role="alert">
                LIVE DATA MAY BE STALE — refresh before leaving.
              </p>
            )}
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            {loading && (
              <div className="loading-card" role="status">
                <span className="loading-line" />
                <h2>Finding your best way in.</h2>
                <p>Checking trains, connections and the drive from home.</p>
              </div>
            )}
            {!loading && result && (
              <>
                {result.messages.map((m, i) => (
                  <p className="notice" key={i}>
                    {m}
                  </p>
                ))}
                {result.roadDataStatus === "degraded" && (
                  <p className="notice">
                    Live road traffic unavailable for some options. Estimated
                    driving times are clearly marked.
                  </p>
                )}
                {result.recommended && (
                  <JourneyCard journey={result.recommended} now={now} primary />
                )}
                {result.alternatives.length > 0 && (
                  <section className="alternatives">
                    <div className="section-heading">
                      <h2>Other ways in</h2>
                      <span>{result.alternatives.length} alternatives</span>
                    </div>
                    {result.alternatives.map((j) => (
                      <JourneyCard key={j.id} journey={j} now={now} />
                    ))}
                  </section>
                )}
              </>
            )}
            {!loading && !result && (
              <section className="welcome-card">
                <div className="rail-illustration" aria-hidden="true">
                  <div className="track" />
                  <div className="train">
                    ↗<span>LDN</span>
                    <i />
                    <i />
                  </div>
                  <span className="map-point start">HOME</span>
                  <span className="map-point finish">LONDON</span>
                </div>
                <p className="eyebrow">ONE COMPLETE JOURNEY</p>
                <h2>
                  {settings.home
                    ? "Ready when you are."
                    : "A better way to London."}
                </h2>
                <p>
                  Compare the drive and live trains together.
                  <br />
                  Know exactly when to leave home.
                </p>
                <button
                  className="save-button"
                  disabled={!ready || !online}
                  onClick={() =>
                    settings.home ? void plan() : setShowSettings(true)
                  }
                >
                  {settings.home
                    ? "Find my journey"
                    : "Set your starting point"}
                  <span>→</span>
                </button>
                <div className="welcome-stations">
                  Lichfield · Tamworth · Derby · Burton
                  <br />
                  <span>Your stations, your choice.</span>
                </div>
              </section>
            )}
            <section className="how-it-works">
              <div className="eyebrow">EVERY MINUTE, ACCOUNTED FOR</div>
              <div>
                <span>Home</span>
                <b>→</b>
                <span>Drive</span>
                <b>→</b>
                <span>Platform</span>
                <b>→</b>
                <span>London</span>
              </div>
              <p>
                Traffic-aware driving. Live rail forecasts. Room to breathe.
              </p>
            </section>
            {install && (
              <button
                className="install-button"
                onClick={async () => {
                  await install.prompt();
                  await install.userChoice;
                  setInstall(null);
                }}
              >
                ＋ Add to your home screen
              </button>
            )}
          </>
        )}
      </main>
      <footer>
        <span className="footer-brand">London, next.</span>
        <span>Built for the whole journey.</span>
        <p>
          Times shown in Europe/London. Live rail:{" "}
          {result?.railSource ?? "your configured provider"}.<br />
          Driving estimates: Google Maps. Always check station displays.
        </p>
      </footer>
    </div>
  );
}
