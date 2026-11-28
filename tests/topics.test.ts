// ==========================================
// 🧪 テスト: お題バンク
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { TOPICS, TOPIC_CATEGORIES } from "../src/topics.js";

test("お題バンクは100件以上ある", () => {
  assert.ok(TOPICS.length >= 100, `件数: ${TOPICS.length}`);
});

test("カテゴリは7つで、全件にカテゴリと本文がある", () => {
  assert.deepEqual(TOPIC_CATEGORIES, [
    "最近のこと",
    "好み・趣味",
    "もしも話",
    "思い出",
    "ゲーム・音楽・アニメ",
    "食べ物",
    "季節・日常",
  ]);
  for (const topic of TOPICS) {
    assert.ok(
      TOPIC_CATEGORIES.includes(topic.category),
      `未知のカテゴリ: ${topic.category}`,
    );
    assert.ok(topic.text.trim().length > 0, "空のお題がある");
  }
});

test("カテゴリごとの件数が想定どおり", () => {
  const counts = new Map<string, number>();
  for (const topic of TOPICS)
    counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(counts), {
    最近のこと: 16,
    "好み・趣味": 16,
    もしも話: 16,
    思い出: 15,
    "ゲーム・音楽・アニメ": 16,
    食べ物: 15,
    "季節・日常": 15,
  });
});

test("お題の本文に重複がない", () => {
  const texts = TOPICS.map((topic) => topic.text);
  assert.equal(new Set(texts).size, texts.length);
});
