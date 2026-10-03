// Helpers for the "klu" mode: the reverse of asosiasi kata. Instead of one
// theme shown as 6 words, there's one hidden keyword (the theme itself,
// e.g. "Kopi" from "Berhubungan dengan Kopi") and 6 short-word clues about
// it (the same 6 associated words asosiasi already shows), revealed one at
// a time. Recycles asosiasi-id.js's bank as-is instead of a separate one,
// and reuses wordGame.js's tile helpers so the answer's letter count shows
// as blank tiles, exactly like tebak/asosiasi, without ever revealing a
// letter (this mode's clues are the words, not the letters).

const { wordKey, isGuessable, buildWord } = require("./wordGame");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const THEME_PREFIX = /^Berhubungan dengan /;

// "Berhubungan dengan Kopi" -> "Kopi".
function extractKeyword(tema) {
  return tema.replace(THEME_PREFIX, "");
}

// Same character/length rules as tebak kata's answers. Two or three of
// asosiasi's 700+ themes have a keyword longer than tebak's 18-letter cap
// (e.g. "Kecelakaan Lalu Lintas") — filtered out before they ever reach a
// round, same rule asosiasi itself never had to apply to its themes.
function isKluAnswer(keyword) {
  return isGuessable(null, keyword);
}

// The subset of asosiasi's bank whose extracted keyword is guessable —
// what KluRotation should actually draw from.
function filterKluBank(associationBank) {
  return associationBank.filter((entry) => isKluAnswer(extractKeyword(entry.tema)));
}

const CLUE_COUNT = 6;

// One entry's round: the hidden keyword (as letter tiles) plus its 6 clue
// words, in the same order asosiasi already curated (roughly easy-to-hard,
// since each word's own bonus point value already trends that way).
function buildKluRound(themeEntry) {
  const word = buildWord(extractKeyword(themeEntry.tema));
  const points = Math.round(themeEntry.kata.reduce((sum, k) => sum + k.p, 0) / themeEntry.kata.length);
  return {
    word,
    clues: themeEntry.kata.map((k) => k.t),
    points,
    category: themeEntry.c
  };
}

// Clues open strictly in order (clue 1 is visible from the start of the
// round already, so this is called for clues 2..6). Returns the next hidden
// clue's index, or -1 once all 6 are open — unlike letters in tebak/asosiasi,
// nothing is held back forever, since 6 clue words never spell out the answer.
function nextClueIndex(revealedCount) {
  return revealedCount < CLUE_COUNT ? revealedCount : -1;
}

// Does a viewer's comment match the hidden keyword? "attempted" means the
// guess's letter count matches the answer's, so it's shown on the ticker
// even when it's wrong; "correct" means it's an exact match. Same principle
// as tebak's guess matching.
function matchKluGuess(text, round) {
  const key = wordKey(text);
  if (!key) return { attempted: false };
  if (key.length !== round.word.key.length) return { attempted: false };
  return { attempted: true, correct: key === round.word.key };
}

// Which entry comes next: shuffles the whole bank, refills when the queue
// runs out, and avoids the last few entries shown this LIVE where possible.
const HISTORY_SIZE = 10;

class KluRotation {
  constructor(bank) {
    this.bank = bank;
    this.queue = [];
    this.history = [];
  }

  next() {
    if (!this.queue.length) this.queue = shuffle(this.bank.map((_, i) => i));
    let pos = this.queue.findIndex((i) => !this.history.includes(i));
    if (pos === -1) pos = 0;
    const index = this.queue.splice(pos, 1)[0];
    this.history.push(index);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
    return this.bank[index];
  }
}

module.exports = {
  CLUE_COUNT,
  extractKeyword,
  isKluAnswer,
  filterKluBank,
  buildKluRound,
  nextClueIndex,
  matchKluGuess,
  KluRotation
};
