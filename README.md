# champions-ai

Pokémon Champions向けの対戦判断支援アプリです。対戦中に確認した変化を記録し、現在盤面から技・対象・交代・ダブルの同時行動を評価します。ポケモン、技、タイプ相性などの基礎データにはPokémon Showdownの`champions` modを利用します。

## GitHub Pages版

`main`へマージすると、GitHub Actionsが静的サイトを生成してGitHub Pagesへデプロイします。

```text
https://atuy1219.github.io/champions-ai/
```

Pages版はNode.jsサーバーを必要としません。

```text
GitHub Actionsでビルド
  ├─ Pokémon Showdownから必要なDexデータだけをJSONへ抽出
  ├─ 評価コアとライブUIをブラウザー用にバンドル
  └─ dist/pagesをGitHub Pagesへ配置

利用時のブラウザー
  ├─ BattleState管理
  ├─ ダメージ・候補手評価
  ├─ Showdownログ解析
  └─ localStorageへの対戦保存
```

対戦データは利用中のブラウザーに保存されます。別端末や別ブラウザーへ自動同期されないため、移動するときは画面の「JSON保存」「JSON読込」を使用します。

ローカルでPages成果物を生成する場合:

```bash
npm install
npm run build:pages
```

出力先:

```text
dist/pages/
```

デプロイWorkflowは`.github/workflows/pages.yml`です。リポジトリで初めてPagesを使う場合は、GitHubの`Settings → Pages → Source`を`GitHub Actions`に設定します。

## v1.1の完成範囲

`/live.html`だけで次の一連の運用が完結します。

```text
新しい対戦を開始
  → 自分の構築と判明済みの相手情報を登録
  → HP・交代・技・能力変化・場の変化だけを入力
  → 現在盤面を評価
  → 採用した行動を記録
  → 誤入力を1手戻す
  → 勝敗とメモを保存
  → JSONで書き出し・再読込・対戦後分析
```

Pages版ではイベント列・判断履歴・勝敗を`localStorage`へ保存します。Nodeサーバー版では`.data/battle-session.json`へ保存します。どちらも保存済みイベントを再生してBattleStateを復元します。

## Nodeサーバー版の起動

Node.js 22以降を使用します。

```bash
npm install
npm run dev
```

次を開きます。

```text
http://127.0.0.1:3000/live.html
```

本番相当の起動:

```bash
npm run build
npm start
```

永続化先は既定で`.data/battle-session.json`です。変更する場合は`SESSION_FILE`を指定します。

```bash
SESSION_FILE=/path/to/session.json npm start
```

## 入力アーキテクチャ

手動入力、Showdownログ、将来の画面認識はすべて共通の`BattleEvent`へ変換されます。

```text
手動入力 ─────────┐
Showdownログ ─────┼→ BattleEvent[] → 永続セッション → BattleState → 評価器
画面認識アダプター ┘
```

Node版ではHTTP APIが処理します。Pages版では同じ`/api/*`インターフェースをブラウザー内で再現するため、ライブUIは共通です。

画面認識器は、例えば次のJSONを`POST /api/state/events`へ送信できます。

```json
{
  "events": [
    {
      "type": "weather",
      "condition": "rain",
      "source": "vision",
      "confidence": 0.96
    }
  ]
}
```

実際のPokémon Champions映像を読む認識器自体は含みません。端末、解像度、言語、UI倍率ごとの調整が必要なため、独立した入力アダプターとして接続する設計です。

## 追跡できる情報

- 自分・相手の最大6体
- 場の左右2体と控え
- レベル、HP実数値またはHP率
- HP・攻撃・防御・特攻・特防・素早さの実数値
- 技、判明済み技、持ち物、特性
- テラスタイプとテラスタル状態
- 状態異常、ひんし、全7種類の能力ランク
- 天候、フィールド、トリックルーム
- おいかぜ、壁、設置技などのサイド状態
- こんらん、ちょうはつ、みがわりなどの一時状態
- 各状態の開始ターン、継続ターン、自動終了

実数値が未入力の場合は、レベル50・個体値31・努力値0・性格補正なしで補完します。

## 現在盤面の評価

評価器は次を生成・計算します。

- 登録済み技の対象候補
- 控えへの交代候補
- ダブルの2体同時行動候補
- 第9世代の基本ダメージ式による16段階の乱数範囲
- 平均ダメージ率、KO確率、命中率
- タイプ一致、テラスタル、タイプ相性、能力ランク
- 天候、フィールド、壁、全体技補正、やけど
- 主要な持ち物・特性
- 行動順、盤面制御、控えへの一貫性、温存価値
- 相手の既知技から推定した反撃リスク
- 相手技が未判明な場合の明示的な未知攻撃リスク
- 味方を巻き込む技の被害
- 集中攻撃、片方の防御、てだすけなどの同時行動シナジー

最終得点だけでなく、各得点成分、ダメージ前提、判断理由を表示します。

## 対戦セッション

セッションには次が保存されます。

- 対戦名、フォーマット、作成・更新・終了日時
- 全BattleEvent
- イベント再生から再構築できるBattleState
- 評価から採用した個別行動または同時行動
- 採用時のターン、盤面revision、得点
- 勝ち・負け・引き分け・中断
- 対戦後メモ

Pages版ではブラウザー保存領域を使用します。Node版では一時ファイルを書いてから保存ファイルを置き換えます。どちらの版でもJSONによる書き出しと読込が可能です。

## Showdownログ取込

通常のシミュレータープロトコルに加えて、`|request|` JSONから自分のチーム、実数値、技、持ち物、特性を取り込めます。

追跡対象:

- チームプレビューの`|poke|`
- 交代、HP、状態異常、能力ランク
- 使用技
- 天候、フィールド、サイド状態、一時状態
- 持ち物と特性の公開・消失
- フォルム変化
- テラスタル

## API

Node版は実際のHTTP APIを提供します。Pages版はライブUIから呼ばれる同じAPIをブラウザー内で処理します。

```text
GET  /api/state
GET  /api/session
GET  /api/session/export
POST /api/state/events
POST /api/state/showdown
POST /api/evaluate-current
POST /api/session/new
POST /api/session/undo
POST /api/session/import
POST /api/session/decision
POST /api/session/finish
```

## 精度上の境界

v1.1は手動入力型の対戦支援アプリとして完成していますが、ゲームエンジンの完全な再実装ではありません。

- ダメージ計算は第9世代の基本式と主要補正を実装しています
- すべての技固有スクリプト、持ち物、特性は未再現です
- 相手行動は既知技の最大被害と未公開技リスクを使った悲観評価です
- 未公開技・持ち物・特性・努力値の確率分布推定は行いません
- 交代評価は攻撃圧力、温存価値、反撃リスクによるモデルです
- ダブルの同時行動は個別評価と主要シナジーの合成で、全行動をBattleStreamで実行してはいません
- 複数ターン探索、選出予測、学習モデルは含みません
- 実際のPokémon Champions画面認識は外部アダプターとして接続します

不明情報を安全とみなして0点にすることは避け、警告と未知リスクを付けます。

## チェック

```bash
npm run check
```

以下を検証します。

- サーバー・通常ブラウザー・Pages版の厳格TypeScript型検査
- Nodeサーバービルド
- Pages用ブラウザーバンドル
- Pokémon Showdownからの静的Dex生成
- BattleStateと継続ターン
- Showdownプロトコル変換
- ダメージ、技・交代、ダブル同時行動
- 未公開技リスク
- セッション永続化、再起動復元、取消、JSON読込
- 破損セッションの復旧

## 構成

```text
src/
├── core/
│   ├── battle-state.ts             チームと対戦状態
│   ├── damage-service.ts           ダメージ範囲・行動順・反撃推定
│   ├── action-evaluator.ts         技・交代・同時行動の採点
│   └── current-evaluator.ts        現在盤面評価
├── input/                          Showdownログ・画面認識入力契約
├── showdown/                       Node版Pokémon Showdownアダプター
├── server/
│   ├── battle-session.ts           ファイル永続化・再生・取消・判断ログ
│   └── index.ts                    HTTP APIと静的配信
├── pages/
│   ├── browser-adapter.ts          静的Dexアダプター
│   ├── browser-session.ts          ブラウザー永続化
│   ├── api-emulator.ts             UI用APIのブラウザー内実装
│   └── main.ts                     Pages版起動処理
└── web/                            Node版・Pages版共通ライブUI

scripts/
├── export-champions-data.mjs       Showdownデータの静的JSON化
└── build-pages.mjs                 Pages成果物生成
```

## 将来の拡張

- BattleStreamによる全候補行動の1ターン実行
- 未公開構築の確率分布モデル
- 複数ターン探索と選出予測
- 端末別のPokémon Champions画面認識アダプター
