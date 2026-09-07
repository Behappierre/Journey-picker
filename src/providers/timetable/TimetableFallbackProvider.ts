import type { RailProvider } from "../../domain/models";
import { RailProviderError } from "../rail/RailProviderError";
/** Fall back only on failed live requests, never replace a successful empty/cancelled board. */
export class TimetableFallbackProvider implements RailProvider {
  readonly name: string;
  private cancelled = new Set<string>();
  constructor(private live: RailProvider, private timetable: RailProvider) { this.name = `${live.name} / RDG timetable`; }
  async getDepartures(...args: Parameters<RailProvider["getDepartures"]>) {
    try {
      const services = await this.live.getDepartures(...args);
      for (const s of services) {
        const key = `${s.originCrs}:${s.destinationCrs}:${s.serviceId.replace(/^(gb-nr:|rdg:)/, "")}`;
        if (s.cancelled) this.cancelled.add(key); else this.cancelled.delete(key);
      }
      return services;
    }
    catch (error) {
      // Credential mistakes must remain visible instead of silently looking healthy.
      if (error instanceof RailProviderError && error.code === "credentials") throw error;
      try { return (await this.timetable.getDepartures(...args)).filter(s => !this.cancelled.has(`${s.originCrs}:${s.destinationCrs}:${s.serviceId.replace(/^(gb-nr:|rdg:)/, "")}`)); }
      catch { throw error; }
    }
  }
  getServiceDetails(...args: Parameters<RailProvider["getServiceDetails"]>) { return args[0].startsWith("rdg:") ? this.timetable.getServiceDetails(...args) : this.live.getServiceDetails(...args); }
  async getDisruptions(...args: Parameters<RailProvider["getDisruptions"]>) {
    try { return await this.live.getDisruptions(...args); }
    catch { return [{ message: "Live disruption information unavailable." }]; }
  }
}
