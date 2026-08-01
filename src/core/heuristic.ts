import { InputError } from './errors.js';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  MoveCandidate,
  MoveSummary,
  PokemonInput,
  SideConditions,
  SpeciesSummary,
  StatKey,
  StatStages,
} from './types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

const SUPPORT_MOVE_BONUSES: Record<string, { score: number; reason: string }> = {
  protect: { score: 44, reason: 'まもる系の技として盤面維持に使える' },
  detect: { score: 44, reason: 'まもる系の技として盤面維持に使える' },
  kingsshield: { score: 46, reason: '防御しながら接触技への圧力を作れる' },
  spikyshield: { score: 46, reason: '防御しながら接触ダメージを狙える' },
  banefulbunker: { score: 46, reason: '防御しながらどく状態を狙える' },
  silkentrap: { score: 46, reason: '防御しながら素早さ低下を狙える' },
  wideguard: { score: 38, reason: '相手の全体技を防ぐ候補になる' },
  quickguard: { score: 32, reason: '相手の先制技を防ぐ候補になる' },
  tailwind: { score: 48, reason: '味方側の素早さ優位を作れる' },
  trickroom: { score: 45, reason: '行動順を反転して素早さ関係を変えられる' },
  icywind: { score: 34, reason: '攻撃しながら相手側の素早さを下げられる' },
  electroweb: { score: 34, reason: '攻撃しながら相手側の素早さを下げられる' },
  fakeout: { score: 42, reason: '相手の行動を1ターン止める圧力がある' },
  followme: { score: 42, reason: '攻撃対象を引き寄せて味方を守れる' },
  ragepowder: { score: 42, reason: '攻撃対象を引き寄せて味方を守れる' },
  helpinghand: { score: 31, reason: '味方の攻撃を強化できる' },
};

const WEATHER_POWER_MULTIPLIERS: Record<
  AnalyzeRequest['field']['weather'],
  Partial<Record<string, number>>
> = {
  none: {},
  sun: { Fire: 1.5, Water: 0.5 },
  rain: { Water: 1.5, Fire: 0.5 },
  sand: {},
  snow: {},
};

const STAGE_KEYS: readonly StatKey[] = [
  'atk',
  'def',
  'spa',
  'spd',
  'spe',
  'accuracy',
  'evasion',
];

function assertPercentage(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new InputError(`${label}は0から100の範囲で入力してください。`);
  }
}

function assertStages(stages: StatStages, label: string): void {
  for (const key of STAGE_KEYS) {
    const value = stages[key];
    if (!Number.isInteger(value) || value < -6 || value > 6) {
      throw new InputError(`${label}の能力ランクは-6から6の整数で入力してください。`);
    }
  }
}

function resolveHpPercent(pokemon: PokemonInput, label: string): number {
  const hasCurrent = pokemon.currentHp !== undefined;
  const hasMax = pokemon.maxHp !== undefined;

  if (hasCurrent !== hasMax) {
    throw new InputError(`${label}の現在HPと最大HPは両方入力してください。`);
  }

  if (hasCurrent && hasMax) {
    const current = pokemon.currentHp!;
    const max = pokemon.maxHp!;
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(current) || current < 0 || current > max) {
      throw new InputError(`${label}のHP実数値が正しくありません。`);
    }
    return current / max * 100;
  }

  assertPercentage(pokemon.hpPercent, `${label}のHP`);
  return pokemon.hpPercent;
}

function stageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function accuracyStageMultiplier(stage: number): number {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

function adjustedAccuracyFactor(
  accuracy: number | true,
  attackerStages: StatStages,
  defenderStages: StatStages,
): number {
  if (accuracy === true) return 1;
  const adjusted =
    accuracy / 100 *
    accuracyStageMultiplier(attackerStages.accuracy) /
    accuracyStageMultiplier(defenderStages.evasion);
  return Math.max(0, Math.min(1, adjusted));
}

function getBoostValue(move: MoveSummary): number {
  const boosts = move.selfBoost?.boosts ?? move.boosts;
  if (!boosts) return 0;

  return Object.values(boosts).reduce((total, stage) => {
    if (stage === undefined || stage <= 0) return total;
    return total + stage;
  }, 0);
}

function effectiveSpeed(
  species: SpeciesSummary,
  pokemon: PokemonInput,
  side: SideConditions,
): number {
  const paralysis = pokemon.status === 'paralysis' ? 0.5 : 1;
  return (
    species.baseStats.spe *
    stageMultiplier(pokemon.stages.spe) *
    (side.tailwind ? 2 : 1) *
    paralysis
  );
}

function speedContextBonus(
  request: AnalyzeRequest,
  attacker: SpeciesSummary,
  defender: SpeciesSummary,
  move: MoveSummary,
): number {
  const attackerSpeed = effectiveSpeed(attacker, request.attacker, request.field.attackerSide);
  const defenderSpeed = effectiveSpeed(defender, request.defender, request.field.defenderSide);
  const attackerActsFirst = request.field.trickRoom
    ? attackerSpeed < defenderSpeed
    : attackerSpeed > defenderSpeed;

  if (move.priority > 0 && !attackerActsFirst) {
    return 8 + move.priority * 4;
  }

  if ((move.id === 'tailwind' || move.id === 'trickroom') && !attackerActsFirst) {
    return 10;
  }

  return 0;
}

function isApproximatelyGrounded(species: SpeciesSummary): boolean {
  return !species.types.includes('Flying');
}

function terrainMultiplier(
  request: AnalyzeRequest,
  attacker: SpeciesSummary,
  defender: SpeciesSummary,
  move: MoveSummary,
  reasons: string[],
): number {
  const attackerGrounded = isApproximatelyGrounded(attacker);
  const defenderGrounded = isApproximatelyGrounded(defender);

  if (request.field.terrain === 'electric' && attackerGrounded && move.type === 'Electric') {
    reasons.push('エレキフィールドによる威力上昇を近似反映');
    return 1.3;
  }
  if (request.field.terrain === 'grassy' && attackerGrounded && move.type === 'Grass') {
    reasons.push('グラスフィールドによる威力上昇を近似反映');
    return 1.3;
  }
  if (request.field.terrain === 'psychic' && attackerGrounded && move.type === 'Psychic') {
    reasons.push('サイコフィールドによる威力上昇を近似反映');
    return 1.3;
  }
  if (request.field.terrain === 'misty' && defenderGrounded && move.type === 'Dragon') {
    reasons.push('ミストフィールドによりドラゴン技が弱まる');
    return 0.5;
  }

  return 1;
}

function screenMultiplier(move: MoveSummary, side: SideConditions, reasons: string[]): number {
  const physicalBlocked = move.category === 'Physical' && side.reflect;
  const specialBlocked = move.category === 'Special' && side.lightScreen;
  if (side.auroraVeil || physicalBlocked || specialBlocked) {
    reasons.push('相手側の壁によるダメージ軽減をダブル用の2/3で近似');
    return 2 / 3;
  }
  return 1;
}

function scoreDamagingMove(
  request: AnalyzeRequest,
  attacker: SpeciesSummary,
  defender: SpeciesSummary,
  defenderHpPercent: number,
  move: MoveSummary,
  typeMultiplier: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const weatherMultiplier = WEATHER_POWER_MULTIPLIERS[request.field.weather][move.type] ?? 1;
  const terrain = terrainMultiplier(request, attacker, defender, move, reasons);
  const screen = screenMultiplier(move, request.field.defenderSide, reasons);
  const offensiveKey = move.category === 'Physical' ? 'atk' : 'spa';
  const defensiveKey = move.category === 'Physical' ? 'def' : 'spd';
  const offensiveStat = attacker.baseStats[offensiveKey] * stageMultiplier(request.attacker.stages[offensiveKey]);
  const defensiveStat = defender.baseStats[defensiveKey] * stageMultiplier(request.defender.stages[defensiveKey]);
  const statRatio = Math.sqrt(Math.max(0.2, offensiveStat / Math.max(1, defensiveStat)));
  const burnMultiplier = move.category === 'Physical' && request.attacker.status === 'burn' ? 0.5 : 1;
  const hitChance = adjustedAccuracyFactor(move.accuracy, request.attacker.stages, request.defender.stages);

  let priorityMultiplier = 1;
  if (
    request.field.terrain === 'psychic' &&
    move.priority > 0 &&
    isApproximatelyGrounded(defender)
  ) {
    priorityMultiplier = 0;
    reasons.push('サイコフィールドにより先制技が失敗する可能性が高い');
  }

  const expectedPower =
    move.basePower *
    stab *
    typeMultiplier *
    hitChance *
    weatherMultiplier *
    terrain *
    screen *
    statRatio *
    burnMultiplier *
    priorityMultiplier;

  if (stab > 1) reasons.push('タイプ一致補正がある');
  if (typeMultiplier === 0) {
    reasons.push('相手のタイプに無効化される');
  } else if (typeMultiplier >= 4) {
    reasons.push('4倍弱点を突ける');
  } else if (typeMultiplier > 1) {
    reasons.push('弱点を突ける');
  } else if (typeMultiplier < 1) {
    reasons.push('相手に半減される');
  }

  if (weatherMultiplier > 1) reasons.push('天候による威力上昇がある');
  if (weatherMultiplier < 1) reasons.push('天候によって威力が下がる');
  if (burnMultiplier < 1) reasons.push('やけどによる物理火力低下を近似反映');
  if (request.attacker.stages[offensiveKey] !== 0) {
    reasons.push(`自分の${offensiveKey === 'atk' ? '攻撃' : '特攻'}ランクを反映`);
  }
  if (request.defender.stages[defensiveKey] !== 0) {
    reasons.push(`相手の${defensiveKey === 'def' ? '防御' : '特防'}ランクを反映`);
  }
  if (move.accuracy !== true && hitChance < 0.9) {
    reasons.push(`命中・回避ランク込みの命中期待値が約${Math.round(hitChance * 100)}%`);
  }
  if (move.priority > 0) reasons.push(`優先度+${move.priority}の先制技`);

  const finishBonus =
    defenderHpPercent <= 30 && typeMultiplier > 0 && priorityMultiplier > 0
      ? Math.min(14, expectedPower / 12)
      : 0;
  if (finishBonus > 0) reasons.push('相手の残りHPが少なく、取り切り候補になる');

  return {
    score:
      expectedPower / 3 +
      move.priority * 3 * priorityMultiplier +
      finishBonus +
      speedContextBonus(request, attacker, defender, move),
    reasons,
  };
}

function scoreStatusMove(
  request: AnalyzeRequest,
  attacker: SpeciesSummary,
  defender: SpeciesSummary,
  attackerHpPercent: number,
  move: MoveSummary,
): { score: number; reasons: string[] } {
  const support = SUPPORT_MOVE_BONUSES[move.id];
  const reasons = support ? [support.reason] : ['変化技として盤面を動かせる'];
  const boostValue = getBoostValue(move);

  let score = support?.score ?? 18;

  if (boostValue > 0) {
    score += boostValue * 9;
    reasons.push(`能力を合計${boostValue}段階上げられる`);
  }

  score += speedContextBonus(request, attacker, defender, move);

  if (attackerHpPercent <= 25 && move.id === 'protect') {
    score += 8;
    reasons.push('残りHPが少なく、味方の行動やターン経過を待てる');
  }

  return { score, reasons };
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function hpSummary(pokemon: PokemonInput, percent: number) {
  return {
    ...(pokemon.currentHp !== undefined ? { current: pokemon.currentHp } : {}),
    ...(pokemon.maxHp !== undefined ? { max: pokemon.maxHp } : {}),
    percent: roundScore(percent),
  };
}

export class HeuristicAnalyzer {
  constructor(private readonly showdown: ShowdownAdapter) {}

  analyze(request: AnalyzeRequest): AnalyzeResponse {
    if (!request.attacker.species.trim() || !request.defender.species.trim()) {
      throw new InputError('両方のポケモン名を入力してください。');
    }

    const attackerHpPercent = resolveHpPercent(request.attacker, '自分');
    const defenderHpPercent = resolveHpPercent(request.defender, '相手');
    assertStages(request.attacker.stages, '自分');
    assertStages(request.defender.stages, '相手');

    const uniqueMoveNames = [...new Set(
      request.attacker.moves.map((move) => move.trim()).filter(Boolean),
    )];

    if (uniqueMoveNames.length === 0) {
      throw new InputError('自分の技を1つ以上入力してください。');
    }

    if (uniqueMoveNames.length > 4) {
      throw new InputError('技は最大4つまで入力できます。');
    }

    const attacker = this.showdown.getSpecies(request.attacker.species);
    const defender = this.showdown.getSpecies(request.defender.species);

    const candidates: MoveCandidate[] = uniqueMoveNames.map((moveName) => {
      const move = this.showdown.getMove(moveName);
      const typeMultiplier =
        move.category === 'Status'
          ? 1
          : this.showdown.getTypeMultiplier(move.type, defender.types);
      const result =
        move.category === 'Status'
          ? scoreStatusMove(request, attacker, defender, attackerHpPercent, move)
          : scoreDamagingMove(
              request,
              attacker,
              defender,
              defenderHpPercent,
              move,
              typeMultiplier,
            );

      return {
        move: move.displayName,
        englishMove: move.name,
        category: move.category,
        type: move.type,
        score: roundScore(result.score),
        basePower: move.basePower,
        accuracy: move.accuracy,
        priority: move.priority,
        typeMultiplier,
        reasons: result.reasons,
      };
    });

    candidates.sort((left, right) => right.score - left.score);

    return {
      engine: {
        name: 'pokemon-showdown',
        mod: 'champions',
        formatId: request.formatId,
      },
      attacker: {
        species: attacker.displayName,
        englishSpecies: attacker.name,
        types: attacker.types,
        hp: hpSummary(request.attacker, attackerHpPercent),
      },
      defender: {
        species: defender.displayName,
        englishSpecies: defender.name,
        types: defender.types,
        hp: hpSummary(request.defender, defenderHpPercent),
      },
      candidates,
      warnings: [
        '現段階は1ターンの近似評価で、実ダメージ計算・交代・相手行動探索は未実装です。',
        '特性・持ち物・接地判定の一部を未入力として扱うため、フィールドと状態異常の評価は概算です。',
        '技の合法性や現在のレギュレーション適合性は、まだ検証していません。',
      ],
    };
  }
}
