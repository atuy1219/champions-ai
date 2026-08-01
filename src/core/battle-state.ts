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

export interface BattleStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface TimedConditionState {
  id: string;
  displayName: string;
  startedTurn: number;
  duration: number | null;
  expiresTurn: number | null;
}

export interface PokemonSetPatch {
  species?: string;
  level?: number;
  item?: string | null;
  ability?: string | null;
  teraType?: string | null;
  teraActive?: boolean;
  moves?: string[];
  stats?: BattleStats | null;
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

export interface SideBattleState {
  id: SideId;
  conditions: Record<string, TimedConditionState>;
  team: TeamPokemonState[];
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

interface ConditionEventFields {
  condition: string;
  displayName?: string;
  duration?: number | null;
}

export type BattleEvent = BattleEventMetadata & (
  | { type: 'turn'; turn: number }
  | ({ type: 'teamMember'; side: SideId; teamIndex: number; species: string; hp?: HpState; status?: string | null } & PokemonSetPatch)
  | ({ type: 'switch'; slot: ActiveSlot; species: string; teamIndex?: number; hp?: HpState; status?: string | null } & PokemonSetPatch)
  | ({ type: 'pokemonInfo'; slot: ActiveSlot; teamIndex?: number } & PokemonSetPatch)
  | { type: 'hp'; slot: ActiveSlot; hp: HpState }
  | { type: 'status'; slot: ActiveSlot; status: string | null }
  | { type: 'boost'; slot: ActiveSlot; stat: BoostStat; amount: number; mode?: 'add' | 'set' }
  | { type: 'clearBoosts'; slot?: ActiveSlot }
  | { type: 'weather'; condition: string | null; displayName?: string; duration?: number | null }
  | { type: 'terrain'; condition: string | null; displayName?: string; duration?: number | null }
  | ({ type: 'fieldCondition'; action: 'start' | 'end' } & ConditionEventFields)
  | ({ type: 'sideCondition'; action: 'start' | 'end'; side: SideId } & ConditionEventFields)
  | ({ type: 'volatile'; action: 'start' | 'end'; slot: ActiveSlot } & ConditionEventFields)
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

const CONDITION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  rain: 'raindance',
  sun: 'sunnyday',
  sand: 'sandstorm',
  electric: 'electricterrain',
  grassy: 'grassyterrain',
  misty: 'mistyterrain',
  psychic: 'psychicterrain',
  おいかぜ: 'tailwind',
  追い風: 'tailwind',
  リフレクター: 'reflect',
  ひかりのかべ: 'lightscreen',
  光の壁: 'lightscreen',
  オーロラベール: 'auroraveil',
  トリックルーム: 'trickroom',
  あめ: 'raindance',
  雨: 'raindance',
  はれ: 'sunnyday',
  晴れ: 'sunnyday',
  すなあらし: 'sandstorm',
  砂嵐: 'sandstorm',
  ゆき: 'snow',
  雪: 'snow',
  エレキフィールド: 'electricterrain',
  グラスフィールド: 'grassyterrain',
  ミストフィールド: 'mistyterrain',
  サイコフィールド: 'psychicterrain',
  まきびし: 'spikes',
  どくびし: 'toxicspikes',
  ステルスロック: 'stealthrock',
  ねばねばネット: 'stickyweb',
  ちょうはつ: 'taunt',
  こんらん: 'confusion',
  みがわり: 'substitute',
  まもる: 'protect',
});

const DEFAULT_DURATIONS: Readonly<Record<string, number>> = Object.freeze({
  tailwind: 4,
  reflect: 5,
  lightscreen: 5,
  auroraveil: 5,
  trickroom: 5,
  electricterrain: 5,
  grassyterrain: 5,
  mistyterrain: 5,
  psychicterrain: 5,
  raindance: 5,
  sunnyday: 5,
  sandstorm: 5,
  snow: 5,
});

function clampStage(value: number): number {
  return Math.max(-6, Math.min(6, Math.trunc(value)));
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 4);
}

function normalizeLevel(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizeStats(value: BattleStats | null | undefined): BattleStats | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return {
    hp: Math.max(1, Math.trunc(value.hp)),
    atk: Math.max(1, Math.trunc(value.atk)),
    def: Math.max(1, Math.trunc(value.def)),
    spa: Math.max(1, Math.trunc(value.spa)),
    spd: Math.max(1, Math.trunc(value.spd)),
    spe: Math.max(1, Math.trunc(value.spe)),
  };
}

function sideFromSlot(slot: ActiveSlot): SideId {
  return slot.slice(0, 2) as SideId;
}

export function normalizeConditionId(value: string): string {
  const normalized = value
    .replace(/^(move|ability|item):\s*/i, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s・･_-]+/g, '');
  const aliased = CONDITION_ALIASES[normalized] ?? normalized;
  return aliased.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '');
}

export function createHpState(
  current: number | null,
  max: number | null,
  percent: number,
  exact: boolean,
): HpState {
  const safeMax = max === null || !Number.isFinite(max) ? null : Math.max(1, Math.trunc(max));
  const safeCurrent = current === null || !Number.isFinite(current)
    ? null
    : Math.max(0, Math.min(safeMax ?? Number.MAX_SAFE_INTEGER, Math.trunc(current)));
  const derivedPercent = exact && safeCurrent !== null && safeMax !== null
    ? safeCurrent / safeMax * 100
    : percent;
  return {
    current: safeCurrent,
    max: safeMax,
    percent: normalizePercent(derivedPercent),
    exact: exact && safeCurrent !== null && safeMax !== null,
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
      p1: { id: 'p1', conditions: {}, team: [] },
      p2: { id: 'p2', conditions: {}, team: [] },
    },
    active: {},
    history: [],
  };
}

function blankTeamMember(side: SideId, teamIndex: number, species = 'Unknown'): TeamPokemonState {
  return {
    side,
    teamIndex,
    species,
    level: 50,
    hp: createHpState(null, null, 100, false),
    status: null,
    item: null,
    ability: null,
    teraType: null,
    teraActive: false,
    moves: [],
    revealedMoves: [],
    stats: null,
    fainted: false,
    activeSlot: null,
  };
}

function blankPokemon(slot: ActiveSlot): PokemonBattleState {
  const side = sideFromSlot(slot);
  return {
    ...blankTeamMember(side, 0),
    slot,
    boosts: { ...EMPTY_BOOSTS },
    volatiles: {},
  };
}

function patchSet(target: TeamPokemonState | PokemonBattleState, patch: PokemonSetPatch): void {
  if (patch.species !== undefined && patch.species.trim()) target.species = patch.species.trim();
  if (patch.level !== undefined) target.level = normalizeLevel(patch.level);
  if (patch.item !== undefined) target.item = patch.item?.trim() || null;
  if (patch.ability !== undefined) target.ability = patch.ability?.trim() || null;
  if (patch.teraType !== undefined) target.teraType = patch.teraType?.trim() || null;
  if (patch.teraActive !== undefined) target.teraActive = patch.teraActive;
  if (patch.moves !== undefined) target.moves = normalizeList(patch.moves);
  const stats = normalizeStats(patch.stats);
  if (stats !== undefined) target.stats = stats;
}

function nextTeamIndex(state: BattleState, side: SideId): number {
  const indexes = state.sides[side].team.map((member) => member.teamIndex);
  for (let index = 1; index <= 6; index += 1) {
    if (!indexes.includes(index)) return index;
  }
  return 6;
}

function getTeamMember(state: BattleState, side: SideId, teamIndex: number): TeamPokemonState | undefined {
  return state.sides[side].team.find((member) => member.teamIndex === teamIndex);
}

function upsertTeamMember(
  state: BattleState,
  side: SideId,
  teamIndex: number,
  species: string,
): TeamPokemonState {
  const normalizedIndex = Math.max(1, Math.min(6, Math.trunc(teamIndex)));
  let member = getTeamMember(state, side, normalizedIndex);
  if (!member) {
    member = blankTeamMember(side, normalizedIndex, species.trim() || 'Unknown');
    state.sides[side].team.push(member);
    state.sides[side].team.sort((left, right) => left.teamIndex - right.teamIndex);
  } else if (species.trim()) {
    member.species = species.trim();
  }
  return member;
}

function ensurePokemon(state: BattleState, slot: ActiveSlot): PokemonBattleState {
  const existing = state.active[slot];
  if (existing) return existing;
  const created = blankPokemon(slot);
  state.active[slot] = created;
  return created;
}

function syncActiveToTeam(state: BattleState, pokemon: PokemonBattleState): void {
  if (pokemon.teamIndex <= 0) return;
  const member = upsertTeamMember(state, pokemon.side, pokemon.teamIndex, pokemon.species);
  member.species = pokemon.species;
  member.level = pokemon.level;
  member.hp = { ...pokemon.hp };
  member.status = pokemon.status;
  member.item = pokemon.item;
  member.ability = pokemon.ability;
  member.teraType = pokemon.teraType;
  member.teraActive = pokemon.teraActive;
  member.moves = [...pokemon.moves];
  member.revealedMoves = [...pokemon.revealedMoves];
  member.stats = pokemon.stats ? { ...pokemon.stats } : null;
  member.fainted = pokemon.fainted;
  member.activeSlot = pokemon.slot;
}

function saveAndClearSlot(state: BattleState, slot: ActiveSlot): void {
  const current = state.active[slot];
  if (!current) return;
  syncActiveToTeam(state, current);
  const member = current.teamIndex > 0 ? getTeamMember(state, current.side, current.teamIndex) : undefined;
  if (member) member.activeSlot = null;
  delete state.active[slot];
}

function activeFromMember(member: TeamPokemonState, slot: ActiveSlot): PokemonBattleState {
  return {
    side: member.side,
    teamIndex: member.teamIndex,
    species: member.species,
    level: member.level,
    hp: { ...member.hp },
    status: member.status,
    item: member.item,
    ability: member.ability,
    teraType: member.teraType,
    teraActive: member.teraActive,
    moves: [...member.moves],
    revealedMoves: [...member.revealedMoves],
    stats: member.stats ? { ...member.stats } : null,
    fainted: member.fainted,
    slot,
    boosts: { ...EMPTY_BOOSTS },
    volatiles: {},
  };
}

function defaultDuration(id: string, explicit: number | null | undefined): number | null {
  if (explicit === null) return null;
  if (explicit !== undefined) return Math.max(1, Math.trunc(explicit));
  return DEFAULT_DURATIONS[id] ?? null;
}

function conditionState(
  state: BattleState,
  id: string,
  displayName?: string,
  duration?: number | null,
): TimedConditionState {
  const normalizedDuration = defaultDuration(id, duration);
  return {
    id,
    displayName: displayName?.trim() || id,
    startedTurn: state.turn,
    duration: normalizedDuration,
    expiresTurn: normalizedDuration === null ? null : state.turn + normalizedDuration,
  };
}

function expireRecord(turn: number, record: Record<string, TimedConditionState>): void {
  for (const [id, condition] of Object.entries(record)) {
    if (condition.expiresTurn !== null && turn >= condition.expiresTurn) delete record[id];
  }
}

function expireConditions(state: BattleState): void {
  if (state.weather && state.weather.expiresTurn !== null && state.turn >= state.weather.expiresTurn) {
    state.weather = null;
  }
  if (state.terrain && state.terrain.expiresTurn !== null && state.turn >= state.terrain.expiresTurn) {
    state.terrain = null;
  }
  expireRecord(state.turn, state.fieldConditions);
  expireRecord(state.turn, state.sides.p1.conditions);
  expireRecord(state.turn, state.sides.p2.conditions);
  for (const pokemon of Object.values(state.active)) {
    if (pokemon) expireRecord(state.turn, pokemon.volatiles);
  }
}

function pushHistory(state: BattleState, event: BattleEvent): void {
  state.history.push(event);
  if (state.history.length > 300) state.history.splice(0, state.history.length - 300);
}

export function applyBattleEvent(state: BattleState, event: BattleEvent): BattleState {
  switch (event.type) {
    case 'turn':
      state.turn = Math.max(0, Math.trunc(event.turn));
      expireConditions(state);
      break;
    case 'teamMember': {
      const member = upsertTeamMember(state, event.side, event.teamIndex, event.species);
      patchSet(member, event);
      if (event.hp) member.hp = event.hp;
      if (event.status !== undefined) member.status = event.status;
      member.fainted = member.hp.percent <= 0;
      if (member.activeSlot) {
        const active = state.active[member.activeSlot];
        if (active) {
          active.species = member.species;
          active.level = member.level;
          active.hp = { ...member.hp };
          active.status = member.status;
          active.item = member.item;
          active.ability = member.ability;
          active.teraType = member.teraType;
          active.teraActive = member.teraActive;
          active.moves = [...member.moves];
          active.stats = member.stats ? { ...member.stats } : null;
          active.fainted = member.fainted;
        }
      }
      break;
    }
    case 'switch': {
      const side = sideFromSlot(event.slot);
      saveAndClearSlot(state, event.slot);
      const matchingBySpecies = state.sides[side].team.find(
        (member) => member.species.toLowerCase() === event.species.trim().toLowerCase() && member.activeSlot === null,
      );
      const teamIndex = event.teamIndex ?? matchingBySpecies?.teamIndex ?? nextTeamIndex(state, side);
      const member = upsertTeamMember(state, side, teamIndex, event.species);
      if (member.activeSlot && member.activeSlot !== event.slot) saveAndClearSlot(state, member.activeSlot);
      patchSet(member, event);
      if (event.hp) member.hp = event.hp;
      if (event.status !== undefined) member.status = event.status;
      member.fainted = member.hp.percent <= 0;
      member.activeSlot = event.slot;
      state.active[event.slot] = activeFromMember(member, event.slot);
      break;
    }
    case 'pokemonInfo': {
      const pokemon = ensurePokemon(state, event.slot);
      if (event.teamIndex !== undefined) pokemon.teamIndex = Math.max(1, Math.min(6, Math.trunc(event.teamIndex)));
      patchSet(pokemon, event);
      syncActiveToTeam(state, pokemon);
      break;
    }
    case 'hp': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.hp = event.hp;
      pokemon.fainted = event.hp.percent <= 0;
      syncActiveToTeam(state, pokemon);
      break;
    }
    case 'status': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.status = event.status;
      syncActiveToTeam(state, pokemon);
      break;
    }
    case 'boost': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.boosts[event.stat] = clampStage(
        event.mode === 'set' ? event.amount : pokemon.boosts[event.stat] + event.amount,
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
      state.weather = id
        ? conditionState(state, id, event.displayName ?? event.condition ?? undefined, event.duration)
        : null;
      break;
    }
    case 'terrain': {
      const id = event.condition ? normalizeConditionId(event.condition) : '';
      state.terrain = id
        ? conditionState(state, id, event.displayName ?? event.condition ?? undefined, event.duration)
        : null;
      break;
    }
    case 'fieldCondition': {
      const id = normalizeConditionId(event.condition);
      if (!id) break;
      if (event.action === 'start') {
        state.fieldConditions[id] = conditionState(state, id, event.displayName ?? event.condition, event.duration);
      } else {
        delete state.fieldConditions[id];
      }
      break;
    }
    case 'sideCondition': {
      const id = normalizeConditionId(event.condition);
      if (!id) break;
      if (event.action === 'start') {
        state.sides[event.side].conditions[id] = conditionState(
          state,
          id,
          event.displayName ?? event.condition,
          event.duration,
        );
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
        pokemon.volatiles[id] = conditionState(state, id, event.displayName ?? event.condition, event.duration);
      } else {
        delete pokemon.volatiles[id];
      }
      break;
    }
    case 'move': {
      const pokemon = ensurePokemon(state, event.slot);
      const move = event.move.trim();
      if (move && !pokemon.revealedMoves.includes(move)) pokemon.revealedMoves.push(move);
      syncActiveToTeam(state, pokemon);
      break;
    }
    case 'faint': {
      const pokemon = ensurePokemon(state, event.slot);
      pokemon.fainted = true;
      pokemon.hp = createHpState(0, pokemon.hp.max, 0, pokemon.hp.exact);
      syncActiveToTeam(state, pokemon);
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function assertBattleEvent(value: unknown): asserts value is BattleEvent {
  if (!value || typeof value !== 'object') throw new Error('イベントはオブジェクトで指定してください。');
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string') throw new Error('イベントtypeがありません。');
  const eventTypes = new Set([
    'turn', 'teamMember', 'switch', 'pokemonInfo', 'hp', 'status', 'boost', 'clearBoosts',
    'weather', 'terrain', 'fieldCondition', 'sideCondition', 'volatile', 'move', 'faint',
  ]);
  if (!eventTypes.has(event.type)) throw new Error(`未対応のイベントtypeです: ${event.type}`);

  const slotTypes = new Set(['switch', 'pokemonInfo', 'hp', 'status', 'boost', 'volatile', 'move', 'faint']);
  if (slotTypes.has(event.type) && !isActiveSlot(event.slot)) {
    throw new Error(`イベント${event.type}のslotが不正です。`);
  }
  if (event.type === 'teamMember') {
    if (!isSideId(event.side)) throw new Error('teamMemberのsideが不正です。');
    if (!isFiniteNumber(event.teamIndex) || event.teamIndex < 1 || event.teamIndex > 6) {
      throw new Error('teamMemberのteamIndexは1から6で指定してください。');
    }
    if (typeof event.species !== 'string' || !event.species.trim()) {
      throw new Error('teamMemberのspeciesがありません。');
    }
  }
  if (event.type === 'switch' && (typeof event.species !== 'string' || !event.species.trim())) {
    throw new Error('switchのspeciesがありません。');
  }
  if (event.type === 'boost') {
    if (!isBoostStat(event.stat)) throw new Error('能力ランクの種類が不正です。');
    if (!isFiniteNumber(event.amount)) throw new Error('能力ランクの変化量が不正です。');
  }
  if (event.type === 'sideCondition' && !isSideId(event.side)) {
    throw new Error('サイドIDが不正です。');
  }
  if (event.type === 'turn' && !isFiniteNumber(event.turn)) throw new Error('turnが不正です。');
  if (event.type === 'hp') {
    if (!event.hp || typeof event.hp !== 'object') throw new Error('hpイベントのHPが不正です。');
  }
}
