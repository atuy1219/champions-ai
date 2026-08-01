import { InputError } from './errors.js';
import { buildJointActions, generateActions, publicAction, type InternalAction } from './action-evaluator.js';
import { activeSlots, clamp, knownMoves, oppositeSide, round1 } from './damage-service.js';
import type {
  CurrentEvaluationRequest,
  CurrentEvaluationResponse,
} from './current-evaluation-types.js';
import type { BattleState } from './battle-state.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

export type {
  ActionScoreBreakdown,
  CurrentActionEvaluation,
  CurrentEvaluationRequest,
  CurrentEvaluationResponse,
  CurrentPokemonEvaluation,
  DamagePreview,
  JointActionEvaluation,
} from './current-evaluation-types.js';

function applyUnknownOpponentRisk(actions: InternalAction[], unknownCount: number): void {
  if (unknownCount <= 0) return;
  const addedRisk = unknownCount * 22;
  const penalty = addedRisk * 0.27;
  for (const action of actions) {
    action.score.opponentResponseRisk = round1(action.score.opponentResponseRisk + addedRisk);
    action.score.final = round1(action.score.final - penalty);
    action.reasons.push(`相手${unknownCount}体の技が未判明のため、未知攻撃リスク${round1(addedRisk)}を加算`);
  }
  actions.sort((left, right) => right.score.final - left.score.final);
}

export class CurrentBattleEvaluator {
  constructor(private readonly adapter: ShowdownAdapter) {}

  evaluate(state: BattleState, request: CurrentEvaluationRequest = {}): CurrentEvaluationResponse {
    const side = request.side ?? 'p1';
    const formatId = request.formatId?.trim() || 'gen9championsvgc2026regma';
    const maxActions = clamp(Math.trunc(request.maxActionsPerPokemon ?? 20), 4, 40);
    const slots = activeSlots(state, side);
    if (slots.length === 0) throw new InputError('評価する自分側のポケモンが場にいません。');

    const warnings = new Set<string>();
    const unknownActiveOpponents = activeSlots(state, oppositeSide(side)).filter((slot) => {
      const pokemon = state.active[slot];
      return pokemon !== undefined && knownMoves(pokemon).length === 0;
    });

    const entries = slots.map((slot) => {
      const pokemon = state.active[slot]!;
      if (knownMoves(pokemon).length === 0) warnings.add(`${slot} ${pokemon.species}の技が未登録です。`);
      if (!pokemon.stats) warnings.add(`${slot} ${pokemon.species}の実数値は標準値で補完しました。`);
      const actions = generateActions(state, slot, this.adapter);
      applyUnknownOpponentRisk(actions, unknownActiveOpponents.length);
      return {
        slot,
        species: pokemon.species,
        actions: actions.slice(0, maxActions),
      };
    });

    for (const member of state.sides[oppositeSide(side)].team) {
      if (!member.stats) warnings.add(`相手${member.teamIndex}番 ${member.species}の実数値は標準値で補完しています。`);
      if (knownMoves(member).length === 0) warnings.add(`相手${member.teamIndex}番 ${member.species}の技が不明です。`);
    }
    if (unknownActiveOpponents.length > 0) {
      warnings.add(`場の相手${unknownActiveOpponents.length}体は技が未判明のため、安全とは扱わず未知攻撃リスクを加算しました。`);
    }

    const jointActions = entries.length >= 2
      ? buildJointActions(
          state,
          entries[0]!.slot,
          entries[0]!.actions,
          entries[1]!.slot,
          entries[1]!.actions,
        )
      : [];

    warnings.add('第9世代ダメージ式を使用しますが、技固有スクリプトの全例は未再現です。');
    warnings.add('相手行動は既知技からの最大被害と未公開技リスクを使う悲観評価で、完全なBattleStream探索ではありません。');
    warnings.add('登録済み技と控えから行動を生成し、構築合法性までは再検証していません。');

    return {
      engine: {
        name: 'pokemon-showdown-data',
        mod: 'champions',
        formatId,
        model: 'gen9-explainable-risk-v1',
      },
      revision: state.revision,
      turn: state.turn,
      side,
      pokemon: entries.map((entry) => ({
        slot: entry.slot,
        species: entry.species,
        actions: entry.actions.map(publicAction),
      })),
      jointActions,
      warnings: [...warnings],
    };
  }
}
