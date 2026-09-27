export type IncidentPace = 'natural' | 'showcase';
export interface IncidentState {
  pace: IncidentPace;
  nextAt: number;
  lastAt: number | null;
  recent: string[];
  cooldowns: Record<string, number>;
  actorCooldowns: Record<string, number>;
  misses: number;
}
export const incidentPacing = {
  natural: { minDelay: 90, jitter: 90, chance: .28, typeCooldown: 360, actorCooldown: 120 },
  showcase: { minDelay: 14, jitter: 10, chance: .85, typeCooldown: 90, actorCooldown: 35 },
} as const;
export const freshIncidents = (clock: number): IncidentState => ({
  pace: 'showcase', nextAt: clock + 4, lastAt: null, recent: [], cooldowns: {}, actorCooldowns: {}, misses: 0,
});
