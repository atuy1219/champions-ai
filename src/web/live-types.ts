export type SideId = 'p1' | 'p2';
export type ActiveSlot = 'p1a' | 'p1b' | 'p2a' | 'p2b';
export type BoostStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';
export type SessionResult = 'win' | 'loss' | 'draw' | 'cancelled' | 'unknown';

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

export interface BattleSessionMetadata {
  id: string;
  title: string;
  formatId: string;
  status: 'active' | 'finished';
  result: SessionResult | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DecisionRecord {
  id: string;
  createdAt: string;
  evaluationRevision: number;
  turn: number;
  side: SideId;
  kind: 'individual' | 'joint';
  actionId: string;
  label: string;
  score: number;
  actorSlots: ActiveSlot[];
  notes: string;
}

export interface BattleSessionSnapshot {
  metadata: BattleSessionMetadata;
  state: BattleState;
  decisions: DecisionRecord[];
  eventCount: number;
}

export interface PersistedBattleSession {
  schemaVersion: 1;
  metadata: BattleSessionMetadata;
  events: Record<string, unknown>[];
  decisions: DecisionRecord[];
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

export interface CurrentEvaluationResponse {
  revision: number;
  turn: number;
  side: SideId;
  pokemon: Array<{
    slot: ActiveSlot;
    species: string;
    actions: CurrentActionEvaluation[];
  }>;
  jointActions: JointActionEvaluation[];
  warnings: string[];
}

export interface SearchResult {
  value: string;
  displayName: string;
  englishName: string;
}
