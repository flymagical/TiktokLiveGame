// Thin wrapper around tiktok-live-connector that normalizes the events
// server.js/game.js care about: connected, comment, follow, disconnected, error.

const { EventEmitter } = require("events");
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require("tiktok-live-connector");

const REPLAY_IGNORE_MS = 3000;

// v2 of tiktok-live-connector exposes the numeric id as `user.id` and the
// @username as `user.displayId` (older versions used userId / uniqueId).
// Every viewer needs a distinct id, or all scores collapse into one entry.
function viewerOf(data) {
  const u = data.user || {};
  const id = u.id || u.userId || data.userId || u.displayId || u.uniqueId || u.nickname;
  return {
    userId: String(id),
    username: u.displayId || u.uniqueId || "",
    nickname: u.nickname || u.displayId || u.uniqueId || data.nickname || "penonton",
    avatar: imageUrl(u.profilePicture) || u.profilePictureUrl || null
  };
}

// Protobuf images carry `url: []`; older versions used `urlList`.
function imageUrl(img) {
  return img?.url?.[0] || img?.urlList?.[0] || null;
}

class TikTokClient extends EventEmitter {
  constructor(username) {
    super();
    this.username = username;
    this.ignoreCommentsUntil = 0;
    this.connection = new TikTokLiveConnection(username, {});

    this.connection.on(WebcastEvent.CHAT, (data) => {
      // TikTok replays a few recent comments when we (re)connect; drop them so
      // old messages can't answer the first question.
      if (Date.now() < this.ignoreCommentsUntil) return;
      this.emit("comment", {
        ...viewerOf(data),
        // v2 of tiktok-live-connector renamed the chat text field to `content`.
        comment: data.content ?? data.comment,
        // True when the commenter already follows the host (followed before
        // this LIVE started, so no follow event will ever arrive for them).
        isFollower: !!(data.userIdentity?.isFollowerOfAnchor || data.userIdentity?.isMutualFollowingWithAnchor)
      });
    });

    this.connection.on(WebcastEvent.FOLLOW, (data) => {
      this.emit("follow", viewerOf(data));
    });

    this.connection.on(WebcastEvent.GIFT, (data) => {
      // Combo gifts (e.g. Rose) send one message per tap while the streak runs;
      // only the last one (repeatEnd) carries the final count.
      const gift = data.gift || {};
      const isCombo = gift.combo || gift.type === 1;
      if (isCombo && !data.repeatEnd) return;
      this.emit("gift", {
        ...viewerOf(data),
        giftName: gift.name || "gift",
        count: data.repeatCount || 1,
        diamonds: (gift.diamondCount || 0) * (data.repeatCount || 1),
        image: imageUrl(gift.image) || imageUrl(gift.icon)
      });
    });

    this.connection.on(ControlEvent.DISCONNECTED, () => this.emit("disconnected"));
    this.connection.on(ControlEvent.ERROR, (err) => this.emit("error", err));
    this.connection.on(WebcastEvent.STREAM_END, () => this.emit("disconnected", "stream berakhir"));
  }

  async connect() {
    this.ignoreCommentsUntil = Infinity;
    const state = await this.connection.connect();
    this.ignoreCommentsUntil = Date.now() + REPLAY_IGNORE_MS;
    this.emit("connected", { roomId: state.roomId });
    return state;
  }
}

module.exports = { TikTokClient };
