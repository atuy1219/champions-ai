import {
  createHpState,
  normalizeConditionId,
  type ActiveSlot,
  type BattleEvent,
  type BattleStats,
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

function parseDetails(value: string): { species: string; level: number; teraType: string | null } {
  const parts = value.split(',').map((part) => part.trim());
  const species = parts[0] || 'Unknown';
  const levelPart = parts.find((part) => /^L\d+$/i.test(part));
  const teraPart = parts.find((part) => /^tera:/i.test(part));
  return {
    species,
    level: levelPart ? Number(levelPart.slice(1)) : 50,
    teraType: teraPart ? teraPart.replace(/^tera:/i, '').trim() || null : null,
  };
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

function statsFromRequest(value: unknown, hp: number | null): BattleStats | null {
  if (!value || typeof value !== 'object') return null;
  const stats = value as Record<string, unknown>;
  const keys = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
  if (hp === null || !keys.every((key) => typeof stats[key] === 'number' && Number.isFinite(stats[key]))) return null;
  return {
    hp,
    atk: stats.atk as number,
    def: stats.def as number,
    spa: stats.spa as number,
    spd: stats.spd as number,
    spe: stats.spe as number,
  };
}

function parseRequestJson(jsonText: string): BattleEvent[] {
  try {
    const request = JSON.parse(jsonText) as Record<string, unknown>;
    const side = request.side as Record<string, unknown> | undefined;
    const sideId = side?.id === 'p1' || side?.id === 'p2' ? side.id : null;
    const pokemon = Array.isArray(side?.pokemon) ? side.pokemon : [];
    if (!sideId) return [];
    const events: BattleEvent[] = [];
    let activeIndex = 0;
    for (let index = 0; index < pokemon.length; index += 1) {
      const entry = pokemon[index];
      if (!entry || typeof entry !== 'object') continue;
      const data = entry as Record<string, unknown>;
      const details = parseDetails(typeof data.details === 'string' ? data.details : 'Unknown');
      const parsed = parseHpStatus(typeof data.condition === 'string' ? data.condition : '100/100');
      const stats = statsFromRequest(data.stats, parsed.hp.max);
      const moves = Array.isArray(data.moves) ? data.moves.filter((move): move is string => typeof move === 'string') : [];
      events.push({
        type: 'teamMember',
        side: sideId,
        teamIndex: index + 1,
        species: details.species,
        level: details.level,
        hp: parsed.hp,
        status: parsed.status,
        item: typeof data.item === 'string' ? data.item || null : null,
        ability: typeof data.ability === 'string'
          ? data.ability || null
          : typeof data.baseAbility === 'string'
            ? data.baseAbility || null
            : null,
        teraType: typeof data.teraType === 'string' ? data.teraType : details.teraType,
        moves,
        ...(stats ? { stats } : {}),
        source: 'showdown',
      });
      if (data.active === true && activeIndex < 2) {
        const slot = `${sideId}${activeIndex === 0 ? 'a' : 'b'}` as ActiveSlot;
        events.push({
          type: 'switch',
          slot,
          teamIndex: index + 1,
          species: details.species,
          level: details.level,
          hp: parsed.hp,
          status: parsed.status,
          item: typeof data.item === 'string' ? data.item || null : null,
          ability: typeof data.ability === 'string'
            ? data.ability || null
            : typeof data.baseAbility === 'string'
              ? data.baseAbility || null
              : null,
          teraType: typeof data.teraType === 'string' ? data.teraType : details.teraType,
          moves,
          ...(stats ? { stats } : {}),
          source: 'showdown',
        });
        activeIndex += 1;
      }
    }
    return events;
  } catch {
    return [];
  }
}

export function parseShowdownProtocol(text: string): BattleEvent[] {
  const events: BattleEvent[] = [];
  const teamPreviewIndexes: Record<SideId, number> = { p1: 0, p2: 0 };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const parts = line.slice(1).split('|');
    const command = parts[0] ?? '';

    switch (command) {
      case 'request':
        events.push(...parseRequestJson(parts.slice(1).join('|')));
        break;
      case 'turn': {
        const turn = Number(parts[1]);
        if (Number.isFinite(turn)) events.push({ type: 'turn', turn, source: 'showdown' });
        break;
      }
      case 'poke': {
        const side = sideFromValue(parts[1] ?? '');
        if (!side) break;
        const details = parseDetails(parts[2] ?? 'Unknown');
        teamPreviewIndexes[side] += 1;
        events.push({
          type: 'teamMember',
          side,
          teamIndex: teamPreviewIndexes[side],
          species: details.species,
          level: details.level,
          teraType: details.teraType,
          source: 'showdown',
        });
        break;
      }
      case 'switch':
      case 'drag': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        const details = parseDetails(parts[2] ?? 'Unknown');
        const parsed = parseHpStatus(parts[3] ?? '');
        events.push({
          type: 'switch',
          slot,
          species: details.species,
          level: details.level,
          teraType: details.teraType,
          hp: parsed.hp,
          status: parsed.status,
          source: 'showdown',
        });
        break;
      }
      case 'detailschange':
      case '-formechange': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        const details = parseDetails(parts[2] ?? 'Unknown');
        const parsed = parseHpStatus(parts[3] ?? '');
        events.push({
          type: 'pokemonInfo',
          slot,
          species: details.species,
          level: details.level,
          teraType: details.teraType,
          source: 'showdown',
        });
        if (parts[3]) events.push({ type: 'hp', slot, hp: parsed.hp, source: 'showdown' });
        if (parts[3] && parsed.status) events.push({ type: 'status', slot, status: parsed.status, source: 'showdown' });
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
      case '-item':
      case '-enditem': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        events.push({
          type: 'pokemonInfo',
          slot,
          item: command === '-item' ? parts[2] || null : null,
          source: 'showdown',
        });
        break;
      }
      case '-ability':
      case '-endability': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        events.push({
          type: 'pokemonInfo',
          slot,
          ability: command === '-ability' ? parts[2] || null : null,
          source: 'showdown',
        });
        break;
      }
      case '-terastallize': {
        const slot = activeSlotFromPokemon(parts[1] ?? '');
        if (!slot) break;
        events.push({
          type: 'pokemonInfo',
          slot,
          teraType: parts[2] || null,
          teraActive: true,
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
