// ==========================================
// 🎲 お題の選択（プール構築と抽選）
// ==========================================
// 📝 内蔵バンクとメンバー追加分を1つのプールにまとめ、直近の出題履歴に
// あるお題を避けてランダムに1件選ぶ純粋関数の集まり。乱数は引数で
// 差し替え可能にし、テストから決定的に検証できるようにしている。
import { TOPICS } from "./topics.js";

// ----- 🏷️ 型 -----
export interface TopicEntry {
  // プール内で一意な ID。内蔵は "b<連番>"、追加分は store が採番する "a<連番>"
  id: string;
  text: string;
  // 内蔵お題のカテゴリ。追加お題は null
  category: string | null;
  source: "builtin" | "added";
  // 追加お題の追加者名（内蔵は null）
  addedBy: string | null;
}

// store の追加お題のうち、プール構築に必要な最小限の形
export interface AddedTopicLike {
  id: string;
  text: string;
  addedBy: string;
}

export interface PickResult {
  picked: TopicEntry;
  // 次回に使う出題履歴（picked を末尾に加えたもの。プールを使い切って
  // いた場合はリセット済みの履歴）
  nextRecent: string[];
}

// ----- 🧺 プール構築 -----
// 内蔵バンク + そのギルドで追加されたお題を1つのプールにする
export function buildPool(addedTopics: AddedTopicLike[]): TopicEntry[] {
  const pool: TopicEntry[] = TOPICS.map((topic, index) => ({
    id: `b${index}`,
    text: topic.text,
    category: topic.category,
    source: "builtin",
    addedBy: null,
  }));
  for (const topic of addedTopics) {
    pool.push({
      id: topic.id,
      text: topic.text,
      category: null,
      source: "added",
      addedBy: topic.addedBy,
    });
  }
  return pool;
}

// ----- 🎯 抽選 -----
// 履歴にあるお題を避けてランダムに1つ選ぶ。候補が無ければ（プールを
// 使い切ったら）履歴をリセットしてプール全体から選ぶ。プールが空なら null。
export function pickTopic(
  pool: TopicEntry[],
  recentIds: string[],
  rng: () => number = Math.random,
): PickResult | null {
  if (pool.length === 0) return null;
  const poolIds = new Set(pool.map((entry) => entry.id));
  // プールに存在しない ID は履歴から落とす（お題が削除された場合の掃除）
  let history = recentIds.filter((id) => poolIds.has(id));
  let candidates = pool.filter((entry) => !history.includes(entry.id));
  if (candidates.length === 0) {
    history = [];
    candidates = pool;
  }
  const index = Math.min(
    candidates.length - 1,
    Math.floor(rng() * candidates.length),
  );
  const picked = candidates[index];
  return { picked, nextRecent: [...history, picked.id] };
}

// ----- 💬 表示の整形 -----
// 追加お題には追加者名の注記を付ける（内蔵お題は付けない）
function addedByNote(entry: TopicEntry): string {
  return entry.source === "added" && entry.addedBy
    ? `\n（${entry.addedBy} さん追加のお題）`
    : "";
}

// /topic のその場投稿
export function formatTopicMessage(entry: TopicEntry): string {
  const head = entry.category
    ? `🎲 **お題**（${entry.category}）`
    : "🎲 **お題**";
  return `${head}\n\n${entry.text}${addedByNote(entry)}`;
}

// 毎日の定期投稿。dateLabel は "2026年11月19日(木)" のような表示用文字列
export function formatDailyMessage(
  entry: TopicEntry,
  dateLabel: string,
): string {
  const head = `📢 **今日のお題** — ${dateLabel}`;
  const categoryLine = entry.category ? `\nカテゴリ: ${entry.category}` : "";
  return `${head}${categoryLine}\n\n${entry.text}${addedByNote(entry)}\n\nみんなの回答を待ってます！`;
}
