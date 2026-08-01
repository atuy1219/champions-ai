import { createRequire } from 'node:module';
import type * as PokemonShowdown from 'pokemon-showdown';

import { InputError } from '../core/errors.js';
import type {
  LocalizedSearchResult,
  MoveSummary,
  SpeciesSummary,
} from '../core/types.js';
import {
  JAPANESE_MOVES_TO_ID,
  JAPANESE_SPECIES_TO_ID,
  MOVE_ID_TO_JAPANESE,
  SPECIES_ID_TO_JAPANESE,
} from '../data/ja-names.generated.js';

const require = createRequire(import.meta.url);
const { Dex, toID } = require('pokemon-showdown') as typeof PokemonShowdown;
const championsDex = Dex.mod('champions');

const FORME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Mega: 'メガ',
  'Mega-X': 'メガX',
  'Mega-Y': 'メガY',
  Alola: 'アローラ',
  Galar: 'ガラル',
  Hisui: 'ヒスイ',
  Paldea: 'パルデア',
  Therian: 'れいじゅう',
  Incarnate: 'けしん',
  Origin: 'オリジン',
  School: 'むれたすがた',
  Crowned: 'けんのおう',
});

function normalizeLocalizedName(value: string): string {
  return value.normalize('NFKC').trim().replace(/[\s・･_-]+/g, '').toLowerCase();
}

function normalizeAccuracy(value: number | true): number | true {
  return value === true ? true : Math.max(0, Math.min(100, value));
}

function resolveLocalized(value: string, aliases: Readonly<Record<string, string>>): string {
  return aliases[normalizeLocalizedName(value)] ?? value;
}

function localizedSpeciesName(species: {
  id: string;
  name: string;
  baseSpecies: string;
  forme?: string;
}): string {
  const direct = SPECIES_ID_TO_JAPANESE[species.id];
  if (direct) return direct;
  const base = SPECIES_ID_TO_JAPANESE[toID(species.baseSpecies)];
  if (!base) return species.name;
  if (!species.forme) return base;
  return `${base}（${FORME_LABELS[species.forme] ?? species.forme}）`;
}

function includesLocalized(haystack: string, query: string): boolean {
  return normalizeLocalizedName(haystack).includes(normalizeLocalizedName(query));
}

function tuplePair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  return [first, second];
}

export class ShowdownAdapter {
  toId(value: string): string {
    return toID(value);
  }

  getSpecies(name: string): SpeciesSummary {
    const resolved = resolveLocalized(name, JAPANESE_SPECIES_TO_ID);
    const species = championsDex.species.get(resolved);
    if (!species.exists) throw new InputError(`ポケモン「${name}」が見つかりません。`);
    return {
      id: species.id,
      name: species.name,
      displayName: localizedSpeciesName(species),
      types: [...species.types],
      baseStats: {
        hp: species.baseStats.hp,
        atk: species.baseStats.atk,
        def: species.baseStats.def,
        spa: species.baseStats.spa,
        spd: species.baseStats.spd,
        spe: species.baseStats.spe,
      },
      nfe: Boolean((species as unknown as { nfe?: boolean }).nfe),
    };
  }

  getMove(name: string): MoveSummary {
    const resolved = resolveLocalized(name, JAPANESE_MOVES_TO_ID);
    const move = championsDex.moves.get(resolved);
    if (!move.exists) throw new InputError(`技「${name}」が見つかりません。`);
    const raw = move as unknown as Record<string, unknown>;
    const summary: MoveSummary = {
      id: move.id,
      name: move.name,
      displayName: MOVE_ID_TO_JAPANESE[move.id] ?? move.name,
      type: move.type,
      category: move.category,
      basePower: move.basePower,
      accuracy: normalizeAccuracy(move.accuracy),
      priority: move.priority,
      target: move.target,
    };
    if (move.boosts) summary.boosts = { ...move.boosts };
    if (move.selfBoost?.boosts) summary.selfBoost = { boosts: { ...move.selfBoost.boosts } };
    if (typeof raw.status === 'string') summary.status = raw.status;
    if (typeof raw.volatileStatus === 'string') summary.volatileStatus = raw.volatileStatus;
    if (typeof raw.sideCondition === 'string') summary.sideCondition = raw.sideCondition;
    if (typeof raw.weather === 'string') summary.weather = raw.weather;
    if (typeof raw.terrain === 'string') summary.terrain = raw.terrain;
    if (typeof raw.pseudoWeather === 'string') summary.pseudoWeather = raw.pseudoWeather;
    if (typeof raw.selfSwitch === 'string' || typeof raw.selfSwitch === 'boolean') summary.selfSwitch = raw.selfSwitch;
    if (typeof raw.forceSwitch === 'boolean') summary.forceSwitch = raw.forceSwitch;
    const drain = tuplePair(raw.drain);
    if (drain) summary.drain = drain;
    const recoil = tuplePair(raw.recoil);
    if (recoil) summary.recoil = recoil;
    if (Array.isArray(raw.multihit)) {
      const min = Number(raw.multihit[0]);
      const max = Number(raw.multihit[1]);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        summary.minHits = min;
        summary.maxHits = max;
      }
    } else if (typeof raw.multihit === 'number') {
      summary.minHits = raw.multihit;
      summary.maxHits = raw.multihit;
    }
    if (typeof raw.damage === 'number') summary.fixedDamage = raw.damage;
    if (raw.damage === 'level') summary.fixedDamage = 'level';
    if (typeof raw.critRatio === 'number') summary.critRatio = raw.critRatio;
    return summary;
  }

  getTypeMultiplier(moveType: string, targetTypes: string[]): number {
    if (!championsDex.getImmunity(moveType, targetTypes)) return 0;
    return 2 ** championsDex.getEffectiveness(moveType, targetTypes);
  }

  searchSpecies(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toID(query);
    return championsDex.species.all().filter((species: any) => {
      if (!species.exists) return false;
      const displayName = localizedSpeciesName(species);
      return (normalizedEnglish && toID(species.name).includes(normalizedEnglish)) || includesLocalized(displayName, query);
    }).slice(0, limit).map((species: any) => {
      const displayName = localizedSpeciesName(species);
      return { value: displayName, displayName, englishName: species.name };
    });
  }

  searchMoves(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toID(query);
    return championsDex.moves.all().filter((move: any) => {
      if (!move.exists) return false;
      const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
      return (normalizedEnglish && toID(move.name).includes(normalizedEnglish)) || includesLocalized(displayName, query);
    }).slice(0, limit).map((move: any) => {
      const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
      return { value: displayName, displayName, englishName: move.name };
    });
  }
}
