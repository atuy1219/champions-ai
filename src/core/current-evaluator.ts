import { InputError } from './errors.js';
import { buildJointActions, generateActions, publicAction } from './action-evaluator.js';
import { activeSlots, clamp, knownMoves, oppositeSide } from './damage-service.js';
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

export class CurrentBattleEvaluator {
  constructor(private readonly adapter: ShowdownAdapter) {}

  evaluate(state: BattleState, request: CurrentEvaluationRequest = {}): CurrentEvaluationResponse {
    const side = request.side ?? 'p1';
    const formatId = request.formatId?.trim() || 'gen9championsvgc2026regma';
    const maxActions = clamp(Math.trunc(request.maxActionsPerPokemon ?? 20), 4, 40);
    const slots = activeSlots(state, side);
    if (slots.length === 0) throw new InputError('評価する自分側のポケモンが場にいません。');

    const warnings = new Set<string>();
    const entries = slots.map((slot) => {
      const pokemon = state.active[slot]!;
      if (knownMoves(pokemon).length === 0) warnings.add(`${slot} ${pokemon.species}の技が未登録です。`);
      if (!pokemon.stats) warnings.add(`${slot} ${pokemon.species}の実数値は標準値で補完しました。`);
      return {
        slot,
        species: pokemon.species,
        actions: generateActions(state, slot, this.adapter).slice(0, maxActions),
      };
    });

    for (const member of state.sides[oppositeSide(side)].team) {
      if (!member.stats) warnings.add(`相手${member.teamIndex}番 ${member.species}の実数値は標準値で補完しています。`);
      if (knownMoves(member).length === 0) warnings.add(`相手${member.teamIndex}番 ${member.species}の技が不明です。`);
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
    warnings.add('相手行動は既知技から最大被害を差し引く悲観評価で、完全なBattleStream探索ではありません。');
    warnings.add('登録済み技と控えから行動を生成し、構築合法性までは再検証していません。');

    return {
      engine: {
        name: 'pokemon-showdown-data',
        mod: 'champions',
        formatId,
        model: 'gen9-damage-and-one-turn-risk-v0',
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
