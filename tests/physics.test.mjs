// tests/physics.test.mjs
// Physics tests for Stages 1 to 3. No test framework.

import { ORBITS, G0, START_ATTITUDE } from '../src/config.js';
import {
  propagateClosedForm,
  propagateRK4
} from '../src/physics/cw.js';
import {
  propellantForBurnKg,
  deltaVForBurnMps,
  combinedBurn,
  quatRotateVec,
  quatNormalize,
  ChaserVehicle,
  quatErrorVec,
  quatMultiply,
  quatFromAxisAngle
} from '../src/physics/vehicle.js';
import { predictPath } from '../src/physics/cw.js';
import {
  createFlight,
  queuePulse,
  pulseBurnActive,
  rotationPress,
  stepFlight,
  maxWarpAllowed,
  clampWarpLevel,
  alignment
} from '../src/physics/flight.js';
import { TIME_WARP } from '../src/config.js';
import {
  sunDirectionLVLH,
  sunDirectionAtTime,
  solarVisibility,
  earthRelativeSpinRate,
  earthPolarAxisLVLH,
  subSatelliteLongitude
} from '../src/physics/environment.js';

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

function positionError(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function state(x, y, z, vx, vy, vz) {
  return { x, y, z, vx, vy, vz };
}

function measureShadow(aM, nRadPerS, betaRad) {
  const pos = { x: aM, y: 0, z: 0 };
  const vis = (phase) => solarVisibility(pos, sunDirectionLVLH(betaRad, phase));

  const lo = Math.PI - 3.3;
  const hi = Math.PI + 3.3;
  const samples = 20000;
  const step = (hi - lo) / samples;
  let firstZero = null;
  let lastZero = null;

  for (let i = 0; i <= samples; i += 1) {
    const phase = lo + step * i;
    const v = vis(phase);
    if (v <= 1e-12) {
      if (firstZero === null) firstZero = phase;
      lastZero = phase;
    }
  }

  if (firstZero === null) {
    return { fullShadowS: 0, penumbraS: 0 };
  }

  let left = firstZero - step;
  let right = firstZero;
  for (let k = 0; k < 80; k += 1) {
    const mid = (left + right) * 0.5;
    if (vis(mid) > 1e-12) left = mid;
    else right = mid;
  }
  const ingress = (left + right) * 0.5;

  left = lastZero;
  right = lastZero + step;
  for (let k = 0; k < 80; k += 1) {
    const mid = (left + right) * 0.5;
    if (vis(mid) <= 1e-12) left = mid;
    else right = mid;
  }
  const egress = (left + right) * 0.5;

  left = egress;
  right = egress + 0.05;
  for (let k = 0; k < 80; k += 1) {
    const mid = (left + right) * 0.5;
    if (vis(mid) >= 1 - 1e-12) right = mid;
    else left = mid;
  }
  const litStart = (left + right) * 0.5;

  return {
    fullShadowS: (egress - ingress) / nRadPerS,
    penumbraS: (litStart - egress) / nRadPerS
  };
}

export const tests = [
  {
    name: '1 V-bar station keeping',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const s0 = state(0, -100, 0, 0, 0, 0);
      const cf = propagateClosedForm(s0, T, n);
      assertClose(cf.x, 0, 1e-6, 'closed-form x');
      assertClose(cf.y, -100, 1e-6, 'closed-form y');
      assertClose(cf.z, 0, 1e-6, 'closed-form z');

      const rk = propagateRK4(s0, T, n, { x: 0, y: 0, z: 0 }, 0.5);
      assertClose(rk.x, 0, 1e-3, 'RK4 x');
      assertClose(rk.y, -100, 1e-3, 'RK4 y');
      assertClose(rk.z, 0, 1e-3, 'RK4 z');
    }
  },
  {
    name: '2 Radial offset',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const s0 = state(10, 0, 0, 0, 0, 0);
      const expectedY = -12 * Math.PI * 10;
      const cf = propagateClosedForm(s0, T, n);
      assertClose(cf.x, 10, 0.01, 'closed-form x');
      assertClose(cf.y, expectedY, 0.01, 'closed-form y');

      const rk = propagateRK4(s0, T, n, { x: 0, y: 0, z: 0 }, 0.5);
      assertClose(rk.x, 10, 0.01, 'RK4 x');
      assertClose(rk.y, expectedY, 0.01, 'RK4 y');
    }
  },
  {
    name: '3 Radial impulse',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const s0 = state(0, 0, 0, 0.1, 0, 0);
      const cf = propagateClosedForm(s0, T, n);
      assertTrue(positionError(cf, state(0, 0, 0, 0, 0, 0)) < 1e-6, 'closed-form returns to origin');

      let minY = Infinity;
      const samples = 4000;
      for (let i = 0; i <= samples; i += 1) {
        const t = T * i / samples;
        const p = propagateClosedForm(s0, t, n);
        if (p.y < minY) minY = p.y;
      }
      assertClose(minY, -0.4 / n, 0.01, 'minimum y');
    }
  },
  {
    name: '4 Posigrade impulse',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      const s0 = state(0, 0, 0, 0, 0.1, 0);
      const cf = propagateClosedForm(s0, T, n);
      assertClose(cf.x, 0, 0.01, 'x');
      assertClose(cf.y, -0.6 * Math.PI / n, 0.01, 'y');
    }
  },
  {
    name: '5 Out of plane',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const halfT = ORBITS.LEO.periodS * 0.5;
      const s0 = state(0, 0, 10, 0, 0, 0);
      const cf = propagateClosedForm(s0, halfT, n);
      assertClose(cf.z, -10, 1e-6, 'z at half period');
    }
  },
  {
    name: '6 RK4 against closed form over one period',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const T = ORBITS.LEO.periodS;
      let seed = 123456789;
      const rand = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 50; i += 1) {
        const s0 = state(
          (rand() - 0.5) * 2000,
          (rand() - 0.5) * 2000,
          (rand() - 0.5) * 2000,
          (rand() - 0.5) * 2,
          (rand() - 0.5) * 2,
          (rand() - 0.5) * 2
        );
        const cf = propagateClosedForm(s0, T, n);
        const rk = propagateRK4(s0, T, n, { x: 0, y: 0, z: 0 }, 0.5);
        const err = positionError(cf, rk);
        assertTrue(err < 1e-3, `random case ${i}: position error ${err} m`);
      }
    }
  },
  {
    name: '7 Propellant for one 22 N thruster',
    fn() {
      const kg = propellantForBurnKg(22, 100, 220, G0);
      assertClose(kg, 1.0197, 1e-4, 'propellant consumed');
    }
  },
  {
    name: '8 Delta-v bookkeeping',
    fn() {
      const dv = deltaVForBurnMps(44, 2100, 10, 220, G0);
      assertClose(dv, 0.20953, 1e-4, 'delta-v');
    }
  },
  {
    name: '9 Arcade mode constant velocity',
    fn() {
      const s0 = state(0, 0, 0, 1, 2, 3);
      const cf = propagateClosedForm(s0, 10, 0);
      assertClose(cf.x, 10, 1e-12, 'closed-form x');
      assertClose(cf.y, 20, 1e-12, 'closed-form y');
      assertClose(cf.z, 30, 1e-12, 'closed-form z');
      assertClose(cf.vx, 1, 1e-12, 'closed-form vx');
      assertClose(cf.vy, 2, 1e-12, 'closed-form vy');
      assertClose(cf.vz, 3, 1e-12, 'closed-form vz');

      const rk = propagateRK4(s0, 10, 0, { x: 0, y: 0, z: 0 }, 0.5);
      assertClose(rk.x, 10, 1e-12, 'RK4 x');
      assertClose(rk.y, 20, 1e-12, 'RK4 y');
      assertClose(rk.z, 30, 1e-12, 'RK4 z');
    }
  },
  {
    name: '10 Approach from above, LEO',
    fn() {
      const n = ORBITS.LEO.nRadPerS;
      const s0 = state(80, 0, 0, 0, 0, 0);
      const p = propagateClosedForm(s0, 600, n);
      assertClose(p.x, 131.00, 0.01, 'x after 600 s');
      assertClose(p.y, -22.92, 0.01, 'y after 600 s');
    }
  },
  {
    name: '11 Approach from above, GEO graveyard',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const s0 = state(80, 0, 0, 0, 0, 0);
      const p = propagateClosedForm(s0, 3600, n);
      assertClose(p.x, 88.056, 0.001, 'x after 3600 s');
      assertClose(p.y, -1.399, 0.001, 'y after 3600 s');
    }
  },
  {
    name: '12 GEO graveyard constants',
    fn() {
      assertClose(ORBITS.GEO.nRadPerS, 7.217534e-5, 1e-10, 'GEO n');
      assertClose(ORBITS.GEO.periodS, 87054.46, 0.01, 'GEO period');
    }
  },
  {
    name: '13 Graveyard beta 0 shadow timing',
    fn() {
      const m = measureShadow(ORBITS.GEO.aM, ORBITS.GEO.nRadPerS, 0);
      assertClose(m.fullShadowS, 4050.0, 2, 'full shadow duration');
      assertClose(m.penumbraS, 128.9, 1, 'penumbra transition');
    }
  },
  {
    name: '14 LEO beta 0 shadow timing',
    fn() {
      const m = measureShadow(ORBITS.LEO.aM, ORBITS.LEO.nRadPerS, 0);
      assertClose(m.fullShadowS, 2136.8, 2, 'full shadow duration');
      assertClose(m.penumbraS, 8.40, 0.1, 'penumbra transition');
    }
  },
  {
    name: '15 Graveyard beta -9.26 no eclipse',
    fn() {
      const beta = -9.26 * Math.PI / 180;
      const pos = { x: ORBITS.GEO.aM, y: 0, z: 0 };
      const samples = 2000;
      for (let i = 0; i <= samples; i += 1) {
        const phase = 2 * Math.PI * i / samples;
        const vis = solarVisibility(pos, sunDirectionLVLH(beta, phase));
        assertTrue(vis >= 1 - 1e-12, `visible fraction at phase ${phase}: ${vis}`);
      }
    }
  },
  {
    name: '16 Earth rotation relative to LVLH',
    fn() {
      const rate = earthRelativeSpinRate(ORBITS.GEO.nRadPerS, 0);
      assertClose(rate, 7.458e-7, 1e-10, 'relative spin rate');
    }
  },
  {
    name: '17 Sun direction versus local time',
    fn() {
      const beta = 0;
      const s06 = sunDirectionAtTime(beta, 6, ORBITS.LEO.nRadPerS, 0);
      const s12 = sunDirectionAtTime(beta, 12, ORBITS.LEO.nRadPerS, 0);
      const s18 = sunDirectionAtTime(beta, 18, ORBITS.LEO.nRadPerS, 0);
      const s00 = sunDirectionAtTime(beta, 0, ORBITS.LEO.nRadPerS, 0);
      assertClose(s06.x, 0, 1e-12, '06:00 x');
      assertClose(s06.y, 1, 1e-12, '06:00 y');
      assertClose(s12.x, 1, 1e-12, '12:00 x');
      assertClose(s12.y, 0, 1e-12, '12:00 y');
      assertClose(s18.x, 0, 1e-12, '18:00 x');
      assertClose(s18.y, -1, 1e-12, '18:00 y');
      assertClose(s00.x, -1, 1e-12, '00:00 x');
      assertClose(s00.y, 0, 1e-12, '00:00 y');

      const quarterT = ORBITS.LEO.periodS * 0.25;
      const sQ = sunDirectionAtTime(beta, 6, ORBITS.LEO.nRadPerS, quarterT);
      assertClose(sQ.x, 1, 1e-9, 'quarter period x');
      assertClose(sQ.y, 0, 1e-9, 'quarter period y');

      const pos = { x: ORBITS.GEO.aM, y: 0, z: 0 };
      const v00 = solarVisibility(pos, sunDirectionAtTime(beta, 0, ORBITS.GEO.nRadPerS, 0));
      const v12 = solarVisibility(pos, sunDirectionAtTime(beta, 12, ORBITS.GEO.nRadPerS, 0));
      assertClose(v00, 0, 1e-12, 'GEO visible at 00:00');
      assertClose(v12, 1, 1e-12, 'GEO visible at 12:00');
    }
  },
  {
    name: '18 Earth polar axis and sub-satellite longitude',
    fn() {
      const i = ORBITS.LEO.inclinationRad;
      const a0 = earthPolarAxisLVLH(i, 0);
      const a90 = earthPolarAxisLVLH(i, Math.PI / 2);
      const a180 = earthPolarAxisLVLH(i, Math.PI);
      assertClose(a0.x, 0, 1e-4, 'u=0 x');
      assertClose(a0.y, 0.7837, 1e-4, 'u=0 y');
      assertClose(a0.z, 0.6211, 1e-4, 'u=0 z');
      assertClose(a90.x, 0.7837, 1e-4, 'u=90 x');
      assertClose(a90.y, 0, 1e-4, 'u=90 y');
      assertClose(a90.z, 0.6211, 1e-4, 'u=90 z');
      assertClose(a180.x, 0, 1e-4, 'u=180 x');
      assertClose(a180.y, -0.7837, 1e-4, 'u=180 y');
      assertClose(a180.z, 0.6211, 1e-4, 'u=180 z');

      const lon0 = subSatelliteLongitude(ORBITS.GEO, 0) * 180 / Math.PI;
      const lon1 = subSatelliteLongitude(ORBITS.GEO, ORBITS.GEO.periodS) * 180 / Math.PI;
      assertClose(lon0, -19.0, 1e-4, 'GEO lon at t=0');
      assertClose(lon1, -22.7200, 1e-4, 'GEO lon after one orbit');
    }
  },
  {
    name: '19 Default chaser attitude',
    fn() {
      const q = quatNormalize({ ...START_ATTITUDE });
      const bx = quatRotateVec(q, { x: 1, y: 0, z: 0 });
      const by = quatRotateVec(q, { x: 0, y: 1, z: 0 });
      assertClose(bx.x, -1, 1e-12, 'body X x');
      assertClose(bx.y, 0, 1e-12, 'body X y');
      assertClose(bx.z, 0, 1e-12, 'body X z');
      assertClose(by.x, 0, 1e-12, 'body Y x');
      assertClose(by.y, 0, 1e-12, 'body Y y');
      assertClose(by.z, 1, 1e-12, 'body Y z');
    }
  },
  {
    name: '20 Two-axis burn propellant and delta-v',
    fn() {
      const r = combinedBurn({ x: 44, y: 44, z: 0 }, 2050, 10, 220, G0);
      assertClose(r.propellantKg, 0.407886, 1e-5, 'propellant');
      assertClose(r.deltaVMps, 0.303569, 1e-5, 'delta-v');
    }
  },
  {
    name: '21 Rotation pulse',
    fn() {
      const v = new ChaserVehicle();
      const before = v.bodyRatesRadPerS.z;
      const res = v.rotationPulse('z', 0.05 * Math.PI / 180);
      const after = v.bodyRatesRadPerS.z;
      const deltaDeg = (after - before) * 180 / Math.PI;
      assertClose(deltaDeg, 0.05, 1e-9, 'Z rate increment');
      assertClose(res.durationS, 0.093216, 1e-5, 'pulse duration');
      assertClose(res.propellantKg, 0.0019011, 1e-6, 'pulse propellant');
    }
  },
  {
    name: '22 Attitude hold',
    fn() {
      const v = new ChaserVehicle();
      v.bodyRatesRadPerS.z = 1 * Math.PI / 180;
      v.enableAttitudeHold();
      const held = { ...v.heldAttitude };
      const dt = 0.05;
      let maxTorque = 0;
      let t = 0;
      let propKg = 0;
      while (t < 60) {
        const res = v.attitudeHoldStep(dt);
        const tau = Math.abs(res.appliedTorqueNm.z);
        if (tau > maxTorque) maxTorque = tau;
        propKg += res.propellantKg;
        t += dt;
        if (Math.abs(t - 30) < 1e-9) {
          const rateDeg = Math.abs(v.bodyRatesRadPerS.z) * 180 / Math.PI;
          const errDeg = Math.abs(quatErrorVec(held, v.attitude).z) * 180 / Math.PI;
          assertTrue(rateDeg < 0.01, `rate at 30 s: ${rateDeg} deg/s`);
          assertTrue(errDeg < 0.5, `error at 30 s: ${errDeg} deg`);
        }
      }
      assertTrue(maxTorque <= 44 + 1e-9, `max torque ${maxTorque}`);
      const rateDeg = Math.abs(v.bodyRatesRadPerS.z) * 180 / Math.PI;
      const errDeg = Math.abs(quatErrorVec(held, v.attitude).z) * 180 / Math.PI;
      assertTrue(rateDeg < 0.01, `rate at 60 s: ${rateDeg} deg/s`);
      assertTrue(errDeg < 0.5, `error at 60 s: ${errDeg} deg`);
      assertTrue(propKg >= 0.0380, `propellant ${propKg} kg below physical minimum`);
      assertTrue(propKg <= 0.10, `propellant ${propKg} kg above maximum`);

      // Same case at a 120 Hz frame rate: steps shorter than the 0.01 s minimum pulse.
      const v2 = new ChaserVehicle();
      v2.bodyRatesRadPerS.z = 1 * Math.PI / 180;
      v2.enableAttitudeHold();
      const held2 = { ...v2.heldAttitude };
      let maxTorque2 = 0;
      for (let k = 0; k < 7200; k += 1) {
        const res = v2.attitudeHoldStep(1 / 120);
        maxTorque2 = Math.max(maxTorque2, Math.abs(res.appliedTorqueNm.z));
      }
      assertTrue(maxTorque2 <= 44 + 1e-9, `max torque at 120 Hz ${maxTorque2}`);
      const rate2 = Math.abs(v2.bodyRatesRadPerS.z) * 180 / Math.PI;
      const err2 = Math.abs(quatErrorVec(held2, v2.attitude).z) * 180 / Math.PI;
      assertTrue(rate2 < 0.01, `rate at 60 s, 120 Hz: ${rate2} deg/s`);
      assertTrue(err2 < 0.5, `error at 60 s, 120 Hz: ${err2} deg`);
    }
  },
  {
    name: '23 Flight: 10 m radial offset drifts back along V-bar',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const v = new ChaserVehicle();
      const f = createFlight({ x: 10 });
      const frame = 2000 / 60;
      const frames = Math.round(21600 / frame);
      for (let k = 0; k < frames; k += 1) stepFlight(f, v, {}, frame, n);
      const ref = propagateClosedForm({ x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, frames * frame, n);
      assertClose(f.cw.x, ref.x, 1e-3, 'x after 6 h');
      assertClose(f.cw.y, ref.y, 1e-3, 'y after 6 h');
      assertTrue(f.cw.y < -30 && f.cw.x > 35, `drift up and back: x=${f.cw.x}, y=${f.cw.y}`);
      assertClose(v.ownPropellantKg, 150, 1e-12, 'coasting uses no propellant');
    }
  },
  {
    name: '24 Flight: radial pulse gives a closed relative orbit',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const v = new ChaserVehicle();
      const f = createFlight({ x: 0 });
      // S key: body -X, which points along LVLH +x at the start attitude (radial up).
      queuePulse(f, v, 'x', -1);
      let t = 0;
      while (pulseBurnActive(f) && t < 5) { stepFlight(f, v, {}, 1 / 60, n); t += 1 / 60; }
      assertClose(f.cw.vx, 0.01, 2e-6, 'radial velocity after the pulse');
      const path = predictPath(f.cw, n, ORBITS.GEO.periodS, 256);
      const first = path[0];
      const last = path[path.length - 1];
      const gap = Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z);
      assertTrue(gap < 0.2, `relative orbit closes within 0.2 m: ${gap}`);
      const minY = Math.min(...path.map((p) => p.y));
      assertClose(minY, -4 * 0.01 / n, 0.01 * 4 * 0.01 / n, 'along-track extent -4 dvx / n');
    }
  },
  {
    name: '25 Flight: PULSE presses book propellant in both directions',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const v = new ChaserVehicle();
      const f = createFlight({ x: 100 });
      const m0 = v.massKg;
      const mdot = 44 / (220 * G0);
      queuePulse(f, v, 'x', 1);
      for (let k = 0; k < 60; k += 1) stepFlight(f, v, {}, 1 / 60, n);
      assertTrue(!pulseBurnActive(f), 'burn finished within 1 s');
      // W key: body +X points along LVLH -x at the start attitude.
      assertClose(f.cw.vx, -0.01, 1e-5, 'vx after W');
      const used1 = 150 - v.ownPropellantKg;
      assertClose(used1, mdot * m0 * 0.01 / 44, 1e-7, 'propellant of one press');
      queuePulse(f, v, 'x', -1);
      for (let k = 0; k < 60; k += 1) stepFlight(f, v, {}, 1 / 60, n);
      assertClose(f.cw.vx, 0, 1e-5, 'vx after S');
      assertClose(150 - v.ownPropellantKg, 2 * used1, 1e-6, 'the opposite press burns the same propellant');
      assertClose(v.deltaVUsedMps, 0.02, 1e-6, 'delta-v used');
    }
  },
  {
    name: '26 Flight: rotation press and free rotation',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const v = new ChaserVehicle();
      const f = createFlight({ x: 100 });
      const res = rotationPress(v, 'z', 1);
      assertTrue(!v.attitudeHold, 'a rotation press switches the hold off');
      assertClose(v.bodyRatesRadPerS.z * 180 / Math.PI, 0.05, 1e-12, 'yaw rate');
      assertClose(res.propellantKg, 0.0019011, 1e-6, 'press propellant');
      for (let k = 0; k < 600; k += 1) stepFlight(f, v, {}, 1 / 60, n);
      const yawDeg = quatErrorVec(START_ATTITUDE, v.attitude).z * 180 / Math.PI;
      assertClose(yawDeg, 0.5, 1e-5, 'yaw after 10 s at 0.05 deg/s');
    }
  },
  {
    name: '27 Flight: attitude hold through the flight step',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const v = new ChaserVehicle();
      const f = createFlight({ x: 100 });
      v.bodyRatesRadPerS.z = Math.PI / 180;
      v.enableAttitudeHold();
      const held = { ...v.heldAttitude };
      const p0 = v.ownPropellantKg;
      for (let k = 0; k < 3600; k += 1) stepFlight(f, v, {}, 1 / 60, n);
      const rateDeg = Math.abs(v.bodyRatesRadPerS.z) * 180 / Math.PI;
      const errDeg = Math.abs(quatErrorVec(held, v.attitude).z) * 180 / Math.PI;
      assertTrue(rateDeg < 0.01, `rate after 60 s: ${rateDeg} deg/s`);
      assertTrue(errDeg < 0.5, `error after 60 s: ${errDeg} deg`);
      const used = p0 - v.ownPropellantKg;
      assertTrue(used >= 0.038 && used <= 0.10, `propellant ${used} kg`);
    }
  },
  {
    name: '28 Time warp rules',
    fn() {
      const geo = TIME_WARP.geoLevels;
      assertTrue(maxWarpAllowed(1000, true, geo) === 2000, 'outside the KOS: every level');
      assertTrue(maxWarpAllowed(150, true, geo) === 50, 'inside the KOS: 50x');
      assertTrue(maxWarpAllowed(30, true, geo) === 10, 'within 30 m: 10x');
      assertTrue(maxWarpAllowed(4, true, geo) === 1, 'within 5 m: 1x');
      assertTrue(maxWarpAllowed(1000, false, geo) === 1, 'firing: 1x');
      assertTrue(maxWarpAllowed(1000, true, TIME_WARP.levels) === 100, 'LEO top level');
      assertTrue(clampWarpLevel(geo, 500, 10) === 10, 'clamp to 10x');
      assertTrue(clampWarpLevel(geo, 2000, 1) === 1, 'clamp to 1x');
    }
  },
  {
    name: '29 Flight: one 2000x frame matches the closed form',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const s0 = { x: 300, y: -200, z: 50, vx: 0.05, vy: -0.02, vz: 0.01 };
      for (const dt of [2000 / 60, 200]) {
        const v = new ChaserVehicle();
        const f = createFlight(s0);
        const out = stepFlight(f, v, {}, dt, n);
        const ref = propagateClosedForm(s0, dt, n);
        const err = Math.hypot(f.cw.x - ref.x, f.cw.y - ref.y, f.cw.z - ref.z);
        assertTrue(err < 1e-6, `position error ${err} m for a ${dt} s frame`);
        assertTrue(out.substeps <= 2000, 'sub-step cap');
      }
    }
  },
  {
    name: '30 Alignment angles and offsets',
    fn() {
      const v = new ChaserVehicle();
      const f = createFlight({ x: 23.05, y: 0.3, z: 0.4 });
      v.attitude = quatMultiply(START_ATTITUDE, quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 3 * Math.PI / 180));
      let a = alignment(f, v);
      assertClose(a.dM, 20, 1e-9, 'd');
      assertClose(a.lateralM, 0.5, 1e-9, 'lateral offset');
      assertClose(a.rollDeg, 3, 1e-9, 'roll');
      assertClose(a.pitchYawDeg, 0, 1e-6, 'no pitch/yaw');
      v.attitude = quatMultiply(START_ATTITUDE, quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 2 * Math.PI / 180));
      a = alignment(f, v);
      assertClose(a.pitchYawDeg, 2, 1e-6, 'pitch/yaw');
      assertClose(a.rollDeg, 0, 1e-9, 'no roll');
    }
  }
];

export default tests;
