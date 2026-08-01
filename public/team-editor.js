const teamForm = document.querySelector('#team-form');
if (!(teamForm instanceof HTMLFormElement)) {
  throw new Error('チーム登録フォームが見つかりません。');
}

const statusText = document.querySelector('#live-status');
const partyNameInput = document.querySelector('#party-name');
const savedPartySelect = document.querySelector('#saved-party');
const partySummary = document.querySelector('#party-summary');
const spTotalOutput = document.querySelector('#sp-total');

const PARTY_STORAGE_KEY = 'champions-ai.parties.v1';
const BUILD_STORAGE_KEY = 'champions-ai.builds.v1';
const DEX_URL = new URL('./data/champions-dex.json', import.meta.url);

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const SP_FIELD_NAMES = {
  hp: 'spHp',
  atk: 'spAtk',
  def: 'spDef',
  spa: 'spSpa',
  spd: 'spSpd',
  spe: 'spSpe',
};
const STAT_FIELD_NAMES = {
  hp: 'statHp',
  atk: 'statAtk',
  def: 'statDef',
  spa: 'statSpa',
  spd: 'statSpd',
  spe: 'statSpe',
};

const NATURES = {
  hardy: { label: 'がんばりや', up: null, down: null },
  lonely: { label: 'さみしがり', up: 'atk', down: 'def' },
  brave: { label: 'ゆうかん', up: 'atk', down: 'spe' },
  adamant: { label: 'いじっぱり', up: 'atk', down: 'spa' },
  naughty: { label: 'やんちゃ', up: 'atk', down: 'spd' },
  bold: { label: 'ずぶとい', up: 'def', down: 'atk' },
  docile: { label: 'すなお', up: null, down: null },
  relaxed: { label: 'のんき', up: 'def', down: 'spe' },
  impish: { label: 'わんぱく', up: 'def', down: 'spa' },
  lax: { label: 'のうてんき', up: 'def', down: 'spd' },
  timid: { label: 'おくびょう', up: 'spe', down: 'atk' },
  hasty: { label: 'せっかち', up: 'spe', down: 'def' },
  serious: { label: 'まじめ', up: null, down: null },
  jolly: { label: 'ようき', up: 'spe', down: 'spa' },
  naive: { label: 'むじゃき', up: 'spe', down: 'spd' },
  modest: { label: 'ひかえめ', up: 'spa', down: 'atk' },
  mild: { label: 'おっとり', up: 'spa', down: 'def' },
  quiet: { label: 'れいせい', up: 'spa', down: 'spe' },
  bashful: { label: 'てれや', up: null, down: null },
  rash: { label: 'うっかりや', up: 'spa', down: 'spd' },
  calm: { label: 'おだやか', up: 'spd', down: 'atk' },
  gentle: { label: 'おとなしい', up: 'spd', down: 'def' },
  sassy: { label: 'なまいき', up: 'spd', down: 'spe' },
  careful: { label: 'しんちょう', up: 'spd', down: 'spa' },
  quirky: { label: 'きまぐれ', up: null, down: null },
};

function formControl(name) {
  const control = teamForm.elements.namedItem(name);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`${name}が見つかりません。`);
  }
  return control;
}

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function toId(value) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function currentBuildKey(side = formControl('side').value, teamIndex = Number(formControl('teamIndex').value)) {
  return `${side}:${teamIndex}`;
}

function readSp() {
  const sp = {};
  for (const stat of STAT_KEYS) {
    const raw = Number(formControl(SP_FIELD_NAMES[stat]).value);
    if (!Number.isInteger(raw) || raw < 0 || raw > 32) {
      throw new Error('能力ポイントは各能力0～32の整数で入力してください。');
    }
    sp[stat] = raw;
  }
  const total = STAT_KEYS.reduce((sum, stat) => sum + sp[stat], 0);
  if (spTotalOutput) {
    spTotalOutput.value = `${total} / 66`;
    spTotalOutput.classList.toggle('over-limit', total > 66);
  }
  if (total > 66) throw new Error(`能力ポイントの合計が${total}です。66以下にしてください。`);
  return sp;
}

function natureMultiplier(nature, stat) {
  if (nature.up === stat) return 1.1;
  if (nature.down === stat) return 0.9;
  return 1;
}

let dexPromise;
function loadDex() {
  dexPromise ??= fetch(DEX_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Pokémon Championsデータを読み込めませんでした（HTTP ${response.status}）。`);
    return response.json();
  });
  return dexPromise;
}

async function resolveSpeciesData(inputName) {
  const query = inputName.trim();
  if (!query) throw new Error('ポケモン名を入力してください。');

  const response = await fetch(`/api/search?kind=species&q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('ポケモン名を検索できませんでした。');
  const body = await response.json();
  const results = Array.isArray(body.results) ? body.results : [];
  const normalized = query.normalize('NFKC').toLowerCase();
  const match = results.find((entry) =>
    entry.displayName?.normalize('NFKC').toLowerCase() === normalized
    || entry.englishName?.normalize('NFKC').toLowerCase() === normalized,
  ) ?? results[0];
  if (!match) throw new Error(`ポケモン「${query}」が見つかりません。候補から選択してください。`);

  const dex = await loadDex();
  const species = dex.species?.[toId(match.englishName)]
    ?? Object.values(dex.species ?? {}).find((entry) => entry.name === match.englishName);
  if (!species) throw new Error(`「${match.displayName}」の種族値を取得できませんでした。`);
  return { species, displayName: match.displayName, englishName: match.englishName };
}

function calculateFinalStats(baseStats, sp, nature) {
  const stats = {
    hp: Math.floor((2 * baseStats.hp + 31 + 2 * sp.hp) / 2) + 60,
  };
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe']) {
    const beforeNature = Math.floor((2 * baseStats[stat] + 31 + 2 * sp[stat]) / 2) + 5;
    stats[stat] = Math.floor(beforeNature * natureMultiplier(nature, stat));
  }
  return stats;
}

let calculationSerial = 0;
async function calculateStats({ updateCurrentHp = true } = {}) {
  const serial = ++calculationSerial;
  const resolved = await resolveSpeciesData(formControl('species').value);
  if (serial !== calculationSerial) return null;

  const sp = readSp();
  const natureId = formControl('nature').value;
  const nature = NATURES[natureId] ?? NATURES.hardy;
  const stats = calculateFinalStats(resolved.species.baseStats, sp, nature);

  formControl('species').value = resolved.displayName;
  for (const stat of STAT_KEYS) {
    formControl(STAT_FIELD_NAMES[stat]).value = String(stats[stat]);
  }
  formControl('maxHp').value = String(stats.hp);
  if (updateCurrentHp || !formControl('currentHp').value) formControl('currentHp').value = String(stats.hp);
  formControl('hpPercent').value = '100';

  return {
    nature: natureId,
    sp,
    stats,
    species: resolved.displayName,
    englishSpecies: resolved.englishName,
  };
}

function saveCurrentBuildMeta(build) {
  const builds = readJsonStorage(BUILD_STORAGE_KEY, {});
  builds[currentBuildKey()] = {
    nature: build.nature,
    sp: build.sp,
    englishSpecies: build.englishSpecies,
    updatedAt: new Date().toISOString(),
  };
  writeJsonStorage(BUILD_STORAGE_KEY, builds);
}

function applyBuildMeta(meta) {
  formControl('nature').value = meta?.nature && NATURES[meta.nature] ? meta.nature : 'hardy';
  for (const stat of STAT_KEYS) {
    const value = Number(meta?.sp?.[stat] ?? 0);
    formControl(SP_FIELD_NAMES[stat]).value = String(Number.isFinite(value) ? value : 0);
  }
  readSp();
}

function memberToForm(member, buildMeta) {
  formControl('side').value = member.side ?? 'p1';
  formControl('teamIndex').value = String(member.teamIndex);
  formControl('level').value = '50';
  formControl('species').value = member.species ?? '';
  formControl('moves').value = Array.isArray(member.moves) ? member.moves.join(', ') : '';
  formControl('item').value = member.item ?? '';
  formControl('ability').value = member.ability ?? '';
  formControl('teraType').value = '';
  formControl('teraActive').checked = false;
  formControl('exactHp').checked = true;
  applyBuildMeta(buildMeta);
  void calculateStats({ updateCurrentHp: false }).then((build) => {
    if (!build) return;
    formControl('currentHp').value = String(member.hp?.current ?? build.stats.hp);
    formControl('maxHp').value = String(member.hp?.max ?? build.stats.hp);
    formControl('hpPercent').value = String(member.hp?.percent ?? 100);
  }).catch((error) => setStatus(error instanceof Error ? error.message : '型を復元できませんでした。'));
}

async function restoreSelectedSlot() {
  try {
    const snapshot = await fetch('/api/session').then((response) => response.json());
    const side = formControl('side').value;
    const index = Number(formControl('teamIndex').value);
    const member = snapshot?.state?.sides?.[side]?.team?.find((entry) => entry.teamIndex === index);
    const builds = readJsonStorage(BUILD_STORAGE_KEY, {});
    const meta = builds[currentBuildKey(side, index)];
    if (member) {
      memberToForm(member, meta);
    } else {
      applyBuildMeta(meta);
      await calculateStats();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '登録済みポケモンを読み込めませんでした。');
  }
}

function readParties() {
  return readJsonStorage(PARTY_STORAGE_KEY, {});
}

function refreshPartySelect(preferredId = '') {
  if (!(savedPartySelect instanceof HTMLSelectElement)) return;
  const parties = readParties();
  savedPartySelect.replaceChildren(new Option('保存済みパーティーを選択', ''));
  for (const party of Object.values(parties).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    savedPartySelect.append(new Option(`${party.name}（${party.members.length}匹）`, party.id));
  }
  if (preferredId && parties[preferredId]) savedPartySelect.value = preferredId;
  renderPartySummary();
}

function renderPartySummary() {
  if (!(partySummary instanceof HTMLElement) || !(savedPartySelect instanceof HTMLSelectElement)) return;
  const party = readParties()[savedPartySelect.value];
  if (!party) {
    partySummary.className = 'party-summary empty-party';
    partySummary.textContent = '現在のセッションに自分のポケモンを登録後、「現在の自分チームを保存」で再利用できます。';
    return;
  }

  partySummary.className = 'party-summary';
  partySummary.innerHTML = party.members.map((member) => {
    const nature = NATURES[member.build?.nature]?.label ?? '補正なし';
    const sp = STAT_KEYS.map((stat) => `${stat.toUpperCase()}:${member.build?.sp?.[stat] ?? 0}`).join(' ');
    return `<button type="button" class="party-member" data-party-member="${member.teamIndex}">
      <strong>${member.teamIndex}. ${member.species}</strong>
      <span>${nature} / ${sp}</span>
      <small>${(member.moves ?? []).join('・') || '技未登録'}</small>
    </button>`;
  }).join('');

  partySummary.querySelectorAll('[data-party-member]').forEach((button) => {
    button.addEventListener('click', () => {
      const teamIndex = Number(button.getAttribute('data-party-member'));
      const member = party.members.find((entry) => entry.teamIndex === teamIndex);
      if (!member) return;
      memberToForm({ ...member, side: 'p1' }, member.build);
      teamForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

async function saveParty() {
  const snapshotResponse = await fetch('/api/session');
  if (!snapshotResponse.ok) throw new Error('現在のチームを読み込めませんでした。');
  const snapshot = await snapshotResponse.json();
  const team = [...(snapshot?.state?.sides?.p1?.team ?? [])].sort((a, b) => a.teamIndex - b.teamIndex);
  if (!team.length) throw new Error('先に「自分 p1」のポケモンを1匹以上登録してください。');

  const builds = readJsonStorage(BUILD_STORAGE_KEY, {});
  const parties = readParties();
  const selectedId = savedPartySelect instanceof HTMLSelectElement ? savedPartySelect.value : '';
  const id = selectedId || crypto.randomUUID();
  const name = partyNameInput instanceof HTMLInputElement && partyNameInput.value.trim()
    ? partyNameInput.value.trim()
    : `マイパーティ ${Object.keys(parties).length + 1}`;

  parties[id] = {
    id,
    name,
    updatedAt: new Date().toISOString(),
    formatId: 'gen9championsvgc2026regma',
    members: team.map((member) => ({
      teamIndex: member.teamIndex,
      species: member.species,
      level: 50,
      moves: member.moves ?? [],
      item: member.item ?? null,
      ability: member.ability ?? null,
      stats: member.stats,
      hp: member.hp,
      build: builds[`p1:${member.teamIndex}`] ?? {
        nature: 'hardy',
        sp: Object.fromEntries(STAT_KEYS.map((stat) => [stat, 0])),
      },
    })),
  };
  writeJsonStorage(PARTY_STORAGE_KEY, parties);
  refreshPartySelect(id);
  if (partyNameInput instanceof HTMLInputElement) partyNameInput.value = name;
  setStatus(`パーティー「${name}」を保存しました`);
}

async function loadParty() {
  if (!(savedPartySelect instanceof HTMLSelectElement) || !savedPartySelect.value) {
    throw new Error('読み込むパーティーを選択してください。');
  }
  const party = readParties()[savedPartySelect.value];
  if (!party) throw new Error('保存済みパーティーが見つかりません。');
  if (!window.confirm(`「${party.name}」を現在の自分チームへ登録しますか？`)) return;

  const builds = readJsonStorage(BUILD_STORAGE_KEY, {});
  const events = party.members.map((member) => {
    builds[`p1:${member.teamIndex}`] = member.build;
    const maxHp = member.stats?.hp ?? member.hp?.max ?? 1;
    return {
      type: 'teamMember',
      side: 'p1',
      teamIndex: member.teamIndex,
      species: member.species,
      level: 50,
      hp: { current: maxHp, max: maxHp, percent: 100, exact: true },
      moves: member.moves ?? [],
      item: member.item ?? null,
      ability: member.ability ?? null,
      teraType: null,
      teraActive: false,
      stats: member.stats ?? null,
      source: 'manual',
    };
  });
  writeJsonStorage(BUILD_STORAGE_KEY, builds);

  const response = await fetch('/api/state/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'パーティーを登録できませんでした。');
  }
  setStatus(`パーティー「${party.name}」を現在の対戦へ登録しました`);
  window.location.reload();
}

function deleteParty() {
  if (!(savedPartySelect instanceof HTMLSelectElement) || !savedPartySelect.value) {
    throw new Error('削除するパーティーを選択してください。');
  }
  const parties = readParties();
  const party = parties[savedPartySelect.value];
  if (!party) return;
  if (!window.confirm(`「${party.name}」を削除しますか？`)) return;
  delete parties[savedPartySelect.value];
  writeJsonStorage(PARTY_STORAGE_KEY, parties);
  refreshPartySelect();
  setStatus(`パーティー「${party.name}」を削除しました`);
}

let calculationTimer;
function scheduleCalculation() {
  window.clearTimeout(calculationTimer);
  try {
    readSp();
  } catch {
    // 入力途中は合計表示だけ更新する。
  }
  calculationTimer = window.setTimeout(() => {
    void calculateStats().catch((error) => setStatus(error instanceof Error ? error.message : '実数値を計算できませんでした。'));
  }, 180);
}

for (const name of ['species', 'nature', ...Object.values(SP_FIELD_NAMES)]) {
  formControl(name).addEventListener('input', scheduleCalculation);
  formControl(name).addEventListener('change', scheduleCalculation);
}
formControl('side').addEventListener('change', () => void restoreSelectedSlot());
formControl('teamIndex').addEventListener('change', () => void restoreSelectedSlot());

let resubmitting = false;
teamForm.addEventListener('submit', (event) => {
  if (resubmitting) {
    resubmitting = false;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void calculateStats().then((build) => {
    if (!build) return;
    saveCurrentBuildMeta(build);
    resubmitting = true;
    teamForm.requestSubmit();
  }).catch((error) => setStatus(error instanceof Error ? error.message : '実数値を計算できませんでした。'));
}, true);

savedPartySelect?.addEventListener('change', () => {
  const party = readParties()[savedPartySelect.value];
  if (partyNameInput instanceof HTMLInputElement) partyNameInput.value = party?.name ?? '';
  renderPartySummary();
});
document.querySelector('#save-party')?.addEventListener('click', () => void saveParty().catch((error) => setStatus(error.message)));
document.querySelector('#load-party')?.addEventListener('click', () => void loadParty().catch((error) => setStatus(error.message)));
document.querySelector('#delete-party')?.addEventListener('click', () => {
  try { deleteParty(); } catch (error) { setStatus(error instanceof Error ? error.message : '削除できませんでした。'); }
});

refreshPartySelect();
readSp();
void calculateStats().catch((error) => setStatus(error instanceof Error ? error.message : '実数値を計算できませんでした。'));
