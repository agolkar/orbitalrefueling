// tests/rules.test.mjs
// Rules tests for Stage 4. No test framework.

import { ORBITS, CAPTURE, RULES, SCORING } from '../src/config.js';
import {
  captureWindow,
  captureScore,
  collisionCheck,
  selectCamDirection,
  departureCheck,
  speedLimitMps,
  envelopeCheck,
  insideKos,
  insideCorridor,
  rangeM,
  rangeRateMps,
  relativeSpeedMps,
  deltaVScore,
  refuelScore,
  departureScore,
  grade
} from '../src/game/rules.js';
import {
  createMission,
  stepMission,
  startCapture,
  applyCamImpulse,
  resumeAfterCam,
  planDeparture,
  computeScore,
  setRefuelResult
} from '../src/game/mission.js';
import { propagateClosedForm } from '../src/physics/cw.js';

function fail(message) {
  throw new Error(message);
}

function assertTrue(condition, message) {
  if (!condition) fail(message);
}

function assertClose(actual, expected, tolerance, message) {
  if (!Number.isFinite(actual)) fail(`${message}: actual is not finite (${actual})`);
  const err = Math.abs(actual - expected);
  if (err > tolerance) fail(`${message}: actual=${actual}, expected=${expected}, err=${err}, tol=${tolerance}`);
}

function state(x, y, z, vx, vy, vz) {
  return { x, y, z, vx, vy, vz };
}

// Alignment object with the same shape the flight module returns.
function al(d, lateral, pitchYaw, roll, pyRate, rollRate, speed) {
  return {
    rangeM: 0,
    rangeRateMps: 0,
    relativeSpeedMps: speed,
    dM: d,
    lateralM: lateral,
    pitchYawDeg: pitchYaw,
    rollDeg: roll,
    pitchYawRateDegS: pyRate,
    rollRateDegS: rollRate
  };
}

export const tests = [
  {
    name: 'R1 Capture window READY',
    fn() {
      const win = captureWindow(al(1.0, 0.05, 2.0, 2.0, 0.10, 0.10, 0.01));
      assertTrue(win.ready, `expected READY, reason=${win.reason}`);
      assertTrue(win.reason === null, 'no reason');
    }
  },
  {
    name: 'R2 Capture window lateral failure',
    fn() {
      const win = captureWindow(al(1.0, 0.15, 2.0, 2.0, 0.10, 0.10, 0.01));
      assertTrue(!win.ready, 'expected NOT_READY');
      assertTrue(win.reason === 'lateral', `reason=${win.reason}`);
    }
  },
  {
    name: 'R3 Capture window speed failure',
    fn() {
      const win = captureWindow(al(1.0, 0.05, 2.0, 2.0, 0.10, 0.10, 0.05));
      assertTrue(!win.ready, 'expected NOT_READY');
      assertTrue(win.reason === 'speed', `reason=${win.reason}`);
    }
  },
  {
    name: 'R4 Body contact at 0.35 m/s is a collision',
    fn() {
      const c = collisionCheck(state(3.0, 0, 0, 0.35, 0, 0), 0.35);
      assertTrue(c.collision, 'expected collision');
      assertTrue(c.reason === 'speed', `reason=${c.reason}`);
    }
  },
  {
    name: 'R5 CAM from (0, -20, 0)',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const s0 = state(0, -20, 0, 0, 0, 0);
      const sel = selectCamDirection(s0, n, T);
      assertTrue(sel.direction !== null, 'direction chosen');
      const dv = RULES.camImpulseMps;
      const s1 = state(s0.x, s0.y, s0.z, s0.vx + sel.direction.x * dv, s0.vy + sel.direction.y * dv, s0.vz + sel.direction.z * dv);
      const r0 = rangeM(s0);
      let minFirst = Infinity;
      for (let i = 0; i <= 900; i += 1) {
        const p = propagateClosedForm(s1, i, n);
        minFirst = Math.min(minFirst, Math.hypot(p.x, p.y, p.z));
      }
      assertTrue(minFirst >= r0 - 1e-6, `range never falls below 20 m: ${minFirst}`);
      let minLate = Infinity;
      for (let i = 0; i <= 900; i += 1) {
        const t = 900 + (2 * T - 900) * i / 900;
        const p = propagateClosedForm(s1, t, n);
        minLate = Math.min(minLate, Math.hypot(p.x, p.y, p.z));
      }
      assertTrue(minLate >= 400, `minimum range over [900 s, 2T] is ${minLate}`);
      // The selection should pick radial-down plus retrograde.
      assertTrue(sel.direction.x < -0.5, `radial-down component: ${sel.direction.x}`);
      assertTrue(sel.direction.y < -0.5, `retrograde component: ${sel.direction.y}`);
    }
  },
  {
    name: 'R6 Departure check',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const radial = departureCheck(state(0, -2, 0, 0.1, 0, 0), n, T);
      assertTrue(!radial.safe, 'radial separation is UNSAFE');
      const along = departureCheck(state(0, -2, 0, 0, -0.1, 0), n, T);
      assertTrue(along.safe, 'along-track separation is SAFE');
      assertTrue(along.exitTimeS !== null && along.exitTimeS > 1000 && along.exitTimeS < 2000, `exit time ${along.exitTimeS}`);
    }
  },
  {
    name: 'R7 Speed envelope',
    fn() {
      assertClose(speedLimitMps(1500), 2.0, 1e-12, '1500 m');
      assertClose(speedLimitMps(500), 0.5, 1e-12, '500 m');
      assertClose(speedLimitMps(100), 0.2, 1e-12, '100 m');
      assertClose(speedLimitMps(20), 0.10, 1e-12, '20 m');
    }
  },
  {
    name: 'R8 Zones',
    fn() {
      assertTrue(insideKos(state(100, 0, 0, 0, 0, 0)), '100 m inside KOS');
      assertTrue(!insideKos(state(300, 0, 0, 0, 0, 0)), '300 m outside KOS');
      assertTrue(insideCorridor(state(100, 0, 0, 0, 0, 0)), 'on-axis inside corridor');
      assertTrue(!insideCorridor(state(100, 30, 0, 0, 0, 0)), '30 m lateral outside corridor');
    }
  },
  {
    name: 'R9 Capture score',
    fn() {
      const perfect = captureScore({ d: 0, lateral: 0, pitchYaw: 0, roll: 0, pitchYawRate: 0, rollRate: 0, speed: 0 });
      assertClose(perfect, SCORING.captureMaxPoints, 1e-9, 'perfect capture');
      const half = captureScore({ d: 0.075, lateral: 0.05, pitchYaw: 2, roll: 2, pitchYawRate: 0.1, rollRate: 0.1, speed: 0.01 });
      assertTrue(half > 0 && half < SCORING.captureMaxPoints, `half capture ${half}`);
    }
  },
  {
    name: 'R10 Mission: hold at HP1 grants the GO',
    fn() {
      const m = createMission({ scenarioName: 'closeApproach' });
      assertTrue(m.phase === 'hold1', `phase ${m.phase}`);
      const cw = state(250 + CAPTURE.axisOffsetM, 0, 0, 0, 0, 0);
      const a = al(250, 0, 0, 0, 0, 0, 0);
      let t = 0;
      while (t < 12) {
        stepMission(m, cw, a, 0.1, ORBITS.LEO.nRadPerS, ORBITS.LEO.periodS);
        t += 0.1;
      }
      assertTrue(m.phase === 'hold2', `phase after hold ${m.phase}`);
      assertTrue(m.kosGo, 'KOS GO granted');
    }
  },
  {
    name: 'R11 Mission: capture sequence',
    fn() {
      const m = createMission({ scenarioName: 'finalApproach' });
      m.phase = 'captureReady';
      const a = al(1.0, 0.05, 2.0, 2.0, 0.10, 0.10, 0.01);
      const res = startCapture(m, a);
      assertTrue(res.started, 'capture started');
      assertTrue(m.phase === 'captureExtension', `phase ${m.phase}`);
      let t = 0;
      while (t < 20) {
        stepMission(m, state(4.05, 0, 0, 0, 0, 0), a, 0.1, ORBITS.LEO.nRadPerS, ORBITS.LEO.periodS);
        t += 0.1;
      }
      assertTrue(m.phase === 'hardCapture', `phase after extension ${m.phase}`);
      assertTrue(m.captureQuality > 0, 'capture quality scored');
    }
  },
  {
    name: 'R12 Mission: CAM and resume',
    fn() {
      const m = createMission({ scenarioName: 'closeApproach' });
      m.kosGo = false;
      const cw = state(100, 0, 0, 0, 0, 0);
      const events = stepMission(m, cw, al(100, 0, 0, 0, 0, 0, 0), 0.1, ORBITS.LEO.nRadPerS, ORBITS.LEO.periodS);
      assertTrue(events.some((e) => e.type === 'cam'), 'CAM triggered');
      assertTrue(m.camActive, 'CAM active');
      applyCamImpulse(m, cw);
      assertTrue(cw.vx !== 0 || cw.vy !== 0 || cw.vz !== 0, 'impulse applied');
      resumeAfterCam(m, cw);
      assertTrue(m.phase === 'hold1', `phase after resume ${m.phase}`);
      assertClose(cw.x, 250 + CAPTURE.axisOffsetM, 1e-9, 'resumed at HP1');
    }
  },
  {
    name: 'R13 Scoring',
    fn() {
      assertClose(deltaVScore(0.15, 0.30), 300, 1e-9, 'delta-v at reference');
      assertClose(deltaVScore(0.60, 0.30), 150, 1e-9, 'delta-v twice reference');
      assertClose(refuelScore(150, 0), 200, 1e-9, 'refuel exact');
      assertClose(refuelScore(150, 1), 150, 1e-9, 'refuel one fault');
      assertClose(departureScore(true, 0), 200, 1e-9, 'departure first plan');
      assertClose(departureScore(true, 1), 100, 1e-9, 'departure corrected');
      assertTrue(grade(900) === 'A', 'grade A');
      assertTrue(grade(750) === 'B', 'grade B');
      assertTrue(grade(600) === 'C', 'grade C');
      assertTrue(grade(400) === 'D', 'grade D');
      assertTrue(grade(399) === 'F', 'grade F');
    }
  },
  {
    name: 'R14 Departure planning records corrections',
    fn() {
      const m = createMission({ scenarioName: 'departureOnly' });
      m.phase = 'departure';
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const unsafe = planDeparture(m, state(0, -2, 0, 0.1, 0, 0), n, T);
      assertTrue(!unsafe.safe, 'unsafe plan');
      assertTrue(m.departure.corrections === 1, 'one correction');
      const safe = planDeparture(m, state(0, -2, 0, 0, -0.1, 0), n, T);
      assertTrue(safe.safe, 'safe plan');
      assertTrue(m.departure.firstPlanSafe === false, 'not the first plan');
    }
  },
  {
    name: 'R15 Speed counts only at contact',
    fn() {
      // A CAM impulse of 0.5 m/s at 100 m is not a collision; the same speed at contact is.
      assertTrue(!collisionCheck(state(100, 0, 0, 0.5, 0, 0)).collision, 'no collision at 100 m');
      const c = collisionCheck(state(2.9, 0, 0, -0.05, 0, 0));
      assertTrue(c.collision && c.reason === 'contact', `slow contact ${c.reason}`);
      // stepMission after a CAM impulse keeps the mission alive.
      const m = createMission({ scenarioName: 'closeApproach' });
      m.kosGo = false;
      const cw = state(100, 0, 0, 0, 0, 0);
      stepMission(m, cw, al(100, 0, 0, 0, 0, 0, 0), 0.1, ORBITS.LEO.nRadPerS, ORBITS.LEO.periodS);
      applyCamImpulse(m, cw);
      stepMission(m, cw, al(100, 0, 0, 0, 0, 0, 0.5), 0.1, ORBITS.LEO.nRadPerS, ORBITS.LEO.periodS);
      assertTrue(m.phase !== 'failed', `phase after the CAM impulse ${m.phase}`);
    }
  },
  {
    name: 'R16 Capture sequence timing and retraction',
    fn() {
      // Extension 5 s, fingers 1 s, retraction 10 s, latches 5 s. During the retraction d
      // shrinks from 1.0 m to 0.5 m: that must not abort the capture.
      const m = createMission({ scenarioName: 'finalApproach' });
      m.phase = 'captureReady';
      assertTrue(startCapture(m, al(1.0, 0.02, 1.0, 1.0, 0.05, 0.05, 0.005)).started, 'started');
      const seen = {};
      let t = 0;
      const dt = 0.05;
      while (t < 25) {
        const p = m.probe.timerS;
        const retracting = m.probe.state === 'retracting';
        const d = retracting ? 1.0 - 0.5 * Math.min(1, (p - 6) / 10) : m.phase === 'captureExtension' ? 1.0 : 0.5;
        stepMission(m, state(d + CAPTURE.axisOffsetM, 0, 0, 0, 0, 0), al(d, 0.02, 1.0, 1.0, 0.05, 0.05, retracting ? 0.05 : 0.005), dt,
          ORBITS.GEO.nRadPerS, ORBITS.GEO.periodS);
        t += dt;
        if (!(m.phase in seen)) seen[m.phase] = t;
      }
      assertTrue(seen.hardCapture !== undefined, `hard capture reached (${JSON.stringify(seen)})`);
      assertClose(seen.hardCapture, 16, 0.11, 'hard capture after 16 s');
      assertClose(seen.docked, 16 + CAPTURE.latchTimeS, 0.11, 'docked after the latches');
      assertTrue(m.captureQuality > 0.5 * SCORING.captureMaxPoints, `capture quality ${m.captureQuality}`);
    }
  }
];

export default tests;
