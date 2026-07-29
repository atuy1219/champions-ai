import { createRequire } from 'node:module';
import type * as PokemonShowdown from 'pokemon-showdown';

import { InputError } from '../core/errors.js';
import type { MoveSummary, SpeciesSummary } from '../core/types.js';

const require = createRequire(import.meta.url);
const { Dex, toID } = require('pokemon-showdown') as typeof PokemonShowdown;
const championsDex = Dex.mod('champions');

function normalizeAccuracy(value: number | true): number | true {
  return value === true ? true : Math.max(0, Math.min(100, value));
}

export class ShowdownAdapter {
  getSpecies(name: string): SpeciesSummary {
    const species = championsDex.species.get(name);

    if (!species.exists) {
      throw new InputError(`ポケモン「${name}」が見つかりません。`);
    }

    return {
      id: species.id,
      name: species.name,
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
    const move = championsDex.moves.get(name);

    if (!move.exists) {
      throw new InputError(`技「${name}」が見つかりません。`);
    }

    const summary: MoveSummary = {
      id: move.id,
      name: move.name,
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

  searchSpecies(query: string, limit = 12): string[] {
    const normalized = toID(query);
    if (!normalized) return [];

    return championsDex.species
      .all()
      .filter((species) => species.exists && toID(species.name).includes(normalized))
      .slice(0, limit)
      .map((species) => species.name);
  }

  searchMoves(query: string, limit = 12): string[] {
    const normalized = toID(query);
    if (!normalized) return [];

    return championsDex.moves
      .all()
      .filter((move) => move.exists && toID(move.name).includes(normalized))
      .slice(0, limit)
      .map((move) => move.name);
  }
}
