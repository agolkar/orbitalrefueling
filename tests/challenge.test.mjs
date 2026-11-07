// tests/challenge.test.mjs
// Capture challenge tests: client drift, relative geometry, capture window, probe entry,
// failures and a player who holds keys. No test framework.

import { ORBITS, CAPTURE, CHALLENGE } from '../src/config.js';
import { createFlight, stepFlight, queuePulse, pulseBurnActive } from '../src/physics/flight.js';
import { ChaserVehicle } from '../src/physics/vehicle.js';
import {
  levelById,
  clientAxis,
  clientOmega,
  trackingAttitude,
  startState,
  relativeState,
  windowChecks,
  recommendedMps,
  createChallenge,
  updateChallenge,
  retractStep,
  NOZZLE_ENTRY_M,
  levelFor,
  scenarioById,
  rollStep,
  ROLL_ACCEL_RADS2
} from '../src/game/challenge.js';
import { solarVisibility, sunDirectionAtTime, shadowEntryLocalTimeHours, startLocalTimeBeforeSunset } from '../src/physics/environment.js';

function assertTrue(c, m) {
  if (!c) throw new Error(m);
}
function assertClose(a, e, tol, m) {
  if (!Number.isFinite(a) || Math.abs(a - e) > tol) throw new Error(`${m}: actual=${a}, expected=${e}, tol=${tol}`);
}

const n = ORBITS.GEO.nRadPerS;

// Servicer placed in the client frame of a level at time t (aligned, given velocity).
function placed(level, dM, y = 0, z = 0, v = { x: 0, y: 0, z: 0 }) {
  const vehicle = new ChaserVehicle();
  vehicle.attitude = trackingAttitude(level, 0);
  vehicle.heldAttitude = { ...vehicle.attitude };
  const flight = createFlight({ x: dM + CAPTURE.axisOffsetM, y, z, vx: v.x, vy: v.y, vz: v.z });
  return { flight, vehicle };
}

function run(ch, flight, vehicle, seconds, capture = false) {
  const h = 1 / 60;
  for (let t = 0; t < seconds && ch.phase !== 'success' && ch.phase !== 'failed'; t += h) {
    vehicle.heldAttitude = trackingAttitude(ch.level, ch.t);
    let res = { forceBodyN: { x: 0, y: 0, z: 0 } };
    if (ch.phase === 'retracting') retractStep(ch, flight, vehicle, h);
    else res = stepFlight(flight, vehicle, {}, h, n);
    updateChallenge(ch, flight, vehicle, h, { capture: capture && t === 0, forceBodyN: res.forceBodyN });
  }
}

// A player who taps whole 0.1 s pulses once per reaction time, and in scenarios with a spinning
// client holds U or O for a moment to match the spin.
function play(id, scenario = CHALLENGE.scenarios[0]) {
  const level = levelFor(id, scenario);
  const nOrbit = ORBITS[scenario.orbit].nRadPerS;
  const { flight, vehicle } = startState(level);
  const ch = createChallenge(level, vehicle.deltaVUsedMps);
  const h = 1 / 60;
  let decide = 0;
  let rollHold = 0;
  let rollSign = 0;
  while (ch.phase !== 'success' && ch.phase !== 'failed' && ch.t < 300) {
    if (level.rollControl && (ch.phase === 'fly' || ch.phase === 'extending')) {
      rollStep(ch, rollHold > 0 ? rollSign : 0, h);
      rollHold -= h;
    }
    vehicle.heldAttitude = trackingAttitude(level, ch.t, ch.rollRad);
    let res = { forceBodyN: { x: 0, y: 0, z: 0 } };
    if (ch.phase === 'retracting') retractStep(ch, flight, vehicle, h);
    else res = stepFlight(flight, vehicle, {}, h, nOrbit);
    const rs = ch.rs || relativeState(level, flight, vehicle, ch.t);
    let capture = false;
    decide -= h;
    if (decide <= 0 && (ch.phase === 'fly' || ch.phase === 'extending')) {
      decide = 0.25;
      if (level.rollControl && rollHold <= 0) {
        const r = rs.rollRateSignedDegS * Math.PI / 180;
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
        if (k > 0) queuePulse(flight, vehicle, axis, Math.sign(e), k * acc * 0.1);
      };
      if (!pulseBurnActive(flight)) {
        tap('x', want - rs.closingMps);
        for (const a of ['y', 'z']) tap(a, Math.max(-0.03, Math.min(0.03, -rs.offsetBody[a] / 8)) - rs.velocityBody[a]);
      }
      const c = windowChecks(rs);
      capture = ch.phase === 'fly' && c.distance && c.centred && c.speed && c.aligned && rs.lateralSpeedMps < 0.006;
    }
    updateChallenge(ch, flight, vehicle, h, { capture, forceBodyN: res.forceBodyN });
  }
  return ch;
}

export const tests = [
  {
    name: '31 Challenge: the client nozzle axis cones',
    fn() {
      const l = levelById(3);
      for (const t of [0, 20, 45, 70]) {
        const a = clientAxis(l, t);
        assertClose(Math.acos(a.x) * 180 / Math.PI, l.coneDeg, 1e-9, `cone angle at ${t} s`);
      }
      const a0 = clientAxis(l, 0);
      const a1 = clientAxis(l, l.conePeriodS);
      assertClose(Math.hypot(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z), 0, 1e-9, 'one period brings the axis back');
      const w = clientOmega(l, 10);
      const expected = 2 * Math.PI / l.conePeriodS * Math.sin(l.coneDeg * Math.PI / 180);
      assertClose(Math.hypot(w.x, w.y, w.z), expected, 0.05 * expected, 'axis angular rate');
    }
  },
  {
    name: '32 Challenge: relative state at the start of level 2',
    fn() {
      const l = levelById(2);
      const { flight, vehicle } = startState(l);
      const rs = relativeState(l, flight, vehicle, 0);
      assertClose(rs.dM, l.startDm, 1e-9, 'd');
      assertClose(rs.lateralM, Math.hypot(l.offset.y, l.offset.z), 1e-9, 'tip offset from the axis');
      assertClose(rs.closingMps, -l.velocity.x, 1e-9, 'closing speed');
      assertClose(rs.angleDeg, 0, 1e-4, 'docking axis along the nozzle axis');
      assertTrue(recommendedMps(1.0) === 0.02 && recommendedMps(9) === 0.10, 'recommended speed range');
    }
  },
  {
    name: '33 Challenge: capture window and NO GO',
    fn() {
      const l = levelById(1);
      const a = placed(l, 1.05);
      const rs = relativeState(l, a.flight, a.vehicle, 0);
      const c = windowChecks(rs);
      assertTrue(c.distance && c.centred && c.speed && c.aligned, 'centred at rest at 1.05 m is inside the window');
      const b = placed(l, 1.4);
      const ch = createChallenge(l);
      updateChallenge(ch, b.flight, b.vehicle, 1 / 60, { capture: true });
      assertTrue(ch.phase === 'fly' && ch.message.startsWith('NO GO'), `NO GO at 1.4 m, got ${ch.phase} ${ch.message}`);
    }
  },
  {
    name: '34 Challenge: probe enters the nozzle and the vehicles dock',
    fn() {
      const l = levelById(1);
      const a = placed(l, 1.05, 0.03, 0, { x: -0.01, y: 0, z: 0 });
      const ch = createChallenge(l);
      run(ch, a.flight, a.vehicle, 30, true);
      assertTrue(ch.phase === 'success', `expected success, got ${ch.phase}: ${ch.result && ch.result.reason}`);
      assertTrue(ch.result.stars >= 1 && ch.result.score > 0, 'scored');
      const rs = relativeState(l, a.flight, a.vehicle, ch.t);
      assertClose(rs.dM, 0.5, 2e-3, 'docked d');
    }
  },
  {
    name: '35 Challenge: a sideways drift makes the probe hit the rim',
    fn() {
      const l = levelById(1);
      // 9 cm off the axis and drifting outward at 1.5 cm/s: inside the window, but the tip
      // reaches the exit plane about 2.5 s later 13 cm off the axis.
      const a = placed(l, 1.05, 0.09, 0, { x: 0, y: 0.015, z: 0 });
      const ch = createChallenge(l);
      run(ch, a.flight, a.vehicle, 10, true);
      assertTrue(ch.phase === 'failed' && /rim/.test(ch.result.reason), `expected a rim hit, got ${ch.phase}: ${ch.result && ch.result.reason}`);
      assertTrue(NOZZLE_ENTRY_M > 0.11 && NOZZLE_ENTRY_M < 0.14, 'entry radius');
    }
  },
  {
    name: '36 Challenge: contact and time-out end the attempt',
    fn() {
      const l = levelById(1);
      const a = placed(l, 1.2, 0, 0, { x: -0.05, y: 0, z: 0 });
      const ch = createChallenge(l);
      run(ch, a.flight, a.vehicle, 30);
      assertTrue(ch.phase === 'failed' && /Contact/.test(ch.result.reason), `contact: ${ch.result && ch.result.reason}`);
      const b = placed(l, 5);
      const ch2 = createChallenge(l);
      run(ch2, b.flight, b.vehicle, l.timeS + 2);
      assertTrue(ch2.phase === 'failed' && /Time/.test(ch2.result.reason), `time-out: ${ch2.result && ch2.result.reason}`);
    }
  },
  {
    name: '37 Challenge: every capture level can be won within its time by tapping keys',
    fn() {
      for (const level of CHALLENGE.levels.filter((l) => !l.docked)) {
        const ch = play(level.id);
        assertTrue(ch.phase === 'success', `level ${level.id}: ${ch.phase}, ${ch.result && ch.result.reason}`);
        assertTrue(ch.captureT <= level.timeS && level.timeS <= 120, `level ${level.id} capture at ${ch.captureT} s`);
        assertTrue(ch.result.deltaVMps < level.budgetMps, `level ${level.id} within budget`);
      }
    }
  },
  {
    name: '38 Scenarios: start times for a sunset after a given time (low Earth orbit)',
    fn() {
      // Used by a scenario with sunsetAfterS: the Sun sets that long after the start.
      const o = ORBITS.LEO;
      const h0 = startLocalTimeBeforeSunset(o, 60);
      const vis = (t) => solarVisibility({ x: o.aM, y: 0, z: 0 }, sunDirectionAtTime(o.defaultBetaRad, h0, o.nRadPerS, t));
      assertTrue(vis(0) > 0.99 && vis(50) > 0.99, 'daylight at the start');
      assertClose(vis(60), 0.5, 0.05, 'half the Sun after 60 s');
      assertTrue(vis(70) < 0.01, 'dark 10 s later');
      assertTrue(shadowEntryLocalTimeHours(ORBITS.GEO) === null, 'no eclipse in the graveyard orbit at beta -9.26 deg');
      assertTrue(scenarioById('leo').orbit === 'LEO', 'the second scenario flies in low Earth orbit');
    }
  },
  {
    name: '39 Scenarios: the non-cooperative client spins, and a matched roll cancels it',
    fn() {
      const scen = scenarioById('tumble');
      const level = levelFor(1, scen);
      assertClose(level.budgetMps, levelById(1).budgetMps * scen.budgetScale, 1e-12, 'scaled budget');
      const w = clientOmega(level, 10);
      assertClose(w.x * 180 / Math.PI, scen.spinDegS, 0.03, 'spin about the engine axis');
      // Servicer on the axis with the guidance attitude and no roll: it sees the full spin.
      const { flight, vehicle } = startState(level);
      vehicle.attitude = trackingAttitude(level, 10);
      vehicle.bodyRatesRadPerS = { x: 0, y: 0, z: 0 };
      let rs = relativeState(level, flight, vehicle, 10);
      assertClose(Math.abs(rs.rollRateSignedDegS), scen.spinDegS, 0.05, 'relative roll before matching');
      assertTrue(rs.rollRateSignedDegS > 0, 'U is the key that matches this spin');
      // Rolling at minus the spin rate about body X cancels it.
      vehicle.bodyRatesRadPerS = { x: -scen.spinDegS * Math.PI / 180, y: 0, z: 0 };
      rs = relativeState(level, flight, vehicle, 10);
      assertTrue(rs.rollRateDegS < 0.05, `relative roll after matching ${rs.rollRateDegS}`);
      // A held roll key changes the commanded rate by 44 N m / Ixx per second.
      const ch = createChallenge(level);
      rollStep(ch, -1, 1);
      assertClose(ch.rollRateRadS, -44 / 4300, 1e-9, 'roll command after 1 s of U');
    }
  },
  {
    name: '40 Scenarios: every capture level can be won in every scenario',
    fn() {
      for (const scen of CHALLENGE.scenarios) {
        for (const l of CHALLENGE.levels.filter((lv) => !lv.docked)) {
          const ch = play(l.id, scen);
          const tag = `${scen.id} level ${l.id}`;
          assertTrue(ch.phase === 'success', `${tag}: ${ch.phase}, ${ch.result && ch.result.reason}`);
          assertTrue(ch.captureT <= l.timeS, `${tag} capture at ${ch.captureT} s`);
          assertTrue(ch.result.deltaVMps < ch.level.budgetMps, `${tag} within budget`);
        }
      }
    }
  }
];

export default tests;
