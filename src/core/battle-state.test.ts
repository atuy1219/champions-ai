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
  assert.equal(event.level, 50);
});

test('boost stages are clamped to the legal range', () => {
  const store = new BattleStateStore();
  store.apply({ type: 'boost', slot: 'p1a', stat: 'spe', amount: 10 });
  assert.equal(store.snapshot().active.p1a?.boosts.spe, 6);
});

test('team configuration follows the Pokémon into and out of an active slot', () => {
  const store = new BattleStateStore();
  store.apply({
    type: 'teamMember', side: 'p1', teamIndex: 1, species: 'Garchomp',
    moves: ['Earthquake', 'Protect'], item: 'Life Orb',
    stats: { hp: 183, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 },
    hp: createHpState(183, 183, 100, true),
  });
  store.apply({ type: 'switch', slot: 'p1a', teamIndex: 1, species: 'Garchomp' });
  store.apply({ type: 'hp', slot: 'p1a', hp: createHpState(90, 183, 49.2, true) });
  const state = store.snapshot();
  assert.deepEqual(state.active.p1a?.moves, ['Earthquake', 'Protect']);
  assert.equal(state.sides.p1.team[0]?.hp.current, 90);
});

test('timed conditions expire when their turn window ends', () => {
  const store = new BattleStateStore();
  store.apply({ type: 'turn', turn: 1 });
  store.apply({ type: 'sideCondition', action: 'start', side: 'p1', condition: 'おいかぜ' });
  assert.ok(store.snapshot().sides.p1.conditions.tailwind);
  store.apply({ type: 'turn', turn: 5 });
  assert.equal(store.snapshot().sides.p1.conditions.tailwind, undefined);
});

test('Showdown request JSON imports exact own stats and moves', () => {
  const request = {
    side: {
      id: 'p1',
      pokemon: [{
        ident: 'p1: Garchomp', details: 'Garchomp, L50, M', condition: '183/183', active: true,
        stats: { hp: 183, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 },
        moves: ['earthquake', 'protect'], item: 'lifeorb', ability: 'roughskin',
      }],
    },
  };
  const store = new BattleStateStore();
  store.applyMany(parseShowdownProtocol(`|request|${JSON.stringify(request)}`));
  const state = store.snapshot();
  assert.equal(state.active.p1a?.stats?.spe, 169);
  assert.deepEqual(state.active.p1a?.moves, ['earthquake', 'protect']);
});
