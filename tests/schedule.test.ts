// ==========================================
// 🧪 テスト: 投稿スケジュール判定
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  isPermanentPostError,
  jstParts,
  parseTimeOption,
  shouldPost,
  timeToMinutes,
} from "../src/schedule.js";

// 2026-11-19T12:00:00Z は JST で 2026-11-19 21:00（木）
const AT_2100_JST = new Date("2026-11-19T12:00:00Z");
const AT_2059_JST = new Date("2026-11-19T11:59:00Z");
// JST で翌日 2026-11-20 21:00
const NEXT_DAY_2100_JST = new Date("2026-11-20T12:00:00Z");

test("parseTimeOption: 正常系は正規化される", () => {
  assert.equal(parseTimeOption("21:00"), "21:00");
  assert.equal(parseTimeOption("9:05"), "09:05");
  assert.equal(parseTimeOption(" 7:30 "), "07:30");
  assert.equal(parseTimeOption("0:00"), "00:00");
  assert.equal(parseTimeOption("23:59"), "23:59");
});

test("parseTimeOption: 異常系は null", () => {
  for (const bad of [
    "24:00",
    "21:60",
    "21",
    "21:0",
    "21:000",
    "abc",
    "",
    "21-00",
  ]) {
    assert.equal(parseTimeOption(bad), null, `入力: ${bad}`);
  }
});

test("timeToMinutes: 分換算と、不正値の既定 21:00", () => {
  assert.equal(timeToMinutes("21:00"), 1260);
  assert.equal(timeToMinutes("00:00"), 0);
  assert.equal(timeToMinutes("変な値"), 1260);
});

test("jstParts: UTC の時刻を JST の日付・分数・ラベルへ変換する", () => {
  const parts = jstParts(AT_2100_JST);
  assert.equal(parts.date, "2026-11-19");
  assert.equal(parts.minutes, 21 * 60);
  assert.equal(parts.label, "2026年11月19日(木)");
});

test("shouldPost: 時刻前は false、時刻ちょうどで true", () => {
  const reg = { time: "21:00", lastPostedDate: null };
  assert.equal(shouldPost(reg, AT_2059_JST), false);
  assert.equal(shouldPost(reg, AT_2100_JST), true);
});

test("shouldPost: 今日投稿済みなら false、翌日になれば true", () => {
  const reg = { time: "21:00", lastPostedDate: "2026-11-19" };
  assert.equal(shouldPost(reg, AT_2100_JST), false);
  assert.equal(shouldPost(reg, NEXT_DAY_2100_JST), true);
});

test("shouldPost: Bot が時刻後に起動しても、その日の分を投稿する", () => {
  // 23:30 JST に初めてチェックしても未投稿なら投稿対象になる
  const late = new Date("2026-11-19T14:30:00Z"); // JST 23:30
  assert.equal(shouldPost({ time: "21:00", lastPostedDate: null }, late), true);
});

test("isPermanentPostError: 恒常的な Discord エラーコードを検出する", () => {
  assert.equal(isPermanentPostError({ code: 10003 }), true); // Unknown Channel
  assert.equal(isPermanentPostError({ code: 50001 }), true); // Missing Access
  assert.equal(isPermanentPostError({ code: 50013 }), true); // Missing Permissions
});

test("isPermanentPostError: 一時的な失敗やコード無しは恒常扱いしない", () => {
  assert.equal(isPermanentPostError({ code: 500 }), false);
  assert.equal(isPermanentPostError(new Error("network error")), false);
  assert.equal(isPermanentPostError(null), false);
  assert.equal(isPermanentPostError("10003"), false);
});
