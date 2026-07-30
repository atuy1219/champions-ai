import type { ActiveSlot, SideId } from './battle-state.js';

export interface CurrentEvaluationRequest {
  side?: SideId;
  formatId?: string;
  maxActionsPerPokemon?: number;
}

export interface DamagePreview {
  targetSlot: ActiveSlot | null;
  targetSpecies: string;
  minDamage: number;
  maxDamage: number;
  minPercent: number;
  maxPercent: number;
  expectedPercent: number;
  koChance: number;
  hitChance: number;
  typeMultiplier: number;
  assumptions: string[];
}

export interface ActionScoreBreakdown {
  damage: number;
  knockout: number;
  speed: number;
  accuracy: number;
  boardControl: number;
  bench: number;
  preservation: number;
  opponentResponseRisk: number;
  friendlyFireRisk: number;
  final: number;
}

export interface CurrentActionEvaluation {
  id: string;
  actorSlot: ActiveSlot;
  actorSpecies: string;
  kind: 'move' | 'switch';
  label: string;
  move?: string;
  englishMove?: string;
  targetSlots: ActiveSlot[];
  switchToTeamIndex?: number;
  damage: DamagePreview[];
  score: ActionScoreBreakdown;
  reasons: string[];
}

export interface JointActionEvaluation {
  id: string;
  actions: string[];
  actorSlots: ActiveSlot[];
  score: number;
  baseScore: number;
  synergyScore: number;
  reasons: string[];
}

export interface CurrentPokemonEvaluation {
  slot: ActiveSlot;
  species: string;
  actions: CurrentActionEvaluation[];
}

export interface CurrentEvaluationResponse {
  engine: {
    name: 'pokemon-showdown-data';
    mod: 'champions';
    formatId: string;
    model: 'gen9-damage-and-one-turn-risk-v0';
  };
  revision: number;
  turn: number;
  side: SideId;
  pokemon: CurrentPokemonEvaluation[];
  jointActions: JointActionEvaluation[];
  warnings: string[];
}
