"use client";
import { useState } from "react";
import { z } from "zod";
import { stationResultSchema, type StationResult } from "../domain/stationLookup";
export function StationLookup({name,token,onSelect}:{name:string;token:string;onSelect:(station:StationResult)=>void}) {
  const [query,setQuery] = useState(name === "New station" ? "" : name);
  const [results,setResults] = useState<StationResult[]>([]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  async function search() {
    setBusy(true); setResults([]); setMessage("Finding stations...");
    try {
      const response = await fetch("/api/stations", {method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query}),signal:AbortSignal.timeout(15000)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Station lookup failed.");
      const stations = z.array(stationResultSchema).parse(data.stations);
      setResults(stations); setMessage("Select your station below.");
    } catch(error) {
      setMessage(error instanceof Error && error.name === "Error" ? error.message : "Station lookup is unavailable. Please try again.");
    } finally {setBusy(false);}
  }
  return <div>
    <label>Find a railway station
      <input type="search" value={query} placeholder="e.g. East Midlands Parkway" maxLength={100} disabled={busy}
        onChange={e=>{setQuery(e.target.value);setResults([]);setMessage("");}}
        onKeyDown={e=>{if(e.key === "Enter"){e.preventDefault();if(!busy && query.trim().length>=2) void search();}}}/>
    </label>
    <button type="button" className="secondary-button" disabled={busy || query.trim().length<2} onClick={search}>{busy ? "Finding..." : "Find station"}</button>
    {message && <p role="status">{message}</p>}
    {results.map(result=><div key={result.id}>
      <p><strong>{result.name}</strong><br/>{result.address}</p>
      <button type="button" className="secondary-button" onClick={()=>{onSelect(result);setResults([]);setMessage("Station location selected. Check the CRS code, London route and parking details below before saving.");}}>Use this station</button>
    </div>)}
    <p>Google Maps. Station locations may differ from car park entrances. CRS codes identify stations to the rail service.</p>
  </div>;
}
