import { renderEvaluation, renderState } from './live-render.js';
import type {
  ActiveSlot,
  BattleState,
  BattleStats,
  CurrentEvaluationResponse,
  SearchResult,
  SideId,
} from './live-types.js';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

const statusText = required<HTMLElement>('#live-status');
const stateView = required<HTMLElement>('#state-view');
const stateMeta = required<HTMLElement>('#state-meta');
const teamForm = required<HTMLFormElement>('#team-form');
const pokemonForm = required<HTMLFormElement>('#pokemon-event-form');
const conditionForm = required<HTMLFormElement>('#condition-form');
const protocolForm = required<HTMLFormElement>('#protocol-form');
const protocolText = required<HTMLTextAreaElement>('#protocol-text');
const turnNumber = required<HTMLInputElement>('#turn-number');
const evaluationView = required<HTMLElement>('#evaluation-view');
const evaluationSide = required<HTMLSelectElement>('#evaluation-side');
const evaluationFormat = required<HTMLInputElement>('#evaluation-format');
const evaluateButton = required<HTMLButtonElement>('#evaluate-current');

function control(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement {
  const value = form.elements.namedItem(name);
  if (!(value instanceof HTMLInputElement || value instanceof HTMLSelectElement)) {
    throw new Error(`${name}が見つかりません。`);
  }
  return value;
}

function value(form: HTMLFormElement, name: string): string {
  return control(form, name).value;
}

function checked(form: HTMLFormElement, name: string): boolean {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${name}が見つかりません。`);
  return input.checked;
}

function optionalNumber(form: HTMLFormElement, name: string): number | null {
  const text = value(form, name).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'APIエラー');
  return body as T;
}

async function postEvents(events: Record<string, unknown>[]): Promise<BattleState> {
  const state = await json<BattleState>('/api/state/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  renderState(state, stateView, stateMeta, turnNumber);
  statusText.textContent = 'イベント反映済み';
  return state;
}

async function refresh(silent = false): Promise<void> {
  try {
    const state = await json<BattleState>('/api/state');
    renderState(state, stateView, stateMeta, turnNumber);
    if (!silent) statusText.textContent = 'BattleState 接続済み';
  } catch (error) {
    if (!silent) statusText.textContent = error instanceof Error ? error.message : '接続失敗';
  }
}

function moves(text: string): string[] {
  return text.split(/[、,]/).map((move) => move.trim()).filter(Boolean).slice(0, 4);
}

function stats(): BattleStats | null {
  const entries = ['statHp', 'statAtk', 'statDef', 'statSpa', 'statSpd', 'statSpe']
    .map((name) => optionalNumber(teamForm, name));
  if (entries.every((entry) => entry === null)) return null;
  if (entries.some((entry) => entry === null || entry <= 0)) {
    throw new Error('実数値は6項目すべて入力するか、すべて空欄にしてください。');
  }
  return {
    hp: entries[0]!, atk: entries[1]!, def: entries[2]!,
    spa: entries[3]!, spd: entries[4]!, spe: entries[5]!,
  };
}

function hpFrom(form: HTMLFormElement): Record<string, unknown> {
  const exact = checked(form, 'exactHp');
  const current = Number(value(form, 'currentHp'));
  const max = Number(value(form, 'maxHp'));
  const percent = exact && max > 0 ? current / max * 100 : Number(value(form, 'hpPercent'));
  return { current: exact ? current : null, max: exact ? max : null, percent, exact };
}

teamForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const item = value(teamForm, 'item').trim();
    const ability = value(teamForm, 'ability').trim();
    const teraType = value(teamForm, 'teraType').trim();
    await postEvents([{
      type: 'teamMember',
      side: value(teamForm, 'side') as SideId,
      teamIndex: Number(value(teamForm, 'teamIndex')),
      species: value(teamForm, 'species').trim(),
      level: Number(value(teamForm, 'level')),
      hp: hpFrom(teamForm),
      moves: moves(value(teamForm, 'moves')),
      item: item || null,
      ability: ability || null,
      teraType: teraType || null,
      teraActive: checked(teamForm, 'teraActive'),
      stats: stats(),
      source: 'manual',
    }]);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : 'チーム登録失敗';
  }
});

pokemonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const slot = value(pokemonForm, 'slot') as ActiveSlot;
    const type = value(pokemonForm, 'eventType');
    const input = value(pokemonForm, 'value').trim();
    let battleEvent: Record<string, unknown>;
    if (type === 'switch') {
      battleEvent = { type, slot, species: input, teamIndex: Number(value(pokemonForm, 'teamIndex')), hp: hpFrom(pokemonForm), source: 'manual' };
    } else if (type === 'hp') {
      battleEvent = { type, slot, hp: hpFrom(pokemonForm), source: 'manual' };
    } else if (type === 'status') {
      battleEvent = { type, slot, status: input === 'なし' || input === 'none' ? null : input, source: 'manual' };
    } else if (type === 'boost') {
      battleEvent = {
        type, slot, stat: value(pokemonForm, 'stat'), amount: Number(value(pokemonForm, 'amount')),
        mode: value(pokemonForm, 'boostMode'), source: 'manual',
      };
    } else if (type === 'move') {
      battleEvent = { type, slot, move: input, source: 'manual' };
    } else if (type === 'faint') {
      battleEvent = { type, slot, source: 'manual' };
    } else {
      throw new Error('未対応のイベントです。');
    }
    await postEvents([battleEvent]);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '反映失敗';
  }
});

conditionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const scope = value(conditionForm, 'scope');
    const action = value(conditionForm, 'action') as 'start' | 'end';
    const condition = value(conditionForm, 'condition').trim();
    const duration = optionalNumber(conditionForm, 'duration');
    const durationPatch = duration === null ? {} : { duration };
    let battleEvent: Record<string, unknown>;
    if (scope === 'weather' || scope === 'terrain') {
      battleEvent = { type: scope, condition: action === 'start' ? condition : null, displayName: condition, ...durationPatch, source: 'manual' };
    } else if (scope === 'field') {
      battleEvent = { type: 'fieldCondition', action, condition, displayName: condition, ...durationPatch, source: 'manual' };
    } else if (scope === 'p1' || scope === 'p2') {
      battleEvent = { type: 'sideCondition', action, side: scope, condition, displayName: condition, ...durationPatch, source: 'manual' };
    } else {
      battleEvent = { type: 'volatile', action, slot: scope, condition, displayName: condition, ...durationPatch, source: 'manual' };
    }
    await postEvents([battleEvent]);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '反映失敗';
  }
});

protocolForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await json<{ state: BattleState; parsedEvents: number }>('/api/state/showdown', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: protocolText.value }),
    });
    renderState(result.state, stateView, stateMeta, turnNumber);
    statusText.textContent = `${result.parsedEvents}件のShowdownイベントを反映`;
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '取込失敗';
  }
});

required<HTMLButtonElement>('#set-turn').addEventListener('click', () => {
  void postEvents([{ type: 'turn', turn: Number(turnNumber.value), source: 'manual' }]);
});

required<HTMLButtonElement>('#next-turn').addEventListener('click', async () => {
  const state = await json<BattleState>('/api/state');
  await postEvents([{ type: 'turn', turn: state.turn + 1, source: 'manual' }]);
});

required<HTMLButtonElement>('#reset-state').addEventListener('click', async () => {
  const state = await json<BattleState>('/api/state/reset', { method: 'POST' });
  renderState(state, stateView, stateMeta, turnNumber);
  evaluationView.className = 'empty-state compact-empty';
  evaluationView.textContent = 'まだ評価していません。';
  statusText.textContent = 'BattleStateをリセットしました';
});

evaluateButton.addEventListener('click', async () => {
  evaluateButton.disabled = true;
  statusText.textContent = '現在盤面を評価中…';
  try {
    const result = await json<CurrentEvaluationResponse>('/api/evaluate-current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: evaluationSide.value, formatId: evaluationFormat.value.trim() }),
    });
    renderEvaluation(result, evaluationView);
    statusText.textContent = '現在盤面の評価完了';
  } catch (error) {
    evaluationView.className = 'empty-state compact-empty';
    evaluationView.textContent = error instanceof Error ? error.message : '評価失敗';
    statusText.textContent = '評価に失敗しました';
  } finally {
    evaluateButton.disabled = false;
  }
});

function attachAutocomplete(input: HTMLInputElement): void {
  const list = document.createElement('datalist');
  list.id = 'live-species-suggestions';
  document.body.append(list);
  input.setAttribute('list', list.id);
  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = input.value.trim();
    if (!query) return;
    timer = window.setTimeout(async () => {
      try {
        const result = await json<{ results: SearchResult[] }>(`/api/search?kind=species&q=${encodeURIComponent(query)}`);
        list.replaceChildren(...result.results.map((item) => {
          const option = document.createElement('option');
          option.value = item.value;
          option.label = item.displayName === item.englishName ? item.displayName : `${item.displayName} / ${item.englishName}`;
          return option;
        }));
      } catch {
        list.replaceChildren();
      }
    }, 180);
  });
}

const speciesInput = teamForm.elements.namedItem('species');
if (speciesInput instanceof HTMLInputElement) attachAutocomplete(speciesInput);

void refresh();
window.setInterval(() => void refresh(true), 1500);
