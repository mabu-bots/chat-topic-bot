// ==========================================
// 💬 スラッシュコマンド
// ==========================================
// 📝 お題の表示・投稿先登録・追加・削除・状況確認の5コマンドを定義し、
// Interaction への応答までを担当する。状態の読み書きは store.ts、
// 抽選と整形は picker.ts、時刻の検証は schedule.ts に委ねる。
import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { buildPool, formatTopicMessage, pickTopic } from "./picker.js";
import { parseTimeOption } from "./schedule.js";
import { TOPICS } from "./topics.js";
import type { Store } from "./store.js";

// ----- 📏 制限値 -----
// 追加お題の最大文字数
const MAX_TOPIC_LENGTH = 200;
// 投稿時刻の既定値（JST）
const DEFAULT_POST_TIME = "21:00";
// ギルドあたりの追加お題の上限（無制限に追加できると状態が肥大化するため）
export const MAX_ADDED_TOPICS_PER_GUILD = 100;

// ----- 🛡️ 入力検証 -----
// 追加お題のテキストにメンション記法が含まれているか。
// @everyone / @here / <@ユーザーID> / <@&ロールID> を弾く（メンション注入対策）。
// 送信側でも allowedMentions: { parse: [] } を併用して二重に防ぐ。
export function containsForbiddenMention(text: string): boolean {
  return (
    text.includes("@everyone") || text.includes("@here") || text.includes("<@")
  );
}

// 実行時にサーバー管理権限（ManageGuild）を持っているか。
// setDefaultMemberPermissions は宣言に過ぎず、インテグレーション権限の
// 上書きで誰でも実行できる構成があり得るため、ハンドラ側でも再検証する。
function hasManageGuild(interaction: ChatInputCommandInteraction): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
  );
}

// 権限不足のときの共通応答。権限があれば true を返す
async function requireManageGuild(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (hasManageGuild(interaction)) return true;
  await interaction.reply({
    content:
      "このコマンドはサーバー管理権限 (ManageGuild) を持つメンバーだけが実行できます。",
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  return false;
}

// ギルド内で実行されているかを確認し、違えば案内を返す。ギルド ID を返す
async function requireGuild(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  if (interaction.guildId) return interaction.guildId;
  await interaction.reply({
    content: "サーバー内で実行してください。",
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  return null;
}

// ----- 📋 コマンド定義 -----
export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("topic")
    .setDescription("ランダムなお題を1つ投稿します"),
  new SlashCommandBuilder()
    .setName("topic-set")
    .setDescription("このチャンネルを毎日のお題投稿先に登録します")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription("投稿時刻 (例: 21:00、日本時間。既定 21:00)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("topic-add")
    .setDescription("お題を追加します (追加したお題も出題されるようになります)")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("追加するお題")
        .setRequired(true)
        .setMaxLength(MAX_TOPIC_LENGTH),
    ),
  new SlashCommandBuilder()
    .setName("topic-remove")
    .setDescription("追加されたお題を削除します (サーバー管理者のみ)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("削除する追加お題の本文 (完全一致) または ID")
        .setRequired(true)
        .setMaxLength(MAX_TOPIC_LENGTH),
    ),
  new SlashCommandBuilder()
    .setName("topic-list")
    .setDescription("お題の登録状況と総数を表示します"),
];

// 登録 API へ渡す JSON 形式
export const commandData = commandBuilders.map((builder) => builder.toJSON());

// ----- 🎮 ハンドラ -----
export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  switch (interaction.commandName) {
    case "topic":
      return handleTopic(interaction, store);
    case "topic-set":
      return handleTopicSet(interaction, store);
    case "topic-add":
      return handleTopicAdd(interaction, store);
    case "topic-remove":
      return handleTopicRemove(interaction, store);
    case "topic-list":
      return handleTopicList(interaction, store);
  }
}

// 出題履歴のスコープキー。ギルド内はギルド単位、DM は "dm"
function historyScopeKey(interaction: ChatInputCommandInteraction): string {
  return interaction.guildId ?? "dm";
}

// 🎲 /topic: その場でお題を1つ出す
async function handleTopic(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const key = historyScopeKey(interaction);
  const added = interaction.guildId
    ? store.addedTopicsForGuild(interaction.guildId)
    : [];
  const pool = buildPool(added);
  const result = pickTopic(pool, store.recentFor(key));
  if (!result) {
    await interaction.reply({
      content: "お題がありません。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  store.setRecent(key, result.nextRecent);
  // 追加お題はユーザー入力なので、メンションとして解釈させない
  await interaction.reply({
    content: formatTopicMessage(result.picked),
    allowedMentions: { parse: [] },
  });
}

// 📌 /topic-set: このチャンネルを毎日の投稿先に登録する
async function handleTopicSet(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;
  if (
    !interaction.guildId ||
    !interaction.channel ||
    interaction.channel.type !== ChannelType.GuildText
  ) {
    await interaction.reply({
      content: "サーバーのテキストチャンネルで実行してください。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const rawTime = interaction.options.getString("time");
  const time = rawTime === null ? DEFAULT_POST_TIME : parseTimeOption(rawTime);
  if (time === null) {
    await interaction.reply({
      content: `時刻の形式が正しくありません。「${rawTime}」→ 例: 21:00 のように指定してください。`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  store.upsertChannel({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    time,
    lastPostedDate: null,
  });
  await interaction.reply({
    content: `このチャンネルを毎日のお題投稿先に登録しました。毎日 ${time} (日本時間) にお題を投稿します。`,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

// ➕ /topic-add: メンバーがお題を追加する
async function handleTopicAdd(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const text = interaction.options.getString("text", true).trim();
  if (!text) {
    await interaction.reply({
      content: "お題が空です。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  // メンション記法を含むお題は拒否する（メンション注入対策）
  if (containsForbiddenMention(text)) {
    await interaction.reply({
      content:
        "メンション (@everyone / @here / <@...> など) を含むお題は追加できません。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  // ギルドあたりの追加お題の上限
  const guildTopics = store.addedTopicsForGuild(guildId);
  if (guildTopics.length >= MAX_ADDED_TOPICS_PER_GUILD) {
    await interaction.reply({
      content: `追加お題が上限 (${MAX_ADDED_TOPICS_PER_GUILD} 件) に達しています。不要なお題を /topic-remove で削除してください。`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  // 内蔵バンク・追加済みとの完全一致は重複として弾く
  const duplicated =
    TOPICS.some((topic) => topic.text === text) ||
    guildTopics.some((topic) => topic.text === text);
  if (duplicated) {
    await interaction.reply({
      content: "そのお題は既に登録されています。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const addedBy = interaction.user.displayName ?? interaction.user.username;
  store.addTopic({
    text,
    addedBy,
    addedById: interaction.user.id,
    guildId,
    addedAt: new Date().toISOString(),
  });
  await interaction.reply({
    content: `お題を追加しました！\n\n${text}`,
    allowedMentions: { parse: [] },
  });
}

// 🗑️ /topic-remove: 追加お題を削除する（管理者のみ）
async function handleTopicRemove(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const query = interaction.options.getString("text", true).trim();
  const removed = store.removeTopic(guildId, query);
  if (!removed) {
    await interaction.reply({
      content:
        "その追加お題は見つかりませんでした。本文 (完全一致) または ID を指定してください。",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.reply({
    content: `追加お題を削除しました: ${removed.text} (${removed.id})`,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

// 📊 /topic-list: 登録状況とお題の総数を表示する
async function handleTopicList(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const added = store.addedTopicsForGuild(guildId);
  const channels = store.channelsForGuild(guildId);
  const lines: string[] = [
    "**お題の登録状況**",
    `内蔵のお題: ${TOPICS.length} 件`,
    `このサーバーで追加されたお題: ${added.length} 件`,
    `出題プール合計: ${TOPICS.length + added.length} 件`,
  ];
  if (channels.length === 0) {
    lines.push("毎日の投稿先: 未登録 (/topic-set で登録できます)");
  } else {
    lines.push("毎日の投稿先:");
    for (const channel of channels) {
      const last = channel.lastPostedDate
        ? `最終投稿 ${channel.lastPostedDate}`
        : "まだ投稿なし";
      lines.push(
        `・<#${channel.channelId}>: 毎日 ${channel.time} (日本時間) / ${last}`,
      );
    }
  }
  await interaction.reply({
    content: lines.join("\n"),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}
