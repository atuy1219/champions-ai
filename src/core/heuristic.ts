import { InputError } from './errors.js';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  MoveCandidate,
  MoveSummary,
  SpeciesSummary,
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

function assertPercentage(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new InputError(`${label}は0から100の範囲で入力してください。`);
  }
}

function assertSpeedStage(value: number, label: string): void {
  if (!Number.isInteger(value) || value < -6 || value > 6) {
    throw new InputError(`${label}は-6から6の整数で入力してください。`);
  }
}

function accuracyFactor(accuracy: number | true): number {
  return accuracy === true ? 1 : accuracy / 100;
}

function getBoostValue(move: MoveSummary): number {
  const boosts = move.selfBoost?.boosts ?? move.boosts;
  if (!boosts) return 0;

  return Object.values(boosts).reduce((total, stage) => {
    if (stage === undefined || stage <= 0) return total;
    return total + stage;
  }, 0);
}

function speedContextBonus(request: AnalyzeRequest, move: MoveSummary): number {
  const attackerTailwind =
    request.field.tailwind === 'attacker' || request.field.tailwind === 'both';
  const defenderTailwind =
    request.field.tailwind === 'defender' || request.field.tailwind === 'both';

  const stageDifference =
    request.field.attackerSpeedStage - request.field.defenderSpeedStage;
  const effectiveAdvantage =
    stageDifference + (attackerTailwind ? 2 : 0) - (defenderTailwind ? 2 : 0);

  if (move.priority > 0 && effectiveAdvantage < 0) {
    return 8 + move.priority * 4;
  }

  if ((move.id === 'tailwind' || move.id === 'trickroom') && effectiveAdvantage < 0) {
    return 10;
  }

  return 0;
}

function scoreDamagingMove(
  request: AnalyzeRequest,
  attacker: SpeciesSummary,
  move: MoveSummary,
  typeMultiplier: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const weatherMultiplier =
    WEATHER_POWER_MULTIPLIERS[request.field.weather][move.type] ?? 1;
  const expectedPower =
    move.basePower *
    stab *
    typeMultiplier *
    accuracyFactor(move.accuracy) *
    weatherMultiplier;

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
  if (move.accuracy !== true && move.accuracy < 90) {
    reasons.push(`命中率${move.accuracy}%で不安定`);
  }
  if (move.priority > 0) reasons.push(`優先度+${move.priority}の先制技`);

  const finishBonus =
    request.defender.hpPercent <= 30 && typeMultiplier > 0
      ? Math.min(14, expectedPower / 12)
      : 0;
  if (finishBonus > 0) reasons.push('相手の残りHPが少なく、取り切り候補になる');

  return {
    score:
      expectedPower / 3 +
      move.priority * 3 +
      finishBonus +
      speedContextBonus(request, move),
    reasons,
  };
}

function scoreStatusMove(
  request: AnalyzeRequest,
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

  score += speedContextBonus(request, move);

  if (request.attacker.hpPercent <= 25 && move.id === 'protect') {
    score += 8;
    reasons.push('残りHPが少なく、味方の行動やターン経過を待てる');
  }

  return { score, reasons };
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

export class HeuristicAnalyzer {
  constructor(private readonly showdown: ShowdownAdapter) {}

  analyze(request: AnalyzeRequest): AnalyzeResponse {
    if (!request.attacker.species.trim() || !request.defender.species.trim()) {
      throw new InputError('両方のポケモン名を入力してください。');
    }

    assertPercentage(request.attacker.hpPercent, '自分のHP');
    assertPercentage(request.defender.hpPercent, '相手のHP');
    assertSpeedStage(request.field.attackerSpeedStage, '自分の素早さランク');
    assertSpeedStage(request.field.defenderSpeedStage, '相手の素早さランク');

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
          ? scoreStatusMove(request, move)
          : scoreDamagingMove(request, attacker, move, typeMultiplier);

      return {
        move: move.name,
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
        species: attacker.name,
        types: attacker.types,
      },
      defender: {
        species: defender.name,
        types: defender.types,
      },
      candidates,
      warnings: [
        '現段階は1ターンの近似評価で、実ダメージ計算・交代・相手行動探索は未実装です。',
        '技の合法性や現在のレギュレーション適合性は、まだ検証していません。',
      ],
    };
  }
}
