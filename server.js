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
    console.log(`[kuis] ${payload.type}`, payload.type === "question" ? payload.question : "");
  });

  // Send a fresh client the current leaderboard so a late-connecting
  // overlay isn't blank until the next event.
  io.on("connection", (socket) => {
    socket.emit("game:leaderboard", scoreboard.getLeaderboard(5));
  });

  tiktok.on("connected", ({ roomId }) => {
    console.log(`Terhubung ke LIVE @${config.tiktokUsername} (room ${roomId}). Memulai kuis...`);
    game.start().catch((err) => console.error("Gagal memulai game:", err));
  });

  tiktok.on("comment", (data) => {
    game.handleComment(data);
  });

  tiktok.on("follow", (data) => {
    console.log(`[follow] ${data.nickname} melakukan follow`);
    game.handleFollow(data);
  });

  tiktok.on("disconnected", (info) => {
    console.warn("Terputus dari TikTok LIVE:", info || "");
    console.warn("Akan mencoba lagi dalam 10 detik (pastikan live masih berjalan)...");
    setTimeout(() => tiktok.connect().catch(() => {}), 10000);
  });

  tiktok.on("error", (err) => {
    console.error("Error koneksi TikTok:", err.message || err);
  });

  httpServer.listen(config.port, () => {
    console.log(`Overlay berjalan di http://localhost:${config.port}/overlay.html`);
    console.log(`Tambahkan URL tersebut sebagai Browser Source di OBS (disarankan ukuran 1080x1920).`);
  });

  tiktok.connect().catch((err) => {
    console.error(`Gagal terhubung ke LIVE @${config.tiktokUsername}:`, err.message || err);
    console.error("Apakah akun sedang live? Mencoba lagi dalam 10 detik...");
    setTimeout(() => tiktok.connect().catch(() => {}), 10000);
  });
}

main();
