// ==========================================
// ⚙️ pm2 運用設定（chat-topic-bot）
// ==========================================
// 📝 起動手順:
//   pm2 start ecosystem.config.cjs
//   pm2 startup  （表示されたコマンドを実行）
//   pm2 save
// 🔑 .env は Node の --env-file で読み込む（npm start と同じ方式）。
// 秘密情報は .env（gitignore 済み）にだけ置き、このファイルには書かない。
// ♻️ READY ウォッチドッグ（src/watchdog.ts）が停滞を検知してプロセスを
// 終了させた場合も、pm2 の autorestart で再起動する前提の構成。

module.exports = {
  apps: [
    {
      name: "chat-topic-bot",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      kill_timeout: 5000,
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
