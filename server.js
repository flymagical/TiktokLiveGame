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

  // The question on screen right now, so a page that (re)connects mid-round
  // (e.g. after switching between overlay.html and tebak.html) can show it.
  let activeQuestion = null;

  // Push every game state change straight to the overlay.
  game.on("state", (payload) => {
    io.emit("game:state", payload);
    if (payload.type === "question" || payload.type === "wordQuestion") {
      activeQuestion = { payload, askedAt: Date.now() };
    } else if (["reveal", "wordReveal", "leaderboard", "endCard", "welcome"].includes(payload.type)) {
      activeQuestion = null;
    }
    if (payload.type === "answer" || payload.type === "taps") return; // too chatty to log
    const detail =
      payload.type === "question" ? payload.question :
      payload.type === "reveal"
        ? `jawaban: ${payload.correctLetter} (${payload.correctText}) — ` +
          (payload.winner ? `pemenang: ${payload.winner.nickname} +${payload.winner.pointsAwarded}` : "tidak ada pemenang")
        :
      payload.type === "followAlert" || payload.type === "powerUp" ? payload.message :
      payload.type === "goal" ? `${payload.count}/${payload.target}${payload.justReached ? " TERCAPAI!" : ""}` :
      payload.type === "mvp"
        ? `${payload.kind}: ${payload.mvp ? payload.mvp.nickname : payload.kind === "quiz" ? "belum ada pemain" : "belum ada gifter"}` :
      payload.type === "wordQuestion" ? `${payload.question} (${payload.letterCount} huruf)` :
      payload.type === "wordClue" ? `huruf ke-${payload.index + 1} dibuka (${payload.source}), sisa ${payload.hiddenLeft}` :
      payload.type === "wordReveal"
        ? `jawaban: ${payload.answer} — ` +
          (payload.winner ? `pemenang: ${payload.winner.nickname} +${payload.winner.pointsAwarded}` : "tidak ada pemenang")
        :
      payload.type === "welcome" ? "kartu selamat datang tampil — ketik !start untuk mulai" :
      payload.type === "mode" ? `${payload.mode}${payload.pending ? " (mulai soal berikutnya)" : ""}` : "";
    console.log(`[kuis] ${payload.type}`, detail);
  });

  // "Live bentar aja, testing" mark on the overlay, toggled by the host with
  // !testing. Off again after a server restart.
  let testingMark = false;
  const setTestingMark = (on) => {
    testingMark = on;
    io.emit("game:testing", testingMark);
    console.log(`[kuis] tanda testing ${testingMark ? "ditampilkan" : "disembunyikan"}`);
  };

  // Send a fresh client the current leaderboard so a late-connecting
  // overlay isn't blank until the next event.
  io.on("connection", (socket) => {
    socket.emit("game:leaderboard", scoreboard.getLeaderboard(10));
    socket.emit("game:config", { powerUps: game.getPowerUpLegend(), goal: game.getGoal(), mode: game.mode });
    socket.emit("game:testing", testingMark);
    socket.emit("game:previousMvp", scoreboard.getPreviousMvp());
    if (game.state === "waiting") socket.emit("game:state", game.getWelcome());
    if (activeQuestion && game.state === "asking") {
      const { payload, askedAt } = activeQuestion;
      const leftSec = Math.round(payload.durationSec - (Date.now() - askedAt) / 1000);
      if (leftSec > 2) socket.emit("game:state", { ...payload, durationSec: leftSec });
    }
  });

  // Open http://localhost:PORT/mvp (e.g. from a browser or a Stream Deck
  // button) to show the end-of-stream MVP gifter card.
  app.get("/mvp", (req, res) => {
    game.showMvp();
    res.type("text/plain").send("Kartu MVP gifter ditampilkan di overlay.");
  });
  // Pause/resume from a browser or Stream Deck, same as !pause / !lanjut.
  app.get("/pause", (req, res) => {
    res.type("text/plain").send(game.pause() ? "Kuis dijeda." : "Tidak ada yang bisa dijeda sekarang.");
  });
  app.get("/lanjut", (req, res) => {
    res.type("text/plain").send(game.resume() ? "Kuis dilanjutkan." : "Kuis tidak sedang dijeda.");
  });

  // Switch the game format: /mode/tebak or /mode/pilihan (same as !mode).
  app.get("/mode/:mode", (req, res) => {
    const ok = game.setMode(req.params.mode);
    res.type("text/plain").send(ok
      ? `Mode ${req.params.mode} dipilih (berlaku mulai soal berikutnya kalau kuis sedang berjalan).`
      : "Mode tidak dikenal. Pilih: tebak atau pilihan.");
  });

  app.get("/testing", (req, res) => {
    setTestingMark(!testingMark);
    res.type("text/plain").send(testingMark ? "Tanda testing ditampilkan." : "Tanda testing disembunyikan.");
  });

  app.get("/end", (req, res) => {
    game.showEndCard();
    res.type("text/plain").send("Kartu penutup live ditampilkan. Buka /lanjut untuk menutupnya.");
  });

  // Same as the host typing !welcome: stop the quiz, show the welcome card.
  app.get("/welcome", (req, res) => {
    res.type("text/plain").send(game.showWelcome()
      ? "Kartu selamat datang ditampilkan. Ketik !start (atau buka /start) untuk mulai lagi."
      : "Belum terhubung ke LIVE.");
  });

  // Same as the host typing !start: end the welcome card, begin the quiz.
  app.get("/start", (req, res) => {
    res.type("text/plain").send(game.begin()
      ? "Kuis dimulai!"
      : "Kuis tidak dalam posisi menunggu (sudah berjalan, atau belum terhubung ke LIVE).");
  });

  app.get("/mvp-kuis", (req, res) => {
    game.showMvp("quiz");
    res.type("text/plain").send("Kartu MVP kuis ditampilkan di overlay.");
  });

  // Data for the shareable cards (overlay.html?card=...). ?limit=1..10, default 3.
  const limitOf = (req) => Math.min(10, Math.max(1, Number(req.query.limit) || 3));
  app.get("/api/top-gifters", (req, res) => res.json(scoreboard.getTopGifters(limitOf(req))));
  app.get("/api/top-players", (req, res) =>
    res.json({ top: scoreboard.getLeaderboard(limitOf(req)), totalPlayers: scoreboard.getLeaderboard(Infinity).length }));

  // Start the Top Gifter board from zero (e.g. at the start of a new stream).
  app.get("/reset-gifters", (req, res) => {
    scoreboard.resetGifters();
    res.type("text/plain").send("Daftar Top Gifter sudah di-reset.");
  });

  tiktok.on("connected", ({ roomId }) => {
    console.log(`Terhubung ke LIVE @${config.tiktokUsername} (room ${roomId}). Memulai kuis...`);
    if (scoreboard.startSession(roomId)) {
      const { quiz, gift } = scoreboard.getPreviousMvp();
      console.log(`MVP live sebelumnya — kuis: ${quiz ? `${quiz.nickname} (${quiz.points} poin)` : "-"}, ` +
        `gift: ${gift ? `${gift.nickname} (${gift.diamonds} koin)` : "-"}`);
      io.emit("game:previousMvp", scoreboard.getPreviousMvp());
    }
    game.start(roomId).catch((err) => console.error("Gagal memulai game:", err));
  });

  tiktok.on("comment", (data) => {
    console.log(`[komentar] ${data.nickname}${data.isFollower ? " (follower)" : ""}: ${data.comment}`);
    // The host types !start to begin the quiz (a welcome card shows until
    // then; !welcome brings it back if the quiz started by accident). The host can also type !mvp (top gifter) or !mvpkuis (top quiz score) in
    // their own chat to show the matching MVP card, or !peringkat for the
    // leaderboard, !pause / !lanjut to pause and resume the quiz, !testing to
    // toggle the "just testing" mark, !mode tebak / !mode pilihan to switch the
    // game format, or !end for the closing thank-you card.
    const isHost = data.username && data.username.toLowerCase() === config.tiktokUsername.toLowerCase();
    const command = (data.comment || "").trim().toLowerCase();
    if (isHost && (command === "!mvp" || command === "!mvpkuis")) {
      game.showMvp(command === "!mvpkuis" ? "quiz" : "gifter");
      return;
    }
    if (isHost && command === "!peringkat") {
      game.requestLeaderboard();
      return;
    }
    if (isHost && (command === "!pause" || command === "!jeda")) {
      game.pause();
      return;
    }
    if (isHost && command === "!welcome") {
      if (!game.showWelcome()) console.log("[kuis] !welcome diabaikan: belum terhubung ke LIVE");
      return;
    }
    if (isHost && command === "!start") {
      if (!game.begin()) console.log("[kuis] !start diabaikan: kuis sudah berjalan atau belum terhubung ke LIVE");
      return;
    }
    const modeCommand = command.match(/^!mode (tebak|pilihan)$/);
    if (isHost && modeCommand) {
      game.setMode(modeCommand[1]);
      return;
    }
    if (isHost && (command === "!testing" || command === "!testing off")) {
      setTestingMark(command === "!testing" ? !testingMark : false);
      return;
    }
    if (isHost && command === "!end") {
      game.showEndCard();
      return;
    }
    if (isHost && (command === "!lanjut" || command === "!resume")) {
      game.resume();
      return;
    }
    game.handleComment(data);
  });

  tiktok.on("follow", (data) => {
    console.log(`[follow] ${data.nickname} melakukan follow`);
    game.handleFollow(data);
    io.emit("thanks", { kind: "follow", nickname: data.nickname });
  });

  tiktok.on("gift", (data) => {
    console.log(`[gift] ${data.nickname} mengirim ${data.giftName} x${data.count} (${data.diamonds} koin)`);
    io.emit("thanks", { kind: "gift", nickname: data.nickname, giftName: data.giftName, count: data.count, image: data.image });
    game.handleGift(data);
  });

  // Taps only matter in tebak mode, where they unlock letter clues.
  tiktok.on("like", (data) => game.handleLike(data));

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
