import assert from 'node:assert/strict';
import test from 'node:test';

import { BattleStateStore, createHpState } from './battle-state.js';
import { CurrentBattleEvaluator } from './current-evaluator.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

function configuredStore(): BattleStateStore {
  const store = new BattleStateStore();
  store.applyMany([
    {
      type: 'teamMember', side: 'p1', teamIndex: 1, species: 'Garchomp', level: 50,
      moves: ['Earthquake', 'Dragon Claw', 'Protect', 'Swords Dance'],
      item: 'Life Orb', ability: 'Rough Skin',
      stats: { hp: 183, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 },
      hp: createHpState(183, 183, 100, true),
    },
    {
      type: 'teamMember', side: 'p1', teamIndex: 2, species: 'Amoonguss', level: 50,
      moves: ['Spore', 'Rage Powder', 'Pollen Puff', 'Protect'],
      item: 'Rocky Helmet', ability: 'Regenerator',
      stats: { hp: 221, atk: 81, def: 134, spa: 105, spd: 101, spe: 31 },
      hp: createHpState(221, 221, 100, true),
    },
    {
      type: 'teamMember', side: 'p1', teamIndex: 3, species: 'Flutter Mane', level: 50,
      moves: ['Moonblast', 'Shadow Ball', 'Icy Wind', 'Protect'],
      item: 'Booster Energy', ability: 'Protosynthesis',
      stats: { hp: 131, atk: 67, def: 75, spa: 187, spd: 155, spe: 205 },
      hp: createHpState(131, 131, 100, true),
    },
    {
      type: 'teamMember', side: 'p2', teamIndex: 1, species: 'Incineroar', level: 50,
      moves: ['Flare Blitz', 'Knock Off', 'Fake Out', 'Parting Shot'],
      item: 'Safety Goggles', ability: 'Intimidate',
      stats: { hp: 202, atk: 135, def: 110, spa: 90, spd: 121, spe: 80 },
      hp: createHpState(null, null, 100, false),
    },
    {
      type: 'teamMember', side: 'p2', teamIndex: 2, species: 'Rillaboom', level: 50,
      moves: ['Grassy Glide', 'Wood Hammer', 'Fake Out', 'U-turn'],
      item: 'Assault Vest', ability: 'Grassy Surge',
      stats: { hp: 207, atk: 194, def: 110, spa: 72, spd: 122, spe: 106 },
      hp: createHpState(null, null, 100, false),
    },
    { type: 'switch', slot: 'p1a', teamIndex: 1, species: 'Garchomp', hp: createHpState(183, 183, 100, true) },
    { type: 'switch', slot: 'p1b', teamIndex: 2, species: 'Amoonguss', hp: createHpState(221, 221, 100, true) },
    { type: 'switch', slot: 'p2a', teamIndex: 1, species: 'Incineroar', hp: createHpState(null, null, 100, false) },
    { type: 'switch', slot: 'p2b', teamIndex: 2, species: 'Rillaboom', hp: createHpState(null, null, 100, false) },
  ]);
  return store;
}

test('current evaluator generates move targets, switch actions and joint actions', () => {
  const evaluator = new CurrentBattleEvaluator(new ShowdownAdapter());
  const response = evaluator.evaluate(configuredStore().snapshot(), { side: 'p1' });
  const garchomp = response.pokemon.find((entry) => entry.slot === 'p1a');
  if (!garchomp) throw new Error('Garchomp evaluation is missing');
  assert.ok(garchomp.actions.some((action) => action.englishMove === 'Earthquake'));
  assert.ok(garchomp.actions.some((action) => action.kind === 'switch' && action.switchToTeamIndex === 3));
  assert.ok(response.jointActions.length > 0);
});

test('damage previews contain a bounded range and opponent-response risk', () => {
  const evaluator = new CurrentBattleEvaluator(new ShowdownAdapter());
  const response = evaluator.evaluate(configuredStore().snapshot());
  const damaging = response.pokemon
    .flatMap((entry) => entry.actions)
    .find((action) => action.damage.length > 0);
  if (!damaging) throw new Error('Damaging action is missing');
  const preview = damaging.damage[0];
  if (!preview) throw new Error('Damage preview is missing');
  assert.ok(preview.minDamage >= 0);
  assert.ok(preview.maxDamage >= preview.minDamage);
  assert.ok(preview.hitChance >= 0 && preview.hitChance <= 100);
  assert.ok(damaging.score.opponentResponseRisk >= 0);
});

test('unknown active opponent moves add explicit uncertainty risk', () => {
  const store = configuredStore();
  store.applyMany([
    { type: 'teamMember', side: 'p2', teamIndex: 1, species: 'Incineroar', moves: [] },
    { type: 'teamMember', side: 'p2', teamIndex: 2, species: 'Rillaboom', moves: [] },
  ]);
  const response = new CurrentBattleEvaluator(new ShowdownAdapter()).evaluate(store.snapshot());
  const action = response.pokemon[0]?.actions[0];
  if (!action) throw new Error('Action is missing');
  assert.ok(action.score.opponentResponseRisk >= 44);
  assert.ok(response.warnings.some((warning) => warning.includes('未知攻撃リスク')));
  assert.equal(response.engine.model, 'gen9-explainable-risk-v1');
});
