export {};

type SideId = 'p1' | 'p2';
type ActiveSlot = 'p1a' | 'p1b' | 'p2a' | 'p2b';
type BoostStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';

interface HpState {
  current: number | null;
  max: number | null;
  percent: number;
  exact: boolean;
}

interface PokemonBattleState {
  slot: ActiveSlot;
  species: string;
  hp: HpState;
  status: string | null;
  boosts: Record<BoostStat, number>;
  volatiles: Record<string, { displayName: string }>;
  revealedMoves: string[];
  fainted: boolean;
}

interface BattleState {
  revision: number;
  turn: number;
  weather: { displayName: string } | null;
  terrain: { displayName: string } | null;
  fieldConditions: Record<string, { displayName: string }>;
  sides: Record<SideId, { conditions: Record<string, { displayName: string }> }>;
  active: Partial<Record<ActiveSlot, PokemonBattleState>>;
  history: Record<string, unknown>[];
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

const statusText = requiredElement<HTMLElement>('#live-status');
const stateView = requiredElement<HTMLElement>('#state-view');
const stateMeta = requiredElement<HTMLElement>('#state-meta');
const pokemonForm = requiredElement<HTMLFormElement>('#pokemon-event-form');
const conditionForm = requiredElement<HTMLFormElement>('#condition-form');
const protocolForm = requiredElement<HTMLFormElement>('#protocol-form');
const protocolText = requiredElement<HTMLTextAreaElement>('#protocol-text');
const turnNumber = requiredElement<HTMLInputElement>('#turn-number');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

function formValue(form: HTMLFormElement, name: string): string {
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`${name}が見つかりません。`);
  }
  return control.value;
}

function formChecked(form: HTMLFormElement, name: string): boolean {
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLInputElement)) throw new Error(`${name}が見つかりません。`);
  return control.checked;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T | { error: string };
  if (!response.ok) throw new Error('error' in (body as { error?: string }) ? (body as { error: string }).error : 'APIエラー');
  return body as T;
}

function hpText(hp: HpState): string {
  if (hp.exact && hp.current !== null && hp.max !== null) {
    return `${hp.current}/${hp.max} (${hp.percent.toFixed(1)}%)`;
  }
  return `${hp.percent.toFixed(1)}%`;
}

function conditionNames(conditions: Record<string, { displayName: string }>): string[] {
  return Object.values(conditions).map((condition) => condition.displayName);
}

function tags(values: string[]): string {
  if (values.length === 0) return '<span class="condition-tag">なし</span>';
  return values.map((value) => `<span class="condition-tag">${escapeHtml(value)}</span>`).join('');
}

function pokemonCard(slot: ActiveSlot, pokemon?: PokemonBattleState): string {
  if (!pokemon) {
    return `<article class="pokemon-state"><h3>${slot}</h3><small>未登録</small></article>`;
  }
  const boosts = Object.entries(pokemon.boosts)
    .filter(([, value]) => value !== 0)
    .map(([stat, value]) => `${stat}${value > 0 ? '+' : ''}${value}`);
  return `
    <article class="pokemon-state">
      <h3>${slot} · ${escapeHtml(pokemon.species)}</h3>
      <dl>
        <dt>HP</dt><dd>${escapeHtml(hpText(pokemon.hp))}</dd>
        <dt>状態</dt><dd>${escapeHtml(pokemon.status ?? 'なし')}</dd>
        <dt>ランク</dt><dd>${escapeHtml(boosts.join(', ') || '変化なし')}</dd>
        <dt>確認済み技</dt><dd>${escapeHtml(pokemon.revealedMoves.join(', ') || 'なし')}</dd>
      </dl>
      <div class="condition-tags">${tags(conditionNames(pokemon.volatiles))}</div>
    </article>`;
}

function renderState(state: BattleState): void {
  stateMeta.textContent = `revision ${state.revision} / turn ${state.turn} / events ${state.history.length}`;
  turnNumber.value = String(state.turn);
  const fieldConditions = conditionNames(state.fieldConditions);
  const p1Conditions = conditionNames(state.sides.p1.conditions);
  const p2Conditions = conditionNames(state.sides.p2.conditions);
  const recent = state.history.slice(-12).reverse();

  stateView.className = 'state-summary';
  stateView.innerHTML = `
    <section class="field-summary">
      <div><span>天候</span><strong>${escapeHtml(state.weather?.displayName ?? 'なし')}</strong></div>
      <div><span>フィールド</span><strong>${escapeHtml(state.terrain?.displayName ?? 'なし')}</strong></div>
      <div><span>場全体</span><div class="condition-tags">${tags(fieldConditions)}</div></div>
      <div><span>自分側</span><div class="condition-tags">${tags(p1Conditions)}</div></div>
      <div><span>相手側</span><div class="condition-tags">${tags(p2Conditions)}</div></div>
    </section>
    <section class="active-grid">
      ${pokemonCard('p1a', state.active.p1a)}
      ${pokemonCard('p1b', state.active.p1b)}
      ${pokemonCard('p2a', state.active.p2a)}
      ${pokemonCard('p2b', state.active.p2b)}
    </section>
    <section>
      <div class="section-heading"><h2>最近のイベント</h2></div>
      <div class="history-list">
        ${recent.length ? recent.map((event) => `<div class="history-row">${escapeHtml(JSON.stringify(event))}</div>`).join('') : '<div class="history-row">イベントなし</div>'}
      </div>
    </section>`;
}

async function refreshState(silent = false): Promise<void> {
  try {
    const state = await requestJson<BattleState>('/api/state');
    renderState(state);
    if (!silent) statusText.textContent = 'BattleState 接続済み';
  } catch (error) {
    if (!silent) statusText.textContent = error instanceof Error ? error.message : '接続失敗';
  }
}

async function postEvents(events: Record<string, unknown>[]): Promise<void> {
  const state = await requestJson<BattleState>('/api/state/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  renderState(state);
  statusText.textContent = 'イベント反映済み';
}

pokemonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const slot = formValue(pokemonForm, 'slot') as ActiveSlot;
    const type = formValue(pokemonForm, 'eventType');
    const value = formValue(pokemonForm, 'value').trim();
    const current = Number(formValue(pokemonForm, 'currentHp'));
    const max = Number(formValue(pokemonForm, 'maxHp'));
    const percentInput = Number(formValue(pokemonForm, 'hpPercent'));
    const exact = formChecked(pokemonForm, 'exactHp');
    const percent = exact && max > 0 ? current / max * 100 : percentInput;
    const hp = {
      current: exact ? current : null,
      max: exact ? max : null,
      percent,
      exact,
    };

    let battleEvent: Record<string, unknown>;
    switch (type) {
      case 'switch': battleEvent = { type, slot, species: value, hp, source: 'manual' }; break;
      case 'hp': battleEvent = { type, slot, hp, source: 'manual' }; break;
      case 'status': battleEvent = { type, slot, status: value === 'なし' || value === 'none' ? null : value, source: 'manual' }; break;
      case 'boost': battleEvent = {
        type,
        slot,
        stat: formValue(pokemonForm, 'stat'),
        amount: Number(formValue(pokemonForm, 'amount')),
        mode: formValue(pokemonForm, 'boostMode'),
        source: 'manual',
      }; break;
      case 'move': battleEvent = { type, slot, move: value, source: 'manual' }; break;
      case 'faint': battleEvent = { type, slot, source: 'manual' }; break;
      default: throw new Error('未対応のイベントです。');
    }
    await postEvents([battleEvent]);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '反映失敗';
  }
});

conditionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const scope = formValue(conditionForm, 'scope');
    const action = formValue(conditionForm, 'action') as 'start' | 'end';
    const condition = formValue(conditionForm, 'condition').trim();
    let battleEvent: Record<string, unknown>;
    if (scope === 'weather' || scope === 'terrain') {
      battleEvent = { type: scope, condition: action === 'start' ? condition : null, displayName: condition, source: 'manual' };
    } else if (scope === 'field') {
      battleEvent = { type: 'fieldCondition', action, condition, displayName: condition, source: 'manual' };
    } else if (scope === 'p1' || scope === 'p2') {
      battleEvent = { type: 'sideCondition', action, side: scope, condition, displayName: condition, source: 'manual' };
    } else {
      battleEvent = { type: 'volatile', action, slot: scope, condition, displayName: condition, source: 'manual' };
    }
    await postEvents([battleEvent]);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '反映失敗';
  }
});

protocolForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson<{ state: BattleState; parsedEvents: number }>('/api/state/showdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: protocolText.value }),
    });
    renderState(body.state);
    statusText.textContent = `${body.parsedEvents}件のShowdownイベントを反映`;
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '取込失敗';
  }
});

requiredElement<HTMLButtonElement>('#set-turn').addEventListener('click', () => {
  void postEvents([{ type: 'turn', turn: Number(turnNumber.value), source: 'manual' }]);
});

requiredElement<HTMLButtonElement>('#next-turn').addEventListener('click', async () => {
  const state = await requestJson<BattleState>('/api/state');
  await postEvents([{ type: 'turn', turn: state.turn + 1, source: 'manual' }]);
});

requiredElement<HTMLButtonElement>('#reset-state').addEventListener('click', async () => {
  const state = await requestJson<BattleState>('/api/state/reset', { method: 'POST' });
  renderState(state);
  statusText.textContent = 'BattleStateをリセットしました';
});

void refreshState();
window.setInterval(() => void refreshState(true), 1500);
