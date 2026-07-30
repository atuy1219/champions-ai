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

function resolveLocalized(
  value: string,
  aliases: Readonly<Record<string, string>>,
): string {
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

export class ShowdownAdapter {
  getSpecies(name: string): SpeciesSummary {
    const resolved = resolveLocalized(name, JAPANESE_SPECIES_TO_ID);
    const species = championsDex.species.get(resolved);

    if (!species.exists) {
      throw new InputError(`ポケモン「${name}」が見つかりません。`);
    }

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
    };
  }

  getMove(name: string): MoveSummary {
    const resolved = resolveLocalized(name, JAPANESE_MOVES_TO_ID);
    const move = championsDex.moves.get(resolved);

    if (!move.exists) {
      throw new InputError(`技「${name}」が見つかりません。`);
    }

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

    if (move.boosts) {
      summary.boosts = { ...move.boosts };
    }
    if (move.selfBoost?.boosts) {
      summary.selfBoost = { boosts: { ...move.selfBoost.boosts } };
    }

    return summary;
  }

  getTypeMultiplier(moveType: string, targetTypes: string[]): number {
    if (!championsDex.getImmunity(moveType, targetTypes)) {
      return 0;
    }

    return 2 ** championsDex.getEffectiveness(moveType, targetTypes);
  }

  searchSpecies(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toID(query);

    return championsDex.species
      .all()
      .filter((species) => {
        if (!species.exists) return false;
        const displayName = localizedSpeciesName(species);
        return (
          (normalizedEnglish && toID(species.name).includes(normalizedEnglish)) ||
          includesLocalized(displayName, query)
        );
      })
      .slice(0, limit)
      .map((species) => {
        const displayName = localizedSpeciesName(species);
        return {
          value: displayName,
          displayName,
          englishName: species.name,
        };
      });
  }

  searchMoves(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toID(query);

    return championsDex.moves
      .all()
      .filter((move) => {
        if (!move.exists) return false;
        const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
        return (
          (normalizedEnglish && toID(move.name).includes(normalizedEnglish)) ||
          includesLocalized(displayName, query)
        );
      })
      .slice(0, limit)
      .map((move) => {
        const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
        return {
          value: displayName,
          displayName,
          englishName: move.name,
        };
      });
  }
}
