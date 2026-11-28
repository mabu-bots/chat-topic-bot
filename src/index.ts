// ==========================================
// 🚀 エントリポイント
// ==========================================
// 📝 Discord へログインし、コマンド登録・対話処理・毎日のお題投稿
// ループを開始する。特権インテントは使わない（Guilds のみ）。
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type TextChannel,
} from "discord.js";
import { commandData, handleCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { logExecution } from "./execution-log.js";
import { buildPool, formatDailyMessage, pickTopic } from "./picker.js";
import { startPresenceCycle } from "./presence-cycle.js";
import { isPermanentPostError, jstParts, shouldPost } from "./schedule.js";
import { Store, type ChannelRegistration } from "./store.js";
import { attachReadyWatchdog } from "./watchdog.js";

const config = loadConfig();
const store = new Store(config.statePath);

// 🔇 allowedMentions の既定でメンションを一切発火させない（追加お題など
// ユーザー入力が投稿文に含まれても ping にならないようにする二重防御）
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] },
});

// 🐕 Gateway 安全構造: READY が来ないサイレント停滞を検知して終了する
attachReadyWatchdog(client);

// ----- 📮 コマンド登録（起動時に自動） -----
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  if (config.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      {
        body: commandData,
      },
    );
    console.log(`コマンドをギルド ${config.guildId} に登録しました`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commandData,
    });
    console.log("コマンドをグローバルに登録しました");
  }
}

// ----- 📅 毎日のお題投稿 -----
// 恒常的に投稿できない登録（チャンネル削除・権限なし等）は自動解除する。
// 解除しないと毎分リトライし続けてしまうため。一時的な失敗は解除せず
// 次回 tick で再試行する。
function unregisterBrokenChannel(
  reg: ChannelRegistration,
  reason: string,
): void {
  if (store.removeChannel(reg.guildId, reg.channelId)) {
    console.warn(
      `投稿先チャンネル ${reg.channelId} は恒常的に投稿できないため登録を解除しました: ${reason}`,
    );
  }
}

// 登録チャンネルを1件チェックし、投稿時刻を過ぎていて今日まだなら投稿する
async function postDailyIfDue(
  reg: ChannelRegistration,
  now: Date,
): Promise<void> {
  if (!shouldPost(reg, now)) return;
  let channel;
  try {
    channel = await client.channels.fetch(reg.channelId);
  } catch (err) {
    if (isPermanentPostError(err)) {
      unregisterBrokenChannel(
        reg,
        err instanceof Error ? err.message : String(err),
      );
    } else {
      console.warn(`投稿先チャンネル ${reg.channelId} の取得に失敗しました`);
    }
    return;
  }
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    unregisterBrokenChannel(reg, "テキストチャンネルとして見つかりません");
    return;
  }
  const pool = buildPool(store.addedTopicsForGuild(reg.guildId));
  const result = pickTopic(pool, store.recentFor(reg.guildId));
  if (!result) return;
  const jst = jstParts(now);
  try {
    await (channel as TextChannel).send({
      content: formatDailyMessage(result.picked, jst.label),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    if (isPermanentPostError(err)) {
      unregisterBrokenChannel(
        reg,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    throw err;
  }
  // 📌 設計意図（at-least-once）: 送信に成功してから投稿済みを記録する
  // 順序のため、送信成功と markPosted の保存の間にクラッシュすると、
  // 再起動後に同じ日のお題がもう一度投稿され得る。「投稿が欠ける」より
  // 「重複する」方がましなため、この順序を意図的に採用している
  // （exactly-once ではない）。
  store.setRecent(reg.guildId, result.nextRecent);
  store.markPosted(reg.guildId, reg.channelId, jst.date);
  console.log(
    `今日のお題を投稿しました: ${result.picked.text} -> #${reg.channelId}`,
  );
}

// 1分間隔で全登録チャンネルをチェックする
function startDailyLoop(): void {
  // tick の再入ガード: 前回の tick が長引いても重ねて実行せず、二重投稿を防ぐ
  let tickRunning = false;
  const tick = async (): Promise<void> => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const now = new Date();
      for (const reg of [...store.data.channels]) {
        try {
          await postDailyIfDue(reg, now);
        } catch (err) {
          console.warn(
            `お題の投稿に失敗しました (#${reg.channelId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      tickRunning = false;
    }
  };
  setInterval(() => void tick(), 60_000);
  void tick();
}

// ----- 🏁 起動 -----
client.once(Events.ClientReady, (readyClient) => {
  // プレゼンスは全 Bot 共通のサイクル表示（presence-cycle.ts）
  startPresenceCycle(readyClient);
  console.log(
    `ログインしました: ${readyClient.user.tag} / 投稿先登録 ${store.data.channels.length} 件 / 追加お題 ${store.data.addedTopics.length} 件`,
  );
  startDailyLoop();
  console.log("毎日のお題投稿ループを開始しました (1分間隔でチェック)");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const meta = {
    cmd: interaction.commandName,
    route: "slash" as const,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  };
  try {
    await handleCommand(interaction, store);
    logExecution({ ...meta, ok: true });
  } catch (err) {
    logExecution({ ...meta, ok: false, error: err });
    console.error("コマンド処理でエラーが発生しました:", err);
    const message =
      "処理中にエラーが発生しました。時間をおいて再度お試しください。";
    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({ content: message, allowedMentions: { parse: [] } })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({
          content: message,
          ephemeral: true,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
  }
});

// コマンド登録とログインは分離する: 登録（REST PUT）が一過性に失敗して
// もログイン自体は続行し、pm2 の再起動ループに陥らないようにする。
// 登録の失敗はログに残し、次回起動時に再試行される。
try {
  await registerCommands();
} catch (err) {
  console.error("コマンド登録に失敗しました (ログインは続行します):", err);
}
await client.login(config.token);
