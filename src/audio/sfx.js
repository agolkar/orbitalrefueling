// src/audio/sfx.js
// Sound effects, all synthesized with Web Audio (no sample files): thrusters, the probe motor and
// the latches, the arm servos, valves and propellant flow, beeps, chimes and alarms. Space carries
// no sound: these are the sounds a crew would hear through the structure and the headset.
//
// play(name, opts) fires a one-shot; loop(name, level) sets a continuous sound (0 stops it).

const NOISE_S = 2;

export class Sfx {
  // out: effects bus; verb: send to the effects reverb.
  constructor(ctx, out, verb) {
    this.ctx = ctx;
    this.out = out;
    this.verb = verb;
    this.noise = makeNoise(ctx);
    this.loops = {};
  }

  // ---- building blocks -------------------------------------------------------------------

  gain(value, dest = this.out) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  filter(type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    f.connect(dest);
    return f;
  }

  // Noise burst through a filter: duration, attack and decay in seconds.
  noiseBurst(t, { type = 'bandpass', freq = 1000, q = 0.8, peak = 0.3, attack = 0.003, decay = 0.08, dur = null, dest = this.out, sweepTo = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + (dur || decay));
    f.Q.value = q;
    src.loop = true;
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    const hold = dur ? Math.max(0, dur - attack - decay) : 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    const end = t + attack + hold + decay + 0.05;
    src.start(t, Math.random() * NOISE_S);
    src.stop(end);
  }

  // A tone with a fast attack and an exponential decay; freqTo glides the pitch.
  tone(t, { type = 'sine', freq = 440, freqTo = null, glide = 0.1, peak = 0.2, attack = 0.004, decay = 0.2, hold = 0, dest = this.out, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + glide);
    o.detune.value = detune;
    const g = ctx.createGain();
    o.connect(g);
    g.connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    o.start(t);
    o.stop(t + attack + hold + decay + 0.05);
  }

  // Struck metal: a few inharmonic partials with their own decays.
  metal(t, { partials, peak = 0.08, decay = 0.6, dest = this.out }) {
    partials.forEach((f, i) => {
      this.tone(t, { freq: f, peak: peak / (1 + 0.4 * i), decay: decay / (1 + 0.3 * i), attack: 0.002, dest });
    });
  }

  // ---- one-shots -------------------------------------------------------------------------

  play(name, opts = {}) {
    const t = this.ctx.currentTime + 0.01;
    const fn = this[`fx_${name}`];
    if (fn) fn.call(this, t, opts);
  }

  // A tap on the thrusters: a short puff and a thump through the structure.
  fx_pulse(t) {
    this.noiseBurst(t, { type: 'bandpass', freq: 700, q: 0.7, peak: 0.16, attack: 0.004, decay: 0.07 });
    this.tone(t, { freq: 95, freqTo: 48, glide: 0.07, peak: 0.22, decay: 0.09 });
  }

  fx_beep(t) {
    this.tone(t, { freq: 880, peak: 0.16, decay: 0.09, hold: 0.04 });
  }

  fx_go(t) {
    this.tone(t, { freq: 1318.5, peak: 0.16, decay: 0.28, hold: 0.06 });
    this.tone(t, { freq: 659.3, peak: 0.07, decay: 0.3, hold: 0.06 });
  }

  fx_select(t) {
    this.tone(t, { type: 'triangle', freq: 1046.5, peak: 0.08, decay: 0.07 });
    this.tone(t + 0.05, { type: 'triangle', freq: 1568, peak: 0.06, decay: 0.09 });
  }

  fx_tick(t) {
    this.tone(t, { freq: 1500, peak: 0.07, decay: 0.03 });
  }

  // Capture window open, leak check passed, trajectory SAFE: a soft rising chime.
  fx_chime(t) {
    this.tone(t, { freq: 1318.5, peak: 0.09, decay: 0.6, dest: this.verbMix(0.35) });
    this.tone(t + 0.09, { freq: 1760, peak: 0.08, decay: 0.8, dest: this.verbMix(0.35) });
  }

  fx_nogo(t) {
    for (let i = 0; i < 2; i += 1) {
      const t0 = t + i * 0.16;
      const lp = this.filter('lowpass', 900, 0.7, this.out);
      this.tone(t0, { type: 'square', freq: 138, peak: 0.12, decay: 0.05, hold: 0.07, dest: lp });
    }
  }

  // The probe fingers open in the combustion chamber: a metallic latch.
  fx_latch(t) {
    this.noiseBurst(t, { type: 'highpass', freq: 2000, q: 0.5, peak: 0.18, decay: 0.03 });
    this.metal(t, { partials: [1830, 2690, 3910], peak: 0.09, decay: 0.3, dest: this.verbMix(0.2) });
    this.tone(t + 0.04, { freq: 180, freqTo: 120, glide: 0.06, peak: 0.12, decay: 0.08 });
  }

  // Hard capture: the stanchions seat on the launch adapter ring.
  fx_clunk(t) {
    this.tone(t, { freq: 72, freqTo: 38, glide: 0.25, peak: 0.55, decay: 0.5 });
    this.noiseBurst(t, { type: 'lowpass', freq: 600, q: 0.7, peak: 0.3, decay: 0.12 });
    this.metal(t + 0.005, { partials: [410, 1127, 2213, 3407], peak: 0.07, decay: 1.1, dest: this.verbMix(0.3) });
  }

  // A collision: a heavier blow, ringing longer.
  fx_impact(t) {
    this.tone(t, { freq: 60, freqTo: 32, glide: 0.4, peak: 0.45, decay: 0.7 });
    this.noiseBurst(t, { type: 'lowpass', freq: 1800, q: 0.6, peak: 0.32, decay: 0.2 });
    this.metal(t, { partials: [311, 773, 1493, 2389, 3301], peak: 0.12, decay: 1.4, dest: this.verbMix(0.35) });
  }

  // Master caution: two tones, four times (short: twice).
  fx_alarm(t, { short = false } = {}) {
    const n = short ? 2 : 4;
    const lp = this.filter('lowpass', 2600, 0.7, this.out);
    for (let i = 0; i < n; i += 1) {
      this.tone(t + i * 0.36, { type: 'square', freq: 880, peak: 0.1, attack: 0.01, hold: 0.14, decay: 0.03, dest: lp });
      this.tone(t + i * 0.36 + 0.18, { type: 'square', freq: 660, peak: 0.1, attack: 0.01, hold: 0.14, decay: 0.03, dest: lp });
    }
  }

  fx_touch(t) {
    this.tone(t, { freq: 420, freqTo: 300, glide: 0.03, peak: 0.12, decay: 0.05 });
    this.noiseBurst(t, { type: 'bandpass', freq: 3000, q: 1.5, peak: 0.06, decay: 0.015 });
  }

  // The tool unscrews the cap: ratchet clicks over the duration of the removal.
  fx_ratchet(t, { durationS = 3 } = {}) {
    const n = Math.floor(durationS * 9);
    for (let i = 0; i < n; i += 1) {
      const t0 = t + i / 9 + (Math.random() - 0.5) * 0.01;
      this.noiseBurst(t0, { type: 'bandpass', freq: 3400, q: 4, peak: 0.3, decay: 0.012 });
      this.tone(t0, { freq: 1200, peak: 0.06, decay: 0.015 });
    }
  }

  fx_capOff(t) {
    this.noiseBurst(t, { type: 'bandpass', freq: 2500, q: 2, peak: 0.12, decay: 0.03 });
    this.tone(t + 0.02, { freq: 640, freqTo: 320, glide: 0.06, peak: 0.12, decay: 0.08 });
  }

  // The tool mates with the valve: a latch, then a short purge hiss.
  fx_mate(t) {
    this.fx_latch(t);
    this.noiseBurst(t + 0.12, { type: 'highpass', freq: 3500, q: 0.5, peak: 0.07, attack: 0.02, decay: 0.35 });
  }

  fx_valveOpen(t) {
    this.noiseBurst(t, { type: 'lowpass', freq: 1200, q: 0.8, peak: 0.2, decay: 0.05 });
    this.tone(t, { freq: 3000, peak: 0.05, decay: 0.01 });
    this.noiseBurst(t + 0.03, { type: 'highpass', freq: 2600, q: 0.5, peak: 0.08, attack: 0.01, decay: 0.25 });
  }

  fx_valveClose(t) {
    this.noiseBurst(t, { type: 'lowpass', freq: 900, q: 0.8, peak: 0.22, decay: 0.06 });
    this.tone(t, { freq: 140, freqTo: 90, glide: 0.05, peak: 0.16, decay: 0.08 });
  }

  // Undocking: the latches let go, the probe spring pushes the servicer off.
  fx_undock(t) {
    this.noiseBurst(t, { type: 'bandpass', freq: 400, q: 0.8, peak: 0.12, attack: 0.08, decay: 0.05, sweepTo: 2500, dur: 0.14 });
    this.metal(t + 0.12, { partials: [520, 1340, 2470], peak: 0.06, decay: 0.7, dest: this.verbMix(0.3) });
    this.tone(t + 0.14, { freq: 130, freqTo: 55, glide: 0.25, peak: 0.35, decay: 0.3 });
  }

  // The separation burn: the thrusters fire for durationS.
  fx_burn(t, { durationS = 1.4 } = {}) {
    this.noiseBurst(t, { type: 'bandpass', freq: 650, q: 0.6, peak: 0.24, attack: 0.03, decay: 0.25, dur: durationS });
    this.noiseBurst(t, { type: 'lowpass', freq: 180, q: 0.7, peak: 0.25, attack: 0.05, decay: 0.3, dur: durationS });
  }

  // Fast-forward: a long rising whoosh.
  fx_warp(t) {
    this.noiseBurst(t + 0.6, { type: 'bandpass', freq: 250, q: 2.5, peak: 0.2, attack: 0.5, decay: 0.6, dur: 1.4, sweepTo: 3200, dest: this.verbMix(0.4) });
  }

  // Result: bells on a bright chord, or a falling pair of low notes.
  fx_success(t) {
    const notes = [587.33, 739.99, 880, 1318.51]; // D5 F#5 A5 E6
    notes.forEach((f, i) => {
      const t0 = t + 0.1 + i * 0.11;
      const d = this.verbMix(0.45);
      this.tone(t0, { freq: f, peak: 0.07, decay: 1.6, dest: d });
      this.tone(t0, { freq: f * 2.756, peak: 0.015, decay: 0.5, dest: d });
    });
  }

  fx_fail(t) {
    const lp = this.filter('lowpass', 700, 1, this.verbMix(0.35));
    this.tone(t + 0.15, { type: 'sawtooth', freq: 220, peak: 0.09, attack: 0.02, hold: 0.25, decay: 0.2, dest: lp });
    this.tone(t + 0.6, { type: 'sawtooth', freq: 174.61, peak: 0.09, attack: 0.02, hold: 0.45, decay: 0.5, dest: lp });
  }

  // Before every voice line: a quick two-tone data chirp.
  fx_chirp(t) {
    this.tone(t, { freq: 1661, peak: 0.06, attack: 0.002, hold: 0.025, decay: 0.012 });
    this.tone(t + 0.045, { freq: 2489, peak: 0.055, attack: 0.002, hold: 0.025, decay: 0.015 });
  }

  // A node that sends to the effects reverb as well as to the dry bus.
  verbMix(send) {
    const g = this.ctx.createGain();
    g.connect(this.out);
    if (this.verb) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.verb);
    }
    return g;
  }

  // ---- continuous sounds -----------------------------------------------------------------

  loop(name, level) {
    let l = this.loops[name];
    if (!l) {
      if (!(level > 0)) return;
      l = this.makeLoop(name);
      if (!l) return;
      this.loops[name] = l;
    }
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, level || 0));
    const rising = v > l.level;
    l.gain.gain.setTargetAtTime(v * l.peak, t, rising ? l.attack : l.release);
    if (l.pitch) l.pitch(v, t);
    l.level = v;
  }

  makeLoop(name) {
    const ctx = this.ctx;
    const g = this.gain(0);
    const noiseSrc = (dest) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.connect(dest);
      s.start(ctx.currentTime, Math.random() * NOISE_S);
      return s;
    };
    if (name === 'rcs') {
      // Thrusters firing: dark, structure-borne hiss.
      const lp = this.filter('lowpass', 1800, 0.5, g);
      const bp = this.filter('bandpass', 750, 0.6, lp);
      noiseSrc(bp);
      return { gain: g, peak: 0.22, attack: 0.015, release: 0.05, level: 0 };
    }
    if (name === 'motor') {
      // The probe drive: a geared whine, higher while extending.
      const bp = this.filter('bandpass', 800, 2.5, g);
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 140;
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 280;
      const m = ctx.createGain();
      m.gain.value = 0.4;
      o1.connect(bp);
      o2.connect(m);
      m.connect(bp);
      o1.start();
      o2.start();
      const pitch = (v, t) => {
        o1.frequency.setTargetAtTime(100 + 60 * v, t, 0.08);
        o2.frequency.setTargetAtTime(200 + 120 * v, t, 0.08);
      };
      return { gain: g, peak: 0.07, attack: 0.05, release: 0.12, level: 0, pitch };
    }
    if (name === 'servo') {
      // Arm joints: a small servo whine that follows the joint speed.
      const bp = this.filter('bandpass', 1300, 3, g);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 180;
      o.connect(bp);
      o.start();
      const hp = this.filter('highpass', 4000, 0.5, g);
      const n = ctx.createGain();
      n.gain.value = 0.15;
      n.connect(hp);
      noiseSrc(n);
      const pitch = (v, t) => o.frequency.setTargetAtTime(150 + 260 * v, t, 0.06);
      return { gain: g, peak: 0.05, attack: 0.04, release: 0.1, level: 0, pitch };
    }
    if (name === 'flow') {
      // Propellant in the line: a low rush and the pump hum.
      const lp = this.filter('lowpass', 520, 0.7, g);
      const hp = this.filter('highpass', 70, 0.7, lp);
      noiseSrc(hp);
      const hum = ctx.createOscillator();
      hum.frequency.value = 98;
      const hg = ctx.createGain();
      hg.gain.value = 0.25;
      hum.connect(hg);
      hg.connect(g);
      hum.start();
      return { gain: g, peak: 0.2, attack: 0.2, release: 0.3, level: 0 };
    }
    if (name === 'hiss') {
      // Helium at 15 bar in the mated tool during the leak check.
      const hp = this.filter('highpass', 3200, 0.5, g);
      noiseSrc(hp);
      return { gain: g, peak: 0.07, attack: 0.15, release: 0.25, level: 0 };
    }
    g.disconnect();
    return null;
  }

  stopLoops() {
    for (const name of Object.keys(this.loops)) this.loop(name, 0);
  }
}

function makeNoise(ctx) {
  const n = Math.floor(NOISE_S * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) d[i] = Math.random() * 2 - 1;
  return buf;
}
