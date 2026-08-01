const PARTY_KEY = 'champions-ai.parties.v1';
const ACTIVE_PARTY_KEY = 'champions-ai.active-party.v1';
const FORMAT_ID = 'gen9championsvgc2026regma';
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS = { hp: 'HP', atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ' };
const NATURES = {
  hardy: ['がんばりや', null, null], lonely: ['さみしがり', 'atk', 'def'], brave: ['ゆうかん', 'atk', 'spe'], adamant: ['いじっぱり', 'atk', 'spa'], naughty: ['やんちゃ', 'atk', 'spd'],
  bold: ['ずぶとい', 'def', 'atk'], docile: ['すなお', null, null], relaxed: ['のんき', 'def', 'spe'], impish: ['わんぱく', 'def', 'spa'], lax: ['のうてんき', 'def', 'spd'],
  timid: ['おくびょう', 'spe', 'atk'], hasty: ['せっかち', 'spe', 'def'], serious: ['まじめ', null, null], jolly: ['ようき', 'spe', 'spa'], naive: ['むじゃき', 'spe', 'spd'],
  modest: ['ひかえめ', 'spa', 'atk'], mild: ['おっとり', 'spa', 'def'], quiet: ['れいせい', 'spa', 'spe'], bashful: ['てれや', null, null], rash: ['うっかりや', 'spa', 'spd'],
  calm: ['おだやか', 'spd', 'atk'], gentle: ['おとなしい', 'spd', 'def'], sassy: ['なまいき', 'spd', 'spe'], careful: ['しんちょう', 'spd', 'spa'], quirky: ['きまぐれ', null, null],
};

const q = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`UIが見つかりません: ${selector}`);
  return element;
};
const status = q('#live-status');
const toast = q('#toast');
const partySelect = q('#party-select');
const partyName = q('#party-name');
const partySlots = q('#party-slots');
const form = q('#member-form');
const natureSelect = form.elements.nature;
const spGrid = q('#sp-grid');
const statGrid = q('#stat-grid');
const spTotal = q('#sp-total');
const editorTitle = q('#editor-title');
let selectedSlot = 1;
let workingParty = createEmptyParty();
let calculatedStats = null;
let dexPromise = null;

function waitForApi() {
  if (window.__championsApiReady) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('champions-api-ready', resolve, { once: true }));
}

async function json(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '処理に失敗しました。');
  return body;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2200);
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
function writeParties(parties) { localStorage.setItem(PARTY_KEY, JSON.stringify(parties)); }
function blankSp() { return Object.fromEntries(STAT_KEYS.map((stat) => [stat, 0])); }
function createEmptyParty() {
  return { id: crypto.randomUUID(), name: 'マイパーティ', updatedAt: new Date().toISOString(), formatId: FORMAT_ID, members: [] };
}

function populateNatureOptions() {
  natureSelect.replaceChildren();
  for (const [id, [label, up, down]] of Object.entries(NATURES)) {
    const suffix = up ? `（${STAT_LABELS[up]}↑ ${STAT_LABELS[down]}↓）` : '（補正なし）';
    natureSelect.append(new Option(`${label}${suffix}`, id));
  }
  natureSelect.value = 'hardy';
}

function createStatInputs() {
  spGrid.innerHTML = STAT_KEYS.map((stat) => `<label>${STAT_LABELS[stat]}<input name="sp-${stat}" type="number" min="0" max="32" step="1" value="0" inputmode="numeric"></label>`).join('');
  statGrid.innerHTML = STAT_KEYS.map((stat) => `<div class="stat-output"><b id="stat-${stat}">-</b><span>${STAT_LABELS[stat]}</span></div>`).join('');
}

function getSp() {
  const sp = {};
  for (const stat of STAT_KEYS) {
    const input = form.elements.namedItem(`sp-${stat}`);
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > 32) throw new Error('能力ポイントは各0～32の整数で入力してください。');
    sp[stat] = value;
  }
  const total = Object.values(sp).reduce((sum, value) => sum + value, 0);
  spTotal.textContent = `能力ポイント ${total} / 66`;
  spTotal.style.color = total > 66 ? '#b3261e' : '';
  if (total > 66) throw new Error('能力ポイントの合計は66以下にしてください。');
  return sp;
}

async function loadDex() {
  dexPromise ??= fetch('./data/champions-dex.json').then((response) => {
    if (!response.ok) throw new Error('Championsデータを読み込めませんでした。');
    return response.json();
  });
  return dexPromise;
}

async function resolveSpecies(input) {
  const query = input.trim();
  if (!query) throw new Error('ポケモン名を入力してください。');
  const body = await json(`/api/search?kind=species&q=${encodeURIComponent(query)}`);
  const exact = body.results.find((entry) => normalize(entry.value) === normalize(query) || normalize(entry.englishName) === normalize(query)) ?? body.results[0];
  if (!exact) throw new Error(`ポケモン「${query}」が見つかりません。`);
  const dex = await loadDex();
  const data = dex.species?.[toId(exact.englishName)] ?? Object.values(dex.species ?? {}).find((entry) => entry.name === exact.englishName);
  if (!data) throw new Error('種族値を取得できませんでした。');
  return { displayName: exact.value, englishName: exact.englishName, data };
}

function natureMultiplier(natureId, stat) {
  const [, up, down] = NATURES[natureId] ?? NATURES.hardy;
  if (up === stat) return 1.1;
  if (down === stat) return 0.9;
  return 1;
}

function calculateFinalStats(baseStats, sp, natureId) {
  const result = { hp: Math.floor((2 * baseStats.hp + 31 + 2 * sp.hp) / 2) + 60 };
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe']) {
    const neutral = Math.floor((2 * baseStats[stat] + 31 + 2 * sp[stat]) / 2) + 5;
    result[stat] = Math.floor(neutral * natureMultiplier(natureId, stat));
  }
  return result;
}

async function recalculate() {
  const speciesInput = form.elements.species.value.trim();
  if (!speciesInput) {
    calculatedStats = null;
    STAT_KEYS.forEach((stat) => q(`#stat-${stat}`).textContent = '-');
    return;
  }
  const resolved = await resolveSpecies(speciesInput);
  const sp = getSp();
  calculatedStats = calculateFinalStats(resolved.data.baseStats, sp, natureSelect.value);
  form.elements.species.value = resolved.displayName;
  STAT_KEYS.forEach((stat) => q(`#stat-${stat}`).textContent = calculatedStats[stat]);
  return { resolved, sp, stats: calculatedStats };
}

function currentMember() { return workingParty.members.find((member) => member.teamIndex === selectedSlot); }

function renderSlots() {
  partySlots.innerHTML = Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const member = workingParty.members.find((entry) => entry.teamIndex === slot);
    return `<button type="button" class="party-slot-button ${slot === selectedSlot ? 'active' : ''}" data-slot="${slot}">
      <b>${slot}</b><strong>${member?.species ?? '未登録'}</strong><span>${member ? (member.moves?.length ?? 0) + '技' : '編集'}</span>
    </button>`;
  }).join('');
  partySlots.querySelectorAll('[data-slot]').forEach((button) => button.addEventListener('click', () => {
    selectedSlot = Number(button.dataset.slot);
    loadMemberToForm();
    renderSlots();
  }));
}

function loadMemberToForm() {
  const member = currentMember();
  editorTitle.textContent = `${selectedSlot}匹目`;
  form.elements.species.value = member?.species ?? '';
  form.elements.ability.value = member?.ability ?? '';
  form.elements.item.value = member?.item ?? '';
  form.elements.moves.value = (member?.moves ?? []).join(', ');
  natureSelect.value = member?.build?.nature ?? 'hardy';
  const sp = member?.build?.sp ?? blankSp();
  for (const stat of STAT_KEYS) form.elements.namedItem(`sp-${stat}`).value = String(sp[stat] ?? 0);
  calculatedStats = member?.stats ?? null;
  STAT_KEYS.forEach((stat) => q(`#stat-${stat}`).textContent = calculatedStats?.[stat] ?? '-');
  getSp();
}

function populatePartySelect(preferred = '') {
  const parties = readParties();
  partySelect.replaceChildren(new Option('新しいパーティー', ''));
  for (const party of Object.values(parties).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    partySelect.append(new Option(`${party.name}（${party.members?.length ?? 0}匹）`, party.id));
  }
  if (preferred && parties[preferred]) partySelect.value = preferred;
}

function loadSelectedParty() {
  const parties = readParties();
  workingParty = partySelect.value && parties[partySelect.value]
    ? structuredClone(parties[partySelect.value])
    : createEmptyParty();
  partyName.value = workingParty.name;
  selectedSlot = 1;
  renderSlots();
  loadMemberToForm();
}

async function saveMember(event) {
  event.preventDefault();
  const calculated = await recalculate();
  if (!calculated) throw new Error('ポケモンを入力してください。');
  const moves = form.elements.moves.value.split(/[、,]/).map((move) => move.trim()).filter(Boolean).slice(0, 4);
  const member = {
    teamIndex: selectedSlot,
    species: calculated.resolved.displayName,
    level: 50,
    moves,
    item: form.elements.item.value.trim() || null,
    ability: form.elements.ability.value.trim() || null,
    stats: calculated.stats,
    hp: { current: calculated.stats.hp, max: calculated.stats.hp, percent: 100, exact: true },
    build: { nature: natureSelect.value, sp: calculated.sp, englishSpecies: calculated.resolved.englishName },
  };
  workingParty.members = workingParty.members.filter((entry) => entry.teamIndex !== selectedSlot);
  workingParty.members.push(member);
  workingParty.members.sort((a, b) => a.teamIndex - b.teamIndex);
  renderSlots();
  notify(`${selectedSlot}匹目を保存しました`);
  if (selectedSlot < 6) {
    selectedSlot += 1;
    renderSlots();
    loadMemberToForm();
  }
}

function saveParty() {
  if (!workingParty.members.length) throw new Error('1匹以上登録してください。');
  workingParty.name = partyName.value.trim() || 'マイパーティ';
  workingParty.updatedAt = new Date().toISOString();
  workingParty.formatId = FORMAT_ID;
  const parties = readParties();
  parties[workingParty.id] = structuredClone(workingParty);
  writeParties(parties);
  localStorage.setItem(ACTIVE_PARTY_KEY, workingParty.id);
  populatePartySelect(workingParty.id);
  notify(`「${workingParty.name}」を保存し、対戦用に設定しました`);
  status.textContent = `${workingParty.members.length}匹登録済み`;
}

function deleteParty() {
  if (!partySelect.value) return notify('削除するパーティーを選択してください');
  const parties = readParties();
  const target = parties[partySelect.value];
  if (!target || !confirm(`「${target.name}」を削除しますか？`)) return;
  delete parties[partySelect.value];
  writeParties(parties);
  if (localStorage.getItem(ACTIVE_PARTY_KEY) === partySelect.value) localStorage.removeItem(ACTIVE_PARTY_KEY);
  populatePartySelect();
  loadSelectedParty();
  notify('削除しました');
}

function attachAutocomplete(input) {
  const list = document.createElement('datalist');
  list.id = 'party-species-suggestions';
  document.body.append(list);
  input.setAttribute('list', list.id);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (!query) return list.replaceChildren();
    timer = setTimeout(async () => {
      try {
        const body = await json(`/api/search?kind=species&q=${encodeURIComponent(query)}`);
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

let recalcTimer;
form.addEventListener('input', (event) => {
  if (!event.target.matches('[name="species"], [name="nature"], [name^="sp-"]')) return;
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => recalculate().catch((error) => status.textContent = error.message), 180);
});
form.addEventListener('submit', (event) => saveMember(event).catch((error) => notify(error.message)));
partySelect.addEventListener('change', loadSelectedParty);
q('#new-party').addEventListener('click', () => { partySelect.value = ''; loadSelectedParty(); });
q('#delete-party').addEventListener('click', deleteParty);
q('#save-party').addEventListener('click', () => { try { saveParty(); } catch (error) { notify(error.message); } });

await waitForApi();
populateNatureOptions();
createStatInputs();
populatePartySelect(localStorage.getItem(ACTIVE_PARTY_KEY) ?? '');
loadSelectedParty();
attachAutocomplete(form.elements.species);
status.textContent = '編集可能';
