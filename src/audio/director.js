// src/audio/director.js
// Decides what the player hears, frame by frame, from a snapshot of the game: the voice callouts,
// the effects, the continuous sounds (thrusters, arm, flow) and the music intensity. Pure logic:
// it calls an output object and never touches Web Audio, so the tests run it in Node.
//
// The voice stays sparse: range callouts once per attempt, warnings at most every few seconds,
// one line for each step of a procedure and for the outcome. The coach panel keeps the detail.
//
// out: { say(id, priority), sfx(name, opts), loop(name, level), music({ intensity, muffled }) }
//
// Snapshot (built by main.js each frame):
//   screen       'menu' | 'about' | 'brief' | 'countdown' | 'fly' | 'paused' | 'result'
//   countdown    3, 2, 1 during the countdown
//   kind         'capture' | 'connect' | 'transfer' | 'departure'
//   timeLeftS    seconds left in the attempt
//   capture      { phase, dM, startDm, closingMps, recMps, allGreen, entered, message, messageS,
//                  thrust (0..1), pulses, braking, impingement, rollControl, rollRelDegS, dvFrac }
//   despin       { active } while the docked stack slows its spin (spinning clients)
//   connect      { phase, pose: { joint1Rad, joint2Rad, strokeM }, overValve, contact, capRemovingS,
//                  capRemoved, message, messageS }
//   transfer     { phase, leakState, openCount, running, opening, deliveredKg, goalLowKg, goalHighKg,
//                  clientPressureBar, maxPressureBar, message, messageS }
//   departure    { phase, safe, planMps, fastForward, message, messageS }
//   result       { success, reason } on the result screen

import { PRIORITY } from './lines.js';

const P = PRIORITY;
const RANGES_M = [5, 3, 2];
const JOINT_RATE_MAX = (5 * Math.PI) / 180; // rad/s, the arm joints at full speed
const STROKE_RATE_MAX = 0.02; // m/s, the tool stroke at full speed

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Voice line for a failed attempt, from the reason the level gives.
export function failLine(reason = '') {
  const r = reason.toLowerCase();
  if (r.includes('contact before capture')) return 'contact';
  if (r.includes('rim') || r.includes('did not reach')) return 'missed';
  if (r.includes('drifted away')) return 'driftAway';
  if (r.includes('rcs budget')) return 'budgetOut';
  if (r.startsWith('time is up')) return 'timeUp';
  if (r.includes('struck')) return 'strike';
  if (r.includes('leak check failed')) return 'leakFail';
  if (r.includes('overpressure')) return 'overpressure';
  if (r.includes('overfilled')) return 'overfill';
  if (r.includes(' hit ') || r.includes('touched')) return 'collision';
  return 'failed';
}

// Effect for a failed attempt: a collision sounds like one, a procedure fault sets off the alarm.
export function failSfx(line) {
  if (['contact', 'missed', 'strike', 'collision'].includes(line)) return 'impact';
  if (['leakFail', 'overpressure', 'overfill'].includes(line)) return 'alarm';
  return null;
}

// A message the level has just shown: new text, or the same text shown again.
function freshMessage(cur, prev) {
  if (!cur || !cur.message || !(cur.messageS > 0)) return null;
  if (!prev || prev.message !== cur.message || cur.messageS > prev.messageS + 1e-6) return cur.message;
  return null;
}

export class AudioDirector {
  constructor(out) {
    this.out = out;
    this.t = 0;
    this.prev = {};
    this.said = new Set();
    this.lastSaid = {};
    this.flags = {};
    this.flyS = 0; // seconds since the attempt started
  }

  // Callouts that come once per attempt start again.
  newAttempt() {
    this.said.clear();
    this.lastSaid = {};
    this.flags = {};
    this.flyS = 0;
  }

  say(id, priority = P.info, { once = false, cooldownS = 0 } = {}) {
    if (once && this.said.has(id)) return false;
    if (cooldownS > 0 && this.lastSaid[id] !== undefined && this.t - this.lastSaid[id] < cooldownS) return false;
    this.said.add(id);
    this.lastSaid[id] = this.t;
    this.out.say(id, priority);
    return true;
  }

  loopsOff() {
    for (const name of ['rcs', 'motor', 'servo', 'flow', 'hiss']) this.out.loop(name, 0);
  }

  update(dtS, s) {
    this.t += dtS;
    const p = this.prev;
    if (s.screen !== p.screen) this.screenChange(p, s);
    if (s.screen === 'countdown' && s.countdown && s.countdown !== p.countdown) this.out.sfx('beep');
    if (s.screen === 'fly') {
      this.flyS += dtS;
      if (s.kind === 'capture' && s.capture) this.capture(dtS, s, p);
      else if (s.kind === 'connect' && s.connect) this.connect(dtS, s, p);
      else if (s.kind === 'transfer' && s.transfer) this.transfer(s, p);
      else if (s.kind === 'departure' && s.departure) this.departure(s, p);
      this.clock(s, p);
    }
    this.prev = s;
  }

  screenChange(p, s) {
    const to = s.screen;
    if (to === 'countdown') {
      this.newAttempt();
      this.loopsOff();
      this.out.music({ intensity: 0.3, muffled: false });
    } else if (to === 'fly') {
      if (p.screen === 'countdown') {
        this.out.sfx('go');
        if (s.kind === 'departure') {
          this.out.sfx('undock');
          this.say('undocking');
        }
      }
      this.out.music({ muffled: false });
    } else if (to === 'paused') {
      this.loopsOff();
      this.out.music({ muffled: true });
    } else if (to === 'result') {
      this.loopsOff();
      this.result(s);
    } else {
      // menu, about, brief
      this.loopsOff();
      if (to === 'brief') this.out.sfx('select');
      this.out.music({ intensity: 0.5, muffled: false });
    }
  }

  result(s) {
    const r = s.result || { success: false, reason: '' };
    if (r.success) {
      // The last step of the level happens in the frame that opens the result: its sound plays here.
      if (s.kind === 'capture' && !this.said.has('docked')) {
        this.out.sfx('clunk');
        this.say('docked', P.warning);
      }
      if (s.kind === 'connect') this.out.sfx('mate');
      if (s.kind === 'transfer') this.out.sfx('valveClose');
      this.out.sfx('success');
      const line = { connect: 'mated', transfer: 'transferDone', departure: 'departed' }[s.kind];
      if (line) this.say(line, P.warning);
      this.out.music({ intensity: 0.32, muffled: false });
    } else {
      const line = failLine(r.reason);
      const fx = failSfx(line);
      if (fx) this.out.sfx(fx);
      this.out.sfx('fail');
      this.say(line, P.critical);
      this.out.music({ intensity: 0.15, muffled: false });
    }
  }

  // Seconds left: callouts at 30 s and 10 s, a soft tick in the last five seconds.
  clock(s, p) {
    const t = s.timeLeftS;
    const tp = p.screen === 'fly' ? p.timeLeftS : undefined;
    if (t === undefined || tp === undefined) return;
    if (tp > 30 && t <= 30) this.say('t30', P.info, { once: true });
    if (tp > 10 && t <= 10) this.say('t10', P.warning, { once: true });
    if (t <= 5 && t > 0 && Math.ceil(t) !== Math.ceil(tp)) this.out.sfx('tick');
  }

  capture(dtS, s, p) {
    const c = s.capture;
    const pc = p.screen === 'fly' && p.capture ? p.capture : null;

    // Thrusters: a hiss while firing, a thump for every tap.
    this.out.loop('rcs', s.despin && s.despin.active ? 0.45 : c.thrust);
    if (c.pulses > 0) this.out.sfx('pulse');

    // The probe: the motor runs while it extends and while it pulls the two spacecraft together.
    this.out.loop('motor', c.phase === 'extending' ? 1 : c.phase === 'retracting' ? 0.6 : 0);

    if (pc && pc.phase !== c.phase) {
      if (c.phase === 'extending') this.say('probe');
      if (c.phase === 'retracting') {
        this.out.sfx('latch');
        this.say('softCapture');
      }
      if (c.phase === 'success') {
        this.out.sfx('clunk');
        this.say('docked', P.warning);
        if (s.despin) this.say('despin');
      }
    }
    if (pc && c.entered && !pc.entered) this.out.sfx('touch');

    const msg = freshMessage(c, pc);
    if (msg && msg.startsWith('NO GO')) {
      this.out.sfx('nogo');
      this.say('noGo', P.warning, { cooldownS: 2 });
    }

    if (c.phase === 'fly' && pc) {
      for (const r of RANGES_M) {
        // Not the distance the attempt starts at (level 1 starts at 5 m).
        if (pc.dM > r && c.dM <= r && c.startDm > r + 0.3) this.say(`range${r}`, P.info, { once: true });
      }
      if (c.allGreen && !pc.allGreen) {
        this.out.sfx('chime');
        this.say('window', P.info, { cooldownS: 8 });
      }
      // Too fast for the distance (after the first second, so that the player hears the start first).
      if (this.flyS > 0.8 && c.closingMps > c.recMps + 0.012 && c.dM > 1.0) {
        this.say('tooFast', P.warning, { cooldownS: 10 });
      }
      if (c.dM < 0.85) this.say('tooClose', P.warning, { cooldownS: 10 });
      if (c.impingement && c.braking && c.dM < 2) this.say('plume', P.warning, { cooldownS: 8 });
      if (c.rollControl && Math.abs(c.rollRelDegS) > 0.5 && c.dM < 4) this.say('matchSpin', P.info, { cooldownS: 20 });
      if (pc.dvFrac < 0.8 && c.dvFrac >= 0.8) this.say('fuelLow', P.warning, { once: true });
    }

    // Music: calm far out, building towards the capture point.
    let x = 0.28;
    if (c.startDm > 1) x += 0.4 * clamp((c.startDm - c.dM) / (c.startDm - 1), 0, 1);
    if (c.allGreen || c.phase === 'extending' || c.phase === 'retracting') x += 0.15;
    if (s.despin && s.despin.active) x = 0.45;
    this.out.music({ intensity: x });
  }

  connect(dtS, s, p) {
    const c = s.connect;
    const pc = p.screen === 'fly' && p.connect ? p.connect : null;
    if (pc && dtS > 0) {
      const jr = (Math.abs(c.pose.joint1Rad - pc.pose.joint1Rad) + Math.abs(c.pose.joint2Rad - pc.pose.joint2Rad)) / dtS;
      const sr = Math.abs(c.pose.strokeM - pc.pose.strokeM) / dtS;
      this.out.loop('servo', clamp(jr / JOINT_RATE_MAX + sr / STROKE_RATE_MAX, 0, 1));
    }
    if (!pc) return;
    if (c.capRemovingS > 0 && !(pc.capRemovingS > 0)) this.out.sfx('ratchet', { durationS: c.capRemovingS });
    if (c.capRemoved && !pc.capRemoved) {
      this.out.sfx('capOff');
      this.say('capOff');
    }
    if (c.overValve && !pc.overValve) this.say('overValve', P.info, { once: true });
    if (c.contact && c.contact !== pc.contact) this.out.sfx('touch');
    const msg = freshMessage(c, pc);
    if (msg && msg.startsWith('NO GO')) {
      this.out.sfx('nogo');
      this.say('noGo', P.warning, { cooldownS: 3 });
    }
    this.out.music({ intensity: 0.32 + (c.overValve ? 0.2 : 0) + (c.contact ? 0.1 : 0) });
  }

  transfer(s, p) {
    const tr = s.transfer;
    const pt = p.screen === 'fly' && p.transfer ? p.transfer : null;
    this.out.loop('flow', tr.running ? 0.35 + 0.65 * tr.opening : 0);
    this.out.loop('hiss', tr.leakState === 'holding' ? 0.5 : 0);
    if (!pt) return;
    if (tr.leakState !== pt.leakState) {
      if (tr.leakState === 'holding') this.say('leakCheck');
      if (tr.leakState === 'passed') {
        this.out.sfx('chime');
        this.say('leakPass');
      }
    }
    const msg = freshMessage(tr, pt);
    if (msg) {
      if (/ open$/.test(msg)) this.out.sfx('valveOpen');
      else if (/ closed$/.test(msg)) this.out.sfx('valveClose');
      else if (msg.startsWith('Fault')) this.out.sfx('alarm', { short: true });
      else if (msg.startsWith('NO GO')) this.out.sfx('nogo');
    }
    if (tr.openCount === 3 && pt.openCount < 3) this.say('lineOpen');
    if (tr.running && !pt.running) this.say('flowOn');
    if (!tr.running && pt.running) this.say('flowOff');
    if (tr.running && pt.deliveredKg < 140 && tr.deliveredKg >= 140) this.say('nearGoal', P.warning, { once: true });
    const inBand = (x) => x.deliveredKg >= x.goalLowKg && x.deliveredKg <= x.goalHighKg;
    if (tr.running && inBand(tr) && !inBand(pt)) this.say('inBand', P.warning, { once: true });
    const high = tr.maxPressureBar - 1.5;
    if (pt.clientPressureBar < high && tr.clientPressureBar >= high) this.say('pressureHigh', P.warning, { cooldownS: 10 });
    this.out.music({ intensity: 0.38 + (tr.running ? 0.22 : 0) });
  }

  departure(s, p) {
    const d = s.departure;
    const pd = p.screen === 'fly' && p.departure ? p.departure : null;
    if (!pd) return;
    if (d.phase !== pd.phase) {
      if (d.phase === 'plan') this.say('separated');
      if (d.phase === 'coast') {
        this.out.sfx('burn', { durationS: 1.4 });
        this.say('burnDone');
        if (d.fastForward > 1) this.out.sfx('warp');
      }
    }
    if (d.phase === 'plan' && d.safe && !pd.safe && d.planMps > 0) {
      this.out.sfx('chime');
      this.say('safe', P.info, { cooldownS: 6 });
    }
    const msg = freshMessage(d, pd);
    if (msg && msg.startsWith('NO GO')) {
      this.out.sfx('nogo');
      if (msg.includes('UNSAFE')) this.say('unsafe', P.warning, { cooldownS: 3 });
      else if (msg.includes('budget')) this.say('overBudget', P.warning, { cooldownS: 3 });
    }
    this.out.music({ intensity: d.phase === 'coast' ? 0.55 : d.phase === 'plan' ? 0.42 : 0.38 });
  }
}
