import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createHpState } from '../core/battle-state.js';
import { BattleSessionService } from './battle-session.js';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'champions-ai-session-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.json');
  const service = new BattleSessionService(file);
  await service.initialize();
  return { directory, file, service };
}

test('session persists events, decisions, and result across restart', async (t) => {
  const { file, service } = await fixture(t);
  await service.startNew({ title: 'Rank Battle 1', formatId: 'gen9championsvgc2026regma' });
  await service.applyMany([
    {
      type: 'teamMember', side: 'p1', teamIndex: 1, species: 'Garchomp',
      moves: ['Earthquake', 'Protect'], source: 'manual',
    },
    {
      type: 'switch', slot: 'p1a', teamIndex: 1, species: 'Garchomp',
      hp: createHpState(183, 183, 100, true), source: 'manual',
    },
  ]);
  const revision = service.stateSnapshot().revision;
  await service.recordDecision({
    evaluationRevision: revision,
    side: 'p1',
    kind: 'individual',
    actionId: 'p1a:move:earthquake:p2a',
    label: 'じしん → p2a',
    score: 72.5,
    actorSlots: ['p1a'],
  });
  await service.finish({ result: 'win', notes: 'test battle' });

  const restored = new BattleSessionService(file);
  const snapshot = await restored.initialize();
  assert.equal(snapshot.metadata.title, 'Rank Battle 1');
  assert.equal(snapshot.metadata.status, 'finished');
  assert.equal(snapshot.metadata.result, 'win');
  assert.equal(snapshot.state.active.p1a?.species, 'Garchomp');
  assert.deepEqual(snapshot.state.active.p1a?.moves, ['Earthquake', 'Protect']);
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.decisions[0]?.label, 'じしん → p2a');
});

test('undo rebuilds the state from the remaining event log', async (t) => {
  const { service } = await fixture(t);
  await service.applyMany([
    { type: 'switch', slot: 'p1a', species: 'Garchomp', source: 'manual' },
    { type: 'boost', slot: 'p1a', stat: 'atk', amount: 2, source: 'manual' },
    { type: 'turn', turn: 3, source: 'manual' },
  ]);

  const undone = await service.undo(2);
  assert.equal(undone.eventCount, 1);
  assert.equal(undone.state.turn, 0);
  assert.equal(undone.state.active.p1a?.boosts.atk, 0);
  assert.equal(undone.state.active.p1a?.species, 'Garchomp');
});

test('import replaces the current session and persists the imported event log', async (t) => {
  const { file, service } = await fixture(t);
  const exported = service.exportData();
  exported.metadata.title = 'Imported Battle';
  exported.events = [
    { type: 'switch', slot: 'p2a', species: 'Incineroar', source: 'showdown' },
    { type: 'status', slot: 'p2a', status: 'brn', source: 'manual' },
  ];

  const imported = await service.importData(exported);
  assert.equal(imported.metadata.title, 'Imported Battle');
  assert.equal(imported.state.active.p2a?.species, 'Incineroar');
  assert.equal(imported.state.active.p2a?.status, 'brn');

  const onDisk = JSON.parse(await readFile(file, 'utf8')) as { events: unknown[] };
  assert.equal(onDisk.events.length, 2);
});

test('corrupt session file is quarantined and replaced with a valid session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'champions-ai-corrupt-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.json');
  await writeFile(file, '{broken', 'utf8');

  const service = new BattleSessionService(file);
  const snapshot = await service.initialize();
  assert.equal(snapshot.eventCount, 0);
  assert.equal(snapshot.metadata.status, 'active');
  const replacement = JSON.parse(await readFile(file, 'utf8')) as { schemaVersion: number };
  assert.equal(replacement.schemaVersion, 1);
});
