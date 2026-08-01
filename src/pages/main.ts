import { PagesApiEmulator } from './api-emulator.js';
import { ShowdownAdapter } from './browser-adapter.js';
import { BrowserBattleSession } from './browser-session.js';

type ReadyWindow = Window & { __championsApiReady?: boolean };

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
