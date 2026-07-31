import { renderEvaluation, renderSession, renderState } from './live-render.js';
import type {
  ActiveSlot,
  BattleSessionSnapshot,
  BattleState,
  BattleStats,
  CurrentActionEvaluation,
  CurrentEvaluationResponse,
  JointActionEvaluation,
  PersistedBattleSession,
  SearchResult,
  SessionResult,
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
const sessionView = required<HTMLElement>('#session-view');
const sessionTitle = required<HTMLInputElement>('#session-title');
const sessionResult = required<HTMLSelectElement>('#session-result');
const sessionNotes = required<HTMLTextAreaElement>('#session-notes');
const importSessionFile = required<HTMLInputElement>('#import-session-file');
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

let latestEvaluation: CurrentEvaluationResponse | null = null;
let lastKnownRevision = -1;

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

function invalidateEvaluation(message = '盤面が変化しました。再評価してください。'): void {
  latestEvaluation = null;
  evaluationView.className = 'empty-state compact-empty';
  evaluationView.textContent = message;
}

function applySessionSnapshot(snapshot: BattleSessionSnapshot, preserveInputs = false): void {
  renderSession(snapshot, sessionView);
  renderState(snapshot.state, stateView, stateMeta, turnNumber);
  lastKnownRevision = snapshot.state.revision;
  if (!preserveInputs) {
    sessionTitle.value = snapshot.metadata.title;
    evaluationFormat.value = snapshot.metadata.formatId;
    sessionNotes.value = snapshot.metadata.notes;
    sessionResult.value = snapshot.metadata.result ?? 'unknown';
  }
}

async function refreshSession(silent = false): Promise<void> {
  try {
    const snapshot = await json<BattleSessionSnapshot>('/api/session');
    const revisionChanged = lastKnownRevision >= 0 && snapshot.state.revision !== lastKnownRevision;
    applySessionSnapshot(snapshot, true);
    if (revisionChanged && latestEvaluation && latestEvaluation.revision !== snapshot.state.revision) {
      invalidateEvaluation();
    }
    if (!silent) statusText.textContent = snapshot.metadata.status === 'active' ? '対戦セッション接続済み' : '終了済みセッションを表示中';
  } catch (error) {
    if (!silent) statusText.textContent = error instanceof Error ? error.message : '接続失敗';
  }
}

async function postEvents(events: Record<string, unknown>[]): Promise<BattleState> {
  const state = await json<BattleState>('/api/state/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  renderState(state, stateView, stateMeta, turnNumber);
  lastKnownRevision = state.revision;
  invalidateEvaluation();
  await refreshSession(true);
  statusText.textContent = 'イベントを保存しました';
  return state;
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
    lastKnownRevision = result.state.revision;
    invalidateEvaluation();
    await refreshSession(true);
    statusText.textContent = `${result.parsedEvents}件のShowdownイベントを保存しました`;
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

required<HTMLButtonElement>('#new-session').addEventListener('click', async () => {
  if (!window.confirm('現在の対戦を閉じて新しい対戦を開始しますか？先にJSON保存することを推奨します。')) return;
  try {
    const snapshot = await json<BattleSessionSnapshot>('/api/session/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: sessionTitle.value.trim(), formatId: evaluationFormat.value.trim() }),
    });
    applySessionSnapshot(snapshot);
    invalidateEvaluation('新しい対戦を開始しました。');
    statusText.textContent = '新しい対戦を開始しました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '新規対戦の開始に失敗しました';
  }
});

required<HTMLButtonElement>('#undo-event').addEventListener('click', async () => {
  try {
    const snapshot = await json<BattleSessionSnapshot>('/api/session/undo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1 }),
    });
    applySessionSnapshot(snapshot, true);
    invalidateEvaluation('最後の入力を取り消しました。再評価してください。');
    statusText.textContent = '最後のイベントを取り消しました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '取消に失敗しました';
  }
});

required<HTMLButtonElement>('#export-session').addEventListener('click', async () => {
  try {
    const data = await json<PersistedBattleSession>('/api/session/export');
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.metadata.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    statusText.textContent = '対戦JSONを保存しました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '保存に失敗しました';
  }
});

required<HTMLButtonElement>('#import-session').addEventListener('click', () => importSessionFile.click());
importSessionFile.addEventListener('change', async () => {
  const file = importSessionFile.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text()) as unknown;
    const snapshot = await json<BattleSessionSnapshot>('/api/session/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imported),
    });
    applySessionSnapshot(snapshot);
    invalidateEvaluation('対戦データを読み込みました。');
    statusText.textContent = '対戦JSONを読み込みました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '読込に失敗しました';
  } finally {
    importSessionFile.value = '';
  }
});

required<HTMLButtonElement>('#finish-session').addEventListener('click', async () => {
  try {
    const snapshot = await json<BattleSessionSnapshot>('/api/session/finish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: sessionResult.value as SessionResult, notes: sessionNotes.value }),
    });
    applySessionSnapshot(snapshot, true);
    statusText.textContent = '対戦結果を確定して保存しました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '対戦終了処理に失敗しました';
  }
});

required<HTMLButtonElement>('#reset-state').addEventListener('click', async () => {
  if (!window.confirm('現在の盤面と履歴を初期化しますか？')) return;
  const state = await json<BattleState>('/api/state/reset', { method: 'POST' });
  renderState(state, stateView, stateMeta, turnNumber);
  lastKnownRevision = state.revision;
  invalidateEvaluation('盤面を初期化しました。');
  await refreshSession(true);
  statusText.textContent = '盤面を初期化しました';
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
    latestEvaluation = result;
    renderEvaluation(result, evaluationView);
    statusText.textContent = '現在盤面の評価完了';
  } catch (error) {
    latestEvaluation = null;
    evaluationView.className = 'empty-state compact-empty';
    evaluationView.textContent = error instanceof Error ? error.message : '評価失敗';
    statusText.textContent = '評価に失敗しました';
  } finally {
    evaluateButton.disabled = false;
  }
});

function findIndividual(id: string): CurrentActionEvaluation | null {
  if (!latestEvaluation) return null;
  for (const entry of latestEvaluation.pokemon) {
    const action = entry.actions.find((candidate) => candidate.id === id);
    if (action) return action;
  }
  return null;
}

function findJoint(id: string): JointActionEvaluation | null {
  return latestEvaluation?.jointActions.find((candidate) => candidate.id === id) ?? null;
}

evaluationView.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('adopt-action')) return;
  if (!latestEvaluation) {
    statusText.textContent = '先に現在盤面を再評価してください';
    return;
  }
  const actionId = target.dataset.actionId ?? '';
  const kind = target.dataset.kind;
  const individual = kind === 'individual' ? findIndividual(actionId) : null;
  const joint = kind === 'joint' ? findJoint(actionId) : null;
  if (!individual && !joint) {
    statusText.textContent = '行動候補が見つかりません';
    return;
  }
  target.disabled = true;
  try {
    const snapshot = await json<BattleSessionSnapshot>('/api/session/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(individual ? {
        evaluationRevision: latestEvaluation.revision,
        side: latestEvaluation.side,
        kind: 'individual',
        actionId: individual.id,
        label: individual.label,
        score: individual.score.final,
        actorSlots: [individual.actorSlot],
      } : {
        evaluationRevision: latestEvaluation.revision,
        side: latestEvaluation.side,
        kind: 'joint',
        actionId: joint!.id,
        label: joint!.actions.join(' ＋ '),
        score: joint!.score,
        actorSlots: joint!.actorSlots,
      }),
    });
    renderSession(snapshot, sessionView);
    statusText.textContent = '採用行動を対戦ログへ記録しました';
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '行動記録に失敗しました';
  } finally {
    target.disabled = false;
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

void refreshSession().then(async () => {
  const snapshot = await json<BattleSessionSnapshot>('/api/session');
  applySessionSnapshot(snapshot);
});
window.setInterval(() => void refreshSession(true), 2000);
