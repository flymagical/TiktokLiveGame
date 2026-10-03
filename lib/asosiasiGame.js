// Helpers for the "asosiasi kata" mode: one theme, 6 words shown as letter
// tiles at once, viewers can guess as many of the 6 as they like. Reuses the
// tebak-kata tile helpers from wordGame.js instead of duplicating them.

const { wordKey, isGuessable, buildWord, hiddenCount } = require("./wordGame");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Same character/length rules as tebak kata's answers (isGuessable ignores
// the "manakah" question check when there's no question text).
function isAssociationWord(text) {
  return isGuessable(null, text);
}

// One theme's 6 words, each built into letter tiles (buildWord) plus its
// curated bonus point value.
function buildAssociationRound(themeEntry) {
  const words = themeEntry.kata.map(({ t, p }) => ({ ...buildWord(t), points: p }));
  return { theme: themeEntry.tema, category: themeEntry.c, words };
}

// The first letter of every word is revealed from the start (the design's
// "always visible" clue), one Set of revealed tile indexes per word.
function initRevealed(words) {
  return words.map((w) => {
    const set = new Set();
    const firstLetter = w.slots.findIndex((s) => s.kind === "letter");
    if (firstLetter !== -1) set.add(firstLetter);
    return set;
  });
}

// A random hidden letter across all 6 words, or null when every word only
// has its last hidden letter left (never given away automatically).
function pickAssociationClue(words, revealedByWord) {
  const candidates = [];
  words.forEach((w, wordIndex) => {
    const hidden = w.slots
      .map((s, i) => (s.kind === "letter" && !revealedByWord[wordIndex].has(i) ? i : -1))
      .filter((i) => i !== -1);
    if (hidden.length > 1) {
      for (const letterIndex of hidden) candidates.push({ wordIndex, letterIndex });
    }
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function allWordsMaxed(words, revealedByWord) {
  return words.every((w, i) => hiddenCount(w, revealedByWord[i]) <= 1);
}

// Does a viewer's comment match one of the 6 words? "attempted" means the
// guess's letter count matches at least one word, so it's shown on the
// ticker even when it's wrong; "correct" means it's an exact match.
function matchWord(text, words) {
  const key = wordKey(text);
  if (!key) return { attempted: false };
  const exactIndex = words.findIndex((w) => w.key === key);
  if (exactIndex !== -1) return { attempted: true, correct: true, wordIndex: exactIndex };
  const lengthIndex = words.findIndex((w) => w.key.length === key.length);
  if (lengthIndex !== -1) return { attempted: true, correct: false, wordIndex: lengthIndex };
  return { attempted: false };
}

// Which theme comes next: shuffles the whole bank, refills when the queue
// runs out, and avoids the last few themes shown this LIVE where possible.
const HISTORY_SIZE = 10;

class AssociationRotation {
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
  isAssociationWord,
  buildAssociationRound,
  initRevealed,
  pickAssociationClue,
  allWordsMaxed,
  matchWord,
  AssociationRotation
};
