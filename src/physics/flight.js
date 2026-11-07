// src/physics/flight.js
// Chaser flight step: PULSE presses executed as short burns, CONTINUOUS thrust,
// CW translation with RK4, rotation presses, Arcade rotation and the attitude hold.
// No three.js and no DOM access.

import { CHASER, CAPTURE, G0, PHYSICS, RULES, TIME_WARP, DEG_TO_RAD, RAD_TO_DEG, START_ATTITUDE } from '../config.js';
import { rk4Step } from './cw.js';
import { quatMultiply, quatRotateVec, integrateAttitude } from './vehicle.js';

export const AXES = ['x', 'y', 'z'];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };

// Attitude sub-step while the hold or a rotation is active, s. The PD loop (wn = 0.4 rad/s)
// stays well resolved, and a 2000x frame of 33 s needs about 670 sub-steps.
export const ATTITUDE_STEP_S = 0.05;
export const MAX_SUBSTEPS_PER_FRAME = 2000;

// Flight state: CW state in LVLH (CM to CM, target at the origin), PULSE burn queues, MET.
export function createFlight(start = {}) {
  return {
    cw: {
      x: start.x || 0,
      y: start.y || 0,
      z: start.z || 0,
      vx: start.vx || 0,
      vy: start.vy || 0,
      vz: start.vz || 0
    },
    // PULSE burns waiting or running, per body axis, in press order: { sign, remainingS }.
    burnQueue: { x: [], y: [], z: [] },
    metS: 0
  };
}

// One PULSE press: dv (default 0.01 m/s) along a body axis, executed as a burn of the axis'
// 2 x 22 N for m * dv / F seconds (0.47 s for 0.01 m/s at mission start).
export function queuePulse(flight, vehicle, axis, sign, dvMps = CHASER.translationPulseMps) {
  const durationS = vehicle.massKg * dvMps / CHASER.rcsTranslationForceN;
  flight.burnQueue[axis].push({ sign: sign > 0 ? 1 : -1, remainingS: durationS });
  return durationS;
}

// Delta-v still to come from the queued PULSE burns, in body axes (m/s).
export function queuedDeltaVBody(flight, vehicle) {
  const out = { x: 0, y: 0, z: 0 };
  const accel = CHASER.rcsTranslationForceN / vehicle.massKg;
  for (const a of AXES) {
    for (const seg of flight.burnQueue[a]) out[a] += seg.sign * seg.remainingS * accel;
  }
  return out;
}

export function pulseBurnActive(flight) {
  return AXES.some((a) => flight.burnQueue[a].length > 0);
}

// One rotation press in Realistic mode: 0.05 deg/s about a body axis; the hold switches off.
export function rotationPress(vehicle, axis, sign) {
  return vehicle.rotationPulse(axis, (sign > 0 ? 1 : -1) * CHASER.rotationStepDegPerPress * DEG_TO_RAD);
}

// Firing time of one axis inside a sub-step of length h: total on-time and signed on-time.
function takeBurn(queue, h) {
  let left = h;
  let on = 0;
  let net = 0;
  while (left > 1e-12 && queue.length > 0) {
    const seg = queue[0];
    const t = Math.min(left, seg.remainingS);
    on += t;
    net += seg.sign * t;
    left -= t;
    seg.remainingS -= t;
    if (seg.remainingS <= 1e-12) queue.shift();
  }
  return { on, net };
}

function isNonZero(v) {
  return !!v && (v.x !== 0 || v.y !== 0 || v.z !== 0);
}

// Advances the flight by dtS of simulated time.
// controls.translationHeld: body-axis signs held in CONTINUOUS mode (-1, 0, 1).
// controls.rotationHeld: body-axis signs held for Arcade rotation (-1, 0, 1).
// options.arcade: rotation keys fire the couple while held, up to the Arcade rate limit.
// Returns the frame-averaged body force and torque (for plumes), the propellant used and the sub-steps.
export function stepFlight(flight, vehicle, controls, dtS, nRadPerS, options = {}) {
  const out = {
    forceBodyN: { x: 0, y: 0, z: 0 },
    torqueBodyNm: { x: 0, y: 0, z: 0 },
    propellantKg: 0,
    substeps: 0
  };
  if (!(dtS > 0)) return out;

  const held = (controls && controls.translationHeld) || { x: 0, y: 0, z: 0 };
  const rotHeld = (options.arcade && controls && controls.rotationHeld) || { x: 0, y: 0, z: 0 };
  const rates = vehicle.bodyRatesRadPerS;
  const attitudeActive = vehicle.attitudeHold || isNonZero(rates) || isNonZero(rotHeld);
  const thrusting = pulseBurnActive(flight) || isNonZero(held);
  const maxStep = attitudeActive || thrusting ? ATTITUDE_STEP_S : PHYSICS.rk4MaxStepS;
  const count = Math.min(MAX_SUBSTEPS_PER_FRAME, Math.max(1, Math.ceil(dtS / maxStep)));
  const h = dtS / count;

  const F = CHASER.rcsTranslationForceN; // two 22 N thrusters per direction
  const mdotAxis = F / (CHASER.ispS * G0);
  const tauMax = CHASER.rcsRotationTorqueNm;
  const mdotCouple = 2 * CHASER.rcsThrusterForceN / (CHASER.ispS * G0);
  const arcadeRateMax = CHASER.arcadeRotationRateDegPerS * DEG_TO_RAD;

  for (let i = 0; i < count; i += 1) {
    // Translation: average body force over the sub-step and the propellant it burns.
    const force = { x: 0, y: 0, z: 0 };
    let flowKg = 0;
    for (const a of AXES) {
      if (held[a] !== 0) {
        force[a] += Math.sign(held[a]) * F;
        flowKg += mdotAxis * h;
      }
      if (flight.burnQueue[a].length > 0) {
        const b = takeBurn(flight.burnQueue[a], h);
        force[a] += F * b.net / h;
        flowKg += mdotAxis * b.on;
      }
    }
    let scale = 1;
    if (flowKg > 0) {
      scale = vehicle.ownPropellantKg > 0 ? Math.min(1, vehicle.ownPropellantKg / flowKg) : 0;
      const used = flowKg * scale;
      vehicle.ownPropellantKg = Math.max(0, vehicle.ownPropellantKg - used);
      out.propellantKg += used;
    }
    const m = vehicle.massKg;
    const accBody = { x: force.x * scale / m, y: force.y * scale / m, z: force.z * scale / m };
    const accMag = Math.hypot(accBody.x, accBody.y, accBody.z);
    const accLvlh = accMag > 0 ? quatRotateVec(vehicle.attitude, accBody) : { x: 0, y: 0, z: 0 };
    vehicle.deltaVUsedMps += accMag * h;
    flight.cw = rk4Step(flight.cw, accLvlh, h, nRadPerS);
    for (const a of AXES) out.forceBodyN[a] += force[a] * scale * h / dtS;

    // Arcade rotation: the couple fires while the key is held, up to the Arcade rate limit.
    for (const a of AXES) {
      const s = rotHeld[a];
      if (s === 0 || vehicle.ownPropellantKg <= 0) continue;
      const inertia = vehicle.inertiaKgM2[AXIS_INDEX[a]];
      const target = Math.sign(s) * arcadeRateMax;
      const room = target - rates[a];
      if (room * Math.sign(s) <= 0) continue;
      const dw = Math.sign(s) * Math.min(Math.abs(room), tauMax / inertia * h);
      const onS = Math.abs(dw) * inertia / tauMax;
      const used = Math.min(vehicle.ownPropellantKg, mdotCouple * onS);
      vehicle.ownPropellantKg -= used;
      out.propellantKg += used;
      rates[a] += dw;
      vehicle.attitudeHold = false;
      out.torqueBodyNm[a] += Math.sign(s) * tauMax * onS / dtS;
    }

    // Attitude: the hold integrates the attitude itself; otherwise free rotation.
    if (vehicle.attitudeHold) {
      const res = vehicle.attitudeHoldStep(h);
      out.propellantKg += res.propellantKg;
      const tq = res.appliedTorqueNm || { x: 0, y: 0, z: 0 };
      for (const a of AXES) out.torqueBodyNm[a] += tq[a] * h / dtS;
    } else {
      vehicle.attitude = integrateAttitude(vehicle.attitude, rates, h);
    }
    flight.metS += h;
  }
  out.substeps = count;
  return out;
}

// Highest time-warp level allowed now. Firing or control input means 1x. While coasting:
// every level outside the KOS, at most 50x inside it, 10x within 30 m and 1x within 5 m.
export function maxWarpAllowed(rangeM, coasting, levels) {
  const top = levels[levels.length - 1];
  if (!coasting) return 1;
  if (rangeM <= TIME_WARP.captureZoneRangeM) return 1;
  if (rangeM <= TIME_WARP.kosMinRangeM) return Math.min(TIME_WARP.closeMax, top);
  if (rangeM < RULES.kosRadiusM) return Math.min(TIME_WARP.kosMax, top);
  return top;
}

// Largest level not above the allowed value.
export function clampWarpLevel(levels, wanted, allowed) {
  let best = levels[0];
  for (const l of levels) if (l <= Math.min(wanted, allowed)) best = l;
  return best;
}

// Alignment with the client's approach axis (LVLH +x through the client CM).
// d is measured along the axis from the docking face to the ring plane: d = x - 3.05 m.
// Pitch/yaw is the angle between the docking axis (body +X) and LVLH -x.
// Roll is the twist about body X relative to the docking attitude (START_ATTITUDE).
export function alignment(flight, vehicle) {
  const c = flight.cw;
  const rangeM = Math.hypot(c.x, c.y, c.z);
  const relativeSpeedMps = Math.hypot(c.vx, c.vy, c.vz);
  const rangeRateMps = rangeM > 1e-9 ? (c.x * c.vx + c.y * c.vy + c.z * c.vz) / rangeM : 0;

  const q = vehicle.attitude;
  const bodyX = quatRotateVec(q, { x: 1, y: 0, z: 0 });
  const pitchYawDeg = Math.acos(Math.max(-1, Math.min(1, -bodyX.x))) * RAD_TO_DEG;

  const ref = START_ATTITUDE;
  const rel = quatMultiply({ w: ref.w, x: -ref.x, y: -ref.y, z: -ref.z }, q);
  const s = rel.w >= 0 ? 1 : -1;
  let roll = 2 * Math.atan2(s * rel.x, s * rel.w);
  if (roll > Math.PI) roll -= 2 * Math.PI;
  if (roll < -Math.PI) roll += 2 * Math.PI;

  const w = vehicle.bodyRatesRadPerS;
  return {
    rangeM,
    rangeRateMps,
    relativeSpeedMps,
    dM: c.x - CAPTURE.axisOffsetM,
    lateralM: Math.hypot(c.y, c.z),
    pitchYawDeg,
    rollDeg: roll * RAD_TO_DEG,
    pitchYawRateDegS: Math.hypot(w.y, w.z) * RAD_TO_DEG,
    rollRateDegS: Math.abs(w.x) * RAD_TO_DEG
  };
}
