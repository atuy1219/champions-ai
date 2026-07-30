import type {
  ActiveSlot,
  BattleState,
  BattleStats,
  CurrentActionEvaluation,
  CurrentEvaluationResponse,
  HpState,
  PokemonBattleState,
  TeamPokemonState,
  TimedConditionState,
} from './live-types.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

function hpText(hp: HpState): string {
  if (hp.exact && hp.current !== null && hp.max !== null) {
    return `${hp.current}/${hp.max} (${hp.percent.toFixed(1)}%)`;
  }
  return `${hp.percent.toFixed(1)}%`;
}

function conditionText(condition: TimedConditionState, turn: number): string {
  if (condition.expiresTurn === null) return condition.displayName;
  return `${condition.displayName}（残り${Math.max(0, condition.expiresTurn - turn)}T）`;
}

function conditionTags(conditions: Record<string, TimedConditionState>, turn: number): string {
  const values = Object.values(conditions).map((condition) => conditionText(condition, turn));
  if (values.length === 0) return '<span class="condition-tag">なし</span>';
  return values.map((value) => `<span class="condition-tag">${escapeHtml(value)}</span>`).join('');
}

function statsText(stats: BattleStats | null): string {
  if (!stats) return '自動補完';
  return `H${stats.hp} A${stats.atk} B${stats.def} C${stats.spa} D${stats.spd} S${stats.spe}`;
}

function pokemonCard(slot: ActiveSlot, pokemon: PokemonBattleState | undefined, turn: number): string {
  if (!pokemon) return `<article class="pokemon-state"><h3>${slot}</h3><small>未登録</small></article>`;
  const boosts = Object.entries(pokemon.boosts)
    .filter(([, value]) => value !== 0)
    .map(([stat, value]) => `${stat}${value > 0 ? '+' : ''}${value}`);
  const moves = pokemon.moves.length > 0 ? pokemon.moves : pokemon.revealedMoves;
  const tera = pokemon.teraType ? `${pokemon.teraType}${pokemon.teraActive ? '（使用中）' : ''}` : '不明';
  return `<article class="pokemon-state">
    <h3>${slot} · ${escapeHtml(pokemon.species)}</h3>
    <dl>
      <dt>チーム</dt><dd>${pokemon.teamIndex || '未紐付け'}番 / Lv.${pokemon.level}</dd>
      <dt>HP</dt><dd>${escapeHtml(hpText(pokemon.hp))}</dd>
      <dt>状態</dt><dd>${escapeHtml(pokemon.status ?? 'なし')}</dd>
      <dt>ランク</dt><dd>${escapeHtml(boosts.join(', ') || '変化なし')}</dd>
      <dt>技</dt><dd>${escapeHtml(moves.join(', ') || '未登録')}</dd>
      <dt>持ち物</dt><dd>${escapeHtml(pokemon.item ?? '不明')}</dd>
      <dt>特性</dt><dd>${escapeHtml(pokemon.ability ?? '不明')}</dd>
      <dt>テラ</dt><dd>${escapeHtml(tera)}</dd>
      <dt>実数値</dt><dd>${escapeHtml(statsText(pokemon.stats))}</dd>
    </dl>
    <div class="condition-tags">${conditionTags(pokemon.volatiles, turn)}</div>
  </article>`;
}

function teamMember(member: TeamPokemonState): string {
  const moves = member.moves.length > 0 ? member.moves : member.revealedMoves;
  return `<article class="team-member ${member.fainted ? 'is-fainted' : ''}">
    <div><strong>${member.teamIndex}. ${escapeHtml(member.species)}</strong><small>Lv.${member.level}${member.activeSlot ? ` / ${member.activeSlot}` : ''}</small></div>
    <span>${escapeHtml(hpText(member.hp))}</span>
    <span>${escapeHtml(moves.join(', ') || '技不明')}</span>
    <span>${escapeHtml(member.item ?? '持ち物不明')} / ${escapeHtml(member.ability ?? '特性不明')}</span>
  </article>`;
}

export function renderState(state: BattleState, view: HTMLElement, meta: HTMLElement, turnInput: HTMLInputElement): void {
  meta.textContent = `revision ${state.revision} / turn ${state.turn} / events ${state.history.length}`;
  turnInput.value = String(state.turn);
  const recent = state.history.slice(-10).reverse();
  view.className = 'state-summary';
  view.innerHTML = `<section class="field-summary">
      <div><span>天候</span><strong>${escapeHtml(state.weather ? conditionText(state.weather, state.turn) : 'なし')}</strong></div>
      <div><span>フィールド</span><strong>${escapeHtml(state.terrain ? conditionText(state.terrain, state.turn) : 'なし')}</strong></div>
      <div><span>場全体</span><div class="condition-tags">${conditionTags(state.fieldConditions, state.turn)}</div></div>
      <div><span>自分側</span><div class="condition-tags">${conditionTags(state.sides.p1.conditions, state.turn)}</div></div>
      <div><span>相手側</span><div class="condition-tags">${conditionTags(state.sides.p2.conditions, state.turn)}</div></div>
    </section>
    <section class="active-grid">
      ${pokemonCard('p1a', state.active.p1a, state.turn)}
      ${pokemonCard('p1b', state.active.p1b, state.turn)}
      ${pokemonCard('p2a', state.active.p2a, state.turn)}
      ${pokemonCard('p2b', state.active.p2b, state.turn)}
    </section>
    <section class="team-summary">
      <div><h3>自分チーム</h3>${state.sides.p1.team.length ? state.sides.p1.team.map(teamMember).join('') : '<p>未登録</p>'}</div>
      <div><h3>相手チーム</h3>${state.sides.p2.team.length ? state.sides.p2.team.map(teamMember).join('') : '<p>未登録</p>'}</div>
    </section>
    <section><h3>最近のイベント</h3><div class="history-list">
      ${recent.length ? recent.map((event) => `<div class="history-row">${escapeHtml(JSON.stringify(event))}</div>`).join('') : '<div class="history-row">イベントなし</div>'}
    </div></section>`;
}

function scoreChips(action: CurrentActionEvaluation): string {
  const score = action.score;
  const entries: Array<[string, number, boolean]> = [
    ['ダメージ', score.damage, false], ['KO', score.knockout, false], ['行動順', score.speed, false],
    ['命中', score.accuracy, false], ['盤面', score.boardControl, false], ['控え', score.bench, false],
    ['温存', score.preservation, false], ['反撃', score.opponentResponseRisk, true], ['味方被害', score.friendlyFireRisk, true],
  ];
  return entries.filter(([, value]) => value !== 0).map(([label, value, negative]) =>
    `<span class="score-chip ${negative ? 'negative' : ''}">${label} ${negative ? '-' : ''}${value.toFixed(1)}</span>`,
  ).join('');
}

function actionCard(action: CurrentActionEvaluation, rank: number): string {
  const damage = action.damage.map((preview) =>
    `<div class="damage-line">${escapeHtml(preview.targetSpecies)} ${preview.minPercent}～${preview.maxPercent}% / 平均${preview.expectedPercent}% / KO${preview.koChance}% / 命中${preview.hitChance}%</div>`,
  ).join('');
  return `<article class="evaluation-card">
    <div class="candidate-rank">${rank}</div>
    <div><div class="evaluation-card-heading"><strong>${escapeHtml(action.label)}</strong><b>${action.score.final.toFixed(1)}</b></div>
      ${damage}<div class="score-chips">${scoreChips(action)}</div>
      <ul>${action.reasons.slice(0, 7).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
    </div>
  </article>`;
}

export function renderEvaluation(response: CurrentEvaluationResponse, view: HTMLElement): void {
  view.className = 'evaluation-results';
  const joint = response.jointActions.length ? `<section class="joint-results"><h3>同時行動</h3>${response.jointActions.slice(0, 6).map((item, index) =>
    `<article class="joint-card"><span>${index + 1}</span><div><strong>${item.actions.map(escapeHtml).join(' ＋ ')}</strong><small>${item.reasons.map(escapeHtml).join(' / ') || '個別評価の合計'}</small></div><b>${item.score.toFixed(1)}</b></article>`,
  ).join('')}</section>` : '';
  const individual = response.pokemon.map((entry) => `<section class="individual-results"><h3>${entry.slot} · ${escapeHtml(entry.species)}</h3>
    ${entry.actions.length ? entry.actions.slice(0, 8).map((action, index) => actionCard(action, index + 1)).join('') : '<p>候補なし。技と控えを登録してください。</p>'}
  </section>`).join('');
  view.innerHTML = `<div class="evaluation-meta">turn ${response.turn} / revision ${response.revision}</div>${joint}${individual}
    <aside class="evaluation-warnings">${response.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}</aside>`;
}
