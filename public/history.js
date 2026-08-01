const q = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`UIが見つかりません: ${selector}`);
  return element;
};

const status = q('#live-status');
const toast = q('#toast');
const summary = q('#session-summary');
const eventList = q('#event-list');
const resultSelect = q('#result');
const notes = q('#notes');
const importFile = q('#import-file');
let snapshot = null;

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
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function eventLabel(event) {
  const labels = {
    turn: `ターン ${event.turn}`,
    teamMember: `${event.side} ${event.teamIndex}: ${event.species}`,
    switch: `${event.slot}に${event.species}`,
    pokemonInfo: `${event.slot}の情報更新`,
    hp: `${event.slot} HP ${event.hp?.percent ?? '?'}%`,
    status: `${event.slot} 状態異常 ${event.status ?? '解除'}`,
    boost: `${event.slot} ${event.stat} ${event.amount > 0 ? '+' : ''}${event.amount}`,
    weather: `天候 ${event.condition ?? '終了'}`,
    terrain: `フィールド ${event.condition ?? '終了'}`,
    fieldCondition: `場 ${event.condition} ${event.action}`,
    sideCondition: `${event.side}側 ${event.condition} ${event.action}`,
    volatile: `${event.slot} ${event.condition} ${event.action}`,
    move: `${event.slot} ${event.move}`,
    faint: `${event.slot} ひんし`,
  };
  return labels[event.type] ?? event.type;
}

function render() {
  if (!snapshot) return;
  const meta = snapshot.metadata;
  summary.className = '';
  summary.innerHTML = `
    <div class="stat-grid">
      <div class="stat-output"><b>${escapeHtml(meta.title)}</b><span>対戦名</span></div>
      <div class="stat-output"><b>${snapshot.state.turn}</b><span>ターン</span></div>
      <div class="stat-output"><b>${snapshot.eventCount}</b><span>入力数</span></div>
      <div class="stat-output"><b>${snapshot.decisions.length}</b><span>採用判断</span></div>
      <div class="stat-output"><b>${meta.status === 'finished' ? '終了' : '進行中'}</b><span>状態</span></div>
      <div class="stat-output"><b>${meta.result ?? '-'}</b><span>結果</span></div>
    </div>`;
  resultSelect.value = meta.result ?? 'unknown';
  notes.value = meta.notes ?? '';
  const events = [...(snapshot.state.history ?? [])].slice(-20).reverse();
  eventList.innerHTML = events.length
    ? events.map((event) => `<article class="action-card"><header><h3>${escapeHtml(eventLabel(event))}</h3><strong>${escapeHtml(event.source ?? 'manual')}</strong></header><p>${escapeHtml(JSON.stringify(event))}</p></article>`).join('')
    : '<div class="empty-message">まだ入力はありません。</div>';
}

async function refresh() {
  snapshot = await json('/api/session');
  render();
  status.textContent = '接続済み';
}

q('#finish').addEventListener('click', async () => {
  try {
    snapshot = await json('/api/session/finish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: resultSelect.value, notes: notes.value }),
    });
    render();
    notify('対戦結果を保存しました');
  } catch (error) { notify(error.message); }
});

q('#export').addEventListener('click', async () => {
  try {
    const data = await json('/api/session/export');
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.metadata.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify('JSONを保存しました');
  } catch (error) { notify(error.message); }
});

q('#import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    snapshot = await json('/api/session/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    render();
    notify('JSONを読み込みました');
  } catch (error) { notify(error.message); }
  finally { importFile.value = ''; }
});

q('#undo').addEventListener('click', async () => {
  try {
    snapshot = await json('/api/session/undo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1 }),
    });
    render();
    notify('最後の入力を戻しました');
  } catch (error) { notify(error.message); }
});

q('#new-session').addEventListener('click', async () => {
  if (!confirm('新しい対戦を開始しますか？現在の対戦は先にJSON保存できます。')) return;
  try {
    snapshot = await json('/api/session/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pokémon Champions Battle', formatId: 'gen9championsvgc2026regma' }),
    });
    render();
    notify('新しい対戦を開始しました');
  } catch (error) { notify(error.message); }
});

q('#reset').addEventListener('click', async () => {
  if (!confirm('現在の盤面と入力履歴を初期化しますか？')) return;
  try {
    await json('/api/state/reset', { method: 'POST' });
    await refresh();
    notify('盤面を初期化しました');
  } catch (error) { notify(error.message); }
});

await waitForApi();
await refresh();
