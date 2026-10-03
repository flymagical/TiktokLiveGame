const { EventEmitter } = require("events");
const { fetchQuestions } = require("./trivia");
const { QuestionRotation, BLOCK_COUNT } = require("./questionRotation");
const questionBank = require("./questions-id");
const { wordKey, isGuessable, buildWord, visibleSlots, pickClue, hiddenCount } = require("./wordGame");
const associationBank = require("./asosiasi-id");
const {
  buildAssociationRound,
  initRevealed: initAssociationRevealed,
  pickAssociationClue,
  allWordsMaxed,
  matchWord: matchAssociationWord,
  AssociationRotation
} = require("./asosiasiGame");
const {
  filterKluBank,
  buildKluRound,
  nextClueIndex: nextKluClueIndex,
  matchKluGuess,
  KluRotation
} = require("./kluGame");

const LETTERS = ["A", "B", "C", "D"];
const MIN_RESUME_QUESTION_MS = 5000;
// Game formats: "pilihan" = multiple choice (overlay.html), "tebak" = type the
// answer with letter clues from taps (tebak.html), "asosiasi" = one theme,
// 6 words at once (asosiasi.html), "klu" = the reverse of asosiasi: the
// theme is the hidden keyword, its 6 associated words are shown one at a
// time as clues (klu.html) — same bank as asosiasi, read the other way.
// "arena" = Arena Tabrak, a bumper-car battle royale driven entirely by
// comments (arena.html) — see design-arena.md.
const MODES = ["pilihan", "tebak", "asosiasi", "klu", "arena"];

// Arena Tabrak: 3 tiers (0 = Dalam/safest … 2 = Luar/edge). Comments move a
// car around a ring of slots within its tier, or push it outward.
const ARENA_TIERS = 3;
const ARENA_MOVES = {
  kiri: "kiri", "1": "kiri",
  kanan: "kanan", "2": "kanan",
  gas: "gas", maju: "gas", "3": "gas",
  tabrak: "tabrak", "4": "tabrak"
};

function matchArenaMove(comment) {
  const c = normalize(comment);
  return ARENA_MOVES[c] || null;
}

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

    // Game format; the host switches with !mode, from the next question on.
    this.mode = MODES.includes(config.mode) ? config.mode : "pilihan";
    this._pendingMode = null;
    const tebak = config.tebak || {};
    this.tebak = {
      roundDurationSec: tebak.roundDurationSec ?? 30,
      tapsPerClue: tebak.tapsPerClue ?? 10,
      clueGift: tebak.clueGift ?? "Rose" // each one of these opens a letter
    };
    this.word = null; // tebak: the current answer split into tiles
    this.revealed = new Set(); // tebak: tile indexes shown as clues
    this.taps = 0; // tebak/asosiasi: taps (likes) during the current round
    this.tapClues = 0; // tebak/asosiasi: clues already given for those taps
    this.giftClueUsed = false; // tebak: the clue gift works once per question

    const asosiasi = config.asosiasi || {};
    this.asosiasi = {
      roundDurationSec: asosiasi.roundDurationSec ?? 45,
      tapsPerClue: asosiasi.tapsPerClue ?? 10,
      clueGift: asosiasi.clueGift ?? "Rose",
      basePoints: asosiasi.basePoints ?? 10,
      mvpTopCount: asosiasi.mvpTopCount ?? 6
    };
    this.round = null; // asosiasi: { theme, category, words } for the current round
    this.roundRevealed = []; // asosiasi: one Set of revealed tile indexes per word
    this.wordCorrect = []; // asosiasi: one ordered array of { userId, nickname, avatar } per word
    this.asosiasiFiftyUsed = false; // asosiasi: the 50/50 gift opens 1 letter, once per round
    this.followGateWarned = new Set(); // asosiasi: userIds already told "follow to play" this LIVE
    this.associationRotation = new AssociationRotation(associationBank);

    const klu = config.klu || {};
    this.klu = {
      roundDurationSec: klu.roundDurationSec ?? 30,
      tapsPerClue: klu.tapsPerClue ?? 10,
      clueGift: klu.clueGift ?? "Rose",
      basePoints: klu.basePoints ?? 10
    };
    this.kluRound = null; // klu: { answer, key, clues, points, category } for the current round
    this.kluRevealedCount = 0; // klu: how many of the 6 clues are open (clue 1 is free)
    this.kluFiftyUsed = false; // klu: the 50/50 gift opens 1 clue, once per round
    this.kluRotation = new KluRotation(filterKluBank(associationBank));

    const arena = config.arena || {};
    this.arena = {
      lobbyDurationSec: arena.lobbyDurationSec ?? 20,
      tickSec: arena.tickSec ?? 4,
      slotsPerTier: arena.slotsPerTier ?? 8,
      maxPlayers: arena.maxPlayers ?? 24,
      shrinkEverySec: arena.shrinkEverySec ?? 30,
      earlyShrinkBelow: arena.earlyShrinkBelow ?? 10,
      maxRoundSec: arena.maxRoundSec ?? 180,
      basePoints: arena.basePoints ?? 5,
      tierBonus: arena.tierBonus ?? 10,
      winBonus: arena.winBonus ?? 50,
      pointsPerDiamond: arena.pointsPerDiamond ?? 2,
      // Round state, reset every lobby:
      phase: "lobby",
      roundNumber: 0,
      cars: new Map(), // userId -> { userId, nickname, avatar, tier, slot, pendingMove, tiersSurvived }
      eliminatedOrder: [],
      tiersAlive: [true, true, true],
      nextShrinkAt: 0,
      battleStartedAt: 0,
      fullWarned: new Set() // userIds already told "arena penuh" this server run
    };
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
    // The quiz waits behind the welcome card until the host types !start.
    this.state = "waiting";
    this.emit("state", this.getWelcome());
  }

  getWelcome() {
    return { type: "welcome", host: this.config.tiktokUsername };
  }

  // Host command !welcome: back to the welcome card, e.g. when the quiz was
  // started by accident. Whatever was running (question, reveal, leaderboard,
  // pause) stops without scoring; !start then asks a new question.
  showWelcome() {
    if (this.state === "idle" || this.state === "starting") return false; // not on a LIVE yet
    this._clearTimer();
    this._paused = null;
    this._endCardShown = false;
    this._resumeAfterMvp = false;
    this.correctAnswerers = [];
    this.answeredThisRound.clear();
    this.word = null;
    this.round = null;
    this.kluRound = null;
    this.arena.phase = "lobby";
    this.arena.cars = new Map();
    this.state = "waiting";
    this.emit("state", this.getWelcome());
    return true;
  }

  // Host command !start: take the welcome card down and ask the first question.
  begin() {
    if (this.state !== "waiting") return false;
    this._advance();
    return true;
  }

  async _loadQuestionPool() {
    if (this.mode === "asosiasi" || this.mode === "klu" || this.mode === "arena") {
      // Asosiasi and klu draw from their own local banks (this.associationRotation /
      // this.kluRotation); arena has no question pool at all.
      this.questions = [];
      this.questionIndex = -1;
      return;
    }
    const filter = this.mode === "tebak" ? (item) => isGuessable(item.q, item.a) : undefined;
    this.questions = await fetchQuestions(this.config.trivia, this.rotation, filter);
    this.questionIndex = -1;
  }

  // Host command !mode tebak / !mode pilihan. A running quiz switches at the
  // next question, so the current one finishes in its own format.
  setMode(mode) {
    if (!MODES.includes(mode)) return false;
    if (this.state === "idle") {
      this.mode = mode;
      this._pendingMode = null;
    } else {
      this._pendingMode = mode === this.mode ? null : mode;
    }
    this.emit("state", {
      type: "mode",
      mode,
      pending: this._pendingMode !== null,
      powerUps: this.getPowerUpLegend(mode)
    });
    return true;
  }

  async _advance() {
    if (this._pendingMode) {
      this.mode = this._pendingMode;
      this._pendingMode = null;
      await this._loadQuestionPool(); // the other format uses a different pool
    }

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

    if (this.mode === "asosiasi") {
      this._askAssociationQuestion();
      return;
    }

    if (this.mode === "klu") {
      this._askKluQuestion();
      return;
    }

    if (this.mode === "arena") {
      this._startArenaLobby();
      return;
    }

    const q = this.questions[this.questionIndex];
    this.currentQuestion = q;
    this.rotation.markAsked(q.key);

    if (this.mode === "tebak") {
      this._askWordQuestion(q);
      return;
    }

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

  // --- Tebak kata ---------------------------------------------------------

  _askWordQuestion(q) {
    this.word = buildWord(q.answer ?? q.options[q.correctIndex]);
    this.revealed = new Set();
    this.taps = 0;
    this.tapClues = 0;
    this.giftClueUsed = false;
    const durationSec = this.tebak.roundDurationSec;

    this.emit("state", {
      type: "wordQuestion",
      questionNumber: this.questionNumber,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      letters: visibleSlots(this.word, this.revealed),
      letterCount: this.word.letterCount,
      tapsPerClue: this.tebak.tapsPerClue,
      durationSec,
      multiplier: this.multiplier,
      goal: this.getGoal()
    });

    this._startRoundTimer(durationSec * 1000);
  }

  // Show one more letter. Returns false when only the last letter is left.
  _revealClue(source, nickname) {
    const index = pickClue(this.word, this.revealed);
    if (index === -1) return false;
    this.revealed.add(index);
    this.emit("state", {
      type: "wordClue",
      source,
      nickname: nickname || null,
      index,
      letters: visibleSlots(this.word, this.revealed),
      hiddenLeft: hiddenCount(this.word, this.revealed)
    });
    return true;
  }

  // Every tapsPerClue taps during a tebak question reveal one letter.
  handleLike({ count }) {
    if (this.state !== "asking") return;
    if (this.mode === "tebak" && this.word) {
      const per = this.tebak.tapsPerClue;
      this.taps += count || 1;
      while (this.taps >= (this.tapClues + 1) * per && this._revealClue("taps")) this.tapClues += 1;
      this.emit("state", {
        type: "taps",
        taps: this.taps,
        perClue: per,
        progress: this.taps - this.tapClues * per,
        maxed: hiddenCount(this.word, this.revealed) <= 1
      });
    } else if (this.mode === "asosiasi" && this.round) {
      const per = this.asosiasi.tapsPerClue;
      this.taps += count || 1;
      while (this.taps >= (this.tapClues + 1) * per && this._revealAssociationClue("taps")) this.tapClues += 1;
      this.emit("state", {
        type: "taps",
        taps: this.taps,
        perClue: per,
        progress: this.taps - this.tapClues * per,
        maxed: allWordsMaxed(this.round.words, this.roundRevealed)
      });
    } else if (this.mode === "klu" && this.kluRound) {
      const per = this.klu.tapsPerClue;
      this.taps += count || 1;
      while (this.taps >= (this.tapClues + 1) * per && this._revealKluClue("taps")) this.tapClues += 1;
      this.emit("state", {
        type: "taps",
        taps: this.taps,
        perClue: per,
        progress: this.taps - this.tapClues * per,
        maxed: this.kluRevealedCount >= 6
      });
    }
  }

  // --- Asosiasi kata -------------------------------------------------------

  _askAssociationQuestion() {
    const themeEntry = this.associationRotation.next();
    this.round = buildAssociationRound(themeEntry);
    this.roundRevealed = initAssociationRevealed(this.round.words);
    this.wordCorrect = this.round.words.map(() => []);
    this.taps = 0;
    this.tapClues = 0;
    this.asosiasiFiftyUsed = false;
    const durationSec = this.asosiasi.roundDurationSec;

    this.emit("state", {
      type: "associationQuestion",
      questionNumber: this.questionNumber,
      theme: this.round.theme,
      words: this.round.words.map((w, i) => ({
        letters: visibleSlots(w, this.roundRevealed[i]),
        letterCount: w.letterCount,
        points: w.points
      })),
      durationSec,
      basePoints: this.asosiasi.basePoints,
      multiplier: this.multiplier,
      goal: this.getGoal()
    });

    this._startRoundTimer(durationSec * 1000);
  }

  // Show one more letter, from the combined pool of all 6 words. Returns
  // false when every word only has its last hidden letter left.
  _revealAssociationClue(source, nickname) {
    const clue = pickAssociationClue(this.round.words, this.roundRevealed);
    if (!clue) return false;
    const { wordIndex, letterIndex } = clue;
    this.roundRevealed[wordIndex].add(letterIndex);
    this.emit("state", {
      type: "associationClue",
      source,
      nickname: nickname || null,
      wordIndex,
      letterIndex,
      ch: this.round.words[wordIndex].slots[letterIndex].ch
    });
    return true;
  }

  // Every follower's comment during an asosiasi round: a guess that isn't
  // gated by follow (participation, not just scoring — see design.md §3).
  _handleAssociationGuess({ userId, nickname, avatar, text }) {
    if (text.startsWith("!")) return;
    if (!this.scoreboard.hasFollowed(userId)) {
      if (!this.followGateWarned.has(userId)) {
        this.followGateWarned.add(userId);
        this.emit("state", { type: "followGateBlocked", nickname });
      }
      return;
    }

    const match = matchAssociationWord(text, this.round.words);
    if (!match.attempted) return;

    this.emit("state", {
      type: "associationAttempt",
      nickname,
      avatar: avatar || null,
      correct: match.correct,
      wordIndex: match.wordIndex
    });

    if (!match.correct) return;
    const list = this.wordCorrect[match.wordIndex];
    if (list.some((a) => a.userId === userId)) return; // already credited for this word
    list.push({ userId, nickname, avatar });
  }

  _revealAssociationAnswer() {
    const words = this.round.words.map((w, i) => {
      const correct = this.wordCorrect[i];
      let winner = null;
      if (correct.length) {
        const [first, ...rest] = correct;
        const winnerPoints = (this.asosiasi.basePoints + w.points) * this.multiplier;
        const v = this.scoreboard.awardPoints(first.userId, first.nickname, winnerPoints, first.avatar);
        winner = { nickname: v.nickname, pointsAwarded: winnerPoints, score: v.score };
        const basePoints = this.asosiasi.basePoints * this.multiplier;
        for (const a of rest) this.scoreboard.awardPoints(a.userId, a.nickname, basePoints, a.avatar);
      }
      return {
        text: w.text,
        letters: visibleSlots(w, this.roundRevealed[i], true),
        points: w.points,
        winner,
        correctCount: correct.length
      };
    });

    this.emit("state", {
      type: "associationReveal",
      questionNumber: this.questionNumber,
      words,
      durationSec: this.config.revealDurationSec
    });

    this._schedule(() => this._advance(), this.config.revealDurationSec * 1000);
  }

  // --- Klu (kebalikan asosiasi: 1 jawaban, 6 klu) ---------------------------

  _askKluQuestion() {
    const entry = this.kluRotation.next();
    this.kluRound = buildKluRound(entry);
    this.kluRevealedCount = 1; // clue 1 is shown for free in the emit below
    this.taps = 0;
    this.tapClues = 0;
    this.kluFiftyUsed = false;
    const durationSec = this.klu.roundDurationSec;

    this.emit("state", {
      type: "kluQuestion",
      questionNumber: this.questionNumber,
      category: this.kluRound.category,
      letters: visibleSlots(this.kluRound.word, new Set()),
      letterCount: this.kluRound.word.letterCount,
      clues: this.kluRound.clues.map((text, i) => (i === 0 ? text : null)),
      bonusPoints: this.kluRound.points,
      durationSec,
      basePoints: this.klu.basePoints,
      multiplier: this.multiplier,
      goal: this.getGoal()
    });

    this._startRoundTimer(durationSec * 1000);
  }

  // Show one more clue, in order (clue 1 is already visible from the start
  // of the round). Returns false once all 6 are open.
  _revealKluClue(source, nickname) {
    const index = nextKluClueIndex(this.kluRevealedCount);
    if (index === -1) return false;
    this.kluRevealedCount += 1;
    this.emit("state", {
      type: "kluClue",
      source,
      nickname: nickname || null,
      index,
      text: this.kluRound.clues[index],
      hiddenLeft: 6 - this.kluRevealedCount
    });
    return true;
  }

  // Viewers may guess as often as they like; the first follower with the
  // right keyword wins at the reveal, same principle as tebak.
  _handleKluGuess({ userId, nickname, avatar, text }) {
    if (text.startsWith("!")) return;
    const match = matchKluGuess(text, this.kluRound);
    if (!match.attempted) return;

    if (!this.answeredThisRound.has(userId)) {
      this.answeredThisRound.add(userId);
      this.emit("state", { type: "answer", nickname, count: this.answeredThisRound.size });
    }

    // Sent for right and wrong guesses alike, for the ticker, without
    // revealing the answer to viewers who haven't got it yet.
    this.emit("state", { type: "kluAttempt", nickname, avatar: avatar || null, correct: match.correct });

    if (!match.correct) return;
    if (this.correctAnswerers.some((a) => a.userId === userId)) return;
    this.correctAnswerers.push({ userId, nickname, avatar });
  }

  _revealKluAnswer() {
    const round = this.kluRound;
    const canScore = (a) => !this.config.requireFollowToScore || this.scoreboard.hasFollowed(a.userId);
    const winnerIndex = this.correctAnswerers.findIndex(canScore);
    let winner = null;
    if (winnerIndex !== -1) {
      const scorers = this.correctAnswerers.filter(canScore);
      const [first, ...rest] = scorers;
      const basePoints = this.klu.basePoints * this.multiplier;
      const bonusPoints = round.points * this.multiplier;
      const v = this.scoreboard.awardPoints(first.userId, first.nickname, basePoints + bonusPoints, first.avatar);
      winner = {
        nickname: v.nickname,
        pointsAwarded: basePoints + bonusPoints,
        basePoints,
        bonusPoints,
        score: v.score,
        multiplier: this.multiplier,
        otherCorrect: rest.length
      };
      for (const a of rest) this.scoreboard.awardPoints(a.userId, a.nickname, basePoints, a.avatar);
    }

    this.emit("state", {
      type: "kluReveal",
      questionNumber: this.questionNumber,
      answer: round.word.text,
      letters: visibleSlots(round.word, new Set(), true),
      clues: round.clues,
      winner,
      durationSec: this.config.revealDurationSec
    });

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

  // --- Arena Tabrak ---------------------------------------------------------
  // Comments-only bumper battle (design-arena.md). Reuses the generic
  // "asking"/"reveal" states throughout lobby+battle and the one-shot
  // _schedule() timer (re-armed every tick), so !pause/!lanjut, !peringkat,
  // !mvp and !end all keep working with no extra plumbing.

  _startArenaLobby() {
    const a = this.arena;
    a.phase = "lobby";
    a.roundNumber = this.questionNumber;
    a.cars = new Map();
    a.eliminatedOrder = [];
    a.tiersAlive = [true, true, true];

    this.emit("state", { type: "arenaLobby", durationSec: a.lobbyDurationSec, slotsPerTier: a.slotsPerTier });
    this._schedule(() => this._startArenaBattle(), a.lobbyDurationSec * 1000);
  }

  _startArenaBattle() {
    const a = this.arena;
    a.phase = "battle";
    a.battleStartedAt = Date.now();
    a.nextShrinkAt = Date.now() + a.shrinkEverySec * 1000;

    this.emit("state", {
      type: "arenaBattleStart",
      roundNumber: a.roundNumber,
      tiers: ARENA_TIERS,
      slotsPerTier: a.slotsPerTier,
      cars: [...a.cars.values()].map((c) => ({ userId: c.userId, nickname: c.nickname, avatar: c.avatar || null, tier: c.tier, slot: c.slot }))
    });

    this._schedule(() => this._arenaTick(), a.tickSec * 1000);
  }

  // Comments are the only input. Joining is automatic: a viewer's first
  // valid move both drops them into the arena and counts as that move.
  _handleArenaComment({ userId, nickname, avatar, text }) {
    if (text.startsWith("!")) return;
    const move = matchArenaMove(text);
    if (!move) return;

    const a = this.arena;
    let car = a.cars.get(userId);
    if (!car) {
      if (a.cars.size >= a.maxPlayers) {
        if (!a.fullWarned.has(userId)) {
          a.fullWarned.add(userId);
          this.emit("state", { type: "arenaFull", nickname });
        }
        return;
      }
      car = {
        userId, nickname, avatar,
        tier: 1, // start in Tengah
        slot: Math.floor(Math.random() * a.slotsPerTier),
        pendingMove: null,
        tiersSurvived: 0
      };
      a.cars.set(userId, car);
      this.emit("state", { type: "arenaJoin", userId, nickname, avatar: avatar || null, tier: car.tier, slot: car.slot });
    } else {
      car.nickname = nickname; // nickname can change mid-live
    }

    if (a.phase === "battle") car.pendingMove = move;
  }

  // One tick: resolve tabrak (from the pre-tick snapshot, so mutual hits
  // both land), then gas/kiri/kanan, then a tier shrink if due, then check
  // whether the round is over.
  _arenaTick() {
    const a = this.arena;

    const bySpot = new Map();
    for (const car of a.cars.values()) {
      const key = `${car.tier}-${car.slot}`;
      if (!bySpot.has(key)) bySpot.set(key, []);
      bySpot.get(key).push(car);
    }

    const tierBumps = new Map(); // userId -> how many tiers to push out
    const actedAsGas = new Set(); // attackers whose tabrak found no target
    for (const car of a.cars.values()) {
      if (car.pendingMove !== "tabrak") continue;
      const targets = (bySpot.get(`${car.tier}-${car.slot}`) || []).filter((c) => c.userId !== car.userId);
      if (!targets.length) {
        actedAsGas.add(car.userId);
        continue;
      }
      for (const target of targets) tierBumps.set(target.userId, (tierBumps.get(target.userId) || 0) + 1);
    }

    const toEliminate = [];
    for (const [userId, bumps] of tierBumps) {
      const car = a.cars.get(userId);
      if (!car) continue;
      const newTier = car.tier + bumps;
      if (newTier >= ARENA_TIERS) toEliminate.push(car);
      else car.tier = newTier;
    }
    for (const car of toEliminate) this._arenaMarkEliminated(car, "tabrak");

    for (const car of a.cars.values()) {
      if (actedAsGas.has(car.userId) || car.pendingMove === "gas") car.tier = Math.max(0, car.tier - 1);
      else if (car.pendingMove === "kiri") car.slot = (car.slot - 1 + a.slotsPerTier) % a.slotsPerTier;
      else if (car.pendingMove === "kanan") car.slot = (car.slot + 1) % a.slotsPerTier;
      car.pendingMove = null;
    }

    this._arenaMaybeShrink();

    if (a.cars.size <= 1 || Date.now() - a.battleStartedAt >= a.maxRoundSec * 1000) {
      this._endArenaBattle();
      return;
    }

    this.emit("state", {
      type: "arenaTick",
      cars: [...a.cars.values()].map((c) => ({ userId: c.userId, tier: c.tier, slot: c.slot }))
    });
    this._schedule(() => this._arenaTick(), a.tickSec * 1000);
  }

  // Luar collapses first, then Tengah (which starts sudden death) — sooner
  // than scheduled if few cars are left, so a quiet round doesn't drag on.
  _arenaMaybeShrink() {
    const a = this.arena;
    if (a.cars.size === 0) return; // nobody playing this round, nothing to shrink
    if (!a.tiersAlive[2] && !a.tiersAlive[1]) return; // only Dalam left, nothing more to collapse
    const due = Date.now() >= a.nextShrinkAt || a.cars.size <= a.earlyShrinkBelow;
    if (!due) return;

    const collapsing = a.tiersAlive[2] ? 2 : 1;
    a.tiersAlive[collapsing] = false;
    const victims = [...a.cars.values()].filter((c) => c.tier === collapsing);
    for (const car of victims) this._arenaMarkEliminated(car, "shrink");
    for (const car of a.cars.values()) car.tiersSurvived += 1;
    a.nextShrinkAt = Date.now() + a.shrinkEverySec * 1000;

    this.emit("state", {
      type: "arenaShrink",
      tierRemoved: collapsing,
      eliminated: victims.map((v) => ({ userId: v.userId, nickname: v.nickname, avatar: v.avatar || null }))
    });
    if (collapsing === 1) this.emit("state", { type: "arenaSuddenDeath" });
  }

  _arenaMarkEliminated(car, cause) {
    const a = this.arena;
    if (!a.cars.has(car.userId)) return;
    a.cars.delete(car.userId);
    a.eliminatedOrder.push({ userId: car.userId, nickname: car.nickname, avatar: car.avatar, tiersSurvived: car.tiersSurvived, cause });
    this.emit("state", { type: "arenaEliminated", userId: car.userId, nickname: car.nickname, avatar: car.avatar || null, cause });
  }

  _endArenaBattle() {
    this.state = "reveal";
    this._revealArena([...this.arena.cars.values()]);
  }

  // Scoring happens here (not as each car is eliminated), so follow status
  // is only checked once, the same moment every other mode checks it.
  _revealArena(winners) {
    const a = this.arena;
    const canScore = (userId) => !this.config.requireFollowToScore || this.scoreboard.hasFollowed(userId);
    const survivalPoints = (tiersSurvived) => a.basePoints + a.tierBonus * tiersSurvived;
    const winBonusEach = winners.length ? Math.floor(a.winBonus / winners.length) : 0;
    const followAlerts = [];

    const score = (entry, isWinner) => {
      const total = survivalPoints(entry.tiersSurvived) + (isWinner ? winBonusEach : 0);
      if (!canScore(entry.userId)) {
        followAlerts.push(entry.nickname);
        return { nickname: entry.nickname, avatar: entry.avatar || null, tiersSurvived: entry.tiersSurvived, pointsAwarded: 0, score: null, winner: isWinner, cause: entry.cause };
      }
      const v = this.scoreboard.awardPoints(entry.userId, entry.nickname, total, entry.avatar);
      return { nickname: entry.nickname, avatar: entry.avatar || null, tiersSurvived: entry.tiersSurvived, pointsAwarded: total, score: v.score, winner: isWinner, cause: entry.cause };
    };

    const winnerResults = winners.map((car) => score(car, true));
    const order = a.eliminatedOrder.map((e) => score(e, false));

    this.emit("state", {
      type: "arenaReveal",
      roundNumber: a.roundNumber,
      winners: winnerResults,
      order,
      durationSec: this.config.revealDurationSec
    });

    for (const nickname of followAlerts) {
      this.emit("state", {
        type: "followAlert",
        nickname,
        message: `@${nickname} ikut arena, tapi belum follow — follow dulu supaya poinmu dihitung!`
      });
    }

    this._schedule(() => this._advance(), this.config.revealDurationSec * 1000);
  }

  // Gift during arena mode never triggers a power-up — it's pure bonus
  // points for the sender, since gifts are hard to come by (design-arena.md §6b).
  _arenaGiftPoints({ userId, nickname, avatar, diamonds }) {
    if (!diamonds) return;
    const points = diamonds * this.arena.pointsPerDiamond;
    const v = this.scoreboard.awardPoints(userId, nickname, points, avatar);
    this.emit("state", { type: "arenaGiftPoints", nickname, diamonds, pointsAwarded: points, score: v.score });
  }

  _startRoundTimer(ms) {
    this.roundEndsAt = Date.now() + ms;
    this._schedule(() => this._revealAnswer(), ms);
  }

  _revealAnswer() {
    this.state = "reveal";

    if (this.mode === "asosiasi") {
      this._revealAssociationAnswer();
      return;
    }

    if (this.mode === "klu") {
      this._revealKluAnswer();
      return;
    }

    const q = this.currentQuestion;

    // Score only now, so nothing on screen hints at the answer before the
    // reveal. Every correct answerer who follows the host (following any time
    // before the reveal counts) gets the base points; the earliest of them
    // ("the winner") also gets a speed bonus on top.
    const canScore = (a) => !this.config.requireFollowToScore || this.scoreboard.hasFollowed(a.userId);
    const winnerIndex = this.correctAnswerers.findIndex(canScore);
    let winner = null;
    if (winnerIndex !== -1) {
      const scorers = this.correctAnswerers.filter(canScore);
      const [first, ...rest] = scorers;
      const basePoints = this.config.pointsForCorrect * this.multiplier;
      const bonusPoints = this.config.fastestBonus * this.multiplier;
      const v = this.scoreboard.awardPoints(first.userId, first.nickname, basePoints + bonusPoints, first.avatar);
      winner = {
        nickname: v.nickname,
        pointsAwarded: basePoints + bonusPoints,
        basePoints,
        bonusPoints,
        score: v.score,
        multiplier: this.multiplier,
        otherCorrect: rest.length
      };
      for (const a of rest) this.scoreboard.awardPoints(a.userId, a.nickname, basePoints, a.avatar);
    }

    if (this.mode === "tebak") {
      this.emit("state", {
        type: "wordReveal",
        questionNumber: this.questionNumber,
        answer: this.word.text,
        letters: visibleSlots(this.word, this.revealed, true),
        winner,
        durationSec: this.config.revealDurationSec
      });
    } else {
      this.emit("state", {
        type: "reveal",
        questionNumber: this.questionNumber,
        correctLetter: LETTERS[q.correctIndex],
        correctText: q.options[q.correctIndex],
        winner,
        durationSec: this.config.revealDurationSec
      });
    }

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
    if (state === "asking" && this.mode !== "arena") {
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

    if (this.mode === "tebak") {
      this._handleGuess({ userId, nickname, avatar, text: trimmed });
      return;
    }

    if (this.mode === "asosiasi") {
      this._handleAssociationGuess({ userId, nickname, avatar, text: trimmed });
      return;
    }

    if (this.mode === "klu") {
      this._handleKluGuess({ userId, nickname, avatar, text: trimmed });
      return;
    }

    if (this.mode === "arena") {
      this._handleArenaComment({ userId, nickname, avatar, text: trimmed });
      return;
    }

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

  // Tebak: viewers may guess as often as they like; the first follower with
  // the right answer wins at the reveal, same as multiple choice.
  _handleGuess({ userId, nickname, avatar, text }) {
    if (text.startsWith("!")) return;
    const guess = wordKey(text);
    // Chat that isn't a guess (wrong length) doesn't count as an answer.
    if (guess.length !== this.word.key.length) return;

    if (!this.answeredThisRound.has(userId)) {
      this.answeredThisRound.add(userId);
      this.emit("state", { type: "answer", nickname, count: this.answeredThisRound.size });
    }

    if (guess !== this.word.key) return;
    if (this.correctAnswerers.some((a) => a.userId === userId)) return;
    this.correctAnswerers.push({ userId, nickname, avatar });
  }

  handleFollow({ userId, nickname }) {
    this.scoreboard.markFollowed(userId, nickname);
  }

  // --- Gifts & power-ups ---------------------------------------------------

  handleGift(gift) {
    this.scoreboard.recordGift(gift);

    if (this.mode === "arena") {
      this._arenaGiftPoints(gift); // no power-ups in arena mode — gifts are pure bonus points
      return;
    }

    const p = this.powerUps;
    const count = gift.count || 1;

    if (isGift(gift.giftName, p.giftGoal?.gift)) this._addGoalProgress(gift.nickname, count);
    if (isGift(gift.giftName, p.fiftyFifty?.gift)) this._fiftyFifty(gift.nickname);
    if (isGift(gift.giftName, p.freezeTimer?.gift)) this._freezeTimer(gift.nickname, count);
    if (isGift(gift.giftName, p.stealPoint?.gift)) this._stealPoint(gift, count);
    if (this.mode === "tebak" && isGift(gift.giftName, this.tebak.clueGift)) this._clueGift(gift.nickname, count);
    if (this.mode === "asosiasi" && isGift(gift.giftName, this.asosiasi.clueGift)) this._associationClueGift(gift.nickname, count);
    if (this.mode === "klu" && isGift(gift.giftName, this.klu.clueGift)) this._kluClueGift(gift.nickname, count);
  }

  // Klu: every clue gift (Rose by default) opens the next clue, as many
  // times as it's sent, until all 6 are open.
  _kluClueGift(nickname, count) {
    if (this.state !== "asking" || !this.kluRound) return; // still counts for the gift goal
    let opened = 0;
    while (opened < count && this._revealKluClue("gift", nickname)) opened += 1;
    const gift = this.klu.clueGift;
    if (opened === 0) {
      return this._powerUpInfo(nickname, `@${nickname}, klu sudah semua terbuka — tebak sendiri ya!`);
    }
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🌹 @${nickname} mengirim ${count > 1 ? `${count} ` : ""}${gift}, ${opened} klu terbuka!`
    });
  }

  // Asosiasi: every clue gift (Rose by default) opens one letter from the
  // combined pool of all 6 words, as many times as it's sent.
  _associationClueGift(nickname, count) {
    if (this.state !== "asking" || !this.round) return; // still counts for the gift goal
    let opened = 0;
    while (opened < count && this._revealAssociationClue("gift", nickname)) opened += 1;
    const gift = this.asosiasi.clueGift;
    if (opened === 0) {
      return this._powerUpInfo(nickname, `@${nickname}, huruf sudah maksimal terbuka — tebak sendiri ya!`);
    }
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🌹 @${nickname} mengirim ${count > 1 ? `${count} ` : ""}${gift}, ${opened} huruf terbuka!`
    });
  }

  // Tebak: every clue gift (Rose by default) opens one letter, as many times
  // as it's sent, until only the last letter is left.
  _clueGift(nickname, count) {
    if (this.state !== "asking" || !this.word) return; // still counts for the gift goal
    let opened = 0;
    while (opened < count && this._revealClue("gift", nickname)) opened += 1;
    const gift = this.tebak.clueGift;
    if (opened === 0) {
      return this._powerUpInfo(nickname, `@${nickname}, tinggal 1 huruf lagi — tebak sendiri ya!`);
    }
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🌹 @${nickname} mengirim ${count > 1 ? `${count} ` : ""}${gift}, ${opened} huruf terbuka!`
    });
  }

  _powerUpInfo(nickname, message) {
    this.emit("state", { type: "powerUp", kind: "info", nickname, message });
  }

  // 50/50: two wrong options disappear for everyone, once per question.
  // In tebak/asosiasi/klu mode the same gift opens one letter/clue instead.
  _fiftyFifty(nickname) {
    if (this.mode === "tebak") return this._giftClue(nickname);
    if (this.mode === "asosiasi") return this._associationGiftClue(nickname);
    if (this.mode === "klu") return this._kluGiftClue(nickname);
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

  _giftClue(nickname) {
    if (this.state !== "asking" || !this.word) {
      return this._powerUpInfo(nickname, `@${nickname}, buka huruf hanya berlaku saat soal sedang berjalan.`);
    }
    if (this.giftClueUsed) {
      return this._powerUpInfo(nickname, `@${nickname}, buka huruf sudah dipakai di soal ini.`);
    }
    if (!this._revealClue("gift", nickname)) {
      return this._powerUpInfo(nickname, `@${nickname}, tinggal 1 huruf lagi — tebak sendiri ya!`);
    }
    this.giftClueUsed = true;
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🔤 @${nickname} membuka 1 huruf!`
    });
  }

  _associationGiftClue(nickname) {
    if (this.state !== "asking" || !this.round) {
      return this._powerUpInfo(nickname, `@${nickname}, buka huruf hanya berlaku saat ronde sedang berjalan.`);
    }
    if (this.asosiasiFiftyUsed) {
      return this._powerUpInfo(nickname, `@${nickname}, buka huruf sudah dipakai di ronde ini.`);
    }
    if (!this._revealAssociationClue("gift", nickname)) {
      return this._powerUpInfo(nickname, `@${nickname}, huruf sudah maksimal terbuka — tebak sendiri ya!`);
    }
    this.asosiasiFiftyUsed = true;
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🔤 @${nickname} membuka 1 huruf!`
    });
  }

  _kluGiftClue(nickname) {
    if (this.state !== "asking" || !this.kluRound) {
      return this._powerUpInfo(nickname, `@${nickname}, buka klu hanya berlaku saat ronde sedang berjalan.`);
    }
    if (this.kluFiftyUsed) {
      return this._powerUpInfo(nickname, `@${nickname}, buka klu sudah dipakai di ronde ini.`);
    }
    if (!this._revealKluClue("gift", nickname)) {
      return this._powerUpInfo(nickname, `@${nickname}, klu sudah semua terbuka — tebak sendiri ya!`);
    }
    this.kluFiftyUsed = true;
    this.emit("state", {
      type: "powerUp",
      kind: "clue",
      nickname,
      message: `🔤 @${nickname} membuka 1 klu!`
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
  getPowerUpLegend(mode = this._pendingMode || this.mode) {
    const p = this.powerUps;
    const legend = [];
    const opensLetter = mode === "tebak" || mode === "asosiasi";
    if (p.fiftyFifty?.gift) legend.push({ gift: p.fiftyFifty.gift, label: opensLetter ? "buka 1 huruf" : mode === "klu" ? "buka 1 klu" : "50/50" });
    if (p.freezeTimer?.gift) legend.push({ gift: p.freezeTimer.gift, label: `+${p.freezeTimer.addSec ?? 5} detik` });
    if (p.stealPoint?.gift) legend.push({ gift: p.stealPoint.gift, label: `curi ${p.stealPoint.points ?? 1} poin #1` });
    if (mode === "tebak" && this.tebak.clueGift) legend.push({ gift: this.tebak.clueGift, label: "+1 huruf" });
    if (mode === "asosiasi" && this.asosiasi.clueGift) legend.push({ gift: this.asosiasi.clueGift, label: "+1 huruf" });
    if (mode === "klu" && this.klu.clueGift) legend.push({ gift: this.klu.clueGift, label: "+1 klu" });
    return legend;
  }

  // End-of-stream card for the top gifter (kind "gifter") or the top quiz
  // score (kind "quiz", `count` entries — default 3, asosiasi's !mvpasosiasi
  // asks for 6). Pauses the quiz while it's on screen so nobody scores
  // unseen, then carries on.
  showMvp(kind = "gifter", { count = 3 } = {}) {
    const durationSec = this.config.mvpCardDurationSec || 30;
    if (kind === "quiz") {
      const [mvp, ...runnersUp] = this.scoreboard.getLeaderboard(count);
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
