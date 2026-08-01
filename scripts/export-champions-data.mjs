import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Dex } = require('pokemon-showdown');

function tuplePair(value) {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  return [first, second];
}

function exportMove(move) {
  const raw = move;
  const result = {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    basePower: move.basePower,
    accuracy: move.accuracy,
    priority: move.priority,
    target: move.target,
  };
  if (move.boosts) result.boosts = { ...move.boosts };
  if (move.selfBoost?.boosts) result.selfBoost = { boosts: { ...move.selfBoost.boosts } };
  for (const key of ['status', 'volatileStatus', 'sideCondition', 'weather', 'terrain', 'pseudoWeather']) {
    if (typeof raw[key] === 'string') result[key] = raw[key];
  }
  if (typeof raw.selfSwitch === 'string' || typeof raw.selfSwitch === 'boolean') result.selfSwitch = raw.selfSwitch;
  if (typeof raw.forceSwitch === 'boolean') result.forceSwitch = raw.forceSwitch;
  const drain = tuplePair(raw.drain);
  if (drain) result.drain = drain;
  const recoil = tuplePair(raw.recoil);
  if (recoil) result.recoil = recoil;
  if (Array.isArray(raw.multihit)) {
    result.minHits = Number(raw.multihit[0]);
    result.maxHits = Number(raw.multihit[1]);
  } else if (typeof raw.multihit === 'number') {
    result.minHits = raw.multihit;
    result.maxHits = raw.multihit;
  }
  if (typeof raw.damage === 'number' || raw.damage === 'level') result.fixedDamage = raw.damage;
  if (typeof raw.critRatio === 'number') result.critRatio = raw.critRatio;
  return result;
}

export async function exportChampionsData(outputPath) {
  const championsDex = Dex.mod('champions');
  const species = {};
  for (const entry of championsDex.species.all()) {
    if (!entry.exists) continue;
    species[entry.id] = {
      id: entry.id,
      name: entry.name,
      baseSpecies: entry.baseSpecies,
      ...(entry.forme ? { forme: entry.forme } : {}),
      types: [...entry.types],
      baseStats: {
        hp: entry.baseStats.hp,
        atk: entry.baseStats.atk,
        def: entry.baseStats.def,
        spa: entry.baseStats.spa,
        spd: entry.baseStats.spd,
        spe: entry.baseStats.spe,
      },
      ...(entry.nfe ? { nfe: true } : {}),
    };
  }

  const moves = {};
  for (const move of championsDex.moves.all()) {
    if (!move.exists) continue;
    moves[move.id] = exportMove(move);
  }

  const typeChart = {};
  const types = championsDex.types.all().filter((type) => type.exists);
  for (const attackType of types) {
    typeChart[attackType.name] = {};
    for (const targetType of types) {
      const immune = !championsDex.getImmunity(attackType.name, [targetType.name]);
      typeChart[attackType.name][targetType.name] = immune
        ? 0
        : 2 ** championsDex.getEffectiveness(attackType.name, [targetType.name]);
    }
  }

  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version: 1, species, moves, typeChart }), 'utf8');
  console.log(`exported Champions dex: ${output}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const output = process.argv[2] ?? 'dist/pages/data/champions-dex.json';
  await exportChampionsData(output);
}
