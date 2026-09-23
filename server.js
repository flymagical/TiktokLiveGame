const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const config = require("./config.json");
const { TikTokClient } = require("./lib/tiktokClient");
const { ScoreBoard } = require("./lib/scores");
const { GameEngine } = require("./lib/game");

async function main() {
  if (!config.tiktokUsername || config.tiktokUsername === "your_tiktok_username") {
    console.error("Atur 'tiktokUsername' di config.json ke username TikTok kamu terlebih dahulu.");
    process.exit(1);
  }

  const app = express();
  app.use(express.static(path.join(__dirname, "public")));
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  const scoreboard = new ScoreBoard();
  const game = new GameEngine(config, scoreboard);
  const tiktok = new TikTokClient(config.tiktokUsername);

  // Push every game state change straight to the overlay.
  game.on("state", (payload) => {
    io.emit("game:state", payload);
    if (payload.type === "answer") return; // the comment itself is already logged
    const detail =
      payload.type === "question" ? payload.question :
      payload.type === "reveal"
        ? `jawaban: ${payload.correctLetter} (${payload.correctText}) — ` +
          (payload.winner ? `pemenang: ${payload.winner.nickname} +${payload.winner.pointsAwarded}` : "tidak ada pemenang")
        :
      payload.type === "followAlert" ? payload.message : "";
    console.log(`[kuis] ${payload.type}`, detail);
  });

  // Send a fresh client the current leaderboard so a late-connecting
  // overlay isn't blank until the next event.
  io.on("connection", (socket) => {
    socket.emit("game:leaderboard", scoreboard.getLeaderboard(10));
  });

  tiktok.on("connected", ({ roomId }) => {
    console.log(`Terhubung ke LIVE @${config.tiktokUsername} (room ${roomId}). Memulai kuis...`);
    game.start().catch((err) => console.error("Gagal memulai game:", err));
  });

  tiktok.on("comment", (data) => {
    console.log(`[komentar] ${data.nickname}${data.isFollower ? " (follower)" : ""}: ${data.comment}`);
    game.handleComment(data);
  });

  tiktok.on("follow", (data) => {
    console.log(`[follow] ${data.nickname} melakukan follow`);
    game.handleFollow(data);
    io.emit("thanks", { kind: "follow", nickname: data.nickname });
  });

  tiktok.on("gift", (data) => {
    console.log(`[gift] ${data.nickname} mengirim ${data.giftName} x${data.count}`);
    io.emit("thanks", { kind: "gift", nickname: data.nickname, giftName: data.giftName, count: data.count, image: data.image });
  });

  tiktok.on("disconnected", (info) => {
    console.warn("Terputus dari TikTok LIVE:", info || "");
    console.warn("Akan mencoba lagi dalam 10 detik (pastikan live masih berjalan)...");
    setTimeout(() => connectWithRetry(tiktok), 10000);
  });

  tiktok.on("error", (err) => {
    console.error("Error koneksi TikTok:", err.message || err);
  });

  httpServer.listen(config.port, () => {
    console.log(`Overlay berjalan di http://localhost:${config.port}/overlay.html`);
    console.log(`Tambahkan URL tersebut sebagai Browser Source di OBS (disarankan ukuran 1080x1920).`);
  });

  connectWithRetry(tiktok);
}

// Keep retrying until the account goes live, so the server can be started
// before the LIVE begins.
function connectWithRetry(tiktok) {
  tiktok.connect().catch((err) => {
    console.error(`Gagal terhubung ke LIVE @${config.tiktokUsername}:`, err.message || err);
    console.error("Apakah akun sedang live? Mencoba lagi dalam 10 detik...");
    setTimeout(() => connectWithRetry(tiktok), 10000);
  });
}

main();
