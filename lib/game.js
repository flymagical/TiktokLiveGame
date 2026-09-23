const { EventEmitter } = require("events");
const { fetchQuestions } = require("./trivia");

const LETTERS = ["A", "B", "C", "D"];

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
  }

  async start() {
    // A reconnect to the LIVE fires "connected" again; keep the running game.
    if (this.state !== "idle") return;
    this.state = "starting";
    await this._loadQuestionPool();
    this._advance();
  }

  async _loadQuestionPool() {
    this.questions = await fetchQuestions(this.config.trivia);
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
    if (everyN && this.questionNumber > 1 && (this.questionNumber - 1) % everyN === 0) {
      this._showLeaderboard();
      return;
    }

    this._askQuestion();
  }

  _askQuestion() {
    this.state = "asking";
    this.correctAnswerers = [];
    this.answeredThisRound.clear();

    const q = this.questions[this.questionIndex];
    this.currentQuestion = q;

    this.emit("state", {
      type: "question",
      questionNumber: this.questionNumber,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      options: q.options.map((text, i) => ({ letter: LETTERS[i], text })),
      durationSec: this.config.roundDurationSec
    });

    this._clearTimer();
    this._timer = setTimeout(() => this._revealAnswer(), this.config.roundDurationSec * 1000);
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
      const { userId, nickname } = this.correctAnswerers[winnerIndex];
      const points = this.config.pointsForFirstCorrect;
      const v = this.scoreboard.awardPoints(userId, nickname, points);
      winner = { nickname: v.nickname, pointsAwarded: points, score: v.score };
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

    this._clearTimer();
    this._timer = setTimeout(() => this._advance(), this.config.revealDurationSec * 1000);
  }

  _showLeaderboard() {
    this.state = "leaderboard";
    const top = this.scoreboard.getLeaderboard(10);

    this.emit("state", {
      type: "leaderboard",
      afterQuestion: this.questionNumber - 1,
      top,
      durationSec: this.config.leaderboardDurationSec
    });

    this._clearTimer();
    this._timer = setTimeout(() => this._askQuestion(), this.config.leaderboardDurationSec * 1000);
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  // --- Viewer interaction -------------------------------------------------

  handleComment({ userId, nickname, comment, isFollower }) {
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
    this.correctAnswerers.push({ userId, nickname });
  }

  handleFollow({ userId, nickname }) {
    this.scoreboard.markFollowed(userId, nickname);
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
