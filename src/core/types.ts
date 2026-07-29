export type Weather =
  | 'none'
  | 'sun'
  | 'rain'
  | 'sand'
  | 'snow';

export interface PokemonInput {
  species: string;
  hpPercent: number;
  moves: string[];
}

export interface FieldInput {
  weather: Weather;
  attackerSpeedStage: number;
  defenderSpeedStage: number;
  tailwind: 'none' | 'attacker' | 'defender' | 'both';
}

export interface AnalyzeRequest {
  formatId: string;
  attacker: PokemonInput;
  defender: PokemonInput;
  field: FieldInput;
}

export interface MoveCandidate {
  move: string;
  category: string;
  type: string;
  score: number;
  basePower: number;
  accuracy: number | true;
  priority: number;
  typeMultiplier: number;
  reasons: string[];
}

export interface AnalyzeResponse {
  engine: {
    name: 'pokemon-showdown';
    mod: 'champions';
    formatId: string;
  };
  attacker: {
    species: string;
    types: string[];
  };
  defender: {
    species: string;
    types: string[];
  };
  candidates: MoveCandidate[];
  warnings: string[];
}

export interface SpeciesSummary {
  id: string;
  name: string;
  types: string[];
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
}

export interface MoveSummary {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  priority: number;
  target: string;
  boosts?: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion', number>>;
  selfBoost?: {
    boosts?: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion', number>>;
  };
}
