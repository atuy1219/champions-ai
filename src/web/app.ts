interface MoveCandidate {
  move: string;
  englishMove: string;
  category: string;
  type: string;
  score: number;
  basePower: number;
  accuracy: number | true;
  priority: number;
  typeMultiplier: number;
  reasons: string[];
}

interface PokemonResponseSummary {
  species: string;
  englishSpecies: string;
  types: string[];
  hp: {
    current?: number;
    max?: number;
    percent: number;
  };
}

interface AnalyzeResponse {
  attacker: PokemonResponseSummary;
  defender: PokemonResponseSummary;
  candidates: MoveCandidate[];
  warnings: string[];
}

interface SearchResult {
  value: string;
  displayName: string;
  englishName: string;
}

const TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Normal: 'ノーマル',
  Fire: 'ほのお',
  Water: 'みず',
  Electric: 'でんき',
  Grass: 'くさ',
  Ice: 'こおり',
  Fighting: 'かくとう',
  Poison: 'どく',
  Ground: 'じめん',
  Flying: 'ひこう',
  Psychic: 'エスパー',
  Bug: 'むし',
  Rock: 'いわ',
  Ghost: 'ゴースト',
  Dragon: 'ドラゴン',
  Dark: 'あく',
  Steel: 'はがね',
  Fairy: 'フェアリー',
});

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element is missing: ${selector}`);
  }
  return element;
}

const form = requiredElement<HTMLFormElement>('#analyze-form');
const submitButton = requiredElement<HTMLButtonElement>('#submit-button');
const results = requiredElement<HTMLElement>('#results');
const errorBox = requiredElement<HTMLElement>('#error-box');
const statusText = requiredElement<HTMLElement>('#status-text');
const hpPercentOutput = requiredElement<HTMLOutputElement>('#attacker-hp-percent');

function getInput(name: string): HTMLInputElement {
  const element = form.elements.namedItem(name);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Input ${name} is missing.`);
  }
  return element;
}

function getSelect(name: string): HTMLSelectElement {
  const element = form.elements.namedItem(name);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Select ${name} is missing.`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return entities[character] ?? character;
  });
}

function formatAccuracy(value: number | true): string {
  return value === true ? '必中' : `${value}%`;
}

function formatHp(pokemon: PokemonResponseSummary): string {
  const percent = `${pokemon.hp.percent.toFixed(1)}%`;
  if (pokemon.hp.current === undefined || pokemon.hp.max === undefined) return percent;
  return `${pokemon.hp.current}/${pokemon.hp.max} (${percent})`;
}

function localizedType(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function renderResponse(response: AnalyzeResponse): void {
  const cards = response.candidates
    .map((candidate, index) => {
      const details =
        candidate.category === 'Status'
          ? `${localizedType(candidate.type)} / 変化技`
          : `${localizedType(candidate.type)} / 威力${candidate.basePower} / 命中${formatAccuracy(candidate.accuracy)} / 相性×${candidate.typeMultiplier}`;
      const bilingualName = candidate.move === candidate.englishMove
        ? escapeHtml(candidate.move)
        : `${escapeHtml(candidate.move)} <small>${escapeHtml(candidate.englishMove)}</small>`;

      return `
        <article class="candidate-card">
          <div class="candidate-rank">${index + 1}</div>
          <div>
            <div class="candidate-heading">
              <h3>${bilingualName}</h3>
              <strong>${candidate.score.toFixed(1)}</strong>
            </div>
            <p class="candidate-meta">${escapeHtml(details)}</p>
            <ul>
              ${candidate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
            </ul>
          </div>
        </article>
      `;
    })
    .join('');

  results.innerHTML = `
    <div class="matchup">
      <span>
        ${escapeHtml(response.attacker.species)}
        <small>${escapeHtml(response.attacker.englishSpecies)}</small>
        <b>${escapeHtml(formatHp(response.attacker))}</b>
      </span>
      <span>vs</span>
      <span>
        ${escapeHtml(response.defender.species)}
        <small>${escapeHtml(response.defender.englishSpecies)}</small>
        <b>${escapeHtml(formatHp(response.defender))}</b>
      </span>
    </div>
    <div class="candidate-list">${cards}</div>
    <aside class="warnings">
      ${response.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}
    </aside>
  `;
}

function populateStageSelects(): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-stage]')) {
    for (let stage = -6; stage <= 6; stage += 1) {
      const option = document.createElement('option');
      option.value = String(stage);
      option.textContent = stage > 0 ? `+${stage}` : String(stage);
      option.selected = stage === 0;
      select.append(option);
    }
  }
}

function readStages(owner: 'attacker' | 'defender') {
  return {
    atk: Number(getSelect(`${owner}-atk`).value),
    def: Number(getSelect(`${owner}-def`).value),
    spa: Number(getSelect(`${owner}-spa`).value),
    spd: Number(getSelect(`${owner}-spd`).value),
    spe: Number(getSelect(`${owner}-spe`).value),
    accuracy: Number(getSelect(`${owner}-accuracy`).value),
    evasion: Number(getSelect(`${owner}-evasion`).value),
  };
}

function attackerHp(): { current: number; max: number; percent: number } {
  const current = Number(getInput('attackerCurrentHp').value);
  const max = Number(getInput('attackerMaxHp').value);
  const percent = Number.isFinite(current) && Number.isFinite(max) && max > 0
    ? Math.max(0, Math.min(100, current / max * 100))
    : 0;
  return { current, max, percent };
}

function updateHpPercent(): void {
  hpPercentOutput.value = `${attackerHp().percent.toFixed(1)}%`;
}

function attachAutocomplete(input: HTMLInputElement, kind: 'species' | 'moves', index: number): void {
  const datalist = document.createElement('datalist');
  datalist.id = `suggestions-${kind}-${index}`;
  document.body.append(datalist);
  input.setAttribute('list', datalist.id);

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = input.value.trim();
    if (!query) {
      datalist.replaceChildren();
      return;
    }

    timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?kind=${kind}&q=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const body = await response.json() as { results: SearchResult[] };
        datalist.replaceChildren(...body.results.map((result) => {
          const option = document.createElement('option');
          option.value = result.value;
          option.label = result.displayName === result.englishName
            ? result.displayName
            : `${result.displayName} / ${result.englishName}`;
          return option;
        }));
      } catch {
        datalist.replaceChildren();
      }
    }, 180);
  });
}

populateStageSelects();
updateHpPercent();
getInput('attackerCurrentHp').addEventListener('input', updateHpPercent);
getInput('attackerMaxHp').addEventListener('input', updateHpPercent);

document.querySelectorAll<HTMLInputElement>('input[data-autocomplete]').forEach((input, index) => {
  const kind = input.dataset.autocomplete;
  if (kind === 'species' || kind === 'moves') attachAutocomplete(input, kind, index);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  results.innerHTML = '';
  submitButton.disabled = true;
  statusText.textContent = '評価中…';

  const moves = ['move1', 'move2', 'move3', 'move4']
    .map((name) => getInput(name).value.trim())
    .filter(Boolean);
  const ownHp = attackerHp();

  const payload = {
    formatId: getInput('formatId').value.trim(),
    attacker: {
      species: getInput('attackerSpecies').value.trim(),
      currentHp: ownHp.current,
      maxHp: ownHp.max,
      hpPercent: ownHp.percent,
      status: getSelect('attackerStatus').value,
      stages: readStages('attacker'),
      moves,
    },
    defender: {
      species: getInput('defenderSpecies').value.trim(),
      hpPercent: Number(getInput('defenderHp').value),
      status: getSelect('defenderStatus').value,
      stages: readStages('defender'),
      moves: [],
    },
    field: {
      weather: getSelect('weather').value,
      terrain: getSelect('terrain').value,
      trickRoom: getInput('trickRoom').checked,
      attackerSide: {
        tailwind: getInput('attackerTailwind').checked,
        reflect: getInput('attackerReflect').checked,
        lightScreen: getInput('attackerLightScreen').checked,
        auroraVeil: getInput('attackerAuroraVeil').checked,
      },
      defenderSide: {
        tailwind: getInput('defenderTailwind').checked,
        reflect: getInput('defenderReflect').checked,
        lightScreen: getInput('defenderLightScreen').checked,
        auroraVeil: getInput('defenderAuroraVeil').checked,
      },
    },
  };

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await response.json() as AnalyzeResponse | { error: string };
    if (!response.ok) {
      throw new Error('error' in body ? body.error : '評価に失敗しました。');
    }

    renderResponse(body as AnalyzeResponse);
    statusText.textContent = '評価完了';
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : '評価に失敗しました。';
    statusText.textContent = '入力を確認してください';
  } finally {
    submitButton.disabled = false;
  }
});

fetch('/api/health')
  .then((response) => response.json())
  .then(() => {
    statusText.textContent = 'Pokémon Showdown / Champions mod 接続済み';
  })
  .catch(() => {
    statusText.textContent = 'サーバーに接続できません';
  });
