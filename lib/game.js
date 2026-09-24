const { EventEmitter } = require("events");
const { fetchQuestions } = require("./trivia");
const { QuestionRotation, BLOCK_COUNT } = require("./questionRotation");
const questionBank = require("./questions-id");

const LETTERS = ["A", "B", "C", "D"];
const MIN_RESUME_QUESTION_MS = 5000;

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/^[!\/.]/, "") // strip leading command-ish characters
    .replace(/[^\p{L}\p{N} ]/gu, "") // strip punctuation, keep letters/numbers/spaces
    .trim();
}

// Which option (index) does a viewer's comment pick, or -1? Matching the
// answer text wins over the 1-4 shortcut, so for numeric answers (e.g. options
// "2", "3", "4", "5") typing "3" means the answer 3, not option #3.
function matchOption(comment, options) {
  const c = normalize(comment);
  if (!c) return -1;
  const byText = options.findIndex((text) => normalize(text) === c);
  if (byText !== -1) return byText;
  const byLetter = LETTERS.findIndex((l) => l.toLowerCase() === c);
  if (byLetter !== -1 && byLetter < options.length) return byLetter;
  const n = Number(c);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  return -1;
}

// Gift names are matched loosely ("finger heart" == "Finger Heart").
function isGift(name, configured) {
  if (!configured || !name) return false;
  return name.trim().toLowerCase() === configured.trim().toLowerCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameEngine extends EventEmitter {
  constructor(config, scoreboard) {
    super();
    this.config = config;
    this.scoreboard = scoreboard;
    this.questions = [];
    this.questionIndex = -1;
    this.questionNumber = 0; // 1-based, resets never (used for leaderboard cadence)
    this.state = "idle";
    this.correctAnswerers = []; // { userId, nickname } in answer order; scored at reveal
    this.answeredThisRound = new Set(); // userIds whose one answer this round is already used
    this._timer = null;
    this._timerFn = null; // what the running timer will do, so a pause can resume it
    this._timerEndsAt = 0;
    this._paused = null; // { state, remainingMs, fn } while the host has paused
    this._endCardShown = false; // closing thank-you card (!end) is on screen

    // Power-ups (gift = in-game advantage), all configured in config.powerUps.
    this.powerUps = config.powerUps || {};
    this.multiplier = 1; // points multiplier for the current question
    this.nextMultiplier = 1; // set when the gift goal is reached
    this.goalCount = 0; // goal gifts received since the current question started
    this.roundEndsAt = 0;
    this.freezesUsed = 0;
    this.eliminated = []; // letters removed by 50/50 this round
    this._resumeAfterMvp = false;
    this._leaderboardRequested = false; // host asked for the board (!peringkat)
    this.rotation = new QuestionRotation(); // which third of the bank this live uses
  }

  async start(roomId) {
    // A reconnect to the LIVE fires "connected" again; keep the running game.
    if (this.state !== "idle") return;
    this.state = "starting";
    const isNewLive = this.rotation.startLive(roomId);
    console.log(
      `${isNewLive ? "Live baru" : "Melanjutkan live yang sama"}: blok soal ${this.rotation.block + 1}/${BLOCK_COUNT} ` +
      `(${this.rotation.pool(questionBank).length} dari ${this.rotation.blockSize(questionBank)} soal belum keluar)`
    );
    await this._loadQuestionPool();
    this._advance();
  }

  async _loadQuestionPool() {
    this.questions = await fetchQuestions(this.config.trivia, this.rotation);
    this.questionIndex = -1;
  }

  async _advance() {
    this.questionIndex += 1;

    // Refill the pool if we've used every question fetched so far.
    if (this.questionIndex >= this.questions.length) {
      await this._loadQuestionPool();
      this.questionIndex = 0;
    }

    this.questionNumber += 1;

    const everyN = this.config.leaderboardEveryNQuestions;
    const due = everyN && this.questionNumber > 1 && (this.questionNumber - 1) % everyN === 0;
    if (due || (this._leaderboardRequested && this.questionNumber > 1)) {
      this._showLeaderboard();
      return;
    }

    this._askQuestion();
  }

  _askQuestion() {
    this.state = "asking";
    this.correctAnswerers = [];
    this.answeredThisRound.clear();
    this.freezesUsed = 0;
    this.eliminated = [];
    this.multiplier = this.nextMultiplier;
    this.nextMultiplier = 1;
    this.goalCount = 0;

    const q = this.questions[this.questionIndex];
    this.currentQuestion = q;
    this.rotation.markAsked(q.key);

    this.emit("state", {
      type: "question",
      questionNumber: this.questionNumber,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      options: q.options.map((text, i) => ({ letter: LETTERS[i], text })),
      durationSec: this.config.roundDurationSec,
      multiplier: this.multiplier,
      goal: this.getGoal()
    });

    this._startRoundTimer(this.config.roundDurationSec * 1000);
  }

  _startRoundTimer(ms) {
    this.roundEndsAt = Date.now() + ms;
    this._schedule(() => this._revealAnswer(), ms);
  }

  _revealAnswer() {
    this.state = "reveal";
    const q = this.currentQuestion;

    // Score only now, so nothing on screen hints at the answer before the
    // reveal. The winner is the earliest correct answerer who follows the host
    // (following any time before the reveal counts).
    const canScore = (a) => !this.config.requireFollowToScore || this.scoreboard.hasFollowed(a.userId);
    const winnerIndex = this.correctAnswerers.findIndex(canScore);
    let winner = null;
    if (winnerIndex !== -1) {
      const { userId, nickname, avatar } = this.correctAnswerers[winnerIndex];
      const points = this.config.pointsForFirstCorrect * this.multiplier;
      const v = this.scoreboard.awardPoints(userId, nickname, points, avatar);
      winner = { nickname: v.nickname, pointsAwarded: points, score: v.score, multiplier: this.multiplier };
    }

    this.emit("state", {
      type: "reveal",
      questionNumber: this.questionNumber,
      correctLetter: LETTERS[q.correctIndex],
      correctText: q.options[q.correctIndex],
      winner,
      durationSec: this.config.revealDurationSec
    });

    // Correct answerers who beat the winner but hadn't followed: nudge them.
    const missedOut = winnerIndex === -1 ? this.correctAnswerers : this.correctAnswerers.slice(0, winnerIndex);
    for (const { nickname } of missedOut) {
      this.emit("state", {
        type: "followAlert",
        nickname,
        message: `@${nickname} jawabannya benar, tapi belum follow — follow dulu supaya poinmu dihitung!`
      });
    }

    this._schedule(() => this._advance(), this.config.revealDurationSec * 1000);
  }

  // Host command !peringkat. Mid-question the board waits until that
  // question's answer has been revealed, so nobody loses a round; before the
  // quiz starts it's shown straight away.
  requestLeaderboard() {
    if (this.state === "leaderboard") return;
    if (["asking", "reveal", "mvp", "starting"].includes(this.state)) {
      this._leaderboardRequested = true;
      return;
    }
    this.emit("state", {
      type: "leaderboard",
      afterQuestion: this.questionNumber,
      top: this.scoreboard.getLeaderboard(10),
      topGifters: this.scoreboard.getTopGifters(10),
      durationSec: this.config.leaderboardDurationSec
    });
  }

  _showLeaderboard() {
    this.state = "leaderboard";
    this._leaderboardRequested = false;
    const top = this.scoreboard.getLeaderboard(10);

    this.emit("state", {
      type: "leaderboard",
      afterQuestion: this.questionNumber - 1,
      top,
      topGifters: this.scoreboard.getTopGifters(10),
      durationSec: this.config.leaderboardDurationSec
    });

    this._schedule(() => this._askQuestion(), this.config.leaderboardDurationSec * 1000);
  }

  // Every step of the quiz goes through this one timer, so pause() can stop
  // it and resume() can run the same step with the time that was left.
  _schedule(fn, ms) {
    this._clearTimer();
    this._timerFn = fn;
    this._timerEndsAt = Date.now() + ms;
    this._timer = setTimeout(fn, ms);
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._timerFn = null;
  }

  // Host commands !pause / !lanjut. The quiz stops wherever it is (during a
  // question, the answer reveal or the leaderboard) and later carries on with
  // the time that was left. Answers sent while paused don't count.
  pause() {
    if (!["asking", "reveal", "leaderboard"].includes(this.state)) return false;
    this._hold();
    this.emit("state", { type: "paused", during: this._paused.state });
    return true;
  }

  // Stop the running timer and remember what it was about to do.
  _hold() {
    const remainingMs = Math.max(0, this._timerEndsAt - Date.now());
    this._paused = { state: this.state, remainingMs, fn: this._timerFn };
    this._clearTimer();
    this.state = "paused";
  }

  // Host command !end: the closing thank-you card. It has no time limit,
  // since ending the LIVE takes it off air; the quiz stops underneath it.
  // !lanjut hides it and carries on, in case it was sent too early.
  showEndCard() {
    if (["asking", "reveal", "leaderboard", "mvp"].includes(this.state)) this._hold();
    this._endCardShown = true;
    const [topPlayer] = this.scoreboard.getLeaderboard(1);
    const [topGifter] = this.scoreboard.getTopGifters(1);
    this.emit("state", {
      type: "endCard",
      host: this.config.tiktokUsername,
      topPlayer: topPlayer || null,
      topGifter: topGifter || null
    });
  }

  resume() {
    const hadEndCard = this._endCardShown;
    this._endCardShown = false;
    if (this.state !== "paused") {
      // End card shown before the quiz was running: just take it down.
      if (hadEndCard) this.emit("state", { type: "resumed", during: null });
      return hadEndCard;
    }
    const { state, remainingMs, fn } = this._paused;
    this._paused = null;
    this.state = state;
    if (state === "asking") {
      // Give viewers a moment to re-read the question after the break.
      const ms = Math.max(remainingMs, MIN_RESUME_QUESTION_MS);
      this._startRoundTimer(ms);
      this.emit("state", { type: "resumed", during: state, remainingMs: ms });
    } else {
      this._schedule(fn, remainingMs);
      this.emit("state", { type: "resumed", during: state, remainingMs });
    }
    return true;
  }

  // --- Viewer interaction -------------------------------------------------

  handleComment({ userId, nickname, avatar, comment, isFollower }) {
    const trimmed = (comment || "").trim();

    if (isFollower && !this.scoreboard.hasFollowed(userId)) {
      this.scoreboard.markFollowed(userId, nickname);
    }

    if (/^!myrank$/i.test(trimmed)) {
      this._handleMyRank(userId, nickname);
      return;
    }

    if (this.state !== "asking") return;

    const q = this.currentQuestion;
    const matchedIndex = matchOption(trimmed, q.options);
    if (matchedIndex === -1) return; // not an answer to this question

    // Only a viewer's first answer counts, so spamming A, B, C, D can't win.
    if (this.answeredThisRound.has(userId)) return;
    this.answeredThisRound.add(userId);

    // Sent for right and wrong answers alike, without the letter, so the
    // overlay can react to activity without hinting at the answer.
    this.emit("state", { type: "answer", nickname, count: this.answeredThisRound.size });

    if (matchedIndex !== q.correctIndex) return; // wrong answer, ignore silently

    // Correct: record it quietly; points are decided at the reveal.
    this.correctAnswerers.push({ userId, nickname, avatar });
  }

  handleFollow({ userId, nickname }) {
    this.scoreboard.markFollowed(userId, nickname);
  }

  // --- Gifts & power-ups ---------------------------------------------------

  handleGift(gift) {
    this.scoreboard.recordGift(gift);
    const p = this.powerUps;
    const count = gift.count || 1;

    if (isGift(gift.giftName, p.giftGoal?.gift)) this._addGoalProgress(gift.nickname, count);
    if (isGift(gift.giftName, p.fiftyFifty?.gift)) this._fiftyFifty(gift.nickname);
    if (isGift(gift.giftName, p.freezeTimer?.gift)) this._freezeTimer(gift.nickname, count);
    if (isGift(gift.giftName, p.stealPoint?.gift)) this._stealPoint(gift, count);
  }

  _powerUpInfo(nickname, message) {
    this.emit("state", { type: "powerUp", kind: "info", nickname, message });
  }

  // 50/50: two wrong options disappear for everyone, once per question.
  _fiftyFifty(nickname) {
    if (this.state !== "asking") {
      return this._powerUpInfo(nickname, `@${nickname}, 50/50 hanya berlaku saat soal sedang berjalan.`);
    }
    if (this.eliminated.length) {
      return this._powerUpInfo(nickname, `@${nickname}, 50/50 sudah dipakai di soal ini.`);
    }
    const q = this.currentQuestion;
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correctIndex);
    this.eliminated = shuffle(wrong).slice(0, 2).map((i) => LETTERS[i]);
    this.emit("state", {
      type: "powerUp",
      kind: "fiftyFifty",
      nickname,
      eliminated: this.eliminated,
      message: `✂️ 50/50! @${nickname} menghapus 2 jawaban salah`
    });
  }

  // Freeze: +N seconds on the current question, capped per question.
  _freezeTimer(nickname, count) {
    const cfg = this.powerUps.freezeTimer;
    const addSec = cfg.addSec ?? 5;
    const max = cfg.maxPerRound ?? 3;
    if (this.state !== "asking") {
      return this._powerUpInfo(nickname, `@${nickname}, tambah waktu hanya berlaku saat soal sedang berjalan.`);
    }
    const uses = Math.min(count, max - this.freezesUsed);
    if (uses <= 0) {
      return this._powerUpInfo(nickname, `@${nickname}, tambah waktu sudah maksimal (${max}×) di soal ini.`);
    }
    this.freezesUsed += uses;
    const remainingMs = Math.max(0, this.roundEndsAt - Date.now()) + uses * addSec * 1000;
    this._startRoundTimer(remainingMs);
    this.emit("state", {
      type: "powerUp",
      kind: "freeze",
      nickname,
      addedSec: uses * addSec,
      remainingMs,
      usesLeft: max - this.freezesUsed,
      message: `⏳ @${nickname} menambah waktu +${uses * addSec} detik! (sisa ${max - this.freezesUsed}× lagi)`
    });
  }

  // Steal: take points from whoever is #1 right now. Works any time.
  _stealPoint({ userId, nickname }, count) {
    const per = this.powerUps.stealPoint.points ?? 1;
    const result = this.scoreboard.stealFromLeader(userId, nickname, per * count);
    if (!result) {
      const mine = this.scoreboard.getRank(userId);
      const msg = mine && mine.rank === 1
        ? `👑 @${nickname} sudah #1 — tidak ada yang bisa dicuri!`
        : `@${nickname}, belum ada juara untuk dicuri poinnya.`;
      return this._powerUpInfo(nickname, msg);
    }
    this.emit("state", {
      type: "powerUp",
      kind: "steal",
      nickname,
      victim: result.victim,
      points: result.points,
      score: result.score,
      victimScore: result.victimScore,
      message: `🦹 @${nickname} mencuri ${result.points} poin dari @${result.victim} (#1)!`
    });
  }

  // Gift goal: enough goal gifts during a question makes the NEXT question
  // worth multiplier × points.
  _addGoalProgress(nickname, count) {
    const cfg = this.powerUps.giftGoal;
    if (!cfg.target) return;
    const wasReached = this.goalCount >= cfg.target;
    this.goalCount += count;
    const justReached = !wasReached && this.goalCount >= cfg.target;
    if (justReached) this.nextMultiplier = cfg.multiplier ?? 3;
    this.emit("state", { type: "goal", ...this.getGoal(), justReached, nickname });
  }

  getGoal() {
    const cfg = this.powerUps.giftGoal;
    if (!cfg?.gift || !cfg.target) return null;
    return {
      gift: cfg.gift,
      count: Math.min(this.goalCount, cfg.target),
      target: cfg.target,
      multiplier: cfg.multiplier ?? 3,
      reached: this.goalCount >= cfg.target
    };
  }

  // Which gift does what, for the overlay's legend.
  getPowerUpLegend() {
    const p = this.powerUps;
    const legend = [];
    if (p.fiftyFifty?.gift) legend.push({ gift: p.fiftyFifty.gift, label: "50/50" });
    if (p.freezeTimer?.gift) legend.push({ gift: p.freezeTimer.gift, label: `+${p.freezeTimer.addSec ?? 5} detik` });
    if (p.stealPoint?.gift) legend.push({ gift: p.stealPoint.gift, label: `curi ${p.stealPoint.points ?? 1} poin #1` });
    return legend;
  }

  // End-of-stream card for the top gifter (kind "gifter") or the top quiz
  // score (kind "quiz"). Pauses the quiz while it's on screen so nobody
  // scores unseen, then carries on.
  showMvp(kind = "gifter") {
    const durationSec = this.config.mvpCardDurationSec || 30;
    if (kind === "quiz") {
      const [mvp, ...runnersUp] = this.scoreboard.getLeaderboard(3);
      const totalPlayers = this.scoreboard.getLeaderboard(Infinity).length;
      this.emit("state", { type: "mvp", kind, mvp: mvp || null, runnersUp, totalPlayers, durationSec });
    } else {
      const [mvp, ...runnersUp] = this.scoreboard.getTopGifters(3);
      this.emit("state", { type: "mvp", kind, mvp: mvp || null, runnersUp, durationSec });
    }

    if (["asking", "reveal", "leaderboard"].includes(this.state)) this._resumeAfterMvp = true;
    if (!this._resumeAfterMvp) return; // game not running yet; just show the card

    this.state = "mvp";
    this._schedule(() => {
      this._resumeAfterMvp = false;
      this._advance();
    }, durationSec * 1000);
  }

  _handleMyRank(userId, nickname) {
    const info = this.scoreboard.getRank(userId);
    this.emit("state", {
      type: "rank",
      nickname,
      found: !!info,
      rank: info?.rank ?? null,
      totalPlayers: info?.totalPlayers ?? null,
      score: info?.score ?? 0
    });
  }
}

module.exports = { GameEngine };
