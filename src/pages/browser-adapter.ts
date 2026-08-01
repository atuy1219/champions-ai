import { InputError } from '../core/errors.js';
import type {
  LocalizedSearchResult,
  MoveSummary,
  SpeciesSummary,
} from '../core/types.js';
import {
  JAPANESE_MOVES_TO_ID,
  JAPANESE_SPECIES_TO_ID,
  MOVE_ID_TO_JAPANESE,
  SPECIES_ID_TO_JAPANESE,
} from '../data/ja-names.generated.js';

interface BrowserSpeciesData {
  id: string;
  name: string;
  baseSpecies: string;
  forme?: string;
  types: string[];
  baseStats: SpeciesSummary['baseStats'];
  nfe?: boolean;
}

interface BrowserMoveData extends Omit<MoveSummary, 'displayName'> {}

interface BrowserDexData {
  version: 1;
  species: Record<string, BrowserSpeciesData>;
  moves: Record<string, BrowserMoveData>;
  typeChart: Record<string, Record<string, number>>;
}

const FORME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Mega: 'メガ',
  'Mega-X': 'メガX',
  'Mega-Y': 'メガY',
  Alola: 'アローラ',
  Galar: 'ガラル',
  Hisui: 'ヒスイ',
  Paldea: 'パルデア',
  Therian: 'れいじゅう',
  Incarnate: 'けしん',
  Origin: 'オリジン',
  School: 'むれたすがた',
  Crowned: 'けんのおう',
});

function toId(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function normalizeLocalizedName(value: string): string {
  return value.normalize('NFKC').trim().replace(/[\s・･_-]+/g, '').toLowerCase();
}

function resolveLocalized(value: string, aliases: Readonly<Record<string, string>>): string {
  return aliases[normalizeLocalizedName(value)] ?? value;
}

function includesLocalized(haystack: string, query: string): boolean {
  return normalizeLocalizedName(haystack).includes(normalizeLocalizedName(query));
}

function localizedSpeciesName(species: BrowserSpeciesData): string {
  const direct = SPECIES_ID_TO_JAPANESE[species.id];
  if (direct) return direct;
  const base = SPECIES_ID_TO_JAPANESE[toId(species.baseSpecies)];
  if (!base) return species.name;
  if (!species.forme) return base;
  return `${base}（${FORME_LABELS[species.forme] ?? species.forme}）`;
}

export class ShowdownAdapter {
  private constructor(private readonly data: BrowserDexData) {}

  static async load(
    url: string | URL,
    fetcher: typeof fetch = fetch,
  ): Promise<ShowdownAdapter> {
    const response = await fetcher(url);
    if (!response.ok) {
      throw new Error(`対戦データを読み込めませんでした: HTTP ${response.status}`);
    }
    const data = await response.json() as BrowserDexData;
    if (data.version !== 1 || !data.species || !data.moves || !data.typeChart) {
      throw new Error('対戦データの形式が正しくありません。');
    }
    return new ShowdownAdapter(data);
  }

  toId(value: string): string {
    return toId(value);
  }

  getSpecies(name: string): SpeciesSummary {
    const resolved = resolveLocalized(name, JAPANESE_SPECIES_TO_ID);
    const species = this.data.species[toId(resolved)];
    if (!species) throw new InputError(`ポケモン「${name}」が見つかりません。`);
    return {
      id: species.id,
      name: species.name,
      displayName: localizedSpeciesName(species),
      types: [...species.types],
      baseStats: { ...species.baseStats },
      nfe: Boolean(species.nfe),
    };
  }

  getMove(name: string): MoveSummary {
    const resolved = resolveLocalized(name, JAPANESE_MOVES_TO_ID);
    const move = this.data.moves[toId(resolved)];
    if (!move) throw new InputError(`技「${name}」が見つかりません。`);
    return {
      ...structuredClone(move),
      displayName: MOVE_ID_TO_JAPANESE[move.id] ?? move.name,
    };
  }

  getTypeMultiplier(moveType: string, targetTypes: string[]): number {
    return targetTypes.reduce((total, targetType) => {
      const multiplier = this.data.typeChart[moveType]?.[targetType] ?? 1;
      return total * multiplier;
    }, 1);
  }

  searchSpecies(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toId(query);
    return Object.values(this.data.species).filter((species) => {
      const displayName = localizedSpeciesName(species);
      return (normalizedEnglish && toId(species.name).includes(normalizedEnglish))
        || includesLocalized(displayName, query);
    }).slice(0, limit).map((species) => {
      const displayName = localizedSpeciesName(species);
      return { value: displayName, displayName, englishName: species.name };
    });
  }

  searchMoves(query: string, limit = 12): LocalizedSearchResult[] {
    const normalizedEnglish = toId(query);
    return Object.values(this.data.moves).filter((move) => {
      const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
      return (normalizedEnglish && toId(move.name).includes(normalizedEnglish))
        || includesLocalized(displayName, query);
    }).slice(0, limit).map((move) => {
      const displayName = MOVE_ID_TO_JAPANESE[move.id] ?? move.name;
      return { value: displayName, displayName, englishName: move.name };
    });
  }
}
