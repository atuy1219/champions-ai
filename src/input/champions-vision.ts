import type { BattleEvent } from '../core/battle-state.js';

export interface ChampionsFrameObservation {
  frameId: string;
  capturedAt: string;
  confidence: number;
  events: BattleEvent[];
  warnings: string[];
}

export interface ChampionsVisionAdapter {
  analyzeFrame(frame: Uint8Array): Promise<ChampionsFrameObservation>;
}

export function visionEvents(observation: ChampionsFrameObservation): BattleEvent[] {
  return observation.events.map((event) => ({
    ...event,
    source: 'vision',
    confidence: event.confidence ?? observation.confidence,
    observedAt: event.observedAt ?? observation.capturedAt,
  }));
}
