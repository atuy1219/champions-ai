# champions-ai

Pokémon Champions向けの対戦判断AIを作るためのTypeScriptプロジェクトです。対戦データとタイプ相性の取得には、Pokémon Showdownの`champions` modを利用します。

## 画面

- `http://127.0.0.1:3000/` — 詳細な盤面を設定して候補手を評価する画面
- `http://127.0.0.1:3000/live.html` — ポケチャンのプレイ中に状態変化を追跡する画面

ライブ追跡では、手動入力・Showdownプロトコル・将来の画面認識がすべて共通の`BattleEvent`を生成し、同じ`BattleStateStore`を更新します。

```text
手動入力 ─────────┐
Showdownログ ─────┼→ BattleEvent[] → BattleStateStore → AI
画面認識（予定） ─┘
```

## 現在の範囲

詳細入力画面では以下を入力できます。

- 日本語または英語のポケモン名・技名
- 自分の現在HP、最大HP、自動計算されたHP率
- 相手の残りHP率
- 両者の状態異常
- 攻撃・防御・特攻・特防・素早さ・命中・回避の全能力ランク
- 天候とフィールド
- トリックルーム
- 両陣営のおいかぜ、リフレクター、ひかりのかべ、オーロラベール

ライブ追跡画面では以下のイベントを登録できます。

- ターン進行
- 場に出たポケモンとHP
- HP変化、状態異常、ひんし
- 能力ランクの加算・指定・リセット
- 使用が確認できた技
- 天候、フィールド、トリックルームなどの場全体状態
- おいかぜ、壁、設置技などのサイド状態
- こんらん、ちょうはつ、みがわりなどの一時状態
- Showdownプロトコルの貼り付け取込

入力された技を、タイプ一致・タイプ相性・命中率・能力ランク・天候・フィールド・壁・行動順・主要な補助技の価値から順位付けします。

現時点では、厳密なダメージ式、特性・持ち物、相手の行動候補、交代、ダブルバトルの2体同時行動、複数ターン探索は未実装です。

## BattleEvent API

現在状態:

```http
GET /api/state
```

手動入力または画面認識結果を反映:

```http
POST /api/state/events
Content-Type: application/json

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

Showdownプロトコルを解析して反映:

```http
POST /api/state/showdown
Content-Type: application/json

{ "text": "|-weather|RainDance" }
```

状態を初期化:

```http
POST /api/state/reset
```

## 日本語名データ

ビルド前にPokeAPIのCSVから日本語名を取得し、Showdown内部IDとの対応表を生成します。

```bash
npm run sync:i18n
```

通常の`npm run build`でもベストエフォートで同期します。ネットワークが利用できない場合は、リポジトリ内のフォールバック辞書を使用します。Champions固有の新しい技・フォルムがPokeAPIにまだない場合は、英語名をそのまま使用できます。

## 実行

Node.js 22以降を使用します。

```bash
npm install
npm run dev
```

本番相当の起動:

```bash
npm run build
npm start
```

## チェック

```bash
npm run check
```

TypeScriptの型検査、ビルド、ヒューリスティック評価、BattleStateとShowdownプロトコル変換の単体テストを実行します。

## 構成

```text
src/
├── core/       BattleState、入出力型、評価関数、テスト
├── data/       日本語名の生成データ
├── input/      Showdownログ・手動・画面認識の入力アダプター
├── showdown/   Pokémon Showdownへのアダプター
├── server/     Node.js HTTP APIと静的ファイル配信
└── web/        ブラウザー側TypeScript
```

AIからPokémon Showdownを直接参照せず、`ShowdownAdapter`と`BattleStateStore`を挟んでいます。Showdown対戦、ポケチャンの手動入力、画面認識のどれでも同じAIへ渡せる構造です。

## 次の実装候補

1. ライブの`BattleState`から評価リクエストを自動生成
2. ポケチャン画面の領域切り出しとHPバー認識
3. 技名・ポケモン名・能力変化表示の画像認識
4. 認識信頼度が低いイベントの手動確認UI
5. 厳密なステータス・ダメージ乱数を含む期待値評価
6. 特性・持ち物・技効果の追跡
7. 相手の候補行動と交代を含む探索
8. ダブルバトルの2体同時選択
