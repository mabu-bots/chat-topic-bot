// ==========================================
// 🔑 設定（.env）
// ==========================================
// 📝 環境変数から Bot の設定を読み込む。必須項目が欠けていれば、起動時に
// 分かるようその場で例外を投げる（中途半端な状態で動き出さないため）。

export interface Config {
  token: string;
  clientId: string;
  guildId: string | null;
  // 状態ファイルのパス
  statePath: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません (.env を確認してください)`,
    );
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadConfig(): Config {
  return {
    token: requiredEnv("DISCORD_TOKEN"),
    clientId: requiredEnv("CLIENT_ID"),
    guildId: optionalEnv("GUILD_ID"),
    statePath: optionalEnv("STATE_PATH") ?? "data/state.json",
  };
}
