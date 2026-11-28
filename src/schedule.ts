// ==========================================
// 🕐 投稿スケジュール判定
// ==========================================
// 📝 Asia/Tokyo 基準の現在日付・時刻の算出と、「今日この登録チャンネルへ
// 投稿すべきか」の判定を行う純粋関数の集まり。実行環境のタイムゾーンに
// 依存しないよう、変換はすべて Intl.DateTimeFormat 経由で行う。

// ----- 🔤 時刻オプションの検証 -----
// "21:00" や "9:05" を受け付け、"21:00" / "09:05" の形に正規化する。不正なら null
export function parseTimeOption(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// "HH:MM" を 0 時からの分数へ。不正な値は 21:00 扱い（登録時に検証済みの前提）
export function timeToMinutes(time: string): number {
  const normalized = parseTimeOption(time) ?? "21:00";
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

// ----- 📅 JST の現在日付・時刻 -----
export interface JstParts {
  // "2026-11-19" 形式（最終投稿日の比較に使う）
  date: string;
  // 0 時からの分数
  minutes: number;
  // "2026年11月19日(木)" 形式（投稿文の表示用）
  label: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const LABEL_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

export function jstParts(now: Date): JstParts {
  const fields: Record<string, string> = {};
  for (const part of DATE_FORMAT.formatToParts(now)) {
    if (part.type !== "literal") fields[part.type] = part.value;
  }
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    minutes: Number(fields.hour) * 60 + Number(fields.minute),
    label: LABEL_FORMAT.format(now),
  };
}

// ----- ✅ 投稿すべきかの判定 -----
export interface ScheduleLike {
  // "HH:MM"（JST）
  time: string;
  // 最後に投稿した JST 日付 "YYYY-MM-DD"。未投稿なら null
  lastPostedDate: string | null;
}

// 登録時刻を過ぎていて、今日まだ投稿していなければ true。
// Bot が登録時刻より後に起動した場合も、その日の分は投稿対象になる。
export function shouldPost(reg: ScheduleLike, now: Date): boolean {
  const jst = jstParts(now);
  if (reg.lastPostedDate === jst.date) return false;
  return jst.minutes >= timeToMinutes(reg.time);
}

// ----- 🚫 投稿エラーの恒常性判定 -----
// Discord API のエラーコードのうち、リトライしても回復しない恒常的なもの。
// 10003: Unknown Channel / 50001: Missing Access / 50013: Missing Permissions
const PERMANENT_ERROR_CODES: ReadonlySet<number> = new Set([
  10003, 50001, 50013,
]);

// 投稿・チャンネル取得の失敗が恒常的（登録を解除すべき）かどうか
export function isPermanentPostError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" && PERMANENT_ERROR_CODES.has(code);
}
