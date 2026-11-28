# DESIGN — chat-topic-bot 再実装の設計記録

v1.0.0（2026-11-28）の再実装における、旧実装（v1.0.1）から新実装への対応と判断を記録する。

## 1. 棚卸しの正

- 棚卸しの正は GitHub ではなく、**本番サーバー（台3 minase）から取得したスナップショット**（2026-11-28 取得）。サーバー側コードが GitHub より進んでいる前例（mabubot）があるため。
- スナップショットには `.env` と `data/` は含まれない。状態ファイルの形式はコードから読み取った。
- 旧バージョンは v1.0.1（package.json）。CHANGELOG には v1.0.1 の記録のみ（堅牢化と実行ログ追加）。

## 2. 旧→新対応表

| 旧（v1.0.1） | 新（v1.0.0） | 備考 |
| --- | --- | --- |
| `src/topics.ts` | `src/topics.ts` | お題バンク 7カテゴリ 109 件、カテゴリ順・本文・並び順まで一致（内蔵 ID `b<連番>` の対応を保つため） |
| `src/picker.ts` | `src/picker.ts` | プール構築・抽選・表示整形を再現 |
| `src/schedule.ts` | `src/schedule.ts` | JST 判定・恒常エラー判定を再現 |
| `src/store.ts` | `src/store.ts` | 状態ファイル形式（JSON）をそのまま再現 |
| `src/config.ts` | `src/config.ts` | 環境変数 4 件を再現 |
| `src/commands.ts` | `src/commands.ts` | コマンド定義 JSON は旧と機械比較で一致を確認 |
| `src/presence-cycle.ts` | `src/presence-cycle.ts` | 全 Bot 統一サイクルを再現 |
| `src/watchdog.ts` | `src/watchdog.ts` | READY ウォッチドッグを再現 |
| `src/execution-log.ts` | `src/execution-log.ts` | `[exec]` 1 行形式を再現 |
| `src/deploy.ts` | `src/deploy.ts` | 事前登録スクリプトを再現 |
| `src/index.ts` | `src/index.ts` | 起動・登録・毎日投稿ループを再現。未使用 import の整理と陳腐化コメントの修正のみ |
| `tests/*.test.ts`（7ファイル・41件） | `tests/*.test.ts`（8ファイル・51件） | 旧テスト相当を書き起こし、プレゼンス・サイクル等のテストを追加 |
| `ecosystem.config.cjs` | `ecosystem.config.cjs` | pm2 アプリ名・設定値は据え置き |
| （なし） | `build.sh` / `build.bat`、`CONTRIBUTING.md`、`DESIGN.md`、`.github/`（CI・Issue テンプレート・PR テンプレート・Dependabot） | fleet 標準の雛形を追加 |
| discord.js ^14.25.1 / TypeScript ^5.9.3 / @types/node ^24 | discord.js ^14.28.1 / TypeScript 7.0.2 / @types/node 26.6.6 / Prettier・tsx 追加 | fleet 標準のツールチェーンに更新 |

## 3. 再現した機能（棚卸し一覧）

- コマンド 5 件（グローバル）:
  - `/topic`（全員）: スコープ（ギルド ID / DM は `dm`）ごとの出題履歴を避けて抽選し投稿。プールを使い切ったら履歴リセット
  - `/topic-set [time]`（ManageGuild、宣言＋実行時再検証）: テキストチャンネルでのみ登録。時刻は `HH:MM`（JST、既定 21:00）に正規化、不正形式はエラー返信。再登録時は最終投稿日を引き継ぐ
  - `/topic-add <text>`（全員、ギルド内のみ）: 最大 200 文字、ギルドあたり最大 100 件。メンション記法（`@everyone` / `@here` / `<@`）を含むお題は拒否。内蔵バンク・追加済みとの完全一致は重複として拒否。追加者の表示名・ユーザー ID・ISO 日時を記録
  - `/topic-remove <text>`（ManageGuild、宣言＋実行時再検証）: 本文の完全一致または ID（`a<連番>`）で削除し、出題履歴からも ID を掃除
  - `/topic-list`（全員、ギルド内のみ、自分にだけ見える返信）: 内蔵件数・追加件数・プール合計・投稿先一覧（時刻と最終投稿日）
- お題バンク: 7 カテゴリ（最近のこと 16 / 好み・趣味 16 / もしも話 16 / 思い出 15 / ゲーム・音楽・アニメ 16 / 食べ物 15 / 季節・日常 15）＝ 109 件。内蔵 ID は平坦化順の `b<連番>`
- 抽選（picker）: 履歴に無い候補からのみ選択、プールに無い ID は履歴から掃除、rng 差し替え可能、表示整形（🎲 その場投稿 / 📢 毎日の投稿、追加お題には追加者名の注記）
- スケジュール（schedule）: `parseTimeOption` の正規化と検証、`timeToMinutes`（不正値は 21:00）、Intl による JST 変換（日付・分数・表示ラベル）、`shouldPost`（当日未投稿かつ登録時刻到達）、恒常エラー判定（コード 10003 / 50001 / 50013）
- 状態ストア（store）: `data/state.json`（`STATE_PATH` で変更可）。スキーマは `channels[]`（guildId / channelId / time / lastPostedDate）、`addedTopics[]`（id / text / addedBy / addedById / guildId / addedAt）、`recentHistory`（スコープ→ID 配列）、`nextAddedSeq`。書き込みは tmp + rename で原子的、整形は JSON 2 スペース。出題履歴は保存時に直近 1000 件へ切り詰め。読み込み時に型検証し、破損時は `state.json.corrupt-<時刻>` へ退避して空の状態で起動
- 毎日の投稿ループ: 1 分間隔＋起動時即時 tick、再入ガード。送信成功後に履歴と最終投稿日を記録する at-least-once 方式。チャンネル取得・送信の恒常的失敗は登録を自動解除、一時的失敗は次回 tick で再試行
- 起動処理: コマンド登録（`GUILD_ID` があればギルド登録、無ければグローバル登録）とログインを分離し、登録失敗時もログインを続行。Client の `allowedMentions: { parse: [] }` を既定にし、全送信でメンションを発火させない。インテントは Guilds のみ
- プレゼンス・サイクル: Playing、Unix 分の偶奇で「起動して <経過>」と「現在時刻 HH:MM JST」を 1 分交代、値は境界時点のものを境界 200ms 前に先行送信、経過起点は初回開始時に固定、タイマーは 1 本のみ・unref
- READY ウォッチドッグ: READY でない状態が 120 秒続いたらログを残して `process.exit(1)`（pm2 が再起動）。確認間隔 30 秒
- 実行ログ: `[exec] <ISO時刻> cmd= route= guild= channel= user= result=` の 1 行形式。失敗時は要点化した `error="..."`（100 文字切り詰め）を付加。入力テキストは記録しない
- 環境変数: `DISCORD_TOKEN`（必須）、`CLIENT_ID`（必須）、`GUILD_ID`（任意）、`STATE_PATH`（任意、既定 `data/state.json`）
- pm2: アプリ名 `chat-topic-bot`、`dist/src/index.js`、fork 1 インスタンス、autorestart、`max_memory_restart: 200M`、`kill_timeout: 5000`、`node_args: --env-file=.env`、`NODE_ENV=production`

## 4. 判断記録

1. **状態の保存先は JSON のままにした。** fleet の他 Bot は SQLite 化が進んでいるが、本番の `data/state.json` とそのまま互換を保つことを優先した。移行が必要になれば別途 Issue で扱う。
2. **engines は `node >=20` を据え置いた。** 稼働先（台3）の Node は 22 系であり、fleet 標準の `>=24` 表記に合わせると本番の前提と食い違うため。discord.js 等の依存バージョンは fleet 標準へ更新した。
3. **旧 index.ts の陳腐化コメントを修正した。** 起動処理のコメントに旧プレゼンス形式（Watching「/help | {ping}ms」、5 分更新）の説明が残っていたため、実態（サイクル方式）に合わせた。あわせて未使用だった `ActivityType` の import を外した。いずれも挙動の変更はない。
4. **コマンド定義は機械比較で一致を確認した。** 新旧双方の `commandData` JSON を出力して diff し、差分ゼロを確認した（お題バンクのテキスト一覧も同様に全件比較）。
