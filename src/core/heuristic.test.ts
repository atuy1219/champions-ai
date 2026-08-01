import assert from 'node:assert/strict';
import test from 'node:test';

import { HeuristicAnalyzer } from './heuristic.js';
import type { AnalyzeRequest, MoveSummary, SpeciesSummary, StatStages } from './types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

const neutralStages: StatStages = {
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
  accuracy: 0,
  evasion: 0,
};

class FakeShowdownAdapter extends ShowdownAdapter {
  override getSpecies(name: string): SpeciesSummary {
    if (name === 'ガブリアス' || name === 'Garchomp') {
      return {
        id: 'garchomp',
        name: 'Garchomp',
        displayName: 'ガブリアス',
        types: ['Dragon', 'Ground'],
        baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
      };
    }

    return {
      id: 'incineroar',
      name: 'Incineroar',
      displayName: 'ガオガエン',
      types: ['Fire', 'Dark'],
      baseStats: { hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60 },
    };
  }

  override getMove(name: string): MoveSummary {
    const moves: Record<string, MoveSummary> = {
      'じしん': {
        id: 'earthquake',
        name: 'Earthquake',
        displayName: 'じしん',
        type: 'Ground',
        category: 'Physical',
        basePower: 100,
        accuracy: 100,
        priority: 0,
        target: 'allAdjacent',
      },
      'ドラゴンクロー': {
        id: 'dragonclaw',
        name: 'Dragon Claw',
        displayName: 'ドラゴンクロー',
        type: 'Dragon',
        category: 'Physical',
        basePower: 80,
        accuracy: 100,
        priority: 0,
        target: 'normal',
      },
      'まもる': {
        id: 'protect',
        name: 'Protect',
        displayName: 'まもる',
        type: 'Normal',
        category: 'Status',
        basePower: 0,
        accuracy: true,
        priority: 4,
        target: 'self',
      },
    };

    return moves[name] ?? moves['ドラゴンクロー']!;
  }

  override getTypeMultiplier(moveType: string): number {
    return moveType === 'Ground' ? 2 : 1;
  }
}

const baseRequest: AnalyzeRequest = {
  formatId: 'gen9championsvgc2026regma',
  attacker: {
    species: 'ガブリアス',
    currentHp: 91,
    maxHp: 183,
    hpPercent: 0,
    status: 'none',
    stages: { ...neutralStages },
    moves: ['じしん', 'ドラゴンクロー', 'まもる'],
  },
  defender: {
    species: 'ガオガエン',
    hpPercent: 100,
    status: 'none',
    stages: { ...neutralStages },
    moves: [],
  },
  field: {
    weather: 'none',
    terrain: 'none',
    trickRoom: false,
    attackerSide: {
      tailwind: false,
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
    },
    defenderSide: {
      tailwind: false,
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
    },
  },
};

test('Japanese input is returned with English reference names', () => {
  const analyzer = new HeuristicAnalyzer(new FakeShowdownAdapter());
  const result = analyzer.analyze(baseRequest);

  assert.equal(result.candidates[0]?.move, 'じしん');
  assert.equal(result.candidates[0]?.englishMove, 'Earthquake');
  assert.equal(result.attacker.species, 'ガブリアス');
  assert.equal(result.attacker.englishSpecies, 'Garchomp');
});

test('exact HP values take precedence over the supplied percentage', () => {
  const analyzer = new HeuristicAnalyzer(new FakeShowdownAdapter());
  const result = analyzer.analyze(baseRequest);

  assert.equal(result.attacker.hp.current, 91);
  assert.equal(result.attacker.hp.max, 183);
  assert.equal(result.attacker.hp.percent, 49.7);
});

test('attack and defensive side conditions affect the score', () => {
  const analyzer = new HeuristicAnalyzer(new FakeShowdownAdapter());
  const neutral = analyzer.analyze(baseRequest).candidates.find((candidate) => candidate.englishMove === 'Earthquake')!;
  const changed = analyzer.analyze({
    ...baseRequest,
    attacker: {
      ...baseRequest.attacker,
      stages: { ...baseRequest.attacker.stages, atk: 2 },
    },
    field: {
      ...baseRequest.field,
      defenderSide: { ...baseRequest.field.defenderSide, reflect: true },
    },
  }).candidates.find((candidate) => candidate.englishMove === 'Earthquake')!;

  assert.notEqual(changed.score, neutral.score);
  assert.match(changed.reasons.join(' '), /攻撃ランク/);
  assert.match(changed.reasons.join(' '), /壁/);
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
