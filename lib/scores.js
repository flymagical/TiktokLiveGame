// Persistent leaderboard: tracks per-viewer score and follow status,
// saved to data/scores.json so progress survives restarts.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "scores.json");

class ScoreBoard {
  constructor() {
    this.viewers = new Map(); // userId -> { userId, nickname, score, followed }
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const arr = JSON.parse(raw);
      for (const v of arr) this.viewers.set(v.userId, v);
    } catch (err) {
      if (err.code !== "ENOENT") console.error("Gagal membaca data/scores.json:", err.message);
    }
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([...this.viewers.values()], null, 2));
    } catch (err) {
      console.error("Gagal menyimpan data/scores.json:", err.message);
    }
  }

  _get(userId, nickname) {
    let v = this.viewers.get(userId);
    if (!v) {
      v = { userId, nickname, score: 0, followed: false };
      this.viewers.set(userId, v);
    } else if (nickname) {
      v.nickname = nickname; // keep display name fresh
    }
    return v;
  }

  getViewer(userId) {
    return this.viewers.get(userId) || null;
  }

  hasFollowed(userId) {
    const v = this.viewers.get(userId);
    return !!(v && v.followed);
  }

  markFollowed(userId, nickname) {
    const v = this._get(userId, nickname);
    v.followed = true;
    this._save();
  }

  awardPoints(userId, nickname, points) {
    const v = this._get(userId, nickname);
    v.score += points;
    this._save();
    return v;
  }

  getLeaderboard(limit = 5) {
    return [...this.viewers.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((v) => ({ nickname: v.nickname, score: v.score }));
  }

  getRank(userId) {
    const sorted = [...this.viewers.values()].sort((a, b) => b.score - a.score);
    const index = sorted.findIndex((v) => v.userId === userId);
    if (index === -1) return null;
    return { rank: index + 1, totalPlayers: sorted.length, score: sorted[index].score };
  }
}

module.exports = { ScoreBoard };
