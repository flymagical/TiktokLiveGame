// Loads quiz questions (built-in Indonesian bank by default, or English from
// the free Open Trivia DB API) and normalizes them into { question, options: [4 strings], correctIndex, category, difficulty }.

const { keyOf } = require("./questionRotation");

const API_BASE = "https://opentdb.com/api.php";
const AMOUNT = 15;

function decodeHtml(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "é")
    .replace(/&uuml;/g, "ü")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");
}

// Fisher-Yates shuffle so the correct answer isn't always in the same slot.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Built-in Indonesian bank: only this live's block (see questionRotation.js),
// shuffled, skipping questions this live already asked.
function loadIndonesianQuestions(rotation, filter) {
  const bank = require("./questions-id");
  const pool = rotation ? rotation.pool(bank, filter) : bank.filter(filter);
  return shuffle(pool).map((item) => {
    const options = shuffle([item.a, ...item.w]);
    return {
      key: keyOf(item),
      answer: item.a,
      question: item.q,
      options,
      correctIndex: options.indexOf(item.a),
      category: item.c,
      difficulty: item.d
    };
  });
}

// `filter` gets the raw bank item ({ q, a, ... }); Open Trivia DB ignores it.
async function fetchQuestions(triviaConfig = {}, rotation = null, filter = () => true) {
  // Default: Indonesian questions. Set "trivia": { "source": "opentdb" } in
  // config.json to use English questions from Open Trivia DB instead.
  if (!triviaConfig || triviaConfig.source !== "opentdb") {
    return loadIndonesianQuestions(rotation, filter);
  }

  const params = new URLSearchParams({ amount: String(AMOUNT), type: "multiple" });
  if (triviaConfig.category) params.set("category", String(triviaConfig.category));
  if (triviaConfig.difficulty) params.set("difficulty", String(triviaConfig.difficulty));

  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open Trivia DB error: HTTP ${res.status}`);

  const data = await res.json();
  if (data.response_code !== 0 || !Array.isArray(data.results) || data.results.length === 0) {
    throw new Error(`Open Trivia DB returned no questions (response_code ${data.response_code})`);
  }

  return data.results.map((item) => {
    const correctText = decodeHtml(item.correct_answer);
    const options = shuffle([correctText, ...item.incorrect_answers.map(decodeHtml)]);
    return {
      question: decodeHtml(item.question),
      options,
      correctIndex: options.indexOf(correctText),
      category: decodeHtml(item.category),
      difficulty: item.difficulty
    };
  });
}

module.exports = { fetchQuestions };
