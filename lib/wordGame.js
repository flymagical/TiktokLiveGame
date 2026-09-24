// Helpers for the "tebak kata" mode: viewers type the answer itself, see how
// many letters it has, and get letters revealed as clues.

// What counts when comparing a guess with the answer: letters and digits
// only, lowercase, accents dropped. "b.j. habibie" == "B.J. Habibie".
function wordKey(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const MAX_LETTERS = 18;

// Good tebak questions: the answer is words (letters, digits, spaces and a
// few marks like "B.J." or "Paru-paru"), short enough to type, and the
// question makes sense without the multiple-choice options.
function isGuessable(question, answer) {
  if (/^manakah\b/i.test(question || "")) return false;
  if (!/^[\p{L}\p{N} .'\-]+$/u.test(answer || "")) return false;
  const n = wordKey(answer).length;
  return n >= 1 && n <= MAX_LETTERS;
}

// Split the answer into tiles: "letter" tiles start hidden, spaces and marks
// (".", "-", "'") are always shown.
function buildWord(answer) {
  const slots = [...answer].map((ch) => {
    if (/\s/.test(ch)) return { kind: "space", ch: " " };
    if (/[\p{L}\p{N}]/u.test(ch)) return { kind: "letter", ch: ch.toUpperCase() };
    return { kind: "mark", ch };
  });
  return {
    text: answer,
    key: wordKey(answer),
    slots,
    letterCount: slots.filter((s) => s.kind === "letter").length
  };
}

// The tiles as the overlay sees them: hidden letters have ch null.
function visibleSlots(word, revealed, showAll = false) {
  return word.slots.map((s, i) =>
    s.kind === "letter" && !showAll && !revealed.has(i) ? { kind: "letter", ch: null } : s
  );
}

// A random hidden letter to reveal as a clue, or -1. The last hidden letter
// is never given away; the full answer only appears when time runs out.
function pickClue(word, revealed) {
  const hidden = word.slots
    .map((s, i) => (s.kind === "letter" && !revealed.has(i) ? i : -1))
    .filter((i) => i !== -1);
  if (hidden.length <= 1) return -1;
  return hidden[Math.floor(Math.random() * hidden.length)];
}

function hiddenCount(word, revealed) {
  return word.slots.filter((s, i) => s.kind === "letter" && !revealed.has(i)).length;
}

module.exports = { wordKey, isGuessable, buildWord, visibleSlots, pickClue, hiddenCount };
