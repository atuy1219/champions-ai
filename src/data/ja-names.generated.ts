/**
 * Fallback aliases used when the PokeAPI synchronization step is offline.
 * Run `npm run sync:i18n` to regenerate this file with the full current list.
 */
export const JAPANESE_SPECIES_TO_ID: Readonly<Record<string, string>> = Object.freeze({
  'ガブリアス': 'garchomp',
  'ガオガエン': 'incineroar',
  'カイリュー': 'dragonite',
  'ゴリランダー': 'rillaboom',
  'サーフゴー': 'gholdengo',
  'ハバタクカミ': 'fluttermane',
  'ウーラオス': 'urshifu',
  'モロバレル': 'amoonguss',
  'トルネロス': 'tornadus',
  'ペリッパー': 'pelipper',
  'ミライドン': 'miraidon',
  'コライドン': 'koraidon',
});

export const SPECIES_ID_TO_JAPANESE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(JAPANESE_SPECIES_TO_ID).map(([ja, id]) => [id, ja])),
);

export const JAPANESE_MOVES_TO_ID: Readonly<Record<string, string>> = Object.freeze({
  'じしん': 'earthquake',
  'ドラゴンクロー': 'dragonclaw',
  'まもる': 'protect',
  'つるぎのまい': 'swordsdance',
  'ねこだまし': 'fakeout',
  'おいかぜ': 'tailwind',
  'トリックルーム': 'trickroom',
  'こごえるかぜ': 'icywind',
  'エレキネット': 'electroweb',
  'このゆびとまれ': 'followme',
  'いかりのこな': 'ragepowder',
  'てだすけ': 'helpinghand',
  'ワイドガード': 'wideguard',
  'ファストガード': 'quickguard',
  'フレアドライブ': 'flareblitz',
  'はたきおとす': 'knockoff',
  'とんぼがえり': 'uturn',
  'グラススライダー': 'grassyglide',
  'ゴールドラッシュ': 'makeitrain',
  'ムーンフォース': 'moonblast',
});

export const MOVE_ID_TO_JAPANESE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(JAPANESE_MOVES_TO_ID).map(([ja, id]) => [id, ja])),
);
