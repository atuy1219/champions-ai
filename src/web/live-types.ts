export type SideId = 'p1' | 'p2';
export type ActiveSlot = 'p1a' | 'p1b' | 'p2a' | 'p2b';
export type BoostStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';

export interface HpState {
  current: number | null;
  max: number | null;
  percent: number;
  exact: boolean;
}

export interface BattleStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface TimedConditionState {
  displayName: string;
  expiresTurn: number | null;
}

export interface TeamPokemonState {
  side: SideId;
  teamIndex: number;
  species: string;
  level: number;
  hp: HpState;
  status: string | null;
  item: string | null;
  ability: string | null;
  teraType: string | null;
  teraActive: boolean;
  moves: string[];
  revealedMoves: string[];
  stats: BattleStats | null;
  fainted: boolean;
  activeSlot: ActiveSlot | null;
}

export interface PokemonBattleState extends Omit<TeamPokemonState, 'activeSlot'> {
  slot: ActiveSlot;
  boosts: Record<BoostStat, number>;
  volatiles: Record<string, TimedConditionState>;
}

export interface BattleState {
  revision: number;
  turn: number;
  weather: TimedConditionState | null;
  terrain: TimedConditionState | null;
  fieldConditions: Record<string, TimedConditionState>;
  sides: Record<SideId, {
    conditions: Record<string, TimedConditionState>;
    team: TeamPokemonState[];
  }>;
  active: Partial<Record<ActiveSlot, PokemonBattleState>>;
  history: Record<string, unknown>[];
}

export interface DamagePreview {
  targetSpecies: string;
  minPercent: number;
  maxPercent: number;
  expectedPercent: number;
  koChance: number;
  hitChance: number;
  typeMultiplier: number;
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
  label: string;
  kind: 'move' | 'switch';
  damage: DamagePreview[];
  score: ActionScoreBreakdown;
  reasons: string[];
}

export interface CurrentEvaluationResponse {
  revision: number;
  turn: number;
  side: SideId;
  pokemon: Array<{
    slot: ActiveSlot;
    species: string;
    actions: CurrentActionEvaluation[];
  }>;
  jointActions: Array<{
    actions: string[];
    score: number;
    baseScore: number;
    synergyScore: number;
    reasons: string[];
  }>;
  warnings: string[];
}

export interface SearchResult {
  value: string;
  displayName: string;
  englishName: string;
}
