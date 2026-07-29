# champions-ai

Pokémon Champions向けの対戦判断AIを作るためのTypeScriptプロジェクトです。対戦データとタイプ相性の取得には、Pokémon Showdownの`champions` modを利用します。

## 現在の範囲

最初のMVPとして、Web画面から以下を入力できます。

- 自分と相手のポケモン
- 自分の4技
- 両者の残りHP
- 素早さランク
- 天候
- おいかぜの状態

入力された技を、タイプ一致・タイプ相性・命中率・天候・先制技・主要な補助技の価値から順位付けします。

現時点では、実際のダメージ式、相手の行動候補、交代、ダブルバトルの2体同時行動、複数ターン探索は未実装です。画面にもこの制約を表示します。

## 実行

Node.js 22以降を使用します。

```bash
npm install
npm run dev
```

`http://127.0.0.1:3000`を開きます。

本番相当の起動:

```bash
npm run build
npm start
```

## チェック

```bash
npm run check
```

TypeScriptの型検査、ビルド、ヒューリスティック評価の単体テストを実行します。

## 構成

```text
src/
├── core/       入出力型、評価関数、テスト
├── showdown/   Pokémon Showdownへのアダプター
├── server/     Node.js HTTP APIと静的ファイル配信
└── web/        ブラウザー側TypeScript
```

AIからPokémon Showdownを直接参照せず、`ShowdownAdapter`を挟んでいます。今後、Showdownとの差分修正や別シミュレーターへの切り替えを行いやすくするためです。

## 次の実装候補

1. ShowdownのBattleStreamを用いた実ターンシミュレーション
2. ダメージ乱数を含む期待値評価
3. 相手の候補行動を含む1ターン探索
4. 交代候補と控えポケモンの入力
5. ダブルバトルの2体同時選択
6. 対戦ログ保存と自己対戦
