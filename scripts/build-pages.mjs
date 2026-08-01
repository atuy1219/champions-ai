import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

import { exportChampionsData } from './export-champions-data.mjs';

const output = resolve('dist/pages');
const browserAdapter = resolve('src/pages/browser-adapter.ts');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve('public'), output, { recursive: true });

const livePath = resolve(output, 'live.html');
let liveHtml = await readFile(livePath, 'utf8');
liveHtml = liveHtml
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./');
await writeFile(livePath, liveHtml, 'utf8');

await build({
  entryPoints: [resolve('src/pages/main.ts')],
  outfile: resolve(output, 'live.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  sourcemap: true,
  minify: true,
  plugins: [{
    name: 'browser-showdown-adapter',
    setup(buildContext) {
      buildContext.onResolve({ filter: /showdown[\\/]adapter\.js$/ }, () => ({ path: browserAdapter }));
    },
  }],
});

await exportChampionsData(resolve(output, 'data/champions-dex.json'));
await writeFile(resolve(output, '.nojekyll'), '', 'utf8');
await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="0; url=./live.html">
  <title>Champions AI</title>
</head>
<body>
  <p><a href="./live.html">Champions AIを開く</a></p>
</body>
</html>
`, 'utf8');

console.log(`GitHub Pages build completed: ${output}`);
