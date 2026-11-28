// ==========================================
// 🧪 テスト: 状態ストア
// ==========================================
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store, validateState } from "../src/store.js";

function tempStore(): { store: Store; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "chat-topic-bot-rebuild-test-"));
  const path = join(dir, "state.json");
  return { store: new Store(path), dir, path };
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test("チャンネル登録が永続化され、再オープンで読み戻せる", () => {
  const { store, dir, path } = tempStore();
  store.upsertChannel({
    guildId: "g1",
    channelId: "c1",
    time: "21:00",
    lastPostedDate: null,
  });
  const saved = JSON.parse(readFileSync(path, "utf-8")) as {
    channels: unknown[];
  };
  assert.equal(saved.channels.length, 1);
  const reopened = new Store(path);
  assert.equal(reopened.channelsForGuild("g1").length, 1);
  assert.equal(reopened.channelsForGuild("other").length, 0);
  cleanup(dir);
});

test("再登録では時刻が更新され、最終投稿日は引き継がれる", () => {
  const { store, dir } = tempStore();
  store.upsertChannel({
    guildId: "g1",
    channelId: "c1",
    time: "21:00",
    lastPostedDate: null,
  });
  store.markPosted("g1", "c1", "2026-11-19");
  store.upsertChannel({
    guildId: "g1",
    channelId: "c1",
    time: "07:30",
    lastPostedDate: null,
  });
  const reg = store.channelsForGuild("g1")[0];
  assert.equal(reg.time, "07:30");
  assert.equal(reg.lastPostedDate, "2026-11-19");
  cleanup(dir);
});

test("チャンネル登録を解除できる（解除の有無が戻り値になる）", () => {
  const { store, dir, path } = tempStore();
  store.upsertChannel({
    guildId: "g1",
    channelId: "c1",
    time: "21:00",
    lastPostedDate: null,
  });
  assert.equal(store.removeChannel("g1", "c1"), true);
  assert.equal(store.channelsForGuild("g1").length, 0);
  assert.equal(store.removeChannel("g1", "c1"), false);
  const reopened = new Store(path);
  assert.equal(reopened.channelsForGuild("g1").length, 0);
  cleanup(dir);
});

test("追加お題は連番 ID が付き、追加者情報と共に残る", () => {
  const { store, dir, path } = tempStore();
  const first = store.addTopic({
    text: "お題その1",
    addedBy: "ユーザーA",
    addedById: "u1",
    guildId: "g1",
    addedAt: "2026-11-19T00:00:00.000Z",
  });
  const second = store.addTopic({
    text: "お題その2",
    addedBy: "ユーザーB",
    addedById: "u2",
    guildId: "g1",
    addedAt: "2026-11-19T00:01:00.000Z",
  });
  assert.equal(first.id, "a1");
  assert.equal(second.id, "a2");
  const reopened = new Store(path);
  const list = reopened.addedTopicsForGuild("g1");
  assert.equal(list.length, 2);
  assert.equal(list[0].addedBy, "ユーザーA");
  assert.equal(reopened.addedTopicsForGuild("g2").length, 0);
  cleanup(dir);
});

test("追加お題を本文または ID で削除でき、出題履歴からも掃除される", () => {
  const { store, dir, path } = tempStore();
  const input = {
    addedBy: "ユーザーA",
    addedById: "u1",
    guildId: "g1",
    addedAt: "2026-11-19T00:00:00.000Z",
  };
  store.addTopic({ ...input, text: "消すお題" });
  store.addTopic({ ...input, text: "残すお題" });
  store.setRecent("g1", ["a1", "a2"]);
  const removed = store.removeTopic("g1", "消すお題");
  assert.equal(removed?.id, "a1");
  assert.deepEqual(store.recentFor("g1"), ["a2"]);
  // 他ギルドのお題は同文でも消えない / ID 指定でも消せる
  assert.equal(store.removeTopic("g2", "残すお題"), null);
  assert.equal(store.removeTopic("g1", "a2")?.text, "残すお題");
  assert.equal(store.removeTopic("g1", "a2"), null);
  const reopened = new Store(path);
  assert.equal(reopened.addedTopicsForGuild("g1").length, 0);
  cleanup(dir);
});

test("出題履歴の読み書き（未登録スコープは空配列）", () => {
  const { store, dir } = tempStore();
  assert.deepEqual(store.recentFor("g1"), []);
  store.setRecent("g1", ["b0", "b3"]);
  assert.deepEqual(store.recentFor("g1"), ["b0", "b3"]);
  assert.deepEqual(store.recentFor("g2"), []);
  cleanup(dir);
});

test("壊れた JSON の状態ファイルでも空の状態で起動し、元ファイルが退避される", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-topic-bot-rebuild-test-"));
  const path = join(dir, "state.json");
  writeFileSync(path, "{broken json", "utf-8");
  const store = new Store(path);
  assert.equal(store.data.channels.length, 0);
  const backups = readdirSync(dir).filter((name) =>
    name.startsWith("state.json.corrupt-"),
  );
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), "utf-8"), "{broken json");
  cleanup(dir);
});

test("型が崩れた状態ファイルは破損扱いで退避され、空で起動する", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-topic-bot-rebuild-test-"));
  const path = join(dir, "state.json");
  writeFileSync(
    path,
    JSON.stringify({ channels: "not-an-array", addedTopics: [] }),
    "utf-8",
  );
  const store = new Store(path);
  assert.equal(store.data.channels.length, 0);
  assert.equal(store.data.addedTopics.length, 0);
  const backups = readdirSync(dir).filter((name) =>
    name.startsWith("state.json.corrupt-"),
  );
  assert.equal(backups.length, 1);
  cleanup(dir);
});

test("validateState: フィールド欠落は既定値で補い、型崩れは null を返す", () => {
  const filled = validateState({});
  assert.deepEqual(filled, {
    channels: [],
    addedTopics: [],
    recentHistory: {},
    nextAddedSeq: 1,
  });
  assert.equal(validateState(null), null);
  assert.equal(validateState([]), null);
  assert.equal(validateState({ nextAddedSeq: 0 }), null);
  assert.equal(validateState({ nextAddedSeq: 1.5 }), null);
  assert.equal(validateState({ recentHistory: { g1: [1] } }), null);
});
