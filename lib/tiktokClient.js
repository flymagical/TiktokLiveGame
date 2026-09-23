// Thin wrapper around tiktok-live-connector that normalizes the events
// server.js/game.js care about: connected, comment, follow, disconnected, error.

const { EventEmitter } = require("events");
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require("tiktok-live-connector");

class TikTokClient extends EventEmitter {
  constructor(username) {
    super();
    this.username = username;
    this.connection = new TikTokLiveConnection(username, {});

    this.connection.on(WebcastEvent.CHAT, (data) => {
      this.emit("comment", {
        userId: String(data.user?.userId ?? data.userId),
        nickname: data.user?.nickname || data.user?.uniqueId || data.nickname,
        comment: data.comment
      });
    });

    this.connection.on(WebcastEvent.FOLLOW, (data) => {
      this.emit("follow", {
        userId: String(data.user?.userId ?? data.userId),
        nickname: data.user?.nickname || data.user?.uniqueId || data.nickname
      });
    });

    this.connection.on(ControlEvent.DISCONNECTED, () => this.emit("disconnected"));
    this.connection.on(ControlEvent.ERROR, (err) => this.emit("error", err));
    this.connection.on(WebcastEvent.STREAM_END, () => this.emit("disconnected", "stream berakhir"));
  }

  async connect() {
    const state = await this.connection.connect();
    this.emit("connected", { roomId: state.roomId });
    return state;
  }
}

module.exports = { TikTokClient };
