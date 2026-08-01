export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'snow';
export type Terrain = 'none' | 'electric' | 'grassy' | 'misty' | 'psychic';
export type MajorStatus = 'none' | 'burn' | 'poison' | 'toxic' | 'paralysis' | 'sleep' | 'freeze';
export type StatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';

export interface StatStages extends Record<StatKey, number> {}

export interface PokemonInput {
  species: string;
  currentHp?: number;
  maxHp?: number;
  hpPercent: number;
  status: MajorStatus;
  stages: StatStages;
  moves: string[];
}

export interface SideConditions {
  tailwind: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
}

export interface FieldInput {
  weather: Weather;
  terrain: Terrain;
  trickRoom: boolean;
  attackerSide: SideConditions;
  defenderSide: SideConditions;
}

export interface AnalyzeRequest {
  formatId: string;
  attacker: PokemonInput;
  defender: PokemonInput;
  field: FieldInput;
}

export interface MoveCandidate {
  move: string;
  englishMove: string;
  category: string;
  type: string;
  score: number;
  basePower: number;
  accuracy: number | true;
  priority: number;
  typeMultiplier: number;
  reasons: string[];
}

export interface PokemonResponseSummary {
  species: string;
  englishSpecies: string;
  types: string[];
  hp: {
    current?: number;
    max?: number;
    percent: number;
  };
}

export interface AnalyzeResponse {
  engine: {
    name: 'pokemon-showdown';
    mod: 'champions';
    formatId: string;
  };
  attacker: PokemonResponseSummary;
  defender: PokemonResponseSummary;
  candidates: MoveCandidate[];
  warnings: string[];
}

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SpeciesSummary {
  id: string;
  name: string;
  displayName: string;
  types: string[];
  baseStats: BaseStats;
  nfe?: boolean;
}

export interface MoveSummary {
  id: string;
  name: string;
  displayName: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  priority: number;
  target: string;
  boosts?: Partial<Record<StatKey, number>>;
  selfBoost?: {
    boosts?: Partial<Record<StatKey, number>>;
  };
  status?: string;
  volatileStatus?: string;
  sideCondition?: string;
  weather?: string;
  terrain?: string;
  pseudoWeather?: string;
  selfSwitch?: string | boolean;
  forceSwitch?: boolean;
  drain?: [number, number];
  recoil?: [number, number];
  minHits?: number;
  maxHits?: number;
  fixedDamage?: number | 'level';
  critRatio?: number;
}

export interface LocalizedSearchResult {
  value: string;
  displayName: string;
  englishName: string;
}
