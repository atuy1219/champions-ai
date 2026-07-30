import assert from 'node:assert/strict';
import test from 'node:test';

import { BattleStateStore, createHpState } from './battle-state.js';
import { parseShowdownProtocol } from '../input/showdown-protocol.js';

test('manual and Showdown events update the same battle state', () => {
  const store = new BattleStateStore();
  store.apply({
    type: 'switch',
    slot: 'p1a',
    species: 'Garchomp',
    hp: createHpState(183, 183, 100, true),
    source: 'manual',
  });

  store.applyMany(parseShowdownProtocol([
    '|-boost|p1a: Garchomp|atk|2',
    '|-sidestart|p1: player|move: Tailwind',
    '|-weather|RainDance',
  ].join('\n')));

  const state = store.snapshot();
  assert.equal(state.active.p1a?.species, 'Garchomp');
  assert.equal(state.active.p1a?.boosts.atk, 2);
  assert.ok(state.sides.p1.conditions.tailwind);
  assert.equal(state.weather?.id, 'raindance');
});

test('opponent percentage HP is kept as inexact information', () => {
  const [event] = parseShowdownProtocol('|switch|p2a: Incineroar|Incineroar, L50, M|73/100 par');
  assert.equal(event?.type, 'switch');
  if (event?.type !== 'switch') return;
  assert.equal(event.hp?.percent, 73);
  assert.equal(event.hp?.exact, false);
  assert.equal(event.status, 'par');
});

test('boost stages are clamped to the legal range', () => {
  const store = new BattleStateStore();
  store.apply({ type: 'boost', slot: 'p1a', stat: 'spe', amount: 10 });
  assert.equal(store.snapshot().active.p1a?.boosts.spe, 6);
});
