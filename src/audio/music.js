// src/audio/music.js
// Background music, generated while the game runs: an original dark synth piece in D minor at
// 92 BPM. Warm detuned pads, a sub bass that starts to pulse as the tension grows, a filtered
// arpeggio through a ping-pong delay, a half-time beat, and the odd burst of data chatter.
//
// One intensity value (0 to 1) arranges it: calm pads and a long bass far from the client, the
// arpeggio and the hi-hats as the servicer closes in, the full beat at the capture point.
// tick() runs every frame and schedules the notes a little ahead (Web Audio clock).

const BPM = 92;
const STEP_S = 60 / BPM / 4; // a sixteenth note
const LOOKAHEAD_S = 0.3;

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Two four-chord progressions of two bars each (MIDI notes): pad voicing, bass root, arpeggio
// tones; pad2 and arp2 replace them in the second bar (a suspension that resolves).
const PROGRESSIONS = [
  [
    { pad: [50, 53, 57, 64], bass: 38, arp: [62, 64, 65, 69, 72, 76] }, // Dm(add9)
    { pad: [53, 57, 58, 62], bass: 34, arp: [62, 65, 69, 70, 74, 77] }, // Bbmaj7
    { pad: [55, 58, 62, 65], bass: 31, arp: [62, 65, 67, 70, 74, 77] }, // Gm7
    { pad: [52, 55, 57, 62], pad2: [52, 55, 57, 61], bass: 33, arp: [62, 64, 67, 69, 74, 76], arp2: [61, 64, 67, 69, 73, 76] } // A7sus4 -> A7
  ],
  [
    { pad: [50, 53, 57, 64], bass: 38, arp: [62, 64, 65, 69, 72, 76] }, // Dm9
    { pad: [53, 57, 60, 64], bass: 41, arp: [60, 64, 65, 69, 72, 76] }, // Fmaj7
    { pad: [52, 55, 60, 62], bass: 36, arp: [60, 62, 64, 67, 72, 74] }, // Cadd9
    { pad: [53, 57, 58, 64], bass: 34, arp: [58, 62, 64, 65, 69, 70] } // Bbmaj7(#11)
  ]
];

const ARP_PATTERNS = [
  [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 5, 4, 2, 3, 1],
  [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 2],
  [0, 3, 1, 4, 2, 5, 3, 4, 0, 3, 1, 4, 2, 5, 4, 3]
];
const ARP_ACCENT = [1, 0.45, 0.7, 0.45, 0.9, 0.45, 0.7, 0.45, 1, 0.45, 0.7, 0.45, 0.9, 0.45, 0.7, 0.55];
const BASS_ACCENT = [1, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.6];
const BLIP_NOTES = [86, 89, 91, 93, 96, 98]; // D minor pentatonic, high

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    // Signal flow: instruments -> layer buses -> mix -> lowpass (muffles in pause) -> out.
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.6;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 18000;
    this.lowpass.Q.value = 0.5;
    this.mix.connect(this.lowpass);
    this.lowpass.connect(out);

    this.verb = ctx.createConvolver();
    this.verb.buffer = makeImpulse(ctx, 3.2, 2.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.38;
    this.verb.connect(verbOut);
    verbOut.connect(this.mix);

    this.delay = makePingPong(ctx, 3 * STEP_S, 0.38, 2600);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.3;
    this.delay.output.connect(delayOut);
    delayOut.connect(this.mix);

    // The pump: pads, bass and air duck under each kick drum.
    this.pump = ctx.createGain();
    this.pump.connect(this.mix);
    this.padBus = this.bus(this.pump, 0.5);
    // The bass goes through a soft saturation: harmonics that small speakers can play.
    this.bassDrive = ctx.createWaveShaper();
    this.bassDrive.curve = driveCurve(2.2);
    this.bassDrive.oversample = '2x';
    this.bassDrive.connect(this.pump);
    this.bassBus = this.bus(this.bassDrive, 0);
    this.arpBus = this.bus(this.mix, 0.25, 0.45);
    this.drumBus = this.bus(this.mix, 0);
    this.blipBus = this.bus(this.mix, 0.5, 0.6);
    this.snareSend = ctx.createGain();
    this.snareSend.gain.value = 0.55;
    this.snareSend.connect(this.verb);

    this.noise = makeNoise(ctx);
    this.air = this.makeAir();

    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0.4;
    this.target = 0.4;
    this.lastTick = 0;
    this.pattern = 0;
  }

  bus(dest, verbSend = 0, delaySend = 0) {
    const g = this.ctx.createGain();
    g.connect(dest);
    if (verbSend > 0) {
      const s = this.ctx.createGain();
      s.gain.value = verbSend;
      g.connect(s);
      s.connect(this.verb);
    }
    if (delaySend > 0) {
      const s = this.ctx.createGain();
      s.gain.value = delaySend;
      g.connect(s);
      s.connect(this.delay.input);
    }
    return g;
  }

  // A faint band of noise that drifts slowly: the "air" under the pads.
  makeAir() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.pump);
    src.start();
    return { filter: bp, gain: g };
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.lastTick = this.ctx.currentTime;
  }

  stop() {
    this.playing = false;
  }

  setIntensity(x) {
    this.target = clamp(x, 0, 1);
  }

  setMuffled(on) {
    const t = this.ctx.currentTime;
    this.lowpass.frequency.setTargetAtTime(on ? 650 : 18000, t, on ? 0.12 : 0.4);
    this.mix.gain.setTargetAtTime(on ? 0.42 : 0.6, t, 0.2);
  }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    // The arrangement follows the game with a few seconds of lag.
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt / 2.5));
    // After a hidden tab the clock ran ahead: start again from now.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD_S) {
      this.scheduleStep(this.step, this.nextTime);
      this.step += 1;
      this.nextTime += STEP_S;
    }
  }

  levels() {
    const x = this.intensity;
    return {
      x,
      pad: 0.8 + 0.2 * x,
      bass: 0.65 + 0.35 * x,
      pulse: x >= 0.4,
      arp: smooth(0.2, 0.6, x),
      hats: smooth(0.45, 0.65, x),
      beat: smooth(0.6, 0.75, x),
      busy: smooth(0.8, 0.95, x),
      blips: x < 0.15 ? 0 : 0.6 + 0.4 * (1 - Math.abs(x - 0.5) * 2)
    };
  }

  scheduleStep(step, t) {
    const L = this.levels();
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const cycle = Math.floor(bar / 8);
    const prog = PROGRESSIONS[cycle % PROGRESSIONS.length];
    const chord = prog[Math.floor(bar / 2) % 4];
    const second = bar % 2 === 1;
    if (step % 128 === 0) this.pattern = (cycle + Math.floor(Math.random() * 2)) % ARP_PATTERNS.length;

    // Pads: one chord for two bars, or one voicing per bar when the second resolves.
    if (s16 === 0) {
      if (!second) {
        const bars = chord.pad2 ? 1 : 2;
        this.padChord(t, chord.pad, bars * 16 * STEP_S, L);
        this.airDrift(t);
      } else if (chord.pad2) {
        this.padChord(t, chord.pad2, 16 * STEP_S, L);
      }
    }

    // Bass: a long note in the calm parts, rolling eighths when the tension grows.
    if (L.pulse) {
      if (step % 2 === 0) {
        const i = s16 / 2;
        const up = s16 === 14 ? 12 : 0;
        this.bassNote(t, chord.bass + up, 1.6 * STEP_S, BASS_ACCENT[i] * L.bass, L);
      }
    } else if (s16 === 0 && !second) {
      this.bassNote(t, chord.bass, 32 * STEP_S, 0.8 * L.bass, L, true);
    }

    // Arpeggio: eighths when it fades in, sixteenths at full level.
    if (L.arp > 0.02 && (L.arp > 0.6 || step % 2 === 0)) {
      const tones = second && chord.arp2 ? chord.arp2 : chord.arp;
      const note = tones[ARP_PATTERNS[this.pattern][s16] % tones.length];
      this.arpNote(t, note, ARP_ACCENT[s16] * L.arp, L.x, s16 % 4 === 0 ? -0.35 : s16 % 4 === 2 ? 0.35 : 0);
    }

    // Beat: half time, kick on 1 and on the "and" of 3, snare on 3.
    if (L.beat > 0.02) {
      if (s16 === 0) this.kick(t, L.beat);
      if (s16 === 10) this.kick(t, 0.8 * L.beat);
      if (s16 === 7 && L.busy > 0.3) this.kick(t, 0.5 * L.beat);
      if (s16 === 8) this.snare(t, L.beat);
    }
    if (L.hats > 0.02) {
      if (step % 2 === 0) this.hat(t, (s16 % 4 === 2 ? 0.75 : 0.45) * L.hats, false);
      else if (L.busy > 0.05) this.hat(t, 0.22 * L.busy, false);
      if (s16 === 14 && L.x > 0.75) this.hat(t, 0.35 * L.hats, true);
    }

    // Data chatter now and then.
    if (s16 % 4 === 0 && L.blips > 0 && Math.random() < 0.09 * L.blips) this.blips(t);
  }

  // ---- instruments -------------------------------------------------------------------------

  padChord(t, notes, dur, L) {
    const ctx = this.ctx;
    const attack = 1.4;
    const release = 2.4;
    const end = t + dur;
    for (const m of notes) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 1.0;
      const top = 1600 + 2400 * L.x;
      f.frequency.setValueAtTime(500, t);
      f.frequency.linearRampToValueAtTime(top, t + 0.45 * dur);
      f.frequency.linearRampToValueAtTime(900, end + release);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(L.pad, t + attack);
      g.gain.setValueAtTime(L.pad, end);
      g.gain.exponentialRampToValueAtTime(0.0001, end + release);
      f.connect(g);
      g.connect(this.padBus);
      [-11, 0, 11].forEach((cents, i) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = cents + (Math.random() - 0.5) * 4;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        const pan = ctx.createStereoPanner();
        pan.pan.value = (i - 1) * 0.55;
        o.connect(og);
        og.connect(pan);
        pan.connect(f);
        o.start(t);
        o.stop(end + release + 0.05);
      });
    }
  }

  bassNote(t, m, dur, vel, L, long = false) {
    const ctx = this.ctx;
    const end = t + dur;
    const g = ctx.createGain();
    g.connect(this.bassBus);
    // Sub: a sine at the root.
    const sub = ctx.createOscillator();
    sub.frequency.value = hz(m);
    const sg = ctx.createGain();
    sg.gain.value = 0.15 * vel;
    sub.connect(sg);
    sg.connect(g);
    // Body: a filtered saw an octave up, so small speakers hear the line.
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = hz(m + 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2.5;
    const top = 400 + 900 * L.x;
    f.frequency.setValueAtTime(long ? top * 0.7 : top * 1.6, t);
    f.frequency.exponentialRampToValueAtTime(long ? top : top * 0.6, t + (long ? dur * 0.5 : 0.15));
    const bg = ctx.createGain();
    bg.gain.value = 0.16 * vel;
    saw.connect(f);
    f.connect(bg);
    bg.connect(g);
    const attack = long ? 0.35 : 0.005;
    const release = long ? 1.2 : 0.07;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + attack);
    if (!long) g.gain.exponentialRampToValueAtTime(0.55, t + 0.18);
    g.gain.setValueAtTime(long ? 1 : 0.55, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + release);
    for (const o of [sub, saw]) {
      o.start(t);
      o.stop(end + release + 0.05);
    }
  }

  arpNote(t, m, vel, x, panValue) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    const top = 2200 + 3000 * x;
    f.frequency.setValueAtTime(top, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    const pan = ctx.createStereoPanner();
    pan.pan.value = panValue;
    f.connect(g);
    g.connect(pan);
    pan.connect(this.arpBus);
    for (const [type, det, lvl] of [['sawtooth', -6, 0.6], ['square', 6, 0.4]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og);
      og.connect(f);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.45);
    this.noiseHit(t, 'highpass', 2500, 0.5, 0.05 * vel, 0.006, this.drumBus);
    // The pump: pads and bass dip under the kick and come back.
    const p = this.pump.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value > 0 ? Math.min(1, p.value) : 1, t);
    p.linearRampToValueAtTime(1 - 0.4 * vel, t + 0.012);
    p.setTargetAtTime(1, t + 0.03, 0.1);
  }

  snare(t, vel) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.drumBus);
    g.connect(this.snareSend);
    this.noiseHit(t, 'bandpass', 1900, 0.8, 0.3 * vel, 0.17, g);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.15 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(og);
    og.connect(g);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, vel, open) {
    this.noiseHit(t, 'highpass', 7800, 0.7, 0.14 * vel, open ? 0.22 : 0.035, this.drumBus);
  }

  noiseHit(t, type, freq, q, peak, decay, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.02);
  }

  blips(t) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    pan.connect(this.blipBus);
    for (let i = 0; i < n; i += 1) {
      const t0 = t + i * (STEP_S / 2);
      const o = ctx.createOscillator();
      o.frequency.value = hz(BLIP_NOTES[Math.floor(Math.random() * BLIP_NOTES.length)]);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.04, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      o.connect(g);
      g.connect(pan);
      o.start(t0);
      o.stop(t0 + 0.08);
    }
  }

  // Every two bars the air band moves to a new place and level.
  airDrift(t) {
    const L = this.levels();
    this.air.filter.frequency.setTargetAtTime(500 + Math.random() * 1400, t, 1.5);
    this.air.gain.gain.setTargetAtTime(0.012 + 0.01 * (1 - L.x), t, 1.0);
  }
}

// Stereo reverb impulse: decaying noise that darkens as it fades, with a short pre-delay.
export function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const pre = Math.floor(0.018 * rate);
  const n = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i += 1) {
      const x = (i - pre) / (n - pre);
      const a = 0.15 + 0.8 * x; // stronger low-pass towards the tail
      lp += (1 - a) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, decay);
    }
  }
  // Normalise the energy so that impulses of any length sit at the same level.
  let e = 0;
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i += 1) e += d[i] * d[i];
  }
  const k = 1 / Math.sqrt(e / 2 + 1e-9) * 0.5;
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i += 1) d[i] *= k;
  }
  return buf;
}

// Ping-pong delay: alternating left and right repeats, each a little darker.
export function makePingPong(ctx, timeS, feedback, toneHz) {
  const input = ctx.createGain();
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const left = ctx.createDelay(2);
  const right = ctx.createDelay(2);
  left.delayTime.value = timeS;
  right.delayTime.value = timeS;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = toneHz;
  const merger = ctx.createChannelMerger(2);
  const output = ctx.createGain();
  input.connect(left);
  left.connect(merger, 0, 0);
  left.connect(right);
  right.connect(merger, 0, 1);
  right.connect(tone);
  tone.connect(fb);
  fb.connect(left);
  merger.connect(output);
  return { input, output };
}

// tanh curve for the bass saturation; drive above 1 adds harmonics.
function driveCurve(drive) {
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

function makeNoise(ctx) {
  const n = Math.floor(2 * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) d[i] = Math.random() * 2 - 1;
  return buf;
}
