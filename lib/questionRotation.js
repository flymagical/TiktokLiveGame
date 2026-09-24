// Splits the built-in question bank into 3 blocks and gives each TikTok LIVE
// its own block, so a question only comes back after 3 lives. Progress is
// saved to data/question-rotation.json so a restart mid-live carries on.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BLOCK_COUNT = 3;
const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "question-rotation.json");

// A question's block comes from a hash of its text, so adding or removing
// questions never moves the others to a different block.
function hashOf(item) {
  return crypto.createHash("sha1").update(`${item.q}|${item.a}`).digest();
}

function blockOf(item) {
  return hashOf(item).readUInt32BE(0) % BLOCK_COUNT;
}

function keyOf(item) {
  return hashOf(item).toString("hex").slice(0, 12);
}

class QuestionRotation {
  constructor() {
    // Start just before block 0 so the very first live gets block 0.
    this.state = { roomId: null, block: BLOCK_COUNT - 1, asked: [] };
    try {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
    } catch (err) {
      if (err.code !== "ENOENT") console.error("Gagal membaca data/question-rotation.json:", err.message);
    }
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error("Gagal menyimpan data/question-rotation.json:", err.message);
    }
  }

  // Every LIVE has its own room id. The same id again means the server was
  // restarted during that live, so it keeps its block and asked questions.
  startLive(roomId) {
    if (roomId && String(roomId) === this.state.roomId) return false;
    this.state = {
      roomId: roomId ? String(roomId) : null,
      block: (this.state.block + 1) % BLOCK_COUNT,
      startedAt: Date.now(),
      asked: []
    };
    this._save();
    return true;
  }

  get block() {
    return this.state.block;
  }

  // This live's block minus what it has already asked. If a long live uses
  // up the whole block, the block starts over.
  pool(bank) {
    const inBlock = bank.filter((item) => blockOf(item) === this.state.block);
    const asked = new Set(this.state.asked);
    const fresh = inBlock.filter((item) => !asked.has(keyOf(item)));
    if (fresh.length > 0) return fresh;
    this.state.asked = [];
    this._save();
    return inBlock;
  }

  blockSize(bank) {
    return bank.filter((item) => blockOf(item) === this.state.block).length;
  }

  markAsked(key) {
    if (!key || this.state.asked.includes(key)) return;
    this.state.asked.push(key);
    this._save();
  }
}

module.exports = { QuestionRotation, keyOf, BLOCK_COUNT };
