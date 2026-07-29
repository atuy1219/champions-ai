interface MoveCandidate {
  move: string;
  category: string;
  type: string;
  score: number;
  basePower: number;
  accuracy: number | true;
  priority: number;
  typeMultiplier: number;
  reasons: string[];
}

interface AnalyzeResponse {
  attacker: { species: string; types: string[] };
  defender: { species: string; types: string[] };
  candidates: MoveCandidate[];
  warnings: string[];
}

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

function renderResponse(response: AnalyzeResponse): void {
  const cards = response.candidates
    .map((candidate, index) => {
      const details =
        candidate.category === 'Status'
          ? `${candidate.type} / 変化技`
          : `${candidate.type} / 威力${candidate.basePower} / 命中${formatAccuracy(candidate.accuracy)} / 相性×${candidate.typeMultiplier}`;

      return `
        <article class="candidate-card">
          <div class="candidate-rank">${index + 1}</div>
          <div>
            <div class="candidate-heading">
              <h3>${escapeHtml(candidate.move)}</h3>
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
      <span>${escapeHtml(response.attacker.species)} (${response.attacker.types.map(escapeHtml).join(' / ')})</span>
      <span>vs</span>
      <span>${escapeHtml(response.defender.species)} (${response.defender.types.map(escapeHtml).join(' / ')})</span>
    </div>
    <div class="candidate-list">${cards}</div>
    <aside class="warnings">
      ${response.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}
    </aside>
  `;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  results.innerHTML = '';
  submitButton.disabled = true;
  statusText.textContent = '評価中…';

  const moves = ['move1', 'move2', 'move3', 'move4']
    .map((name) => getInput(name).value.trim())
    .filter(Boolean);

  const payload = {
    formatId: getInput('formatId').value.trim(),
    attacker: {
      species: getInput('attackerSpecies').value.trim(),
      hpPercent: Number(getInput('attackerHp').value),
      moves,
    },
    defender: {
      species: getInput('defenderSpecies').value.trim(),
      hpPercent: Number(getInput('defenderHp').value),
      moves: [],
    },
    field: {
      weather: getSelect('weather').value,
      attackerSpeedStage: Number(getInput('attackerSpeedStage').value),
      defenderSpeedStage: Number(getInput('defenderSpeedStage').value),
      tailwind: getSelect('tailwind').value,
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
