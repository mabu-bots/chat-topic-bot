// ==========================================
// 🧪 テスト: プレゼンス・サイクル
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatElapsedMinutes,
  nextPresenceSend,
  PRESENCE_SEND_LEAD_MS,
  presenceCycleText,
} from "../src/presence-cycle.js";

test("先行送信リードは200ms", () => {
  assert.equal(PRESENCE_SEND_LEAD_MS, 200);
});

test("formatElapsedMinutes: 分粒度の整形", () => {
  assert.equal(formatElapsedMinutes(0), "0分");
  assert.equal(formatElapsedMinutes(26 * 60_000), "26分");
  assert.equal(formatElapsedMinutes(59 * 60_000 + 59_000), "59分");
  assert.equal(formatElapsedMinutes((60 + 26) * 60_000), "1時間26分");
  assert.equal(formatElapsedMinutes(60 * 60_000), "1時間00分");
  assert.equal(formatElapsedMinutes(-1), "0分");
});

test("presenceCycleText: 偶数分は経過時間、奇数分は現在時刻（JST）", () => {
  const startedAt = Date.parse("2026-11-28T00:00:00Z");
  // Unix 分が偶数になる時刻: 2026-11-28T01:26:00Z は JST 10:26
  const even = new Date("2026-11-28T01:26:00Z");
  assert.equal(Math.floor(even.getTime() / 60_000) % 2, 0);
  assert.equal(
    presenceCycleText("話題Bot", startedAt, even),
    "話題Bot | 起動して 1時間26分",
  );
  // 奇数分: その1分後
  const odd = new Date(even.getTime() + 60_000);
  assert.equal(Math.floor(odd.getTime() / 60_000) % 2, 1);
  assert.equal(
    presenceCycleText("話題Bot", startedAt, odd),
    "話題Bot | 現在時刻 10:27 JST",
  );
});

test("nextPresenceSend: 次の境界の200ms前を返す", () => {
  const now = Date.parse("2026-11-28T00:00:10.000Z");
  const { sendAt, boundary } = nextPresenceSend(now);
  assert.equal(boundary, Date.parse("2026-11-28T00:01:00.000Z"));
  assert.equal(sendAt, boundary - 200);
});

test("nextPresenceSend: 送信予定を過ぎていたら翌分の境界へ前進する", () => {
  // 境界の100ms前（送信予定時刻 = 境界-200ms は既に過去）
  const boundary = Date.parse("2026-11-28T00:01:00.000Z");
  const now = boundary - 100;
  const result = nextPresenceSend(now);
  assert.equal(result.boundary, boundary + 60_000);
  assert.equal(result.sendAt, boundary + 60_000 - 200);
  assert.ok(result.sendAt > now);
});
