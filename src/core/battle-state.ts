export const BOOST_STATS = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const;

export type BoostStat = typeof BOOST_STATS[number];
export type SideId = 'p1' | 'p2';
export type ActiveSlot = 'p1a' | 'p1b' | 'p2a' | 'p2b';
export type BattleEventSource = 'manual' | 'showdown' | 'vision';

export interface HpState {
  current: number | null;
  max: number | null;
  percent: number;
  exact: boolean;
}

export interface TimedConditionState {
  id: string;
  displayName: string;
  startedTurn: number;
}

export interface PokemonBattleState {
  slot: ActiveSlot;
  species: string;
  hp: HpState;
  status: string | null;
  boosts: Record<BoostStat, number>;
  volatiles: Record<string, TimedConditionState>;
  revealedMoves: string[];
  fainted: boolean;
}

export interface SideBattleState {
  id: SideId;
  conditions: Record<string, TimedConditionState>;
}

export interface BattleState {
  revision: number;
  turn: number;
  weather: TimedConditionState | null;
  terrain: TimedConditionState | null;
  fieldConditions: Record<string, TimedConditionState>;
  sides: Record<SideId, SideBattleState>;
  active: Partial<Record<ActiveSlot, PokemonBattleState>>;
  history: BattleEvent[];
}

interface BattleEventMetadata {
  source?: BattleEventSource;
  confidence?: number;
  observedAt?: string;
}

export type BattleEvent = BattleEventMetadata & (
  | { type: 'turn'; turn: number }
  | { type: 'switch'; slot: ActiveSlot; species: string; hp?: HpState; status?: string | null }
  | { type: 'hp'; slot: ActiveSlot; hp: HpState }
  | { type: 'status'; slot: ActiveSlot; status: string | null }
  | { type: 'boost'; slot: ActiveSlot; stat: BoostStat; amount: number; mode?: 'add' | 'set' }
  | { type: 'clearBoosts'; slot?: ActiveSlot }
  | { type: 'weather'; condition: string | null; displayName?: string }
  | { type: 'terrain'; condition: string | null; displayName?: string }
  | { type: 'fieldCondition'; action: 'start' | 'end'; condition: string; displayName?: string }
  | { type: 'sideCondition'; action: 'start' | 'end'; side: SideId; condition: string; displayName?: string }
  | { type: 'volatile'; action: 'start' | 'end'; slot: ActiveSlot; condition: string; displayName?: string }
  | { type: 'move'; slot: ActiveSlot; move: string; target?: ActiveSlot }
  | { type: 'faint'; slot: ActiveSlot }
);

const EMPTY_BOOSTS: Readonly<Record<BoostStat, number>> = Object.freeze({
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
  accuracy: 0,
  evasion: 0,
});

function clampStage(value: number): number {
  return Math.max(-6, Math.min(6, Math.trunc(value)));
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function normalizeConditionId(value: string): string {
  return value
    .replace(/^(move|ability|item):\s*/i, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '');
}

export function createHpState(
  current: number | null,
  max: number | null,
  percent: number,
  exact: boolean,
): HpState {
  return {
    current: current === null || !Number.isFinite(current) ? null : Math.max(0, current),
    max: max === null || !Number.isFinite(max) ? null : Math.max(1, max),
    percent: normalizePercent(percent),
    exact,
  };
}

export function createInitialBattleState(): BattleState {
  return {
    revision: 0,
    turn: 0,
    weather: null,
    terrain: null,
    fieldConditions: {},
    sides: {
      p1: { id: 'p1', conditions: {} },
      p2: { id: 'p2', conditions: {} },
    },
    active: {},
    history: [],
  };
}

function blankPokemon(slot: ActiveSlot): PokemonBattleState {
  return {
    slot,
    species: 'Unknown',
    hp: createHpState(null, null, 100, false),
    status: null,
    boosts: { ...EMPTY_BOOSTS },
    volatiles: {},
    revealedMoves: [],
    fainted: false,
  };
}

function ensurePokemon(state: BattleState, slot: ActiveSlot): PokemonBattleState {
  const existing = state.active[slot];
  if (existing) return existing;
  const created = blankPokemon(slot);
  state.active[slot] = created;
  return created;
}

function conditionState(state: BattleState, id: string, displayName?: string): TimedConditionState {
  return {
    id,
    displayName: displayName?.trim() || id,
    startedTurn: state.turn,
  };
}

function pushHistory(state: BattleState, event: BattleEvent): void {
  state.history.push(event);
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
}

export function applyBattleEvent(state: BattleState, event: BattleEvent): BattleState {
  switch (event.type) {
    case 'turn':
      state.turn = Math.max(0, Math.trunc(event.turn));
      break;
    case 'switch': {
      state.active[event.slot] = {
        ...blankPokemon(event.slot),
        species: event.species.trim() || 'Unknown',
        hp: event.hp ?? createHpState(null, null, 100, false),
        status: event.status ?? null,
      };
      break;
    }
    case 'hp': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.hp = event.hp;
      pokemon.fainted = event.hp.percent <= 0;
      break;
    }
    case 'status':
      ensurePokemon(state, event.slot).status = event.status;
      break;
    case 'boost': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.boosts[event.stat] = clampStage(
        event.mode === 'set'
          ? event.amount
          : pokemon.boosts[event.stat] + event.amount,
      );
      break;
    }
    case 'clearBoosts': {
      if (event.slot) {
        ensurePokemon(state, event.slot).boosts = { ...EMPTY_BOOSTS };
      } else {
        for (const pokemon of Object.values(state.active)) {
          if (pokemon) pokemon.boosts = { ...EMPTY_BOOSTS };
        }
      }
      break;
    }
    case 'weather': {
      const id = event.condition ? normalizeConditionId(event.condition) : '';
      state.weather = id ? conditionState(state, id, event.displayName ?? event.condition ?? undefined) : null;
      break;
    }
    case 'terrain': {
      const id = event.condition ? normalizeConditionId(event.condition) : '';
      state.terrain = id ? conditionState(state, id, event.displayName ?? event.condition ?? undefined) : null;
      break;
    }
    case 'fieldCondition': {
      const id = normalizeConditionId(event.condition);
      if (!id) break;
      if (event.action === 'start') {
        state.fieldConditions[id] = conditionState(state, id, event.displayName ?? event.condition);
      } else {
        delete state.fieldConditions[id];
      }
      break;
    }
    case 'sideCondition': {
      const id = normalizeConditionId(event.condition);
      if (!id) break;
      if (event.action === 'start') {
        state.sides[event.side].conditions[id] = conditionState(state, id, event.displayName ?? event.condition);
      } else {
        delete state.sides[event.side].conditions[id];
      }
      break;
    }
    case 'volatile': {
      const pokemon = ensurePokemon(state, event.slot);
      const id = normalizeConditionId(event.condition);
      if (!id) break;
      if (event.action === 'start') {
        pokemon.volatiles[id] = conditionState(state, id, event.displayName ?? event.condition);
      } else {
        delete pokemon.volatiles[id];
      }
      break;
    }
    case 'move': {
      const pokemon = ensurePokemon(state, event.slot);
      if (!pokemon.revealedMoves.includes(event.move)) pokemon.revealedMoves.push(event.move);
      break;
    }
    case 'faint': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.fainted = true;
      pokemon.hp = createHpState(0, pokemon.hp.max, 0, pokemon.hp.exact);
      break;
    }
  }

  state.revision += 1;
  pushHistory(state, event);
  return state;
}

export class BattleStateStore {
  private state = createInitialBattleState();

  reset(): BattleState {
    this.state = createInitialBattleState();
    return this.snapshot();
  }

  apply(event: BattleEvent): BattleState {
    applyBattleEvent(this.state, event);
    return this.snapshot();
  }

  applyMany(events: readonly BattleEvent[]): BattleState {
    for (const event of events) applyBattleEvent(this.state, event);
    return this.snapshot();
  }

  snapshot(): BattleState {
    return structuredClone(this.state);
  }
}

export function isActiveSlot(value: unknown): value is ActiveSlot {
  return typeof value === 'string' && /^(p1|p2)[ab]$/.test(value);
}

export function isSideId(value: unknown): value is SideId {
  return value === 'p1' || value === 'p2';
}

export function isBoostStat(value: unknown): value is BoostStat {
  return typeof value === 'string' && BOOST_STATS.includes(value as BoostStat);
}

export function assertBattleEvent(value: unknown): asserts value is BattleEvent {
  if (!value || typeof value !== 'object') throw new Error('イベントはオブジェクトで指定してください。');
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string') throw new Error('イベントtypeがありません。');
  const eventTypes = new Set([
    'turn', 'switch', 'hp', 'status', 'boost', 'clearBoosts', 'weather', 'terrain',
    'fieldCondition', 'sideCondition', 'volatile', 'move', 'faint',
  ]);
  if (!eventTypes.has(event.type)) throw new Error(`未対応のイベントtypeです: ${event.type}`);

  const slotTypes = new Set(['switch', 'hp', 'status', 'boost', 'volatile', 'move', 'faint']);
  if (slotTypes.has(event.type) && !isActiveSlot(event.slot)) {
    throw new Error(`イベント${event.type}のslotが不正です。`);
  }
  if (event.type === 'boost' && !isBoostStat(event.stat)) {
    throw new Error('能力ランクの種類が不正です。');
  }
  if (event.type === 'sideCondition' && !isSideId(event.side)) {
    throw new Error('サイドIDが不正です。');
  }
}
