import type { ActiveSlot, BattleState, PokemonBattleState, TeamPokemonState } from './battle-state.js';
import type { CurrentActionEvaluation, DamagePreview, JointActionEvaluation } from './current-evaluation-types.js';
import {
  activeSlots,
  benchCoverage,
  calculateDamage,
  clamp,
  effectiveSpeed,
  estimateOpponentRisk,
  isSpreadMove,
  knownMoves,
  moveTargets,
  oppositeSide,
  resolvePokemon,
  round1,
  sideFromSlot,
} from './damage-service.js';
import type { MoveSummary } from './types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

export interface InternalAction extends CurrentActionEvaluation {
  moveData?: MoveSummary;
}

const SUPPORT: Readonly<Record<string, { score: number; reason: string }>> = Object.freeze({
  protect: { score: 28, reason: '攻撃を防ぎ、隣の行動や盤面変化を待てる' },
  detect: { score: 28, reason: '攻撃を防ぎ、隣の行動や盤面変化を待てる' },
  spikyshield: { score: 30, reason: '防御しながら接触技へ圧力をかけられる' },
  kingsshield: { score: 30, reason: '防御しながら物理攻撃を牽制できる' },
  tailwind: { score: 34, reason: '味方側の行動順を改善できる' },
  trickroom: { score: 34, reason: '素早さ関係を反転できる' },
  reflect: { score: 24, reason: '味方側の物理被害を軽減できる' },
  lightscreen: { score: 24, reason: '味方側の特殊被害を軽減できる' },
  auroraveil: { score: 31, reason: '物理・特殊被害を同時に軽減できる' },
  fakeout: { score: 31, reason: '優先度付きで相手の行動を止める圧力がある' },
  followme: { score: 29, reason: '攻撃を引き寄せて隣を守れる' },
  ragepowder: { score: 29, reason: '攻撃を引き寄せて隣を守れる' },
  helpinghand: { score: 23, reason: '隣の攻撃を強化できる' },
  wideguard: { score: 25, reason: '相手の全体技を防ぐ候補になる' },
  quickguard: { score: 21, reason: '相手の先制技を防ぐ候補になる' },
  icywind: { score: 18, reason: '相手全体の素早さを下げられる' },
  electroweb: { score: 18, reason: '相手全体の素早さを下げられる' },
});

function controlScore(move: MoveSummary, actor: PokemonBattleState): { score: number; reasons: string[] } {
  const support = SUPPORT[move.id];
  let score = support?.score ?? (move.category === 'Status' ? 12 : 0);
  const reasons = support ? [support.reason] : [];
  const boosts = move.selfBoost?.boosts ?? move.boosts;
  if (boosts) {
    const positive = Object.values(boosts).reduce((sum, value) => sum + Math.max(0, value ?? 0), 0);
    score += positive * 7;
    if (positive > 0) reasons.push(`能力上昇を${positive * 7}点評価`);
  }
  if (move.status) {
    score += 13;
    reasons.push(`状態異常${move.status}を狙える`);
  }
  if (move.sideCondition || move.weather || move.terrain || move.pseudoWeather) score += 8;
  if (move.forceSwitch || move.selfSwitch) score += 6;
  if (actor.hp.percent <= 25 && ['protect', 'detect'].includes(move.id)) score += 6;
  return { score, reasons };
}

function speedScore(
  state: BattleState,
  actorSlot: ActiveSlot,
  move: MoveSummary,
  adapter: ShowdownAdapter,
): { score: number; reason: string } {
  const actorState = state.active[actorSlot];
  if (!actorState) return { score: 0, reason: '' };
  const actor = resolvePokemon(actorState, adapter);
  const opponents = activeSlots(state, oppositeSide(actorState.side));
  if (opponents.length === 0) return { score: 0, reason: '' };
  const actorSpeed = effectiveSpeed(state, actor, actorSlot);
  const trickRoom = Boolean(state.fieldConditions.trickroom);
  const fasterCount = opponents.filter((slot) => {
    const opponent = state.active[slot];
    if (!opponent) return false;
    const opposingSpeed = effectiveSpeed(state, resolvePokemon(opponent, adapter), slot);
    return trickRoom ? actorSpeed < opposingSpeed : actorSpeed > opposingSpeed;
  }).length;
  if (move.priority > 0) return { score: 8 + move.priority * 3, reason: `優先度+${move.priority}` };
  if (fasterCount === opponents.length) {
    return { score: 8, reason: trickRoom ? 'トリックルーム下で先に動ける' : '相手全体より先に動ける' };
  }
  if (fasterCount > 0) return { score: 3, reason: '相手の一部より先に動ける' };
  return { score: -4, reason: '相手より後に動く可能性が高い' };
}

function affectedTargets(
  state: BattleState,
  actor: PokemonBattleState,
  move: MoveSummary,
  targetSlot: ActiveSlot | null,
): ActiveSlot[] {
  if (isSpreadMove(move)) return activeSlots(state, oppositeSide(actor.side));
  if (targetSlot && sideFromSlot(targetSlot) !== actor.side) return [targetSlot];
  return [];
}

function damageForTargets(
  state: BattleState,
  actorSlot: ActiveSlot,
  actor: PokemonBattleState,
  move: MoveSummary,
  targetSlot: ActiveSlot | null,
  adapter: ShowdownAdapter,
): DamagePreview[] {
  const resolvedActor = resolvePokemon(actor, adapter);
  const spread = isSpreadMove(move);
  return affectedTargets(state, actor, move, targetSlot).flatMap((slot) => {
    const target = state.active[slot];
    if (!target) return [];
    return [calculateDamage(state, move, resolvedActor, resolvePokemon(target, adapter), slot, spread, adapter)];
  });
}

function friendlyFire(
  state: BattleState,
  actorSlot: ActiveSlot,
  actor: PokemonBattleState,
  move: MoveSummary,
  adapter: ShowdownAdapter,
): number {
  if (move.target !== 'allAdjacent') return 0;
  const resolvedActor = resolvePokemon(actor, adapter);
  let total = 0;
  for (const slot of activeSlots(state, actor.side).filter((slot) => slot !== actorSlot)) {
    const ally = state.active[slot];
    if (!ally) continue;
    total += calculateDamage(state, move, resolvedActor, resolvePokemon(ally, adapter), slot, true, adapter).expectedPercent;
  }
  return total;
}

function createMoveAction(
  state: BattleState,
  actorSlot: ActiveSlot,
  actor: PokemonBattleState,
  move: MoveSummary,
  targetSlot: ActiveSlot | null,
  adapter: ShowdownAdapter,
): InternalAction {
  const resolvedActor = resolvePokemon(actor, adapter);
  const damage = damageForTargets(state, actorSlot, actor, move, targetSlot, adapter);
  const friendly = friendlyFire(state, actorSlot, actor, move, adapter);
  const control = controlScore(move, actor);
  const speed = speedScore(state, actorSlot, move, adapter);
  const expected = damage.reduce((sum, preview) => sum + preview.expectedPercent, 0);
  const knockout = damage.reduce((sum, preview) => sum + preview.koChance * 0.28, 0);
  const accuracy = damage.length > 0
    ? damage.reduce((sum, preview) => sum + (preview.hitChance - 85) * 0.12, 0)
    : 0;
  const bench = benchCoverage(state, resolvedActor, move, adapter);
  const preservation = ['protect', 'detect', 'spikyshield', 'kingsshield'].includes(move.id)
    ? clamp((45 - actor.hp.percent) * 0.4, 0, 12)
    : 0;
  const response = estimateOpponentRisk(state, resolvedActor, adapter);
  const final = expected * 0.62
    + knockout
    + speed.score
    + accuracy
    + control.score
    + bench
    + preservation
    - response.risk * 0.27
    - friendly * 0.55;
  const targetLabel = isSpreadMove(move)
    ? '相手全体'
    : targetSlot
      ? `${targetSlot} ${state.active[targetSlot]?.species ?? ''}`.trim()
      : move.target === 'self'
        ? '自分'
        : '場';
  const reasons = [
    ...damage.map((preview) => `${preview.targetSpecies}: ${preview.minPercent}～${preview.maxPercent}% / KO率${preview.koChance}%`),
    ...(speed.reason ? [speed.reason] : []),
    ...control.reasons,
    ...response.reasons,
  ];
  if (bench > 0) reasons.push(`相手控えへの一貫性を${round1(bench)}点評価`);
  if (friendly > 0) reasons.push(`味方への平均${round1(friendly)}%を減点`);
  return {
    id: `${actorSlot}:move:${move.id}:${targetSlot ?? 'spread'}`,
    actorSlot,
    actorSpecies: resolvedActor.species.displayName,
    kind: 'move',
    label: `${move.displayName} → ${targetLabel}`,
    move: move.displayName,
    englishMove: move.name,
    targetSlots: damage.flatMap((preview) => preview.targetSlot ? [preview.targetSlot] : []),
    damage,
    score: {
      damage: round1(expected * 0.62),
      knockout: round1(knockout),
      speed: round1(speed.score),
      accuracy: round1(accuracy),
      boardControl: round1(control.score),
      bench: round1(bench),
      preservation: round1(preservation),
      opponentResponseRisk: round1(response.risk),
      friendlyFireRisk: round1(friendly),
      final: round1(final),
    },
    reasons,
    moveData: move,
  };
}

function switchPressure(
  state: BattleState,
  member: TeamPokemonState,
  adapter: ShowdownAdapter,
): number {
  const attacker = resolvePokemon(member, adapter);
  let pressure = 0;
  for (const moveName of knownMoves(member)) {
    try {
      const move = adapter.getMove(moveName);
      if (move.category === 'Status') continue;
      for (const slot of activeSlots(state, oppositeSide(member.side))) {
        const target = state.active[slot];
        if (!target) continue;
        const preview = calculateDamage(state, move, attacker, resolvePokemon(target, adapter), slot, isSpreadMove(move), adapter);
        pressure = Math.max(pressure, preview.expectedPercent * 0.45);
      }
    } catch {
      // Incomplete switch candidate.
    }
  }
  return clamp(pressure, 0, 35);
}

function createSwitchAction(
  state: BattleState,
  actorSlot: ActiveSlot,
  actor: PokemonBattleState,
  member: TeamPokemonState,
  adapter: ShowdownAdapter,
): InternalAction {
  const incoming = resolvePokemon(member, adapter);
  const response = estimateOpponentRisk(state, incoming, adapter);
  const pressure = switchPressure(state, member, adapter);
  const preservation = clamp((45 - actor.hp.percent) * 0.65, 0, 22);
  const final = pressure + preservation - response.risk * 0.31 - 5;
  return {
    id: `${actorSlot}:switch:${member.teamIndex}`,
    actorSlot,
    actorSpecies: actor.species,
    kind: 'switch',
    label: `交代 → ${incoming.species.displayName}（${member.teamIndex}番）`,
    targetSlots: [],
    switchToTeamIndex: member.teamIndex,
    damage: [],
    score: {
      damage: 0,
      knockout: 0,
      speed: 0,
      accuracy: 0,
      boardControl: 0,
      bench: round1(pressure),
      preservation: round1(preservation),
      opponentResponseRisk: round1(response.risk),
      friendlyFireRisk: 0,
      final: round1(final),
    },
    reasons: [
      `交代後の対面圧力を${round1(pressure)}点評価`,
      ...(preservation > 0 ? [`現在の${actor.species}の温存を${round1(preservation)}点評価`] : []),
      ...response.reasons,
      '交代ターンのテンポ損失を5点減点',
    ],
  };
}

export function generateActions(
  state: BattleState,
  slot: ActiveSlot,
  adapter: ShowdownAdapter,
): InternalAction[] {
  const actor = state.active[slot];
  if (!actor || actor.fainted) return [];
  const actions: InternalAction[] = [];
  for (const moveName of knownMoves(actor)) {
    try {
      const move = adapter.getMove(moveName);
      for (const target of moveTargets(state, slot, move)) {
        actions.push(createMoveAction(state, slot, actor, move, target, adapter));
      }
    } catch {
      // One unresolved move must not hide all other actions.
    }
  }
  for (const member of state.sides[actor.side].team) {
    if (member.fainted || member.activeSlot !== null || member.species === 'Unknown') continue;
    try {
      actions.push(createSwitchAction(state, slot, actor, member, adapter));
    } catch {
      // Ignore incomplete switch candidates.
    }
  }
  return actions.sort((left, right) => right.score.final - left.score.final);
}

export function publicAction(action: InternalAction): CurrentActionEvaluation {
  const { moveData: _moveData, ...result } = action;
  return result;
}

export function buildJointActions(
  state: BattleState,
  leftSlot: ActiveSlot,
  leftActions: readonly InternalAction[],
  rightSlot: ActiveSlot,
  rightActions: readonly InternalAction[],
): JointActionEvaluation[] {
  const joint: JointActionEvaluation[] = [];
  const protects = new Set(['protect', 'detect', 'spikyshield', 'kingsshield']);
  for (const left of leftActions.slice(0, 8)) {
    for (const right of rightActions.slice(0, 8)) {
      if (left.kind === 'switch' && right.kind === 'switch' && left.switchToTeamIndex === right.switchToTeamIndex) continue;
      let synergy = 0;
      const reasons: string[] = [];
      const leftProtect = left.moveData ? protects.has(left.moveData.id) : false;
      const rightProtect = right.moveData ? protects.has(right.moveData.id) : false;
      if (leftProtect !== rightProtect) {
        synergy += 4;
        reasons.push('片方が防御し、もう片方が行動する組み合わせ');
      }
      for (const target of left.targetSlots.filter((slot) => right.targetSlots.includes(slot))) {
        const total = (left.damage.find((preview) => preview.targetSlot === target)?.expectedPercent ?? 0)
          + (right.damage.find((preview) => preview.targetSlot === target)?.expectedPercent ?? 0);
        const hp = state.active[target]?.hp.percent ?? 100;
        if (total >= hp) {
          synergy += 12;
          reasons.push(`${target}への集中攻撃で平均上は取り切れる`);
        } else if (total >= hp * 0.75) {
          synergy += 5;
          reasons.push(`${target}へ大きな集中ダメージを与えられる`);
        }
      }
      if (left.moveData?.id === 'helpinghand' || right.moveData?.id === 'helpinghand') {
        const partner = left.moveData?.id === 'helpinghand' ? right : left;
        if (partner.damage.length > 0) {
          synergy += 10;
          reasons.push('てだすけと攻撃技の組み合わせ');
        }
      }
      const base = left.score.final + right.score.final;
      joint.push({
        id: `${left.id}|${right.id}`,
        actions: [left.label, right.label],
        actorSlots: [leftSlot, rightSlot],
        score: round1(base + synergy),
        baseScore: round1(base),
        synergyScore: round1(synergy),
        reasons,
      });
    }
  }
  return joint.sort((a, b) => b.score - a.score).slice(0, 12);
}
