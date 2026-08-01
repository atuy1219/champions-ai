const PARTY_KEY = 'champions-ai.parties.v1';
const ACTIVE_PARTY_KEY = 'champions-ai.active-party.v1';
const FORMAT_ID = 'gen9championsvgc2026regma';
const SELF_SIDE_CONDITIONS = new Set(['tailwind', 'reflect', 'lightscreen', 'auroraveil', 'safeguard', 'mist', 'luckychant']);
const STAT_NAMES = { atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ', accuracy: '命中', evasion: '回避' };

const ABILITY_EFFECTS = {
  drizzle: { type: 'weather', condition: 'raindance', label: '雨' },
  あめふらし: { type: 'weather', condition: 'raindance', label: '雨' },
  drought: { type: 'weather', condition: 'sunnyday', label: '晴れ' },
  ひでり: { type: 'weather', condition: 'sunnyday', label: '晴れ' },
  sandstream: { type: 'weather', condition: 'sandstorm', label: '砂嵐' },
  すなおこし: { type: 'weather', condition: 'sandstorm', label: '砂嵐' },
  snowwarning: { type: 'weather', condition: 'snow', label: '雪' },
  ゆきふらし: { type: 'weather', condition: 'snow', label: '雪' },
  electricsurge: { type: 'terrain', condition: 'electricterrain', label: 'エレキフィールド' },
  エレキメイカー: { type: 'terrain', condition: 'electricterrain', label: 'エレキフィールド' },
  grassysurge: { type: 'terrain', condition: 'grassyterrain', label: 'グラスフィールド' },
  グラスメイカー: { type: 'terrain', condition: 'grassyterrain', label: 'グラスフィールド' },
  mistysurge: { type: 'terrain', condition: 'mistyterrain', label: 'ミストフィールド' },
  ミストメイカー: { type: 'terrain', condition: 'mistyterrain', label: 'ミストフィールド' },
  psychicsurge: { type: 'terrain', condition: 'psychicterrain', label: 'サイコフィールド' },
  サイコメイカー: { type: 'terrain', condition: 'psychicterrain', label: 'サイコフィールド' },
  hadronengine: { type: 'terrain', condition: 'electricterrain', label: 'エレキフィールド' },
  ハドロンエンジン: { type: 'terrain', condition: 'electricterrain', label: 'エレキフィールド' },
  orichalcumpulse: { type: 'weather', condition: 'sunnyday', label: '晴れ' },
  ひひいろのこどう: { type: 'weather', condition: 'sunnyday', label: '晴れ' },
  neutralizinggas: { type: 'fieldCondition', condition: 'neutralizinggas', label: 'かがくへんかガス' },
  かがくへんかガス: { type: 'fieldCondition', condition: 'neutralizinggas', label: 'かがくへんかガス' },
};

const q = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`UIが見つかりません: ${selector}`);
  return element;
};

const status = q('#live-status');
const toast = q('#toast');
const stateStrip = q('#state-strip');
const battleBoard = q('#battle-board');
const partySelect = q('#party-select');
const ownLeft = q('#own-left');
const ownRight = q('#own-right');
const form = q('#opponent-form');
const evaluationView = q('#evaluation-view');
const inferenceNote = q('#inference-note');
let selectedOpponentSlot = 'p2a';
let latestState = null;
let latestEvaluation = null;
let dexPromise = null;

function waitForApi() {
  if (window.__championsApiReady) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('champions-api-ready', resolve, { once: true }));
}

async function json(path, init) {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '処理に失敗しました。');
  return body;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s・･_-]+/g, '');
}

function toId(value) {
  return String(value ?? '').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function readParties() {
  try { return JSON.parse(localStorage.getItem(PARTY_KEY) ?? '{}'); } catch { return {}; }
}

function hp(percent) {
  return { current: null, max: null, percent: Math.max(0, Math.min(100, Number(percent))), exact: false };
}

function sideFromSlot(slot) { return slot.slice(0, 2); }
function otherSide(side) { return side === 'p1' ? 'p2' : 'p1'; }
function oppositeSlots(slot) { return sideFromSlot(slot) === 'p1' ? ['p2a', 'p2b'] : ['p1a', 'p1b']; }

async function loadDex() {
  dexPromise ??= fetch('./data/champions-dex.json').then((response) => {
    if (!response.ok) throw new Error('Championsデータを読み込めませんでした。');
    return response.json();
  });
  return dexPromise;
}

async function exactSearch(kind, input) {
  const query = input.trim();
  if (!query) return null;
  const body = await json(`/api/search?kind=${kind}&q=${encodeURIComponent(query)}`);
  const normalized = normalize(query);
  return body.results.find((entry) => normalize(entry.value) === normalized || normalize(entry.englishName) === normalized)
    ?? body.results[0]
    ?? null;
}

function extendedDuration(condition, item, source) {
  if (source === 'ability') return null;
  const itemId = normalize(item);
  if (['reflect', 'lightscreen', 'auroraveil'].includes(condition) && ['ひかりのねんど', 'lightclay'].includes(itemId)) return 8;
  if (condition.endsWith('terrain') && ['グランドコート', 'terrainextender'].includes(itemId)) return 8;
  const rocks = {
    raindance: ['しめったいわ', 'damprock'],
    sunnyday: ['あついいわ', 'heatrock'],
    sandstorm: ['さらさらいわ', 'smoothrock'],
    snow: ['つめたいいわ', 'icyrock'],
  };
  if (rocks[condition]?.includes(itemId)) return 8;
  return undefined;
}

function abilityEvents(ability, actorSlot, state) {
  const id = normalize(ability);
  if (!id) return [];
  if (id === 'いかく' || id === 'intimidate') {
    return oppositeSlots(actorSlot)
      .filter((slot) => state.active?.[slot])
      .map((slot) => ({ type: 'boost', slot, stat: 'atk', amount: -1, source: 'manual' }));
  }
  if (id === 'ふとうのけん' || id === 'intrepidsword') {
    return [{ type: 'boost', slot: actorSlot, stat: 'atk', amount: 1, source: 'manual' }];
  }
  if (id === 'ふくつのたて' || id === 'dauntlessshield') {
    return [{ type: 'boost', slot: actorSlot, stat: 'def', amount: 1, source: 'manual' }];
  }
  const effect = ABILITY_EFFECTS[id];
  if (!effect) return [];
  if (effect.type === 'weather' || effect.type === 'terrain') {
    return [{ type: effect.type, condition: effect.condition, displayName: effect.label, duration: null, source: 'manual' }];
  }
  return [{ type: 'fieldCondition', action: 'start', condition: effect.condition, displayName: effect.label, duration: null, source: 'manual' }];
}

async function moveEvents(moveInput, actorSlot, item = '') {
  const search = await exactSearch('moves', moveInput);
  if (!search) return { events: [], summary: '' };
  const dex = await loadDex();
  const move = dex.moves?.[toId(search.englishName)] ?? Object.values(dex.moves ?? {}).find((entry) => entry.name === search.englishName);
  if (!move) return { events: [{ type: 'move', slot: actorSlot, move: search.value, source: 'manual' }], summary: search.value };

  const actorSide = sideFromSlot(actorSlot);
  const events = [{ type: 'move', slot: actorSlot, move: search.value, source: 'manual' }];
  const inferred = [];

  if (move.weather) {
    events.push({ type: 'weather', condition: move.weather, displayName: search.value, duration: extendedDuration(move.weather, item, 'move'), source: 'manual' });
    inferred.push('天候');
  }
  if (move.terrain) {
    events.push({ type: 'terrain', condition: move.terrain, displayName: search.value, duration: extendedDuration(move.terrain, item, 'move'), source: 'manual' });
    inferred.push('フィールド');
  }
  if (move.pseudoWeather) {
    events.push({ type: 'fieldCondition', action: 'start', condition: move.pseudoWeather, displayName: search.value, source: 'manual' });
    inferred.push('場全体');
  }
  if (move.sideCondition) {
    const condition = normalize(move.sideCondition);
    const side = SELF_SIDE_CONDITIONS.has(condition) ? actorSide : otherSide(actorSide);
    events.push({
      type: 'sideCondition', action: 'start', side, condition: move.sideCondition, displayName: search.value,
      duration: extendedDuration(condition, item, 'move'), source: 'manual',
    });
    inferred.push(side === actorSide ? '使用者側' : '相手側');
  }
  const boosts = move.selfBoost?.boosts ?? (move.target === 'self' ? move.boosts : null);
  if (boosts) {
    for (const [stat, amount] of Object.entries(boosts)) {
      if (STAT_NAMES[stat] && Number(amount)) events.push({ type: 'boost', slot: actorSlot, stat, amount: Number(amount), source: 'manual' });
    }
    inferred.push('能力ランク');
  }
  if (move.volatileStatus && move.target === 'self') {
    events.push({ type: 'volatile', action: 'start', slot: actorSlot, condition: move.volatileStatus, displayName: search.value, source: 'manual' });
    inferred.push('一時状態');
  }
  return { events, summary: inferred.length ? `${search.value}から${inferred.join('・')}を自動反映` : `${search.value}を記録` };
}

async function postEvents(events) {
  if (!events.length) return latestState;
  latestState = await json('/api/state/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }),
  });
  renderState(latestState);
  return latestState;
}

function activeCard(mon, emptyText) {
  if (!mon) return `<div class="battle-mon"><strong>${emptyText}</strong><small>未設定</small></div>`;
  const hpText = `${mon.hp?.percent?.toFixed?.(1) ?? mon.hp?.percent ?? 100}%`;
  const details = [mon.ability, mon.item].filter(Boolean).join(' / ');
  return `<div class="battle-mon"><strong>${escapeHtml(mon.species)}</strong><span>HP ${hpText}</span><small>${escapeHtml(details || '情報なし')}</small></div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function renderState(state) {
  const chips = [`ターン ${state.turn}`];
  if (state.weather) chips.push(state.weather.displayName);
  if (state.terrain) chips.push(state.terrain.displayName);
  for (const condition of Object.values(state.fieldConditions ?? {})) chips.push(condition.displayName);
  for (const side of ['p1', 'p2']) {
    for (const condition of Object.values(state.sides?.[side]?.conditions ?? {})) chips.push(`${side === 'p1' ? '自' : '相'}:${condition.displayName}`);
  }
  stateStrip.innerHTML = chips.map((chip) => `<span class="state-chip">${escapeHtml(chip)}</span>`).join('');
  battleBoard.innerHTML = `
    <div class="battle-side">${activeCard(state.active?.p1a, '自分 左')}${activeCard(state.active?.p1b, '自分 右')}</div>
    <div class="board-vs">VS</div>
    <div class="battle-side">${activeCard(state.active?.p2a, '相手 左')}${activeCard(state.active?.p2b, '相手 右')}</div>`;
  populateOwnSelectors(state);
  fillOpponentForm(state.active?.[selectedOpponentSlot]);
}

function populateOwnSelectors(state) {
  const team = state.sides?.p1?.team ?? [];
  const makeOptions = (select, active) => {
    const current = select.value;
    select.replaceChildren(new Option('未設定', ''));
    for (const member of team) select.append(new Option(`${member.teamIndex}. ${member.species}`, String(member.teamIndex)));
    select.value = active?.teamIndex ? String(active.teamIndex) : current;
  };
  makeOptions(ownLeft, state.active?.p1a);
  makeOptions(ownRight, state.active?.p1b);
}

function fillOpponentForm(mon) {
  if (!mon) return;
  form.elements.species.value = mon.species === 'Unknown' ? '' : mon.species;
  form.elements.ability.value = mon.ability ?? '';
  form.elements.item.value = mon.item ?? '';
  form.elements.hpPercent.value = String(mon.hp?.percent ?? 100);
}

function populateParties() {
  const parties = readParties();
  const activeId = localStorage.getItem(ACTIVE_PARTY_KEY) ?? '';
  partySelect.replaceChildren(new Option('パーティーを選択', ''));
  for (const party of Object.values(parties).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    partySelect.append(new Option(`${party.name}（${party.members?.length ?? 0}匹）`, party.id));
  }
  if (parties[activeId]) partySelect.value = activeId;
}

async function loadPartyIntoBattle() {
  const parties = readParties();
  const party = parties[partySelect.value];
  if (!party) throw new Error('パーティーを選択してください。');
  localStorage.setItem(ACTIVE_PARTY_KEY, party.id);
  await json('/api/session/new', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: party.name, formatId: FORMAT_ID }),
  });
  const events = party.members.map((member) => {
    const max = member.stats?.hp ?? member.hp?.max ?? 1;
    return {
      type: 'teamMember', side: 'p1', teamIndex: member.teamIndex, species: member.species, level: 50,
      hp: { current: max, max, percent: 100, exact: true }, moves: member.moves ?? [], item: member.item ?? null,
      ability: member.ability ?? null, teraType: null, teraActive: false, stats: member.stats ?? null, source: 'manual',
    };
  });
  const first = party.members[0];
  const second = party.members[1];
  if (first) events.push({ type: 'switch', slot: 'p1a', species: first.species, teamIndex: first.teamIndex, source: 'manual' });
  if (second) events.push({ type: 'switch', slot: 'p1b', species: second.species, teamIndex: second.teamIndex, source: 'manual' });
  await postEvents(events);
  notify(`「${party.name}」を読み込みました`);
  await evaluate();
}

async function setOwnActive() {
  const events = [];
  const team = latestState?.sides?.p1?.team ?? [];
  for (const [slot, select] of [['p1a', ownLeft], ['p1b', ownRight]]) {
    const index = Number(select.value);
    if (!index) continue;
    const member = team.find((entry) => entry.teamIndex === index);
    if (member && latestState.active?.[slot]?.teamIndex !== index) {
      events.push({ type: 'switch', slot, species: member.species, teamIndex: index, source: 'manual' });
      events.push(...abilityEvents(member.ability, slot, latestState));
    }
  }
  await postEvents(events);
  if (events.length) await evaluate();
}

async function applyOpponent(event) {
  event.preventDefault();
  const button = q('#apply-opponent');
  button.disabled = true;
  try {
    const speciesInput = form.elements.species.value.trim();
    const speciesResult = await exactSearch('species', speciesInput);
    if (!speciesResult) throw new Error('相手のポケモンを候補から選択してください。');
    const species = speciesResult.value;
    const ability = form.elements.ability.value.trim();
    const item = form.elements.item.value.trim();
    const move = form.elements.move.value.trim();
    const percent = Number(form.elements.hpPercent.value);
    const current = latestState.active?.[selectedOpponentSlot];
    const existing = latestState.sides?.p2?.team?.find((member) => normalize(member.species) === normalize(species));
    const usedIndexes = latestState.sides?.p2?.team?.map((member) => member.teamIndex) ?? [];
    const teamIndex = existing?.teamIndex ?? [1, 2, 3, 4, 5, 6].find((index) => !usedIndexes.includes(index)) ?? 6;
    const switched = !current || normalize(current.species) !== normalize(species);
    const info = { ability: ability || undefined, item: item || undefined };
    const events = switched
      ? [{ type: 'switch', slot: selectedOpponentSlot, species, teamIndex, hp: hp(percent), ...info, source: 'manual' }]
      : [{ type: 'pokemonInfo', slot: selectedOpponentSlot, teamIndex, ...info, source: 'manual' }, { type: 'hp', slot: selectedOpponentSlot, hp: hp(percent), source: 'manual' }];

    const abilityChanged = ability && (switched || normalize(current?.ability) !== normalize(ability));
    if (abilityChanged) events.push(...abilityEvents(ability, selectedOpponentSlot, latestState));
    let summary = abilityChanged ? `${ability}の発動効果を自動反映` : '';
    if (move) {
      const inferred = await moveEvents(move, selectedOpponentSlot, item || current?.item || '');
      events.push(...inferred.events);
      summary = [summary, inferred.summary].filter(Boolean).join('、');
    }
    await postEvents(events);
    form.elements.move.value = '';
    inferenceNote.textContent = summary || '相手情報を更新しました。場に影響する技・特性はありません。';
    notify('相手情報を反映しました');
    await evaluate();
  } finally {
    button.disabled = false;
  }
}

function renderEvaluation(result) {
  latestEvaluation = result;
  if (!result.pokemon?.length) {
    evaluationView.className = 'empty-message';
    evaluationView.textContent = result.warnings?.[0] ?? '自分の場を設定してください。';
    return;
  }
  const sections = result.pokemon.map((entry) => {
    const cards = entry.actions.slice(0, 3).map((action, index) => `
      <article class="action-card ${index === 0 ? 'top' : ''}">
        <header><h3>${escapeHtml(action.label)}</h3><strong>${action.score.final.toFixed(1)}</strong></header>
        <p>${escapeHtml(action.reasons.slice(0, 2).join(' / '))}</p>
        <button type="button" data-action-id="${escapeHtml(action.id)}">この手を採用して記録</button>
      </article>`).join('');
    return `<section><h3>${escapeHtml(entry.species)}の候補</h3><div class="action-group">${cards}</div></section>`;
  }).join('');
  const joint = result.jointActions?.slice(0, 2).map((action) => `
    <article class="action-card top"><header><h3>${escapeHtml(action.actions.join(' ＋ '))}</h3><strong>${action.score.toFixed(1)}</strong></header>
    <p>${escapeHtml(action.reasons.slice(0, 2).join(' / '))}</p></article>`).join('') ?? '';
  evaluationView.className = 'action-group';
  evaluationView.innerHTML = `${joint ? `<section><h3>同時行動</h3><div class="action-group">${joint}</div></section>` : ''}${sections}`;
}

async function evaluate() {
  const button = q('#evaluate');
  button.disabled = true;
  status.textContent = '評価中…';
  try {
    const result = await json('/api/evaluate-current', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 'p1', formatId: FORMAT_ID }),
    });
    renderEvaluation(result);
    status.textContent = '評価完了';
  } catch (error) {
    evaluationView.className = 'empty-message';
    evaluationView.textContent = error.message;
    status.textContent = '入力待ち';
  } finally {
    button.disabled = false;
  }
}

function findAction(id) {
  for (const entry of latestEvaluation?.pokemon ?? []) {
    const action = entry.actions.find((candidate) => candidate.id === id);
    if (action) return action;
  }
  return null;
}

async function adoptAction(action) {
  await json('/api/session/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      evaluationRevision: latestEvaluation.revision, side: 'p1', kind: 'individual', actionId: action.id,
      label: action.label, score: action.score.final, actorSlots: [action.actorSlot],
    }),
  });
  const events = [];
  if (action.kind === 'move' && action.move) {
    const actor = latestState.active?.[action.actorSlot];
    const inferred = await moveEvents(action.move, action.actorSlot, actor?.item ?? '');
    events.push(...inferred.events);
  } else if (action.kind === 'switch' && action.switchToTeamIndex) {
    const member = latestState.sides.p1.team.find((entry) => entry.teamIndex === action.switchToTeamIndex);
    if (member) {
      events.push({ type: 'switch', slot: action.actorSlot, species: member.species, teamIndex: member.teamIndex, source: 'manual' });
      events.push(...abilityEvents(member.ability, action.actorSlot, latestState));
    }
  }
  await postEvents(events);
  notify('採用した行動を記録しました');
}

function attachAutocomplete(input, kind) {
  const list = document.createElement('datalist');
  list.id = `${kind}-suggestions`;
  document.body.append(list);
  input.setAttribute('list', list.id);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (!query) return list.replaceChildren();
    timer = setTimeout(async () => {
      try {
        const body = await json(`/api/search?kind=${kind}&q=${encodeURIComponent(query)}`);
        list.replaceChildren(...body.results.map((entry) => {
          const option = document.createElement('option');
          option.value = entry.value;
          option.label = entry.displayName === entry.englishName ? entry.displayName : `${entry.displayName} / ${entry.englishName}`;
          return option;
        }));
      } catch { list.replaceChildren(); }
    }, 150);
  });
}

async function refresh() {
  latestState = await json('/api/state');
  renderState(latestState);
  status.textContent = '接続済み';
}

document.querySelectorAll('.slot-tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.slot-tab').forEach((entry) => entry.classList.toggle('active', entry === button));
  selectedOpponentSlot = button.dataset.slot;
  fillOpponentForm(latestState?.active?.[selectedOpponentSlot]);
}));

q('#load-party').addEventListener('click', () => loadPartyIntoBattle().catch((error) => notify(error.message)));
ownLeft.addEventListener('change', () => setOwnActive().catch((error) => notify(error.message)));
ownRight.addEventListener('change', () => setOwnActive().catch((error) => notify(error.message)));
form.addEventListener('submit', (event) => applyOpponent(event).catch((error) => { notify(error.message); status.textContent = '入力を確認'; }));
q('#evaluate').addEventListener('click', () => evaluate());
q('#next-turn').addEventListener('click', async () => {
  await postEvents([{ type: 'turn', turn: (latestState?.turn ?? 0) + 1, source: 'manual' }]);
  await evaluate();
});
evaluationView.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action-id]');
  if (!button) return;
  const action = findAction(button.dataset.actionId);
  if (action) adoptAction(action).catch((error) => notify(error.message));
});

await waitForApi();
populateParties();
attachAutocomplete(form.elements.species, 'species');
attachAutocomplete(form.elements.move, 'moves');
await refresh();
if (partySelect.value && !(latestState.sides?.p1?.team?.length)) await loadPartyIntoBattle();
else if (latestState.active?.p1a) await evaluate();
