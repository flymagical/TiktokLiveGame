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
      for (const v of arr) {
        // Older builds saved every viewer under the id "undefined", merging
        // everyone's points into one entry; that entry can't be split, so skip it.
        if (!v.userId || v.userId === "undefined") continue;
        this.viewers.set(v.userId, v);
      }
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

  // Everyone who has scored, highest first. Viewers who only followed (score 0)
  // aren't players yet. There is no cap on how many players are tracked.
  _ranked() {
    return [...this.viewers.values()].filter((v) => v.score > 0).sort((a, b) => b.score - a.score);
  }

  getLeaderboard(limit = 10) {
    return this._ranked()
      .slice(0, limit)
      .map((v) => ({ nickname: v.nickname, score: v.score }));
  }

  getRank(userId) {
    const sorted = this._ranked();
    const index = sorted.findIndex((v) => v.userId === userId);
    if (index === -1) return null;
    return { rank: index + 1, totalPlayers: sorted.length, score: sorted[index].score };
  }
}

module.exports = { ScoreBoard };
