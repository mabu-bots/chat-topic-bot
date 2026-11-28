// ==========================================
// 🗄️ 状態ストア（JSON ファイル）
// ==========================================
// 📝 毎日の投稿先チャンネルの登録、メンバー追加のお題、出題履歴を
// data/state.json に保持する。書き込みは tmp ファイル + rename で
// 原子的（atomic）に行い、書き込み途中のクラッシュでファイルが
// 中途半端な状態にならないようにする。
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

// ----- 🏷️ 型 -----
export interface ChannelRegistration {
  guildId: string;
  channelId: string;
  // 毎日の投稿時刻 "HH:MM"（Asia/Tokyo）
  time: string;
  // 最後に投稿した JST 日付 "YYYY-MM-DD"。未投稿なら null
  lastPostedDate: string | null;
}

export interface AddedTopic {
  // "a<連番>"
  id: string;
  text: string;
  // 追加者の表示名（不適切な追加への備えとして記録する）
  addedBy: string;
  addedById: string;
  guildId: string;
  // ISO 8601
  addedAt: string;
}

export interface State {
  channels: ChannelRegistration[];
  addedTopics: AddedTopic[];
  // ギルド ID（DM は "dm"）-> 直近の出題履歴（お題 ID の配列）
  recentHistory: Record<string, string[]>;
  // 追加お題の採番カウンタ
  nextAddedSeq: number;
}

export function emptyState(): State {
  return { channels: [], addedTopics: [], recentHistory: {}, nextAddedSeq: 1 };
}

// 出題履歴はプール件数を超えて伸びない設計だが、念のため上限を設ける
const RECENT_HISTORY_LIMIT = 1000;

// ----- 🔍 読み込み時の検証 -----
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isValidChannel(value: unknown): value is ChannelRegistration {
  return (
    isRecord(value) &&
    typeof value.guildId === "string" &&
    typeof value.channelId === "string" &&
    typeof value.time === "string" &&
    (value.lastPostedDate === null || typeof value.lastPostedDate === "string")
  );
}

function isValidAddedTopic(value: unknown): value is AddedTopic {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.addedBy === "string" &&
    typeof value.addedById === "string" &&
    typeof value.guildId === "string" &&
    typeof value.addedAt === "string"
  );
}

// パース済み JSON の型を検証し、正しければ State として返す。
// フィールド欠落は既定値で補うが、型が崩れている場合は null（破損扱い）。
export function validateState(parsed: unknown): State | null {
  if (!isRecord(parsed)) return null;
  const state = emptyState();
  if (parsed.channels !== undefined) {
    if (
      !Array.isArray(parsed.channels) ||
      !parsed.channels.every(isValidChannel)
    )
      return null;
    state.channels = parsed.channels;
  }
  if (parsed.addedTopics !== undefined) {
    if (
      !Array.isArray(parsed.addedTopics) ||
      !parsed.addedTopics.every(isValidAddedTopic)
    ) {
      return null;
    }
    state.addedTopics = parsed.addedTopics;
  }
  if (parsed.recentHistory !== undefined) {
    if (!isRecord(parsed.recentHistory)) return null;
    if (!Object.values(parsed.recentHistory).every(isStringArray)) return null;
    state.recentHistory = parsed.recentHistory as Record<string, string[]>;
  }
  if (parsed.nextAddedSeq !== undefined) {
    if (
      typeof parsed.nextAddedSeq !== "number" ||
      !Number.isInteger(parsed.nextAddedSeq) ||
      parsed.nextAddedSeq < 1
    ) {
      return null;
    }
    state.nextAddedSeq = parsed.nextAddedSeq;
  }
  return state;
}

// ----- 🏪 ストア本体 -----
export class Store {
  private state: State;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = emptyState();
    if (!existsSync(filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
      const validated = validateState(parsed);
      if (validated === null) throw new Error("状態ファイルの型が不正です");
      this.state = validated;
    } catch (err) {
      // ⚠️ 壊れた状態ファイルで Bot を止めない: 空の状態で起動する。
      // ただし無言で全消失させないため、元ファイルは別名へ退避してから
      // 起動する（次の save() で破損ファイルが上書きされて復旧不能に
      // なるのを防ぐ）。
      const detail = err instanceof Error ? err.message : String(err);
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        renameSync(filePath, backupPath);
        console.error(
          `状態ファイル ${filePath} が破損しているため空の状態で起動します。元ファイルは ${backupPath} へ退避しました: ${detail}`,
        );
      } catch {
        console.error(
          `状態ファイル ${filePath} が破損しているため空の状態で起動します (退避にも失敗しました): ${detail}`,
        );
      }
      this.state = emptyState();
    }
  }

  get data(): State {
    return this.state;
  }

  save(): void {
    this.trimRecentHistory();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    renameSync(tmpPath, this.filePath);
  }

  private trimRecentHistory(): void {
    for (const key of Object.keys(this.state.recentHistory)) {
      const list = this.state.recentHistory[key];
      if (list.length > RECENT_HISTORY_LIMIT) {
        this.state.recentHistory[key] = list.slice(
          list.length - RECENT_HISTORY_LIMIT,
        );
      }
    }
  }

  // ----- 📺 チャンネル登録の操作 -----
  upsertChannel(reg: ChannelRegistration): void {
    const index = this.state.channels.findIndex(
      (c) => c.guildId === reg.guildId && c.channelId === reg.channelId,
    );
    if (index >= 0) {
      // 再登録では最終投稿日を引き継ぐ（時刻変更だけで二重投稿しないため）
      const previous = this.state.channels[index];
      this.state.channels[index] = {
        ...reg,
        lastPostedDate: previous.lastPostedDate,
      };
    } else {
      this.state.channels.push(reg);
    }
    this.save();
  }

  markPosted(guildId: string, channelId: string, date: string): void {
    const reg = this.state.channels.find(
      (c) => c.guildId === guildId && c.channelId === channelId,
    );
    if (!reg) return;
    reg.lastPostedDate = date;
    this.save();
  }

  channelsForGuild(guildId: string): ChannelRegistration[] {
    return this.state.channels.filter((c) => c.guildId === guildId);
  }

  // 登録を解除する。解除したら true
  removeChannel(guildId: string, channelId: string): boolean {
    const before = this.state.channels.length;
    this.state.channels = this.state.channels.filter(
      (c) => !(c.guildId === guildId && c.channelId === channelId),
    );
    if (this.state.channels.length === before) return false;
    this.save();
    return true;
  }

  // ----- ➕ 追加お題の操作 -----
  addTopic(input: Omit<AddedTopic, "id">): AddedTopic {
    const topic: AddedTopic = { ...input, id: `a${this.state.nextAddedSeq}` };
    this.state.nextAddedSeq += 1;
    this.state.addedTopics.push(topic);
    this.save();
    return topic;
  }

  addedTopicsForGuild(guildId: string): AddedTopic[] {
    return this.state.addedTopics.filter((t) => t.guildId === guildId);
  }

  // 追加お題を削除する。query は ID（"a<連番>"）または本文の完全一致で指定する。
  // 削除できたらそのお題、対象が無ければ null
  removeTopic(guildId: string, query: string): AddedTopic | null {
    const index = this.state.addedTopics.findIndex(
      (t) => t.guildId === guildId && (t.id === query || t.text === query),
    );
    if (index < 0) return null;
    const removed = this.state.addedTopics[index];
    this.state.addedTopics.splice(index, 1);
    // 出題履歴に残った ID も掃除する（pickTopic 側でも掃除されるが、状態を綺麗に保つ）
    const recent = this.state.recentHistory[guildId];
    if (recent) {
      this.state.recentHistory[guildId] = recent.filter(
        (id) => id !== removed.id,
      );
    }
    this.save();
    return removed;
  }

  // ----- 🕘 出題履歴の操作 -----
  recentFor(scopeKey: string): string[] {
    return this.state.recentHistory[scopeKey] ?? [];
  }

  setRecent(scopeKey: string, ids: string[]): void {
    this.state.recentHistory[scopeKey] = ids;
    this.save();
  }
}
