import type {
  ActiveSlot,
  BattleState,
  BattleStats,
  PokemonBattleState,
  SideId,
  TeamPokemonState,
} from './battle-state.js';
import type { DamagePreview } from './current-evaluation-types.js';
import type { MoveSummary, SpeciesSummary } from './types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

export type PokemonLike = PokemonBattleState | TeamPokemonState;

export interface ResolvedPokemon {
  source: PokemonLike;
  species: SpeciesSummary;
  stats: BattleStats;
  defaultStats: boolean;
}

const JAPANESE_IDS: Readonly<Record<string, string>> = Object.freeze({
  こだわりハチマキ: 'choiceband', こだわりメガネ: 'choicespecs', こだわりスカーフ: 'choicescarf',
  いのちのたま: 'lifeorb', たつじんのおび: 'expertbelt', とつげきチョッキ: 'assaultvest',
  しんかのきせき: 'eviolite', ふうせん: 'airballoon', こうかくレンズ: 'widelens',
  ふゆう: 'levitate', こんじょう: 'guts', ちからもち: 'hugepower', ヨガパワー: 'purepower',
  てきおうりょく: 'adaptability', すいすい: 'swiftswim', ようりょくそ: 'chlorophyll',
  すなかき: 'sandrush', ゆきかき: 'slushrush', かたやぶり: 'moldbreaker',
  かたいいし: 'solidrock', フィルター: 'filter', プリズムアーマー: 'prismarmor',
  マルチスケイル: 'multiscale', もふもふ: 'fluffy', ファーコート: 'furcoat',
  こおりのりんぷん: 'icescales', もらいび: 'flashfire', ちょすい: 'waterabsorb',
  よびみず: 'stormdrain', ひらいしん: 'lightningrod', そうしょく: 'sapsipper',
});

const STATUS_IDS: Readonly<Record<string, string>> = Object.freeze({
  burn: 'brn', やけど: 'brn', brn: 'brn', paralysis: 'par', まひ: 'par', par: 'par',
  poison: 'psn', どく: 'psn', psn: 'psn', toxic: 'tox', もうどく: 'tox', tox: 'tox',
  sleep: 'slp', ねむり: 'slp', slp: 'slp', freeze: 'frz', こおり: 'frz', frz: 'frz',
});

const ZERO_BOOSTS = Object.freeze({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 });

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeBattleId(value: string | null): string {
  if (!value) return '';
  const normalized = value.normalize('NFKC').trim().replace(/[\s・･_-]+/g, '').toLowerCase();
  return JAPANESE_IDS[normalized] ?? normalized.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '');
}

function normalizedStatus(value: string | null): string {
  if (!value) return '';
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  return STATUS_IDS[normalized] ?? normalized;
}

export function oppositeSide(side: SideId): SideId {
  return side === 'p1' ? 'p2' : 'p1';
}

export function sideFromSlot(slot: ActiveSlot): SideId {
  return slot.slice(0, 2) as SideId;
}

export function activeSlots(state: BattleState, side: SideId): ActiveSlot[] {
  return (Object.keys(state.active) as ActiveSlot[]).filter((slot) => {
    const pokemon = state.active[slot];
    return sideFromSlot(slot) === side && pokemon !== undefined && !pokemon.fainted;
  });
}

function stageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function accuracyStageMultiplier(stage: number): number {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

function defaultStat(base: number, level: number): number {
  return Math.floor((2 * base + 31) * level / 100) + 5;
}

function defaultHp(base: number, level: number): number {
  return Math.floor((2 * base + 31) * level / 100) + level + 10;
}

export function resolvePokemon(pokemon: PokemonLike, adapter: ShowdownAdapter): ResolvedPokemon {
  const species = adapter.getSpecies(pokemon.species);
  if (pokemon.stats) return { source: pokemon, species, stats: { ...pokemon.stats }, defaultStats: false };
  const level = pokemon.level || 50;
  return {
    source: pokemon,
    species,
    defaultStats: true,
    stats: {
      hp: pokemon.hp.max ?? defaultHp(species.baseStats.hp, level),
      atk: defaultStat(species.baseStats.atk, level),
      def: defaultStat(species.baseStats.def, level),
      spa: defaultStat(species.baseStats.spa, level),
      spd: defaultStat(species.baseStats.spd, level),
      spe: defaultStat(species.baseStats.spe, level),
    },
  };
}

export function knownMoves(pokemon: PokemonLike): string[] {
  return [...new Set([...pokemon.moves, ...pokemon.revealedMoves].map((move) => move.trim()).filter(Boolean))].slice(0, 4);
}

export function isSpreadMove(move: MoveSummary): boolean {
  return ['allAdjacent', 'allAdjacentFoes', 'foeSide', 'allySide', 'all'].includes(move.target);
}

export function moveTargets(state: BattleState, actorSlot: ActiveSlot, move: MoveSummary): Array<ActiveSlot | null> {
  const side = sideFromSlot(actorSlot);
  const foes = activeSlots(state, oppositeSide(side));
  const allies = activeSlots(state, side).filter((slot) => slot !== actorSlot);
  if (isSpreadMove(move) || move.target === 'self' || ['allySide', 'foeSide', 'all'].includes(move.target)) return [null];
  if (move.target === 'adjacentAlly') return allies;
  if (move.target === 'adjacentAllyOrSelf') return [actorSlot, ...allies];
  if (move.target === 'any') return [...foes, ...allies];
  return foes;
}

function effectiveTypes(pokemon: ResolvedPokemon): string[] {
  if (!pokemon.source.teraActive || !pokemon.source.teraType) return pokemon.species.types;
  const type = pokemon.source.teraType.trim();
  return [type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()];
}

function grounded(pokemon: ResolvedPokemon): boolean {
  return !effectiveTypes(pokemon).includes('Flying')
    && normalizeBattleId(pokemon.source.ability) !== 'levitate'
    && normalizeBattleId(pokemon.source.item) !== 'airballoon';
}

function boosts(pokemon: ResolvedPokemon): Record<keyof typeof ZERO_BOOSTS, number> {
  return 'boosts' in pokemon.source ? pokemon.source.boosts : ZERO_BOOSTS;
}

function modifiedStat(pokemon: ResolvedPokemon, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'): number {
  let value = pokemon.stats[stat] * stageMultiplier(boosts(pokemon)[stat]);
  const ability = normalizeBattleId(pokemon.source.ability);
  const item = normalizeBattleId(pokemon.source.item);
  const status = normalizedStatus(pokemon.source.status);
  if (stat === 'atk') {
    if (ability === 'hugepower' || ability === 'purepower') value *= 2;
    if (ability === 'guts' && status) value *= 1.5;
    if (item === 'choiceband') value *= 1.5;
  }
  if (stat === 'spa' && item === 'choicespecs') value *= 1.5;
  if (stat === 'def') {
    if (ability === 'furcoat') value *= 2;
    if (item === 'eviolite' && pokemon.species.nfe) value *= 1.5;
  }
  if (stat === 'spd') {
    if (ability === 'icescales') value *= 2;
    if (item === 'assaultvest') value *= 1.5;
    if (item === 'eviolite' && pokemon.species.nfe) value *= 1.5;
  }
  if (stat === 'spe') {
    if (item === 'choicescarf') value *= 1.5;
    if (status === 'par') value *= 0.5;
  }
  return Math.max(1, Math.floor(value));
}

function currentHp(pokemon: ResolvedPokemon): number {
  if (pokemon.source.hp.exact && pokemon.source.hp.current !== null) return pokemon.source.hp.current;
  return Math.max(1, Math.ceil(pokemon.stats.hp * pokemon.source.hp.percent / 100));
}

function typeImmunity(move: MoveSummary, attacker: ResolvedPokemon, defender: ResolvedPokemon): string | null {
  const attackerAbility = normalizeBattleId(attacker.source.ability);
  if (['moldbreaker', 'teravolt', 'turboblaze'].includes(attackerAbility)) return null;
  const ability = normalizeBattleId(defender.source.ability);
  const item = normalizeBattleId(defender.source.item);
  const type = move.type.toLowerCase();
  if (type === 'ground' && (ability === 'levitate' || item === 'airballoon')) return ability || item;
  if (type === 'fire' && ability === 'flashfire') return ability;
  if (type === 'water' && ['waterabsorb', 'stormdrain', 'dryskin'].includes(ability)) return ability;
  if (type === 'electric' && ['voltabsorb', 'lightningrod', 'motordrive'].includes(ability)) return ability;
  if (type === 'grass' && ability === 'sapsipper') return ability;
  return null;
}

function hitChance(move: MoveSummary, attacker: ResolvedPokemon, defender: ResolvedPokemon): number {
  if (move.accuracy === true) return 100;
  let chance = move.accuracy
    * accuracyStageMultiplier(boosts(attacker).accuracy)
    / accuracyStageMultiplier(boosts(defender).evasion);
  if (normalizeBattleId(attacker.source.item) === 'widelens') chance *= 1.1;
  return clamp(chance, 0, 100);
}

function stab(move: MoveSummary, attacker: ResolvedPokemon): number {
  const base = attacker.species.types.some((type) => type.toLowerCase() === move.type.toLowerCase());
  const tera = attacker.source.teraActive && attacker.source.teraType?.toLowerCase() === move.type.toLowerCase();
  if (!base && !tera) return 1;
  if (normalizeBattleId(attacker.source.ability) === 'adaptability') return tera && base ? 2.25 : 2;
  return tera && base ? 2 : 1.5;
}

function fieldMultiplier(state: BattleState, move: MoveSummary, attacker: ResolvedPokemon, defender: ResolvedPokemon): number {
  let value = 1;
  const weather = state.weather?.id ?? '';
  if (weather === 'raindance') value *= move.type === 'Water' ? 1.5 : move.type === 'Fire' ? 0.5 : 1;
  if (weather === 'sunnyday') value *= move.type === 'Fire' ? 1.5 : move.type === 'Water' ? 0.5 : 1;
  const terrain = state.terrain?.id ?? '';
  if (terrain === 'electricterrain' && grounded(attacker) && move.type === 'Electric') value *= 1.3;
  if (terrain === 'grassyterrain' && grounded(attacker) && move.type === 'Grass') value *= 1.3;
  if (terrain === 'psychicterrain' && grounded(attacker) && move.type === 'Psychic') value *= 1.3;
  if (terrain === 'mistyterrain' && grounded(defender) && move.type === 'Dragon') value *= 0.5;
  return value;
}

function otherMultiplier(
  state: BattleState,
  move: MoveSummary,
  attacker: ResolvedPokemon,
  defender: ResolvedPokemon,
  typeMultiplier: number,
  spread: boolean,
): number {
  let value = fieldMultiplier(state, move, attacker, defender) * (spread ? 0.75 : 1);
  const item = normalizeBattleId(attacker.source.item);
  if (item === 'lifeorb') value *= 1.3;
  if (item === 'expertbelt' && typeMultiplier > 1) value *= 1.2;
  if (item === 'muscleband' && move.category === 'Physical') value *= 1.1;
  if (item === 'wiseglasses' && move.category === 'Special') value *= 1.1;
  if (move.category === 'Physical'
    && normalizedStatus(attacker.source.status) === 'brn'
    && normalizeBattleId(attacker.source.ability) !== 'guts') value *= 0.5;
  const side = defender.source.side;
  if (state.sides[side].conditions.auroraveil) value *= 2 / 3;
  if (move.category === 'Physical' && state.sides[side].conditions.reflect) value *= 2 / 3;
  if (move.category === 'Special' && state.sides[side].conditions.lightscreen) value *= 2 / 3;
  const ability = normalizeBattleId(defender.source.ability);
  if (['solidrock', 'filter', 'prismarmor'].includes(ability) && typeMultiplier > 1) value *= 0.75;
  if (ability === 'multiscale' && defender.source.hp.percent >= 99.9) value *= 0.5;
  if (ability === 'fluffy' && move.category === 'Physical') value *= move.type === 'Fire' ? 1 : 0.5;
  return value;
}

export function calculateDamage(
  state: BattleState,
  move: MoveSummary,
  attacker: ResolvedPokemon,
  defender: ResolvedPokemon,
  targetSlot: ActiveSlot | null,
  spread: boolean,
  adapter: ShowdownAdapter,
): DamagePreview {
  const assumptions: string[] = [];
  if (attacker.defaultStats) assumptions.push('攻撃側の実数値を標準値で補完');
  if (defender.defaultStats) assumptions.push('防御側の実数値を標準値で補完');
  const immunity = typeImmunity(move, attacker, defender);
  const typeMultiplier = immunity ? 0 : adapter.getTypeMultiplier(move.type, effectiveTypes(defender));
  const accuracy = hitChance(move, attacker, defender);
  if (immunity) assumptions.push(`${defender.source.ability ?? defender.source.item ?? immunity}で無効`);
  if (move.category === 'Status' || typeMultiplier === 0) {
    return {
      targetSlot,
      targetSpecies: defender.species.displayName,
      minDamage: 0,
      maxDamage: 0,
      minPercent: 0,
      maxPercent: 0,
      expectedPercent: 0,
      koChance: 0,
      hitChance: round1(accuracy),
      typeMultiplier,
      assumptions,
    };
  }
  const fixed = move.fixedDamage === 'level' ? attacker.source.level : move.fixedDamage;
  const hits = move.minHits && move.maxHits ? (move.minHits + move.maxHits) / 2 : 1;
  let baseDamage: number;
  if (typeof fixed === 'number') {
    baseDamage = fixed;
  } else {
    const attackStat = move.category === 'Physical' ? 'atk' : 'spa';
    const defenseStat = move.category === 'Physical' ? 'def' : 'spd';
    baseDamage = Math.floor(
      Math.floor(
        Math.floor((2 * attacker.source.level / 5 + 2) * move.basePower * modifiedStat(attacker, attackStat)
          / modifiedStat(defender, defenseStat)) / 50,
      ) + 2,
    );
  }
  const multiplier = stab(move, attacker)
    * typeMultiplier
    * otherMultiplier(state, move, attacker, defender, typeMultiplier, spread)
    * hits;
  const rolls = Array.from({ length: 16 }, (_, index) => Math.max(0, Math.floor(baseDamage * multiplier * (85 + index) / 100)));
  const hp = currentHp(defender);
  const minDamage = Math.min(...rolls);
  const maxDamage = Math.max(...rolls);
  const average = rolls.reduce((sum, damage) => sum + damage, 0) / rolls.length;
  const koRolls = rolls.filter((damage) => damage >= hp).length;
  return {
    targetSlot,
    targetSpecies: defender.species.displayName,
    minDamage,
    maxDamage,
    minPercent: round1(minDamage / defender.stats.hp * 100),
    maxPercent: round1(maxDamage / defender.stats.hp * 100),
    expectedPercent: round1(average / defender.stats.hp * 100 * accuracy / 100),
    koChance: round1(koRolls / rolls.length * accuracy),
    hitChance: round1(accuracy),
    typeMultiplier,
    assumptions,
  };
}

export function effectiveSpeed(state: BattleState, pokemon: ResolvedPokemon, slot: ActiveSlot): number {
  let speed = modifiedStat(pokemon, 'spe');
  if (state.sides[sideFromSlot(slot)].conditions.tailwind) speed *= 2;
  const ability = normalizeBattleId(pokemon.source.ability);
  const weather = state.weather?.id ?? '';
  if (ability === 'swiftswim' && weather === 'raindance') speed *= 2;
  if (ability === 'chlorophyll' && weather === 'sunnyday') speed *= 2;
  if (ability === 'sandrush' && weather === 'sandstorm') speed *= 2;
  if (ability === 'slushrush' && weather === 'snow') speed *= 2;
  return speed;
}

export function estimateOpponentRisk(
  state: BattleState,
  target: ResolvedPokemon,
  adapter: ShowdownAdapter,
): { risk: number; reasons: string[] } {
  let risk = 0;
  const reasons: string[] = [];
  for (const slot of activeSlots(state, oppositeSide(target.source.side))) {
    const attackerState = state.active[slot];
    if (!attackerState) continue;
    const attacker = resolvePokemon(attackerState, adapter);
    let best = 0;
    let bestMove = '';
    for (const moveName of knownMoves(attackerState)) {
      try {
        const move = adapter.getMove(moveName);
        if (move.category === 'Status') continue;
        const preview = calculateDamage(state, move, attacker, target, null, isSpreadMove(move), adapter);
        if (preview.expectedPercent > best) {
          best = preview.expectedPercent;
          bestMove = move.displayName;
        }
      } catch {
        // Unknown or invalid observed move.
      }
    }
    if (bestMove) reasons.push(`${attacker.species.displayName}の${bestMove}から平均${round1(best)}%を受ける想定`);
    risk += best;
  }
  return { risk, reasons };
}

export function benchCoverage(
  state: BattleState,
  attacker: ResolvedPokemon,
  move: MoveSummary,
  adapter: ShowdownAdapter,
): number {
  if (move.category === 'Status') return 0;
  const bench = state.sides[oppositeSide(attacker.source.side)].team
    .filter((member) => !member.fainted && member.activeSlot === null && member.species !== 'Unknown');
  if (bench.length === 0) return 0;
  let total = 0;
  for (const member of bench) {
    try {
      const defender = resolvePokemon(member, adapter);
      const multiplier = typeImmunity(move, attacker, defender)
        ? 0
        : adapter.getTypeMultiplier(move.type, effectiveTypes(defender));
      total += multiplier === 0 ? -8 : multiplier > 1 ? 12 : multiplier < 1 ? -3 : 5;
    } catch {
      // Incomplete opponent bench data.
    }
  }
  return clamp(total / bench.length, -8, 12);
}
