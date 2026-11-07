// tests/audio.test.mjs
// Sound tests: the director (what plays when), the voice queue, the failure lines and the voice
// files. The director is fed with the same snapshots main.js builds, from scripted attempts that
// use the real game modules. No Web Audio here.

import { ORBITS, CHALLENGE, CHASER } from '../src/config.js';
import { stepFlight, queuePulse, pulseBurnActive } from '../src/physics/flight.js';
import {
  levelFor,
  scenarioById,
  trackingAttitude,
  startState,
  relativeState,
  windowChecks,
  recommendedMps,
  createChallenge,
  updateChallenge,
  retractStep,
  rollStep,
  createDespin,
  stepDespin,
  ROLL_ACCEL_RADS2
} from '../src/game/challenge.js';
import { AudioDirector, failLine, failSfx } from '../src/audio/director.js';
import { VoiceQueue } from '../src/audio/voice.js';
import { VOICE_LINES, PRIORITY } from '../src/audio/lines.js';

function assertTrue(c, m) {
  if (!c) throw new Error(m);
}

// Records what the director asks for.
function recorder() {
  const rec = { says: [], sfx: [], loops: {}, intensity: [] };
  rec.out = {
    say: (id, p) => rec.says.push({ id, p }),
    sfx: (name) => rec.sfx.push(name),
    loop: (name, level) => {
      rec.loops[name] = Math.max(rec.loops[name] || 0, level || 0);
    },
    music: (m) => {
      if (m.intensity !== undefined) rec.intensity.push(m.intensity);
    }
  };
  rec.ids = () => rec.says.map((s) => s.id);
  return rec;
}

// Index of each id in order inside the list (-1 if the order breaks).
function inOrder(list, ids) {
  let at = -1;
  for (const id of ids) {
    const i = list.indexOf(id, at + 1);
    if (i < 0) return false;
    at = i;
  }
  return true;
}

// The capture snapshot of main.js.
function captureSnap(screen, level, ch, vehicle, force, presses, countdown = 0, despin = null) {
  const s = { screen, kind: 'capture', countdown };
  if (screen === 'result') s.result = { success: ch.result.success, reason: ch.result.reason };
  const rs = ch.rs;
  if (rs) {
    const c = windowChecks(rs);
    s.timeLeftS = level.timeS - ch.t;
    s.capture = {
      phase: ch.phase,
      dM: rs.dM,
      startDm: level.startDm,
      closingMps: rs.closingMps,
      recMps: recommendedMps(rs.dM),
      allGreen: c.distance && c.centred && c.speed && c.aligned,
      entered: ch.entered,
      message: ch.message,
      messageS: ch.messageS,
      thrust: screen === 'fly' ? Math.min(1, Math.hypot(force.x, force.y, force.z) / CHASER.rcsTranslationForceN) : 0,
      pulses: presses,
      braking: force.x < 0,
      impingement: !!level.impingement,
      rollControl: !!level.rollControl,
      rollRelDegS: rs.rollRateSignedDegS,
      dvFrac: (vehicle.deltaVUsedMps - ch.dvStart) / level.budgetMps
    };
    s.despin = despin ? { active: !despin.done } : null;
  }
  return s;
}

// A whole capture attempt as the game runs it: brief, countdown, flight with a scripted pilot
// (the one of tests/challenge.test.mjs), de-spin when the client spins, result.
function playCapture(id, scenarioId = 'geo', { lazyS = 0 } = {}) {
  const scenario = scenarioById(scenarioId);
  const level = levelFor(id, scenario);
  const nOrbit = ORBITS[scenario.orbit].nRadPerS;
  const { flight, vehicle } = startState(level);
  const ch = createChallenge(level, vehicle.deltaVUsedMps);
  ch.rs = relativeState(level, flight, vehicle, 0);
  const rec = recorder();
  const dir = new AudioDirector(rec.out);
  const h = 1 / 60;
  const zero = { x: 0, y: 0, z: 0 };
  dir.update(h, captureSnap('brief', level, ch, vehicle, zero, 0));
  for (let t = 3; t > 0; t -= h) dir.update(h, captureSnap('countdown', level, ch, vehicle, zero, 0, Math.ceil(t)));
  let decide = 0;
  let rollHold = 0;
  let rollSign = 0;
  let despin = null;
  while (ch.phase !== 'failed' && ch.t < 300) {
    if (ch.phase === 'success') {
      if (!despin) break;
      stepDespin(despin, h);
      if (despin.done) break;
      dir.update(h, captureSnap('fly', level, ch, vehicle, zero, 0, 0, despin));
      continue;
    }
    if (level.rollControl && (ch.phase === 'fly' || ch.phase === 'extending')) {
      rollStep(ch, rollHold > 0 ? rollSign : 0, h);
      rollHold -= h;
    }
    vehicle.heldAttitude = trackingAttitude(level, ch.t, ch.rollRad);
    let res = { forceBodyN: zero };
    if (ch.phase === 'retracting') retractStep(ch, flight, vehicle, h);
    else res = stepFlight(flight, vehicle, {}, h, nOrbit);
    const rs = ch.rs;
    let capture = false;
    let presses = 0;
    decide -= h;
    if (decide <= 0 && ch.t >= lazyS && (ch.phase === 'fly' || ch.phase === 'extending')) {
      decide = 0.25;
      if (level.rollControl && rollHold <= 0) {
        const r = (rs.rollRateSignedDegS * Math.PI) / 180;
        if (Math.abs(r) > 0.0015) {
          rollSign = -Math.sign(r);
          rollHold = Math.min(1.0, Math.max(0.1, (0.7 * Math.abs(r)) / ROLL_ACCEL_RADS2));
        }
      }
      const near = rs.dM < 1.6;
      let want = near ? Math.max(-0.01, Math.min(0.017, (rs.dM - 1) / 6)) : 0.9 * recommendedMps(rs.dM);
      if (level.impingement && !near) want = Math.min(want, rs.dM < 3 ? 0.035 : 0.1);
      const acc = 44 / vehicle.massKg;
      const tap = (axis, e) => {
        if (Math.abs(e) < 0.004) return;
        const k = Math.min(Math.round(Math.abs(e) / (acc * 0.1)), 10);
        if (k > 0) {
          queuePulse(flight, vehicle, axis, Math.sign(e), k * acc * 0.1);
          presses += 1;
        }
      };
      if (!pulseBurnActive(flight)) {
        tap('x', want - rs.closingMps);
        for (const a of ['y', 'z']) tap(a, Math.max(-0.03, Math.min(0.03, -rs.offsetBody[a] / 8)) - rs.velocityBody[a]);
      }
      const c = windowChecks(rs);
      capture = ch.phase === 'fly' && c.distance && c.centred && c.speed && c.aligned && rs.lateralSpeedMps < 0.006;
    }
    updateChallenge(ch, flight, vehicle, h, { capture, forceBodyN: res.forceBodyN });
    if (ch.phase === 'success' && level.spinDegS > 0) despin = createDespin(level, ch.t);
    const ended = ch.phase === 'failed' || (ch.phase === 'success' && !despin);
    if (!ended) dir.update(h, captureSnap('fly', level, ch, vehicle, res.forceBodyN, presses, 0, despin));
  }
  dir.update(h, captureSnap('result', level, ch, vehicle, zero, 0));
  return { rec, ch, level };
}

// Feeds a list of [seconds, snapshot] to a director; every snapshot is held that long.
function run(dir, steps, h = 1 / 30) {
  for (const [dur, snap] of steps) {
    const n = Math.max(1, Math.round(dur / h));
    for (let i = 0; i < n; i += 1) dir.update(h, typeof snap === 'function' ? snap(i * h) : snap);
  }
}

export const tests = [
  {
    name: '56 Sound: a capture is called out in order, once each, with the thrusters and the probe heard',
    fn() {
      const { rec, ch } = playCapture(1);
      assertTrue(ch.phase === 'success', `the scripted capture succeeds (${ch.phase})`);
      const ids = rec.ids();
      assertTrue(inOrder(ids, ['range3', 'range2', 'window', 'probe', 'softCapture', 'docked']), `callouts in order: ${ids.join(' ')}`);
      for (const id of ['range3', 'range2', 'probe', 'softCapture', 'docked']) {
        assertTrue(ids.filter((x) => x === id).length === 1, `${id} once`);
      }
      assertTrue(ids.length <= 10, `a sparse voice: ${ids.length} lines (${ids.join(' ')})`);
      assertTrue(rec.sfx.filter((x) => x === 'beep').length === 3 && rec.sfx.includes('go'), 'three countdown beeps and the start tone');
      for (const fx of ['pulse', 'latch', 'clunk', 'success']) assertTrue(rec.sfx.includes(fx), `${fx} plays`);
      assertTrue(rec.loops.rcs > 0 && rec.loops.motor > 0, 'thrusters and probe motor heard');
      const first = rec.intensity.find((x) => x < 0.4);
      assertTrue(first !== undefined && Math.max(...rec.intensity) >= 0.65, 'the music builds towards the capture');
    }
  },
  {
    name: '57 Sound: warnings repeat at most every 10 s; the spinning client adds the de-spin line',
    fn() {
      // A pilot who reacts after 2.5 s: level 4 starts closing at 12 cm/s.
      const fast = playCapture(4, 'geo', { lazyS: 2.5 });
      assertTrue(fast.ch.phase === 'success', `level 4 still captured (${fast.ch.phase})`);
      const warn = fast.rec.says.filter((s) => s.id === 'tooFast');
      assertTrue(warn.length >= 1, 'level 4 arrives too fast: the brake callout plays');
      assertTrue(warn.length <= Math.ceil(fast.ch.t / 10) + 1, `brake callout not repeated faster than every 10 s (${warn.length} in ${fast.ch.t.toFixed(0)} s)`);
      assertTrue(warn[0].p === PRIORITY.warning, 'it is a warning');
      const spin = playCapture(1, 'tumble');
      assertTrue(spin.ch.phase === 'success', 'the spinning client is captured');
      const ids = spin.rec.ids();
      assertTrue(inOrder(ids, ['docked', 'despin']), `hard capture, then the de-spin: ${ids.join(' ')}`);
      assertTrue(ids.filter((x) => x === 'docked').length === 1, 'docked said once (not again at the result)');
    }
  },
  {
    name: '58 Sound: the docked levels call out each step of their procedure',
    fn() {
      // Level 5 Connect
      let rec = recorder();
      let dir = new AudioDirector(rec.out);
      const pose = (j) => ({ joint1Rad: j, joint2Rad: 2.8, strokeM: 0 });
      const con = (o) => ({ screen: 'fly', kind: 'connect', timeLeftS: 60, connect: { phase: 'fly', pose: pose(0), overValve: false, contact: null, capRemovingS: 0, capRemoved: false, message: '', messageS: 0, ...o } });
      run(dir, [
        [0.1, { screen: 'countdown', kind: 'connect', countdown: 1 }],
        [1, (t) => con({ pose: pose(0.05 * t) })],
        [0.5, con({ overValve: true })],
        [0.5, con({ overValve: false })],
        [0.5, con({ overValve: true })],
        [0.3, con({ overValve: true, contact: 'cap' })],
        [0.1, con({ overValve: true, contact: 'cap', message: 'NO GO: 14 mm off the valve axis, centre within 10 mm', messageS: 3 })],
        [0.5, (t) => con({ overValve: true, contact: 'cap', message: 'NO GO: 14 mm off the valve axis, centre within 10 mm', messageS: 2.9 - t })],
        [0.1, con({ overValve: true, contact: 'cap', capRemovingS: 3, message: 'Unscrewing the cap', messageS: 3 })],
        [0.5, con({ overValve: true, contact: null, capRemoved: true, message: 'Cap removed and stowed: lower the tool onto the valve (SHIFT + W), then SPACE mates', messageS: 4 })],
        [0.1, { screen: 'result', kind: 'connect', result: { success: true, reason: 'Connected: the tool is mated to the service valve.' } }]
      ]);
      let ids = rec.ids();
      assertTrue(rec.loops.servo > 0, 'the arm servos are heard');
      assertTrue(ids.filter((x) => x === 'overValve').length === 1, 'over the valve: once per attempt');
      assertTrue(ids.filter((x) => x === 'noGo').length === 1 && rec.sfx.includes('nogo'), 'NO GO heard once for one message');
      assertTrue(rec.sfx.includes('ratchet') && rec.sfx.includes('capOff') && rec.sfx.includes('touch'), 'cap: contact, ratchet, removal');
      assertTrue(inOrder(ids, ['overValve', 'capOff', 'mated']) && rec.sfx.includes('mate'), `connect lines in order: ${ids.join(' ')}`);

      // Level 6 Transfer
      rec = recorder();
      dir = new AudioDirector(rec.out);
      const base = { phase: 'fly', leakState: 'idle', openCount: 0, running: false, opening: 1, deliveredKg: 0, goalLowKg: 147, goalHighKg: 153, clientPressureBar: 16, maxPressureBar: 22, message: '', messageS: 0 };
      const tr = (o) => ({ screen: 'fly', kind: 'transfer', timeLeftS: 60, transfer: { ...base, ...o } });
      run(dir, [
        [0.2, tr({})],
        [0.5, tr({ leakState: 'holding', message: 'Leak check: helium at 15 bar against the closed valves, hold 30 s (1 s at 30x)', messageS: 2 })],
        [0.3, tr({ leakState: 'passed' })],
        [0.2, tr({ leakState: 'passed', openCount: 1, message: '1 servicer cargo isolation valve open', messageS: 2 })],
        [0.2, tr({ leakState: 'passed', openCount: 2, message: '2 line valve open', messageS: 2 })],
        [0.2, tr({ leakState: 'passed', openCount: 3, message: '3 client fill valve open', messageS: 2 })],
        [2, (t) => tr({ leakState: 'passed', openCount: 3, running: true, deliveredKg: 130 + 10 * t, clientPressureBar: 19.8 + 0.6 * t })],
        [0.3, tr({ leakState: 'passed', openCount: 3, running: false, deliveredKg: 150, clientPressureBar: 20.9 })],
        [0.1, { screen: 'result', kind: 'transfer', result: { success: true, reason: 'Refuelled: 150 kg delivered within 2 % and the line closed.' } }]
      ]);
      ids = rec.ids();
      assertTrue(inOrder(ids, ['leakCheck', 'leakPass', 'lineOpen', 'flowOn', 'nearGoal', 'inBand', 'flowOff', 'transferDone']), `transfer lines in order: ${ids.join(' ')}`);
      assertTrue(ids.includes('pressureHigh'), 'tank pressure warning');
      assertTrue(rec.sfx.filter((x) => x === 'valveOpen').length === 3, 'three valves heard opening');
      assertTrue(rec.loops.flow > 0 && rec.loops.hiss > 0, 'flow and leak-check hiss heard');

      // Level 7 Depart
      rec = recorder();
      dir = new AudioDirector(rec.out);
      const dep = (o) => ({ screen: 'fly', kind: 'departure', timeLeftS: 100, departure: { phase: 'undocking', safe: false, planMps: 0, fastForward: 100, message: '', messageS: 0, ...o } });
      run(dir, [
        [0.1, { screen: 'countdown', kind: 'departure', countdown: 1 }],
        [0.5, dep({})],
        [0.5, dep({ phase: 'plan' })],
        [0.2, dep({ phase: 'plan', planMps: 0.01, message: 'NO GO: the plan is UNSAFE, the burn was not executed', messageS: 3 })],
        [0.5, dep({ phase: 'plan', planMps: 0.03, safe: true })],
        [0.5, dep({ phase: 'coast', safe: true, planMps: 0.03, message: 'SAFE burn executed: fast-forward to 30 m', messageS: 3 })],
        [0.1, { screen: 'result', kind: 'departure', result: { success: true, reason: 'Safe departure: the range passed 30 m on a SAFE trajectory.' } }]
      ]);
      ids = rec.ids();
      assertTrue(inOrder(ids, ['undocking', 'separated', 'unsafe', 'safe', 'burnDone', 'departed']), `departure lines in order: ${ids.join(' ')}`);
      for (const fx of ['undock', 'burn', 'warp', 'success']) assertTrue(rec.sfx.includes(fx), `${fx} plays`);
    }
  },
  {
    name: '59 Sound: every failure has its line and effect; every line has its voice file',
    fn() {
      const cases = {
        'Contact before capture: the probe hit the nozzle.': 'contact',
        'The probe tip hit the nozzle rim, 7 cm off the axis.': 'missed',
        'The probe did not reach the nozzle.': 'missed',
        'You drifted away from the client.': 'driftAway',
        'The RCS budget for this approach is used up.': 'budgetOut',
        'Time is up: the Sun now glares into the docking camera.': 'timeUp',
        'Time is up: the ground-station pass has ended.': 'timeUp',
        'Time is up: the Sun now glares into the servicer cameras.': 'timeUp',
        'The tool struck the cap at 2.1 cm/s: touch below 1 cm/s.': 'strike',
        'The arm hit a stanchion of the docking mechanism.': 'collision',
        'The tool hit the client\'s engine nozzle.': 'collision',
        'The tool touched the client deck.': 'collision',
        'The leak check failed: the mated tool loses helium. The tool must be re-seated.': 'leakFail',
        'Overpressure: the client tank passed 22 bar.': 'overpressure',
        'Overfilled: 154.2 kg delivered, more than 150 kg + 2 %.': 'overfill',
        'Line closed with 140.0 kg delivered: the goal was 150 kg within 2 %.': 'failed'
      };
      for (const [reason, id] of Object.entries(cases)) {
        assertTrue(failLine(reason) === id, `"${reason}" -> ${failLine(reason)}, expected ${id}`);
        assertTrue(VOICE_LINES[id], `line ${id} exists`);
      }
      assertTrue(failSfx('contact') === 'impact' && failSfx('overfill') === 'alarm' && failSfx('timeUp') === null, 'failure effects');
      const rec = recorder();
      const dir = new AudioDirector(rec.out);
      run(dir, [[0.1, { screen: 'fly', kind: 'capture' }], [0.1, { screen: 'result', kind: 'capture', result: { success: false, reason: 'Contact before capture: the probe hit the nozzle.' } }]]);
      assertTrue(rec.says.length === 1 && rec.says[0].id === 'contact' && rec.says[0].p === PRIORITY.critical, 'a collision cuts in');
      assertTrue(rec.sfx.includes('impact') && rec.sfx.includes('fail'), 'impact and the failure tones');
      // Voice files (Node or Deno; skipped where neither file API is there).
      const missing = Object.keys(VOICE_LINES).filter((id) => !fileExists(`assets/voice/${id}.mp3`));
      assertTrue(missing.length === 0, `voice files missing: ${missing.join(', ')}`);
    }
  },
  {
    name: '60 Sound: the voice queue keeps lines apart, puts warnings first, drops stale ones, lets critical lines cut in',
    fn() {
      const q = new VoiceQueue();
      assertTrue(q.push('range3', PRIORITY.info, 0) === 'queued', 'queued');
      assertTrue(q.next(0) === 'range3', 'plays at once when free');
      q.started(0, 1.0);
      q.push('range2', PRIORITY.info, 0.5);
      assertTrue(q.next(0.6) === null && q.next(1.2) === null, 'waits for the line and the gap');
      assertTrue(q.next(1.4) === 'range2', 'then plays');
      q.started(1.4, 1.0);
      q.push('t30', PRIORITY.info, 1.5);
      q.push('tooFast', PRIORITY.warning, 1.6);
      assertTrue(q.next(2.8) === 'tooFast', 'the warning goes first');
      q.started(2.8, 3.0);
      assertTrue(q.next(6.2) === null, 'an info line waiting more than 2.5 s is dropped');
      q.push('a', PRIORITY.info, 7);
      assertTrue(q.push('a', PRIORITY.info, 7.1) === 'dropped', 'no duplicates in the queue');
      q.push('b', PRIORITY.info, 7.2);
      q.push('c', PRIORITY.info, 7.3);
      assertTrue(q.items.length === 2 && !q.items.some((it) => it.id === 'a'), 'at most two lines wait; the oldest goes');
      assertTrue(q.push('contact', PRIORITY.critical, 7.4) === 'now' && q.items.length === 0, 'a critical line cuts in and clears the queue');
    }
  }
];

function fileExists(rel) {
  const url = new URL(`../${rel}`, import.meta.url);
  if (typeof Deno !== 'undefined') {
    try {
      Deno.statSync(url);
      return true;
    } catch (e) {
      return false;
    }
  }
  const proc = typeof process !== 'undefined' ? process : null;
  const fs = proc && proc.getBuiltinModule ? proc.getBuiltinModule('fs') : null;
  if (!fs) return true;
  return fs.existsSync(url);
}

export default tests;
