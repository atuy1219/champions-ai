import {
  createHpState,
  normalizeConditionId,
  type ActiveSlot,
  type BattleEvent,
  type BoostStat,
  type SideId,
} from '../core/battle-state.js';

function activeSlotFromPokemon(value: string): ActiveSlot | null {
  const match = value.trim().match(/^(p[12][ab]):/);
  return match?.[1] as ActiveSlot | undefined ?? null;
}

function sideFromValue(value: string): SideId | null {
  const match = value.trim().match(/^(p[12])/);
  return match?.[1] as SideId | undefined ?? null;
}

function parseHpStatus(value: string) {
  const [hpToken = '', statusToken = ''] = value.trim().split(/\s+/, 2);
  const match = hpToken.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return { hp: createHpState(null, null, 100, false), status: statusToken || null };
  const current = Number(match[1]);
  const max = Number(match[2]);
  const percent = max > 0 ? current / max * 100 : 0;
  const exact = max !== 100 && max !== 48;
  return {
    hp: createHpState(exact ? current : null, exact ? max : null, percent, exact),
    status: statusToken && statusToken !== 'fnt' ? statusToken : null,
  };
}

function displayCondition(value: string): string {
  return value.replace(/^(move|ability|item):\s*/i, '').trim();
}

function terrainId(condition: string): string | null {
  const id = normalizeConditionId(condition);
  if (id.endsWith('terrain')) return id;
  return null;
}

export function parseShowdownProtocol(text: string): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const parts = line.slice(1).split('|');
    const command = parts[0] ?? '';

    switch (command) {
      case 'turn': {
        const turn = Number(parts[1]);
        if (Number.isFinite(turn)) events.push({ type: 'turn', turn, source: 'showdown' });
        break;
      }
      case 'switch':
      case 'drag': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        const species = (parts[2] ?? 'Unknown').split(',')[0]?.trim() || 'Unknown';
        const parsed = parseHpStatus(parts[3] ?? '');
        events.push({
          type: 'switch',
          slot,
          species,
          hp: parsed.hp,
          status: parsed.status,
          source: 'showdown',
        });
        break;
      }
      case '-damage':
      case '-heal':
      case '-sethp': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        events.push({ type: 'hp', slot, hp: parseHpStatus(parts[2] ?? '').hp, source: 'showdown' });
        break;
      }
      case '-status':
      case '-curestatus': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        events.push({
          type: 'status',
          slot,
          status: command === '-status' ? parts[2] || null : null,
          source: 'showdown',
        });
        break;
      }
      case '-boost':
      case '-unboost':
      case '-setboost': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        const stat = parts[2] as BoostStat | undefined;
        const amount = Number(parts[3]);
        if (!slot || !stat || !Number.isFinite(amount)) break;
        events.push({
          type: 'boost',
          slot,
          stat,
          amount: command === '-unboost' ? -amount : amount,
          mode: command === '-setboost' ? 'set' : 'add',
          source: 'showdown',
        });
        break;
      }
      case '-clearboost': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (slot) events.push({ type: 'clearBoosts', slot, source: 'showdown' });
        break;
      }
      case '-clearallboost':
        events.push({ type: 'clearBoosts', source: 'showdown' });
        break;
      case '-weather': {
        const condition = parts[1] ?? 'none';
        events.push({
          type: 'weather',
          condition: condition === 'none' ? null : condition,
          displayName: displayCondition(condition),
          source: 'showdown',
        });
        break;
      }
      case '-fieldstart':
      case '-fieldend': {
        const condition = parts[1] ?? '';
        const terrain = terrainId(condition);
        const action = command === '-fieldstart' ? 'start' : 'end';
        if (terrain) {
          events.push({
            type: 'terrain',
            condition: action === 'start' ? terrain : null,
            displayName: displayCondition(condition),
            source: 'showdown',
          });
        } else if (condition) {
          events.push({
            type: 'fieldCondition',
            action,
            condition,
            displayName: displayCondition(condition),
            source: 'showdown',
          });
        }
        break;
      }
      case '-sidestart':
      case '-sideend': {
        const side = sideFromValue(parts[1] ?? '');
        const condition = parts[2] ?? '';
        if (!side || !condition) break;
        events.push({
          type: 'sideCondition',
          action: command === '-sidestart' ? 'start' : 'end',
          side,
          condition,
          displayName: displayCondition(condition),
          source: 'showdown',
        });
        break;
      }
      case '-start':
      case '-end': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        const condition = parts[2] ?? '';
        if (!slot || !condition) break;
        events.push({
          type: 'volatile',
          action: command === '-start' ? 'start' : 'end',
          slot,
          condition,
          displayName: displayCondition(condition),
          source: 'showdown',
        });
        break;
      }
      case 'move': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        const move = parts[2]?.trim();
        const target = activeSlotFromPokemon(parts[3] ?? '') ?? undefined;
        if (!slot || !move) break;
        events.push({ type: 'move', slot, move, ...(target ? { target } : {}), source: 'showdown' });
        break;
      }
      case 'faint': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (slot) events.push({ type: 'faint', slot, source: 'showdown' });
        break;
      }
    }
  }
  return events;
}
