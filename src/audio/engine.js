// src/audio/engine.js
// The sound of the game: one Web Audio context (browsers allow it only after a key press or a
// click, so it starts at the first one), three buses (music, effects, voice) into a soft master
// limiter, and the settings kept in this browser (B toggles the music, V the voice, K all sound;
// the menu's settings panel sets the volume).
// The director (src/audio/director.js) decides what plays; this class only carries it out.

import { Music, makeImpulse } from './music.js';
import { Sfx } from './sfx.js';
import { VoicePlayer } from './voice.js';
import { PRIORITY } from './lines.js';

const STORE = 'refuelAudio';
const DEFAULTS = { music: true, voice: true, muted: false, volume: 0.9, musicVolume: 0.7, sfxVolume: 0.85, voiceVolume: 0.9 };

export class AudioSystem {
  constructor({ voiceBase = 'assets/voice/' } = {}) {
    this.voiceBase = voiceBase;
    this.settings = { ...DEFAULTS };
    try {
      Object.assign(this.settings, JSON.parse(window.localStorage.getItem(STORE) || '{}'));
    } catch (e) {
      // storage unavailable: defaults
    }
    this.ctx = null;
    this.pending = { intensity: 0.5, muffled: false };
    this.greeted = false;
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('pointerdown', unlock, true);
  }

  get ready() {
    return !!this.ctx;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Master: a gentle compressor keeps the peaks of music, effects and voice together in check.
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Music bus, with the ducking under the voice.
    this.musicOut = ctx.createGain();
    this.duck = ctx.createGain();
    this.duck.connect(this.musicOut);
    this.musicOut.connect(this.master);
    this.music = new Music(ctx, this.duck);

    // Effects bus with a short reverb.
    this.sfxOut = ctx.createGain();
    this.sfxOut.connect(this.master);
    const sfxVerb = ctx.createConvolver();
    sfxVerb.buffer = makeImpulse(ctx, 1.6, 3);
    const sfxVerbOut = ctx.createGain();
    sfxVerbOut.gain.value = 0.5;
    sfxVerb.connect(sfxVerbOut);
    sfxVerbOut.connect(this.sfxOut);
    this.sfx = new Sfx(ctx, this.sfxOut, sfxVerb);

    // Voice bus: low cut, a little presence, a touch of small room. The flight computer.
    this.voiceOut = ctx.createGain();
    this.voiceOut.connect(this.master);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 4;
    const room = ctx.createConvolver();
    room.buffer = makeImpulse(ctx, 0.45, 4);
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.22;
    hp.connect(presence);
    presence.connect(this.voiceOut);
    presence.connect(room);
    room.connect(roomOut);
    roomOut.connect(this.voiceOut);
    this.voice = new VoicePlayer(ctx, hp, {
      chirp: () => this.sfx.play('chirp'),
      onSpeaking: (on) => this.duck.gain.setTargetAtTime(on ? 0.5 : 1, ctx.currentTime, on ? 0.05 : 0.4)
    });
    this.voice.load(this.voiceBase);

    this.applySettings();
    this.music.setIntensity(this.pending.intensity);
    this.music.setMuffled(this.pending.muffled);
    this.music.start();
    if (ctx.state === 'suspended') ctx.resume();
    if (!this.greeted) {
      this.greeted = true;
      this.say('online', PRIORITY.info);
    }
  }

  applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume, t, 0.05);
    this.musicOut.gain.setTargetAtTime(s.music ? s.musicVolume : 0, t, 0.15);
    this.sfxOut.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.voiceOut.gain.setTargetAtTime(s.voiceVolume, t, 0.05);
    this.voice.setEnabled(s.voice);
  }

  save() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(this.settings));
    } catch (e) {
      // storage unavailable: the choice lasts for this page only
    }
  }

  toggleMusic() {
    this.settings.music = !this.settings.music;
    this.applySettings();
    this.save();
    return this.settings.music;
  }

  toggleVoice() {
    this.settings.voice = !this.settings.voice;
    this.applySettings();
    this.save();
    return this.settings.voice;
  }

  // All sound on or off (K); the music and voice choices stay as they are.
  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.applySettings();
    this.save();
    return !this.settings.muted;
  }

  // kind: 'master', 'music', 'sfx' or 'voice'; v from 0 to 1.
  setVolume(kind, v) {
    const key = { master: 'volume', music: 'musicVolume', sfx: 'sfxVolume', voice: 'voiceVolume' }[kind];
    if (!key) return;
    this.settings[key] = Math.max(0, Math.min(1, v));
    this.applySettings();
    this.save();
  }

  // ---- the director's output ---------------------------------------------------------------

  say(id, priority = PRIORITY.info) {
    if (this.voice) this.voice.say(id, priority);
  }

  play(name, opts) {
    if (this.sfx) this.sfx.play(name, opts);
  }

  loop(name, level) {
    if (this.sfx) this.sfx.loop(name, level);
  }

  setMusic({ intensity, muffled } = {}) {
    if (intensity !== undefined) this.pending.intensity = intensity;
    if (muffled !== undefined && muffled !== this.pending.muffled) {
      this.pending.muffled = muffled;
      if (this.music) this.music.setMuffled(muffled);
    }
    if (this.music && intensity !== undefined) this.music.setIntensity(intensity);
  }

  // Every frame: the music scheduler and the voice queue.
  tick() {
    if (!this.ctx) return;
    this.music.tick();
    this.voice.tick();
  }

  // The object the director talks to.
  output() {
    return {
      say: (id, p) => this.say(id, p),
      sfx: (name, opts) => this.play(name, opts),
      loop: (name, level) => this.loop(name, level),
      music: (m) => this.setMusic(m)
    };
  }
}
