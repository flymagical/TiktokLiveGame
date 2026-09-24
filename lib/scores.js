// Persistent leaderboard: tracks per-viewer score and follow status,
// saved to data/scores.json so progress survives restarts.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "scores.json");
const GIFTERS_FILE = path.join(DATA_DIR, "gifters.json");
// Gift tallies older than this belong to a previous stream and start fresh.
const GIFTERS_STALE_MS = 6 * 60 * 60 * 1000;

class ScoreBoard {
  constructor() {
    this.viewers = new Map(); // userId -> { userId, nickname, score, followed }
    this.sessionGifts = new Map(); // userId -> { userId, nickname, avatar, diamonds, gifts }
    this._load();
    this._loadGifters();
  }

  _loadGifters() {
    try {
      const { updatedAt, gifters } = JSON.parse(fs.readFileSync(GIFTERS_FILE, "utf8"));
      if (Date.now() - updatedAt > GIFTERS_STALE_MS) return;
      for (const g of gifters) this.sessionGifts.set(g.userId, g);
    } catch (err) {
      if (err.code !== "ENOENT") console.error("Gagal membaca data/gifters.json:", err.message);
    }
  }

  _saveGifters() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const data = { updatedAt: Date.now(), gifters: [...this.sessionGifts.values()] };
      fs.writeFileSync(GIFTERS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Gagal menyimpan data/gifters.json:", err.message);
    }
  }

  resetGifters() {
    this.sessionGifts.clear();
    this._saveGifters();
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

  awardPoints(userId, nickname, points, avatar) {
    const v = this._get(userId, nickname);
    if (avatar) v.avatar = avatar;
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
      .map((v) => ({ nickname: v.nickname, score: v.score, avatar: v.avatar || null }));
  }

  // Take up to `points` from the current #1 and give them to the thief.
  // Returns null when there's no leader or the thief already is #1.
  stealFromLeader(userId, nickname, points) {
    const leader = this._ranked()[0];
    if (!leader || leader.userId === userId) return null;
    const taken = Math.min(points, leader.score);
    leader.score -= taken;
    const thief = this._get(userId, nickname);
    thief.score += taken;
    this._save();
    return { victim: leader.nickname, victimScore: leader.score, points: taken, score: thief.score };
  }

  // Gifts are tallied per stream (saved to data/gifters.json, fresh after
  // 6 idle hours) for the Top Gifter board and the end-of-stream MVP card.
  recordGift({ userId, nickname, avatar, count, diamonds }) {
    let g = this.sessionGifts.get(userId);
    if (!g) {
      // Entries rebuilt from console logs have no real id ("log:<nickname>");
      // adopt one when that viewer gifts again so they aren't listed twice.
      const restored = this.sessionGifts.get(`log:${nickname}`);
      if (restored) {
        this.sessionGifts.delete(restored.userId);
        restored.userId = userId;
        this.sessionGifts.set(userId, restored);
        g = restored;
      }
    }
    if (!g) {
      g = { userId, nickname, avatar: null, diamonds: 0, gifts: 0 };
      this.sessionGifts.set(userId, g);
    }
    g.nickname = nickname || g.nickname;
    g.avatar = avatar || g.avatar;
    g.diamonds += diamonds || 0;
    g.gifts += count || 1;
    this._saveGifters();
  }

  getTopGifters(limit = 10) {
    return [...this.sessionGifts.values()]
      .sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts)
      .slice(0, limit)
      .map(({ nickname, avatar, diamonds, gifts }) => ({ nickname, avatar, diamonds, gifts }));
  }

  getRank(userId) {
    const sorted = this._ranked();
    const index = sorted.findIndex((v) => v.userId === userId);
    if (index === -1) return null;
    return { rank: index + 1, totalPlayers: sorted.length, score: sorted[index].score };
  }
}

module.exports = { ScoreBoard };
