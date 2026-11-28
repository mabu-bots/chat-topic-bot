// ==========================================
// 🧪 テスト: コマンド定義と入力検証
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  commandData,
  containsForbiddenMention,
  MAX_ADDED_TOPICS_PER_GUILD,
} from "../src/commands.js";

test("containsForbiddenMention: メンション記法を検出する", () => {
  assert.equal(containsForbiddenMention("@everyone みんな聞いて"), true);
  assert.equal(containsForbiddenMention("@here 集まって"), true);
  assert.equal(containsForbiddenMention("<@123456789> さんへ"), true);
  assert.equal(containsForbiddenMention("<@&987654321> ロールへ"), true);
});

test("containsForbiddenMention: 通常のお題は通す", () => {
  assert.equal(containsForbiddenMention("好きな食べ物は？"), false);
  assert.equal(containsForbiddenMention("メールアドレスの @ の話"), false);
  assert.equal(containsForbiddenMention("everyone で遊んだ話"), false);
});

test("追加お題の上限は100件", () => {
  assert.equal(MAX_ADDED_TOPICS_PER_GUILD, 100);
});

test("コマンド定義は5件で、名前と権限・オプションが想定どおり", () => {
  const byName = new Map(
    commandData.map((command) => [
      command.name,
      command as unknown as Record<string, unknown>,
    ]),
  );
  assert.deepEqual([...byName.keys()].sort(), [
    "topic",
    "topic-add",
    "topic-list",
    "topic-remove",
    "topic-set",
  ]);
  // topic-set / topic-remove は ManageGuild (32) を既定権限に持つ
  assert.equal(byName.get("topic-set")?.default_member_permissions, "32");
  assert.equal(byName.get("topic-remove")?.default_member_permissions, "32");
  assert.equal(byName.get("topic")?.default_member_permissions, undefined);
  // 必須オプション
  const addOptions = byName.get("topic-add")?.options as Array<
    Record<string, unknown>
  >;
  assert.equal(addOptions[0].name, "text");
  assert.equal(addOptions[0].required, true);
  assert.equal(addOptions[0].max_length, 200);
  const setOptions = byName.get("topic-set")?.options as Array<
    Record<string, unknown>
  >;
  assert.equal(setOptions[0].name, "time");
  assert.equal(setOptions[0].required, false);
});
