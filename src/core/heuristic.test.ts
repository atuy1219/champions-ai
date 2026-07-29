import assert from 'node:assert/strict';
import test from 'node:test';

import { HeuristicAnalyzer } from './heuristic.js';
import type { AnalyzeRequest, MoveSummary, SpeciesSummary } from './types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

class FakeShowdownAdapter extends ShowdownAdapter {
  override getSpecies(name: string): SpeciesSummary {
    if (name === 'Garchomp') {
      return {
        id: 'garchomp',
        name,
        types: ['Dragon', 'Ground'],
        baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
      };
    }

    return {
      id: 'incineroar',
      name: 'Incineroar',
      types: ['Fire', 'Dark'],
      baseStats: { hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60 },
    };
  }

  override getMove(name: string): MoveSummary {
    const moves: Record<string, MoveSummary> = {
      Earthquake: {
        id: 'earthquake',
        name: 'Earthquake',
        type: 'Ground',
        category: 'Physical',
        basePower: 100,
        accuracy: 100,
        priority: 0,
        target: 'allAdjacent',
      },
      DragonClaw: {
        id: 'dragonclaw',
        name: 'Dragon Claw',
        type: 'Dragon',
        category: 'Physical',
        basePower: 80,
        accuracy: 100,
        priority: 0,
        target: 'normal',
      },
      Protect: {
        id: 'protect',
        name: 'Protect',
        type: 'Normal',
        category: 'Status',
        basePower: 0,
        accuracy: true,
        priority: 4,
        target: 'self',
      },
    };

    return moves[name] ?? moves.DragonClaw!;
  }

  override getTypeMultiplier(moveType: string): number {
    return moveType === 'Ground' ? 2 : 1;
  }
}

const baseRequest: AnalyzeRequest = {
  formatId: 'gen9championsvgc2026regma',
  attacker: {
    species: 'Garchomp',
    hpPercent: 100,
    moves: ['Earthquake', 'DragonClaw', 'Protect'],
  },
  defender: {
    species: 'Incineroar',
    hpPercent: 100,
    moves: [],
  },
  field: {
    weather: 'none',
    attackerSpeedStage: 0,
    defenderSpeedStage: 0,
    tailwind: 'none',
  },
};

test('weakness and STAB make Earthquake the top candidate', () => {
  const analyzer = new HeuristicAnalyzer(new FakeShowdownAdapter());
  const result = analyzer.analyze(baseRequest);

  assert.equal(result.candidates[0]?.move, 'Earthquake');
  assert.equal(result.candidates[0]?.typeMultiplier, 2);
  assert.match(result.candidates[0]?.reasons.join(' ') ?? '', /弱点/);
});

test('rejects an empty move list', () => {
  const analyzer = new HeuristicAnalyzer(new FakeShowdownAdapter());

  assert.throws(
    () =>
      analyzer.analyze({
        ...baseRequest,
        attacker: { ...baseRequest.attacker, moves: [] },
      }),
    /技を1つ以上/,
  );
});
