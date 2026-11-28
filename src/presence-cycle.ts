// ==========================================
// 🎮 プレゼンス・サイクル（全 Bot 共通）
// ==========================================
// 📝 Playing で1分ごとに次の2パターンを交互に表示する。
//   経過時間: <Bot名> | 起動して 1時間26分（起点はログイン完了時）
//   現在時刻: <Bot名> | 現在時刻 19:24 JST
// ⏰ 値は「次の分の境界時点」のものを計算し、境界の 200ms 前に先行送信
// する（Discord のプレゼンス伝播遅延の実測中央値 190ms と相殺し、
// 切り替えが境界にほぼ一致するようにする。実測: 着地は境界の ±20ms 以内）。
// 🔀 位相は Unix 分の偶奇で決まるため、全 Bot が同時に切り替わる。
// 📌 従来の Watching「/help | {ping}ms」（5分更新）はこのサイクルに置き換えた。
import { ActivityType, type Client } from "discord.js";

// 境界より何 ms 早く送信するか
export const PRESENCE_SEND_LEAD_MS = 200;

const MINUTE_MS = 60_000;

let cycleStartedAtMs: number | null = null;
let cycleTimer: ReturnType<typeof setTimeout> | null = null;

// ⏱️ 経過時間を分粒度で整形する（1時間26分 / 26分 / 0分）
export function formatElapsedMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}

// 🕐 JST の "HH:MM" を作る（UTC に9時間を足して UTC として読む）
function jstClock(at: Date): string {
  const shifted = new Date(at.getTime() + 9 * 3_600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 🎮 時刻 at におけるプレゼンス文字列を返す
export function presenceCycleText(
  botName: string,
  startedAt: number,
  at: Date,
): string {
  const phase = Math.floor(at.getTime() / MINUTE_MS) % 2;
  if (phase === 1) {
    return `${botName} | 現在時刻 ${jstClock(at)} JST`;
  }
  return `${botName} | 起動して ${formatElapsedMinutes(at.getTime() - startedAt)}`;
}

// ⏰ 次の分の境界と、その値で先行送信すべき時刻を返す。送信予定時刻を
// 過ぎている場合は翌分の境界へ前進する（過ぎた予定で即時発火を繰り返すと
// 送信を連打して Gateway レート制限にかかるため、この前進処理が必須）。
export function nextPresenceSend(nowMs: number): {
  sendAt: number;
  boundary: number;
} {
  let boundary = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  let sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  if (sendAt <= nowMs) {
    boundary += MINUTE_MS;
    sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  }
  return { sendAt, boundary };
}

// 👀 現在のプレゼンス文字列（他モジュールからの参照用）
export function currentPresenceText(client: Client): string {
  const name = client.user?.username ?? "";
  return presenceCycleText(name, cycleStartedAtMs ?? Date.now(), new Date());
}

// 📤 プレゼンスを1回適用する
function applyPresence(client: Client, at: Date): void {
  if (!client.user || cycleStartedAtMs === null) return;
  const text = presenceCycleText(client.user.username, cycleStartedAtMs, at);
  try {
    client.user.setActivity(text, { type: ActivityType.Playing });
    console.log(`[presence-cycle] ${text}`);
  } catch (error) {
    console.error("[presence-cycle] presence update failed:", error);
  }
}

// 🚀 サイクルを開始する。呼び出しのたびに現在の値を即時適用し、
// 境界タイマーは多重起動しても1本だけ動く。経過時間の起点は最初の
// 呼び出し時刻に固定される（再接続や再適用ではリセットしない）。
export function startPresenceCycle(client: Client): void {
  if (cycleStartedAtMs === null) cycleStartedAtMs = Date.now();
  applyPresence(client, new Date());
  if (cycleTimer !== null) return;
  const scheduleNext = (): void => {
    const { sendAt, boundary } = nextPresenceSend(Date.now());
    cycleTimer = setTimeout(
      () => {
        // 値は送信時刻ではなく境界時点のものを使う（先行送信）
        applyPresence(client, new Date(boundary));
        scheduleNext();
      },
      Math.max(0, sendAt - Date.now()),
    );
    cycleTimer.unref?.();
  };
  scheduleNext();
}
