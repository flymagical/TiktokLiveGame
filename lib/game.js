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

// Does a viewer's comment match a given answer option, either by letter
// (a / b / c / d, 1-4) or by the answer text itself?
function commentMatchesOption(comment, optionText, optionIndex) {
  const c = normalize(comment);
  if (!c) return false;
  if (c === LETTERS[optionIndex].toLowerCase()) return true;
  if (c === String(optionIndex + 1)) return true;
  if (c === normalize(optionText)) return true;
  return false;
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
    this.roundWinnerId = null;
    this.pendingUnfollowed = new Set(); // userIds who answered correctly but aren't followers yet
    this._timer = null;
  }

  async start() {
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
    this.roundWinnerId = null;
    this.pendingUnfollowed.clear();

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
    const winner = this.roundWinnerId ? this.scoreboard.getViewer(this.roundWinnerId) : null;

    this.emit("state", {
      type: "reveal",
      questionNumber: this.questionNumber,
      correctLetter: LETTERS[q.correctIndex],
      correctText: q.options[q.correctIndex],
      winner: winner ? { nickname: winner.nickname, score: winner.score } : null,
      durationSec: this.config.revealDurationSec
    });

    this._clearTimer();
    this._timer = setTimeout(() => this._advance(), this.config.revealDurationSec * 1000);
  }

  _showLeaderboard() {
    this.state = "leaderboard";
    const top = this.scoreboard.getLeaderboard(5);

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

  handleComment({ userId, nickname, comment }) {
    const trimmed = (comment || "").trim();

    if (/^!myrank$/i.test(trimmed)) {
      this._handleMyRank(userId, nickname);
      return;
    }

    if (this.state !== "asking" || this.roundWinnerId) return;

    const q = this.currentQuestion;
    const matchedIndex = q.options.findIndex((text, i) => commentMatchesOption(trimmed, text, i));
    if (matchedIndex === -1) return; // not an answer to this question
    if (matchedIndex !== q.correctIndex) return; // wrong answer, ignore silently

    // Correct answer from here on.
    const alreadyFollowing = !this.config.requireFollowToScore || this.scoreboard.hasFollowed(userId);

    if (alreadyFollowing) {
      this._awardWin(userId, nickname);
    } else if (!this.pendingUnfollowed.has(userId)) {
      this.pendingUnfollowed.add(userId);
      this.emit("state", {
        type: "followAlert",
        nickname,
        message: `@${nickname} jawabannya benar — follow dulu untuk klaim poinmu!`
      });
    }
  }

  handleFollow({ userId, nickname }) {
    this.scoreboard.markFollowed(userId, nickname);

    if (this.state === "asking" && !this.roundWinnerId && this.pendingUnfollowed.has(userId)) {
      this._awardWin(userId, nickname);
    }
  }

  _awardWin(userId, nickname) {
    this.roundWinnerId = userId;
    const points = this.config.pointsForFirstCorrect;
    const v = this.scoreboard.awardPoints(userId, nickname, points);
    this.emit("state", {
      type: "correctWinner",
      nickname: v.nickname,
      pointsAwarded: points,
      score: v.score,
      questionNumber: this.questionNumber
    });
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
