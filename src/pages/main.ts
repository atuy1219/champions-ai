import { PagesApiEmulator } from './api-emulator.js';
import { ShowdownAdapter } from './browser-adapter.js';
import { BrowserBattleSession } from './browser-session.js';

type ReadyWindow = Window & { __championsApiReady?: boolean };

function addAdvancedBackLink(): void {
  const link = document.createElement('a');
  link.href = './battle.html';
  link.textContent = '簡易対戦画面へ戻る';
  link.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:12px', 'z-index:100',
    'padding:10px 14px', 'border-radius:999px', 'background:#4d5ee8',
    'color:white', 'font:700 13px system-ui', 'text-decoration:none',
    'box-shadow:0 8px 24px rgba(0,0,0,.22)',
  ].join(';');
  document.body.append(link);
}

async function bootstrap(): Promise<void> {
  const nativeFetch = window.fetch.bind(window);
  const dexUrl = new URL('./data/champions-dex.json', import.meta.url);
  const adapter = await ShowdownAdapter.load(dexUrl, nativeFetch);
  const session = new BrowserBattleSession('champions-ai.session.v1');
  session.initialize();
  const api = new PagesApiEmulator(adapter, session);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await api.handle(input, init);
    return response ?? nativeFetch(input, init);
  };

  (window as ReadyWindow).__championsApiReady = true;
  window.dispatchEvent(new Event('champions-api-ready'));

  const page = document.body.dataset.page ?? 'advanced';
  if (page === 'advanced') {
    addAdvancedBackLink();
    await import('../web/live.js');
  }
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : '起動に失敗しました。';
  const status = document.querySelector<HTMLElement>('#live-status');
  if (status) status.textContent = message;
  const state = document.querySelector<HTMLElement>('#state-view');
  if (state) {
    state.className = 'empty-state';
    state.textContent = message;
  }
  console.error(error);
});
