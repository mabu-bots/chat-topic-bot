// ==========================================
// 🧪 テスト: お題の選択
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPool,
  formatDailyMessage,
  formatTopicMessage,
  pickTopic,
  type TopicEntry,
} from "../src/picker.js";
import { TOPICS } from "../src/topics.js";

function makeEntry(id: string, text = id): TopicEntry {
  return { id, text, category: null, source: "builtin", addedBy: null };
}

test("buildPool: 内蔵と追加分が合体し、ID が一意になる", () => {
  const pool = buildPool([{ id: "a1", text: "追加のお題", addedBy: "だれか" }]);
  assert.equal(pool.length, TOPICS.length + 1);
  assert.equal(new Set(pool.map((entry) => entry.id)).size, pool.length);
  assert.equal(pool[0].id, "b0");
  assert.equal(pool[0].source, "builtin");
  const added = pool.find((entry) => entry.id === "a1");
  assert.equal(added?.source, "added");
  assert.equal(added?.addedBy, "だれか");
  assert.equal(added?.category, null);
});

test("pickTopic: 履歴にある題は選ばない", () => {
  const pool = [makeEntry("b0"), makeEntry("b1"), makeEntry("b2")];
  // rng が何を返しても b2 しか候補に残らない
  for (const r of [0, 0.5, 0.99]) {
    const result = pickTopic(pool, ["b0", "b1"], () => r);
    assert.equal(result?.picked.id, "b2");
    assert.deepEqual(result?.nextRecent, ["b0", "b1", "b2"]);
  }
});

test("pickTopic: プールを使い切ったら履歴をリセットして選ぶ", () => {
  const pool = [makeEntry("b0"), makeEntry("b1")];
  const result = pickTopic(pool, ["b0", "b1"], () => 0);
  assert.equal(result?.picked.id, "b0");
  // リセット後なので履歴は picked だけ
  assert.deepEqual(result?.nextRecent, ["b0"]);
});

test("pickTopic: プールに無い ID は履歴から掃除される", () => {
  const pool = [makeEntry("b0"), makeEntry("b1")];
  const result = pickTopic(pool, ["gone", "b0"], () => 0);
  assert.equal(result?.picked.id, "b1");
  assert.deepEqual(result?.nextRecent, ["b0", "b1"]);
});

test("pickTopic: 空プールでは null", () => {
  assert.equal(pickTopic([], []), null);
});

test("pickTopic: 連続で選んでも一巡するまで重複しない", () => {
  const pool = buildPool([]);
  let recent: string[] = [];
  const seen = new Set<string>();
  let counter = 0;
  const rng = () => {
    counter = (counter + 0.37) % 1;
    return counter;
  };
  for (let i = 0; i < pool.length; i++) {
    const result = pickTopic(pool, recent, rng);
    assert.ok(result);
    assert.ok(!seen.has(result.picked.id), `重複: ${result.picked.id}`);
    seen.add(result.picked.id);
    recent = result.nextRecent;
  }
  assert.equal(seen.size, pool.length);
});

test("formatTopicMessage: カテゴリ付き内蔵お題の書式", () => {
  const entry = makeEntry("b0", "好きな色は？");
  entry.category = "好み・趣味";
  assert.equal(
    formatTopicMessage(entry),
    "🎲 **お題**（好み・趣味）\n\n好きな色は？",
  );
});

test("formatTopicMessage: 追加お題には追加者名が付く", () => {
  const entry: TopicEntry = {
    id: "a1",
    text: "追加のお題",
    category: null,
    source: "added",
    addedBy: "だれか",
  };
  assert.equal(
    formatTopicMessage(entry),
    "🎲 **お題**\n\n追加のお題\n（だれか さん追加のお題）",
  );
});

test("formatDailyMessage: 日付ラベルと締めの文を含む", () => {
  const entry = makeEntry("b0", "好きな色は？");
  entry.category = "好み・趣味";
  const message = formatDailyMessage(entry, "2026年11月19日(木)");
  assert.ok(message.startsWith("📢 **今日のお題** — 2026年11月19日(木)"));
  assert.ok(message.includes("カテゴリ: 好み・趣味"));
  assert.ok(message.includes("好きな色は？"));
  assert.ok(message.endsWith("みんなの回答を待ってます！"));
});
