import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const bestEffort = process.argv.includes('--best-effort');
const outputPath = resolve('src/data/ja-names.generated.ts');
const baseUrl = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const [headers, ...values] = rows;
  if (!headers) return [];
  return values
    .filter((valuesRow) => valuesRow.some(Boolean))
    .map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? ''])));
}

function showdownId(identifier) {
  return identifier.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function localizedKey(name) {
  return name.normalize('NFKC').trim().replace(/[\s・･_-]+/g, '').toLowerCase();
}

async function fetchCsv(name) {
  const response = await fetch(`${baseUrl}/${name}.csv`, {
    headers: { 'User-Agent': 'atuy1219/champions-ai i18n sync' },
  });
  if (!response.ok) {
    throw new Error(`${name}.csv: HTTP ${response.status}`);
  }
  return parseCsv(await response.text());
}

function createMaps(resources, names, resourceIdKey, identifierKey, nameIdKey) {
  const identifiers = new Map(
    resources.map((row) => [row[resourceIdKey], showdownId(row[identifierKey])]),
  );
  const jaToId = {};
  const idToJa = {};

  for (const row of names) {
    if (row.local_language_id !== '1') continue;
    const id = identifiers.get(row[nameIdKey]);
    if (!id || !row.name) continue;
    jaToId[localizedKey(row.name)] = id;
    idToJa[id] = row.name;
  }

  return { jaToId, idToJa };
}

function serialize(name, value) {
  return `export const ${name}: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(value, null, 2)});`;
}

async function main() {
  const [species, speciesNames, moves, moveNames] = await Promise.all([
    fetchCsv('pokemon_species'),
    fetchCsv('pokemon_species_names'),
    fetchCsv('moves'),
    fetchCsv('move_names'),
  ]);

  const speciesMaps = createMaps(species, speciesNames, 'id', 'identifier', 'pokemon_species_id');
  const moveMaps = createMaps(moves, moveNames, 'id', 'identifier', 'move_id');
  const generated = [
    '/** Generated from PokeAPI CSV data. Do not edit manually. */',
    serialize('JAPANESE_SPECIES_TO_ID', speciesMaps.jaToId),
    serialize('SPECIES_ID_TO_JAPANESE', speciesMaps.idToJa),
    serialize('JAPANESE_MOVES_TO_ID', moveMaps.jaToId),
    serialize('MOVE_ID_TO_JAPANESE', moveMaps.idToJa),
    '',
  ].join('\n\n');

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, generated, 'utf8');
  await rename(temporaryPath, outputPath);
  console.log(
    `Japanese names synchronized: ${Object.keys(speciesMaps.jaToId).length} species, ${Object.keys(moveMaps.jaToId).length} moves`,
  );
}

main().catch((error) => {
  if (bestEffort) {
    console.warn(`Japanese name synchronization skipped: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 0;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
