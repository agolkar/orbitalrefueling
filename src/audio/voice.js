// src/audio/voice.js
// The voice of the flight computer: plays the pre-rendered callouts (assets/voice/<id>.mp3) one at
// a time, each announced by a short two-tone data chirp. VoiceQueue is the pure part (which line
// plays next), so the tests run it without Web Audio.

import { VOICE_LINES, PRIORITY } from './lines.js';

const GAP_S = 0.35; // silence between two lines
const STALE_S = [2.5, 4.0, 6.0]; // an info, warning or critical line is dropped after waiting this long
const MAX_QUEUED = 2;

export class VoiceQueue {
  constructor() {
    this.items = []; // { id, priority, at }
    this.busyUntilS = -Infinity; // end of the line playing now
  }

  // Returns 'now' when the line must start at once (it cuts in), 'queued' or 'dropped'.
  push(id, priority, nowS) {
    if (priority >= PRIORITY.critical) {
      this.items = [];
      return 'now';
    }
    if (this.items.some((it) => it.id === id)) return 'dropped';
    this.items.push({ id, priority, at: nowS });
    // Keep the queue short: the lowest priority, then the oldest, goes first.
    while (this.items.length > MAX_QUEUED) {
      let worst = 0;
      for (let i = 1; i < this.items.length; i += 1) {
        const a = this.items[i];
        const b = this.items[worst];
        if (a.priority < b.priority || (a.priority === b.priority && a.at < b.at)) worst = i;
      }
      this.items.splice(worst, 1);
    }
    return 'queued';
  }

  // The line to play now, if the voice is free: highest priority first, stale lines dropped.
  next(nowS) {
    this.items = this.items.filter((it) => nowS - it.at <= STALE_S[it.priority]);
    if (nowS < this.busyUntilS + GAP_S || this.items.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.items.length; i += 1) {
      if (this.items[i].priority > this.items[best].priority) best = i;
    }
    return this.items.splice(best, 1)[0].id;
  }

  started(nowS, durationS) {
    this.busyUntilS = nowS + durationS;
  }

  clear() {
    this.items = [];
  }
}

export class VoicePlayer {
  // out: node the voice goes to; chirp(time): plays the data chirp; onSpeaking(on): music ducking.
  constructor(ctx, out, { chirp = null, onSpeaking = null } = {}) {
    this.ctx = ctx;
    this.out = out;
    this.chirp = chirp;
    this.onSpeaking = onSpeaking;
    this.buffers = {};
    this.failed = new Set();
    this.queue = new VoiceQueue();
    this.current = null; // { source, endS }
    this.enabled = true;
    this.loadedAt = null;
  }

  load(base) {
    const jobs = Object.keys(VOICE_LINES).map((id) =>
      fetch(`${base}${id}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => {
          this.buffers[id] = buf;
        })
        .catch(() => {
          this.failed.add(id);
        })
    );
    return Promise.all(jobs).then(() => {
      this.loadedAt = this.ctx.currentTime;
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }

  say(id, priority = PRIORITY.info) {
    if (!this.enabled || !VOICE_LINES[id]) return;
    const now = this.ctx.currentTime;
    if (this.queue.push(id, priority, now) === 'now') {
      this.stop();
      this.play(id);
    }
  }

  stop() {
    this.queue.clear();
    if (this.current) {
      try {
        this.current.source.stop();
      } catch (e) {
        // already stopped
      }
      this.current = null;
      if (this.onSpeaking) this.onSpeaking(false);
    }
  }

  // Called every frame: ends the current line, starts the next one.
  tick() {
    const now = this.ctx.currentTime;
    if (this.current && now >= this.current.endS) {
      this.current = null;
      if (this.onSpeaking) this.onSpeaking(false);
    }
    if (this.current) return;
    // Lines asked for before the files arrived wait (up to their stale time) for the loading.
    if (this.loadedAt === null && this.queue.items.length) return;
    const id = this.queue.next(now);
    if (id) this.play(id);
  }

  play(id) {
    const now = this.ctx.currentTime;
    const buf = this.buffers[id];
    if (!buf) {
      // No file: the browser's own speech synthesis reads the text, if there is one.
      if (this.failed.has(id) && typeof window !== 'undefined' && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(VOICE_LINES[id]);
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
        this.queue.started(now, 1.5);
      }
      return;
    }
    const lead = 0.12; // the chirp, then the words
    if (this.chirp) this.chirp(now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    src.start(now + lead);
    this.current = { source: src, endS: now + lead + buf.duration };
    this.queue.started(now, lead + buf.duration);
    if (this.onSpeaking) this.onSpeaking(true);
  }
}
