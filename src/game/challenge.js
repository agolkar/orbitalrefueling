// src/game/challenge.js
// Capture challenges: level start states, the client's attitude drift, the servicer's position
// relative to the client's nozzle axis, the capture window, the probe extension into the nozzle,
// the retraction, failures, feedback text, score and stars. No three.js and no DOM.
//
// It also models the de-spin of the docked stack after hard capture in a scenario with a spinning
// client, so the docked levels 5 to 7 start from a still stack.

import { CAPTURE, CHASER, CLIENT, CLIENT_MODELS, CHALLENGE, START_ATTITUDE, DEG_TO_RAD, RAD_TO_DEG } from '../config.js';
import { ChaserVehicle, quatMultiply, quatRotateVec, quatFromAxisAngle, quatNormalize } from '../physics/vehicle.js';
import { createFlight } from '../physics/flight.js';

const FACE_X = CHASER.dockingFaceAheadOfCmM; // docking face ahead of the servicer CM, m
const TIP_STOWED_X = FACE_X + 0.15; // stowed probe tip ahead of the servicer CM, m
const RING_X = CAPTURE.ringPlaneAboveClientCmM; // ring plane above the client CM, m
const EXIT_X = RING_X + CAPTURE.nozzleExitProtrusionM; // nozzle exit plane, m
// The folded tip enters the nozzle if its centre is this close to the axis at the exit plane.
export const NOZZLE_ENTRY_M = CAPTURE.laeExitDiameterM / 2 - CAPTURE.probeTipFoldedDiameterM / 2 - 0.01;
export const STANCHION_CONTACT_DM = CAPTURE.stanchionLengthM; // d at which the stanchions touch the ring
export const DOCKED_DM = CAPTURE.dockedCmXM - CAPTURE.axisOffsetM; // 0.50 m

function conj(q) {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function levelById(id) {
  return CHALLENGE.levels.find((l) => l.id === id) || CHALLENGE.levels[0];
}

export function scenarioById(id) {
  return CHALLENGE.scenarios.find((s) => s.id === id) || CHALLENGE.scenarios[0];
}

// A level as flown in a scenario: the scenario scales the RCS budget, sets the time-out text and
// adds the client's spin and tumble.
// The docked levels (5 to 7) start from a still stack: no spin, no tumble, no roll control.
export function levelFor(id, scenario = CHALLENGE.scenarios[0]) {
  const base = levelById(id);
  const docked = !!base.docked;
  return {
    ...base,
    budgetMps: base.budgetMps * (scenario.budgetScale || 1),
    scenarioId: scenario.id,
    client: scenario.client || 'relay',
    clientInertiaKgM2: (CLIENT_MODELS[scenario.client] || { inertiaKgM2: CLIENT.inertiaKgM2 }).inertiaKgM2,
    spinDegS: docked ? 0 : scenario.spinDegS || 0,
    tumbleConeDeg: docked ? 0 : scenario.tumbleConeDeg || 0,
    tumblePeriodS: docked ? 0 : scenario.tumblePeriodS || 0,
    rollControl: docked ? false : !!scenario.rollControl,
    timeoutReason: (docked && scenario.dockedTimeoutReason) || scenario.timeoutReason,
    timeLimitText: (docked && scenario.dockedTimeLimitText) || scenario.timeLimitText,
    dockedNote: docked ? scenario.dockedNote || '' : ''
  };
}

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

function coneQuat(deg, periodS, t, phase0 = 0) {
  if (!deg || !periodS) return IDENTITY;
  const ph = phase0 + 2 * Math.PI * t / periodS;
  return quatFromAxisAngle({ x: 0, y: -Math.sin(ph), z: Math.cos(ph) }, deg * DEG_TO_RAD);
}

// Spin angle of the client about its engine axis (client +x), rad.
export function spinAngleRad(level, t) {
  return (level.spinDegS || 0) * DEG_TO_RAD * t;
}

// Direction of the client's engine axis without the spin: the level's cone (coneDeg, period
// conePeriodS) and the scenario's tumble cone (tumbleConeDeg, tumblePeriodS).
export function pointingQuat(level, t) {
  return quatMultiply(coneQuat(level.coneDeg, level.conePeriodS, t), coneQuat(level.tumbleConeDeg, level.tumblePeriodS, t, Math.PI / 3));
}

// Client attitude in LVLH: pointing, then the spin about its own engine axis. spinRad replaces
// the free spin angle (the de-spin after hard capture).
export function clientQuat(level, t, spinRad = null) {
  const p = pointingQuat(level, t);
  const spin = spinRad === null ? spinAngleRad(level, t) : spinRad;
  if (!spin) return p;
  return quatMultiply(p, quatFromAxisAngle({ x: 1, y: 0, z: 0 }, spin));
}

export function clientAxis(level, t) {
  return quatRotateVec(clientQuat(level, t), { x: 1, y: 0, z: 0 });
}

// Client angular velocity in LVLH, rad/s.
export function clientOmega(level, t) {
  if (!level.coneDeg && !level.tumbleConeDeg && !level.spinDegS) return { x: 0, y: 0, z: 0 };
  const h = 0.01;
  const dq = quatMultiply(clientQuat(level, t + h), conj(clientQuat(level, t)));
  const s = dq.w >= 0 ? 1 : -1;
  return { x: 2 * s * dq.x / h, y: 2 * s * dq.y / h, z: 2 * s * dq.z / h };
}

// Servicer attitude commanded by its guidance: the docking axis on the client's engine axis.
// The guidance does not follow the client's spin: rollRad is the roll about body X that the
// player commands with U and O (scenarios with rollControl). Without spin this is the client's
// attitude.
export function trackingAttitude(level, t, rollRad = 0) {
  const q = quatMultiply(pointingQuat(level, t), START_ATTITUDE);
  if (!rollRad) return quatNormalize(q);
  return quatNormalize(quatMultiply(q, quatFromAxisAngle({ x: 1, y: 0, z: 0 }, rollRad)));
}

// Servicer attitude once the probe holds the client: it turns with the client. rollOffsetRad is
// fixed at soft capture so that the attitude is continuous (rollRad + spin angle).
export function attachedAttitude(level, t, rollOffsetRad = 0, spinRad = null) {
  const q = quatMultiply(clientQuat(level, t, spinRad), START_ATTITUDE);
  if (!rollOffsetRad) return quatNormalize(q);
  return quatNormalize(quatMultiply(q, quatFromAxisAngle({ x: 1, y: 0, z: 0 }, rollOffsetRad)));
}

// Roll command: U and O fire the roll couple (44 N m on the servicer's roll inertia); a held key
// changes the commanded roll rate by about 0.59 deg/s per second. intent is -1, 0 or +1.
export const ROLL_ACCEL_RADS2 = CHASER.rcsRotationTorqueNm / CHASER.inertiaKgM2[0];
export function rollStep(ch, intent, dt) {
  ch.rollRateRadS += intent * ROLL_ACCEL_RADS2 * dt;
  ch.rollRad += ch.rollRateRadS * dt;
}

// Start of a level: servicer on (or near) the nozzle axis at startDm, velocity in the client frame.
export function startState(level) {
  const qc = clientQuat(level, 0);
  const rC = { x: level.startDm + CAPTURE.axisOffsetM, y: level.offset.y, z: level.offset.z };
  const r = quatRotateVec(qc, rC);
  const v = quatRotateVec(qc, level.velocity);
  const flight = createFlight({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z });
  const vehicle = new ChaserVehicle();
  vehicle.attitude = trackingAttitude(level, 0);
  vehicle.heldAttitude = { ...vehicle.attitude };
  vehicle.attitudeHold = true;
  return { flight, vehicle };
}

// Geometry relative to the client: d (docking face to ring plane), the probe tip's offset from
// the nozzle axis and its velocity relative to the client point it passes, the angle between the
// docking axis and the nozzle axis, and the relative rates.
export function relativeState(level, flight, vehicle, t, extensionM = 0) {
  const qc = clientQuat(level, t);
  const qci = conj(qc);
  const c = flight.cw;
  const att = vehicle.attitude;
  const atti = conj(att);
  const r = { x: c.x, y: c.y, z: c.z };
  const v = { x: c.vx, y: c.vy, z: c.vz };
  const wChaser = quatRotateVec(att, vehicle.bodyRatesRadPerS);
  const wClient = clientOmega(level, t);
  const tipArm = quatRotateVec(att, { x: TIP_STOWED_X + extensionM, y: 0, z: 0 });
  const faceArm = quatRotateVec(att, { x: FACE_X, y: 0, z: 0 });
  const tip = add(r, tipArm);
  const tipC = quatRotateVec(qci, tip);
  const faceC = quatRotateVec(qci, add(r, faceArm));
  const relVel = sub(add(v, cross(wChaser, tipArm)), cross(wClient, tip));
  const relVelC = quatRotateVec(qci, relVel);
  const axis = quatRotateVec(qc, { x: 1, y: 0, z: 0 });
  const bodyX = quatRotateVec(att, { x: 1, y: 0, z: 0 });
  const cosA = -(bodyX.x * axis.x + bodyX.y * axis.y + bodyX.z * axis.z);
  const wRelBody = quatRotateVec(atti, sub(wChaser, wClient));
  // Tip offset from the axis and relative velocity in the servicer body axes (y left, z up).
  const offBody = quatRotateVec(atti, quatRotateVec(qc, { x: 0, y: tipC.y, z: tipC.z }));
  const velBody = quatRotateVec(atti, relVel);
  return {
    dM: faceC.x - RING_X,
    tipToExitM: tipC.x - EXIT_X,
    lateralM: Math.hypot(tipC.y, tipC.z),
    closingMps: -relVelC.x,
    lateralSpeedMps: Math.hypot(relVelC.y, relVelC.z),
    relSpeedMps: Math.hypot(relVelC.x, relVelC.y, relVelC.z),
    angleDeg: Math.acos(clamp(cosA, -1, 1)) * RAD_TO_DEG,
    rollRateDegS: Math.abs(wRelBody.x) * RAD_TO_DEG,
    rollRateSignedDegS: wRelBody.x * RAD_TO_DEG, // > 0: the servicer turns faster than the client about body +X
    pitchYawRateDegS: Math.hypot(wRelBody.y, wRelBody.z) * RAD_TO_DEG,
    offsetBody: { y: offBody.y, z: offBody.z },
    velocityBody: { y: velBody.y, z: velBody.z },
    rangeM: Math.hypot(c.x, c.y, c.z)
  };
}

// Recommended closing speed for a distance d: up to 10 cm/s (the envelope inside 30 m), down
// to 2 cm/s at the capture point.
export function recommendedMps(dM) {
  return clamp(0.02 + 0.04 * (dM - CAPTURE.captureDm), 0.02, 0.10);
}

export function windowChecks(rs) {
  return {
    distance: Math.abs(rs.dM - CAPTURE.captureDm) <= CAPTURE.captureDToleranceM,
    centred: rs.lateralM <= CAPTURE.lateralToleranceM,
    speed: rs.relSpeedMps <= CAPTURE.relativeSpeedToleranceMps,
    aligned: rs.angleDeg <= CAPTURE.pitchYawToleranceDeg
      && rs.pitchYawRateDegS <= CAPTURE.pitchYawRateToleranceDegS
      && rs.rollRateDegS <= CAPTURE.rollRateToleranceDegS
  };
}

export function createChallenge(level, deltaVUsedMps = 0) {
  return {
    level,
    phase: 'fly', // fly, extending, retracting, success, failed
    t: 0,
    extensionM: 0,
    strokeM: 0,
    entered: false,
    dvStart: deltaVUsedMps,
    impingementS: 0,
    envelopeS: 0,
    capture: null, // relative state when SPACE was accepted
    rollRad: 0, // commanded roll about body X (scenarios with rollControl)
    rollRateRadS: 0,
    rollOffsetRad: 0, // roll relative to the client once attached
    message: '',
    messageS: 0,
    rs: null,
    result: null
  };
}

function nogoText(checks, rs) {
  if (!checks.distance) return rs.dM > CAPTURE.captureDm ? `d is ${rs.dM.toFixed(2)} m: come to 1.00 m` : `d is ${rs.dM.toFixed(2)} m: back off to 1.00 m`;
  if (!checks.centred) return `${(100 * rs.lateralM).toFixed(0)} cm off the nozzle axis: centre within 10 cm`;
  if (!checks.speed) return `relative speed ${(100 * rs.relSpeedMps).toFixed(1)} cm/s: slow below 2 cm/s`;
  if (rs.rollRateDegS > CAPTURE.rollRateToleranceDegS) {
    return `the client still turns ${rs.rollRateDegS.toFixed(1)} deg/s relative to you: match the spin with U or O`;
  }
  return 'not aligned with the nozzle axis yet';
}

function finish(ch, vehicle, success, reason) {
  ch.phase = success ? 'success' : 'failed';
  const level = ch.level;
  const dv = vehicle.deltaVUsedMps - ch.dvStart;
  const timeLeft = Math.max(0, level.timeS - (ch.captureT !== undefined ? ch.captureT : ch.t));
  let score = 0;
  let stars = 0;
  let quality = 0;
  if (success && ch.capture) {
    const e = ch.capture;
    quality = clamp(1 - (e.lateralM / CAPTURE.lateralToleranceM
      + Math.abs(e.dM - CAPTURE.captureDm) / CAPTURE.captureDToleranceM
      + e.relSpeedMps / CAPTURE.relativeSpeedToleranceMps
      + e.angleDeg / CAPTURE.pitchYawToleranceDeg) / 4, 0, 1);
    // 400 for precision, 300 for time (full with 40 % of the time left), 300 for propellant
    // (full with half the budget left), minus penalties.
    const penalty = Math.min(300, 40 * (ch.impingementS + ch.envelopeS));
    const timePart = clamp(timeLeft / (0.4 * level.timeS), 0, 1);
    const fuelPart = clamp((level.budgetMps - dv) / (0.5 * level.budgetMps), 0, 1);
    score = Math.max(0, Math.round(400 * quality + 300 * timePart + 300 * fuelPart - penalty));
    stars = score >= 750 ? 3 : score >= 550 ? 2 : 1;
  }
  ch.result = {
    success,
    reason,
    score,
    stars,
    timeS: ch.t,
    timeLeftS: timeLeft,
    deltaVMps: dv,
    budgetMps: level.budgetMps,
    impingementS: ch.impingementS,
    envelopeS: ch.envelopeS,
    quality,
    capture: ch.capture
  };
}

// One frame after the physics step. dt: simulated seconds of this frame.
// events.capture: SPACE pressed; events.forceBodyN: frame-averaged thrust (body axes).
export function updateChallenge(ch, flight, vehicle, dt, events = {}) {
  if (ch.phase === 'success' || ch.phase === 'failed') return ch;
  const level = ch.level;
  ch.t += dt;
  ch.messageS = Math.max(0, ch.messageS - dt);
  if (ch.phase === 'extending') ch.extensionM = Math.min(ch.strokeM, ch.extensionM + CAPTURE.extensionRateMps * dt);
  const rs = relativeState(level, flight, vehicle, ch.t, ch.extensionM);
  ch.rs = rs;
  const dv = vehicle.deltaVUsedMps - ch.dvStart;

  if (ch.phase === 'retracting') {
    if (rs.dM <= DOCKED_DM + 1e-3) finish(ch, vehicle, true, 'Docked: the stanchions sit on the launch adapter ring.');
    return ch;
  }

  // Failures.
  if (ch.t > level.timeS && ch.phase === 'fly') {
    finish(ch, vehicle, false, level.timeoutReason || 'Time is up: the Sun now glares into the docking camera.');
    return ch;
  }
  if (dv > level.budgetMps) {
    finish(ch, vehicle, false, 'The RCS budget for this approach is used up.');
    return ch;
  }
  if (rs.dM < STANCHION_CONTACT_DM || (ch.phase === 'fly' && rs.tipToExitM < 0 && rs.lateralM < CAPTURE.ringRadiusM)) {
    finish(ch, vehicle, false, 'Contact before capture: the probe hit the nozzle.');
    return ch;
  }
  if (rs.dM > level.startDm + CHALLENGE.driftAwayM) {
    finish(ch, vehicle, false, 'You drifted away from the client.');
    return ch;
  }

  // Penalties: braking thrust (-X force, exhaust toward the client) close in, envelope.
  const fx = events.forceBodyN ? events.forceBodyN.x : 0;
  if (level.impingement && fx < 0 && rs.dM < CHALLENGE.impingementDm) ch.impingementS += dt;
  if (rs.relSpeedMps > 0.10) ch.envelopeS += dt;

  if (ch.phase === 'fly' && events.capture) {
    const checks = windowChecks(rs);
    if (checks.distance && checks.centred && checks.speed && checks.aligned) {
      ch.phase = 'extending';
      ch.capture = { ...rs };
      ch.captureT = ch.t;
      ch.strokeM = Math.min(CAPTURE.maxStrokeM, rs.dM + CAPTURE.strokeOffsetM);
      ch.message = 'GO for capture: probe extending';
      ch.messageS = 3;
    } else {
      ch.message = `NO GO: ${nogoText(checks, rs)}`;
      ch.messageS = 3;
    }
  }

  if (ch.phase === 'extending') {
    if (!ch.entered && rs.tipToExitM <= 0) {
      if (rs.lateralM <= NOZZLE_ENTRY_M) {
        ch.entered = true;
        ch.message = 'The probe tip is in the nozzle';
        ch.messageS = 3;
      } else {
        finish(ch, vehicle, false, `The probe tip hit the nozzle rim, ${(100 * rs.lateralM).toFixed(0)} cm off the axis.`);
        return ch;
      }
    }
    if (ch.extensionM >= ch.strokeM - 1e-9) {
      if (ch.entered) {
        ch.phase = 'retracting';
        ch.rollOffsetRad = ch.rollRad + spinAngleRad(level, ch.t);
        ch.message = 'Soft capture: the probe fingers opened in the combustion chamber';
        ch.messageS = 4;
      } else {
        finish(ch, vehicle, false, 'The probe did not reach the nozzle.');
      }
    }
  }
  return ch;
}

// During the retraction the probe pulls the servicer down the axis to the docked position.
export function retractStep(ch, flight, vehicle, dt) {
  const level = ch.level;
  const qc = clientQuat(level, ch.t);
  const rC = quatRotateVec(conj(qc), { x: flight.cw.x, y: flight.cw.y, z: flight.cw.z });
  const step = CHALLENGE.retractSpeedMps * dt;
  const target = CAPTURE.dockedCmXM;
  rC.x = Math.max(target, rC.x - step);
  const k = Math.exp(-dt / 2);
  rC.y *= k;
  rC.z *= k;
  const r = quatRotateVec(qc, rC);
  flight.cw = { x: r.x, y: r.y, z: r.z, vx: 0, vy: 0, vz: 0 };
  vehicle.attitude = attachedAttitude(level, ch.t, ch.rollOffsetRad);
  vehicle.heldAttitude = { ...vehicle.attitude };
  vehicle.bodyRatesRadPerS = { x: 0, y: 0, z: 0 };
  ch.extensionM = Math.max(0, ch.extensionM - step);
}

// Arrow keys that move the servicer by (dy, dz) in its body axes (y left, z up), as seen in the
// docking camera; small components are left out.
function arrowsFor(dy, dz) {
  const m = Math.max(Math.abs(dy), Math.abs(dz));
  const out = [];
  if (Math.abs(dy) > 0.3 * m) out.push(dy > 0 ? '←' : '→');
  if (Math.abs(dz) > 0.3 * m) out.push(dz > 0 ? '↑' : '↓');
  return out.join(' ');
}

// Feedback for the player: one line, no key counts.
export function feedback(ch) {
  const rs = ch.rs;
  if (!rs) return { text: '', tone: 'info' };
  if (ch.messageS > 0 && ch.message) return { text: ch.message, tone: ch.message.startsWith('NO GO') ? 'bad' : 'go' };
  if (ch.phase === 'extending') return { text: ch.entered ? 'In the nozzle: hold steady' : 'Probe extending: hold steady', tone: 'go' };
  if (ch.phase === 'retracting') return { text: 'Retracting the probe: the two satellites pull together', tone: 'go' };
  const checks = windowChecks(rs);
  if (checks.distance && checks.centred && checks.speed && checks.aligned) return { text: 'CAPTURE WINDOW: press SPACE', tone: 'go' };
  const rec = recommendedMps(rs.dM);
  if (rs.closingMps > rec + 0.01) {
    const plume = ch.level.impingement && rs.dM < CHALLENGE.impingementDm ? ' (this close, braking hits the client with the plume)' : '';
    return { text: `Too fast for ${rs.dM.toFixed(1)} m: hold S to brake${plume}`, tone: 'bad' };
  }
  if (ch.level.rollControl) {
    // r > 0: the servicer turns faster than the client about body +X, so roll toward -X (U).
    const r = rs.rollRateSignedDegS;
    const key = r > 0 ? 'U' : 'O';
    if (Math.abs(r) > 0.5) return { text: `The client turns ${Math.abs(r).toFixed(1)} deg/s relative to you: hold ${key} to roll with it`, tone: 'act' };
    if (Math.abs(r) > 0.15 && rs.dM < 3) return { text: `Still turning ${Math.abs(r).toFixed(2)} deg/s relative to the client: tap ${key}`, tone: 'act' };
  }
  if (rs.dM < CAPTURE.captureDm - CAPTURE.captureDToleranceM) return { text: 'Too close: hold S gently to back off to 1 m', tone: 'bad' };
  const side = [];
  const o = rs.offsetBody;
  const v = rs.velocityBody;
  // The nozzle appears right of the reticle when the tip is left of the axis (o.y > 0).
  if (Math.abs(o.y) > 0.03) side.push(`${(100 * Math.abs(o.y)).toFixed(0)} cm ${o.y > 0 ? 'right' : 'left'}`);
  if (Math.abs(o.z) > 0.03) side.push(`${(100 * Math.abs(o.z)).toFixed(0)} cm ${o.z > 0 ? 'down' : 'up'}`);
  const tol = Math.max(CAPTURE.lateralToleranceM, 0.04 * rs.dM);
  // Speed towards the axis, and whether the sideways motion points at it.
  const towards = -(o.y * v.y + o.z * v.z) / Math.max(1e-9, rs.lateralM);
  const aimed = towards > 0.004 && towards > 0.7 * rs.lateralSpeedMps;
  const tAxis = aimed ? rs.lateralM / towards : Infinity;
  const stopKeys = arrowsFor(-v.y, -v.z);
  if (rs.lateralM > 0.03 && aimed && tAxis < 3) {
    return { text: `The nozzle is reaching the reticle: tap ${stopKeys} to stop the sideways motion`, tone: 'act' };
  }
  if (rs.lateralM > tol || rs.lateralSpeedMps > 0.008) {
    if (rs.lateralM > 0.03 && aimed && tAxis <= 15) {
      return { text: `Sliding onto the axis: tap ${stopKeys} when the nozzle reaches the reticle`, tone: 'ok' };
    }
    if (rs.lateralM > tol) return { text: `The nozzle is ${side.join(' and ')} of the reticle: tap ${arrowsFor(-o.y, -o.z)}`, tone: 'act' };
    return { text: `Drifting sideways at ${(100 * rs.lateralSpeedMps).toFixed(1)} cm/s: tap ${stopKeys} to stop`, tone: 'act' };
  }
  if (rs.dM > CAPTURE.captureDm + CAPTURE.captureDToleranceM && rs.closingMps < 0.4 * rec) return { text: 'Hold W to close in: aim for the green band', tone: 'act' };
  if (rs.dM <= CAPTURE.captureDm + CAPTURE.captureDToleranceM && rs.relSpeedMps > CAPTURE.relativeSpeedToleranceMps) return { text: 'Slow down below 2 cm/s for the capture', tone: 'act' };
  return { text: 'Good: keep the nozzle in the reticle and the speed in the green band', tone: 'ok' };
}

// ---------------------------------------------------------------------------
// De-spin of the docked stack after hard capture with a spinning client. The servicer fires its
// roll couple against the spin; the stack (servicer and client roll inertias about the common
// docking axis) slows down at constant deceleration until it holds still.

// Deceleration of the stack (rad/s^2) with the client of the level (its roll inertia).
export function despinAccelRadS2(level) {
  const client = (level && level.clientInertiaKgM2) || CLIENT.inertiaKgM2;
  return CHASER.rcsRotationTorqueNm / (CHASER.inertiaKgM2[0] + client[0]);
}
export const DESPIN_ACCEL_RADS2 = despinAccelRadS2(null);

// t0: level time of the hard capture. The spin angle at that time continues smoothly.
export function createDespin(level, t0) {
  const rate0 = (level.spinDegS || 0) * DEG_TO_RAD;
  const accel = despinAccelRadS2(level);
  return {
    t0,
    t: 0,
    rate0,
    accel,
    angle0: spinAngleRad(level, t0),
    durationS: rate0 / accel,
    done: rate0 === 0
  };
}

export function stepDespin(d, dtS) {
  if (d.done) return d;
  d.t = Math.min(d.durationS, d.t + dtS);
  if (d.t >= d.durationS) d.done = true;
  return d;
}

export function despinRateRadS(d) {
  return Math.max(0, d.rate0 - d.accel * d.t);
}

// Spin angle of the stack during the de-spin (rad), for clientQuat and attachedAttitude.
export function despinAngleRad(d) {
  const t = Math.min(d.t, d.durationS);
  return d.angle0 + d.rate0 * t - 0.5 * d.accel * t * t;
}

export function despinText(d) {
  if (d.done) return 'Stack de-spun: the client holds still';
  return `Hard capture. De-spinning the stack with the roll thrusters: ${(despinRateRadS(d) * RAD_TO_DEG).toFixed(2)} deg/s (SPACE skips)`;
}
