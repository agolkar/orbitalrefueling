// src/game/rules.js
// Zones, speed envelope, capture window, CAM, departure check, scoring.
// No three.js and no DOM access.

import { CAPTURE, RULES, SCORING, DEG_TO_RAD, RAD_TO_DEG } from '../config.js';
import { propagateClosedForm, periodS } from '../physics/cw.js';

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// ---------------------------------------------------------------------------
// Zones and envelope

// CM-to-CM range from the client centre.
export function rangeM(cw) {
  return Math.hypot(cw.x, cw.y, cw.z);
}

export function relativeSpeedMps(cw) {
  return Math.hypot(cw.vx, cw.vy, cw.vz);
}

export function rangeRateMps(cw) {
  const r = rangeM(cw);
  return r > 1e-9 ? (cw.x * cw.vx + cw.y * cw.vy + cw.z * cw.vz) / r : 0;
}

export function insideKos(cw) {
  return rangeM(cw) < RULES.kosRadiusM;
}

// Approach corridor: cone with a 10 deg half-angle about the docking axis (LVLH +x through
// the client CM), apex at the ring plane (x = 1.80 m), applied inside the KOS only.
// The chaser is inside the corridor when its position projected on the axis is beyond the
// apex and its lateral offset is within tan(halfAngle) * axialDistance.
export function insideCorridor(cw) {
  const apexX = CAPTURE.ringPlaneAboveClientCmM;
  const axial = cw.x - apexX;
  if (axial <= 0) return false;
  const lateral = Math.hypot(cw.y, cw.z);
  const tanHalf = Math.tan(RULES.corridorHalfAngleDeg * DEG_TO_RAD);
  return lateral <= tanHalf * axial;
}

// Speed envelope: closing speed limit by range. Returns the limit in m/s.
export function speedLimitMps(range) {
  for (const band of RULES.speedEnvelope) {
    if (range >= band.minRangeM) return band.maxSpeedMps;
  }
  return RULES.speedEnvelope[RULES.speedEnvelope.length - 1].maxSpeedMps;
}

// Closing speed is the magnitude of the relative velocity projected on the line of sight,
// but the prompt's envelope is checked against the relative speed magnitude for simplicity
// (recorded in ASSUMPTIONS.md). Returns { limit, speed, violation }.
export function envelopeCheck(cw) {
  const r = rangeM(cw);
  const limit = speedLimitMps(r);
  const speed = relativeSpeedMps(cw);
  return { limit, speed, violation: speed > limit };
}

// ---------------------------------------------------------------------------
// Capture window

// Alignment values from the flight module are already in display units where noted.
// The capture window uses the same values the HUD shows.
export function captureWindow(al, arcade = false) {
  const scale = arcade ? 2 : 1;
  const dErr = Math.abs(al.dM - CAPTURE.captureDm);
  const checks = [
    { key: 'd', value: dErr, limit: CAPTURE.captureDToleranceM * scale },
    { key: 'lateral', value: al.lateralM, limit: CAPTURE.lateralToleranceM * scale },
    { key: 'pitchYaw', value: al.pitchYawDeg, limit: CAPTURE.pitchYawToleranceDeg * scale },
    { key: 'roll', value: al.rollDeg, limit: CAPTURE.rollToleranceDeg * scale },
    { key: 'pitchYawRate', value: al.pitchYawRateDegS, limit: CAPTURE.pitchYawRateToleranceDegS * scale },
    { key: 'rollRate', value: al.rollRateDegS, limit: CAPTURE.rollRateToleranceDegS * scale },
    { key: 'speed', value: al.relativeSpeedMps, limit: CAPTURE.relativeSpeedToleranceMps * scale }
  ];
  const failed = checks.filter((c) => c.value > c.limit);
  return {
    ready: failed.length === 0,
    reason: failed.length ? failed[0].key : null,
    failed,
    checks
  };
}

// Score the capture by how far inside the window each value stayed during the extension.
// peaks: { d, lateral, pitchYaw, roll, pitchYawRate, rollRate, speed } (peak values).
export function captureScore(peaks, arcade = false) {
  const scale = arcade ? 2 : 1;
  const limits = {
    d: CAPTURE.captureDToleranceM * scale,
    lateral: CAPTURE.lateralToleranceM * scale,
    pitchYaw: CAPTURE.pitchYawToleranceDeg * scale,
    roll: CAPTURE.rollToleranceDeg * scale,
    pitchYawRate: CAPTURE.pitchYawRateToleranceDegS * scale,
    rollRate: CAPTURE.rollRateToleranceDegS * scale,
    speed: CAPTURE.relativeSpeedToleranceMps * scale
  };
  // The peaks use the capture-window keys; the weights and exponents in config name two of
  // them differently (d is dError, speed is relativeSpeed).
  const CONFIG_KEY = { d: 'dError', speed: 'relativeSpeed' };
  const weights = SCORING.captureWeights;
  const exponents = SCORING.captureExponents;
  let sum = 0;
  for (const key of Object.keys(limits)) {
    const ck = CONFIG_KEY[key] || key;
    const peak = Math.abs(peaks[key] || 0);
    const limit = limits[key];
    const p = exponents[ck] || 1;
    const s = limit > 0 ? Math.max(0, 1 - Math.pow(peak / limit, p)) : 0;
    sum += (weights[ck] || 0) * s;
  }
  return SCORING.captureMaxPoints * sum;
}

// ---------------------------------------------------------------------------
// Collision

// Bounding volumes: the chaser bus is 2.5 x 2.0 x 2.0 m; the client bus is 3.5 x 2.8 x 2.8 m.
// Contact anywhere other than probe and stanchions is a collision. For the game we use a
// simple CM-to-CM distance test with the sum of half-extents along the approach axis.
// The speed limit applies to contact only: far from the client a CAM or a fast approach is
// not a collision. A contact above 0.3 m/s is reported with the reason 'speed'.
export function collisionCheck(cw, contactSpeedMps) {
  const chaserHalf = 1.25; // m along body X
  const clientHalf = 1.75; // m along LVLH x
  const touch = chaserHalf + clientHalf;
  const r = rangeM(cw);
  if (r > touch) return { collision: false, reason: null };
  const speed = contactSpeedMps !== undefined ? contactSpeedMps : relativeSpeedMps(cw);
  return { collision: true, reason: speed > RULES.collisionSpeedMps ? 'speed' : 'contact' };
}

// ---------------------------------------------------------------------------
// CAM

const CAM_DIRECTIONS = (() => {
  const out = [];
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      for (const k of [-1, 0, 1]) {
        if (i === 0 && j === 0 && k === 0) continue;
        const m = Math.hypot(i, j, k);
        out.push({ x: i / m, y: j / m, z: k / m });
      }
    }
  }
  return out;
})();

// CAM selection: 26 unit directions. Discard directions with a non-positive initial range rate
// and directions whose range falls below the initial range at any time in the first 900 s.
// Among the rest pick the one that maximises the minimum range over [900 s, 2T].
export function selectCamDirection(cw, nRadPerS, periodS_) {
  const T = periodS_ || periodS(nRadPerS);
  const r0 = rangeM(cw);
  const r0Rate = rangeRateMps(cw);
  const dv = RULES.camImpulseMps;
  const firstWindow = RULES.camFirstWindowS;
  const samples = 180;
  const candidates = [];

  for (const dir of CAM_DIRECTIONS) {
    const s0 = {
      x: cw.x, y: cw.y, z: cw.z,
      vx: cw.vx + dir.x * dv,
      vy: cw.vy + dir.y * dv,
      vz: cw.vz + dir.z * dv
    };
    const initialRate = (s0.x * s0.vx + s0.y * s0.vy + s0.z * s0.vz) / Math.max(1e-9, r0);
    if (initialRate <= 0) continue;

    let minFirst = Infinity;
    for (let i = 0; i <= samples; i += 1) {
      const t = firstWindow * i / samples;
      const p = propagateClosedForm(s0, t, nRadPerS);
      const r = Math.hypot(p.x, p.y, p.z);
      if (r < minFirst) minFirst = r;
    }
    if (minFirst < r0) continue;

    let minLate = Infinity;
    for (let i = 0; i <= samples; i += 1) {
      const t = firstWindow + (2 * T - firstWindow) * i / samples;
      const p = propagateClosedForm(s0, t, nRadPerS);
      const r = Math.hypot(p.x, p.y, p.z);
      if (r < minLate) minLate = r;
    }
    candidates.push({ dir, minLate, minFirst });
  }

  if (candidates.length === 0) {
    // Fallback: largest minimum range over [0, 2T].
    let best = null;
    for (const dir of CAM_DIRECTIONS) {
      const s0 = {
        x: cw.x, y: cw.y, z: cw.z,
        vx: cw.vx + dir.x * dv,
        vy: cw.vy + dir.y * dv,
        vz: cw.vz + dir.z * dv
      };
      let minAll = Infinity;
      for (let i = 0; i <= samples; i += 1) {
        const t = 2 * T * i / samples;
        const p = propagateClosedForm(s0, t, nRadPerS);
        const r = Math.hypot(p.x, p.y, p.z);
        if (r < minAll) minAll = r;
      }
      if (!best || minAll > best.minAll) best = { dir, minAll };
    }
    return { direction: best.dir, minRangeM: best.minAll, fallback: true, candidates: 0 };
  }

  candidates.sort((a, b) => b.minLate - a.minLate);
  return { direction: candidates[0].dir, minRangeM: candidates[0].minLate, fallback: false, candidates: candidates.length };
}

// ---------------------------------------------------------------------------
// Departure

// SAFE when the closed-form prediction leaves the KOS within one orbit, stays outside it for
// two orbits, and never comes within 5 m of the target after the first 60 s.
export function departureCheck(cw, nRadPerS, periodS_) {
  const T = periodS_ || periodS(nRadPerS);
  if (nRadPerS === 0) {
    // Arcade: straight-line motion. SAFE if the range grows monotonically past the KOS.
    const r0 = rangeM(cw);
    const rate = rangeRateMps(cw);
    if (rate <= 0) return { safe: false, reason: 'closing' };
    return { safe: true, reason: null, exitTimeS: r0 < RULES.kosRadiusM ? (RULES.kosRadiusM - r0) / rate : 0 };
  }
  const samples = 360;
  let exitTime = null;
  let minAfter60 = Infinity;
  let insideAfterExit = false;
  let exitSeen = false;
  for (let i = 0; i <= samples; i += 1) {
    const t = 2 * T * i / samples;
    const p = propagateClosedForm(cw, t, nRadPerS);
    const r = Math.hypot(p.x, p.y, p.z);
    if (t <= T && r >= RULES.kosRadiusM && exitTime === null) {
      exitTime = t;
      exitSeen = true;
    }
    if (exitSeen && r < RULES.kosRadiusM) insideAfterExit = true;
    if (t > RULES.departureFirst60s && r < minAfter60) minAfter60 = r;
  }
  if (exitTime === null) return { safe: false, reason: 'kos', exitTimeS: null };
  if (insideAfterExit) return { safe: false, reason: 'reenter', exitTimeS: exitTime };
  if (minAfter60 < RULES.departureNoCloseApproachM) return { safe: false, reason: 'close', exitTimeS: exitTime };
  return { safe: true, reason: null, exitTimeS: exitTime };
}

// ---------------------------------------------------------------------------
// Scoring

export function deltaVScore(usedMps, referenceMps) {
  if (!(usedMps > 0) || !(referenceMps > 0)) return 0;
  const ratio = Math.min(1, referenceMps / usedMps);
  return SCORING.deltaVMaxPoints * ratio;
}

export function refuelScore(deliveredKg, faults) {
  const goal = SCORING.refuelGoalKg;
  const tol = SCORING.refuelGoalToleranceFrac;
  const err = Math.abs(deliveredKg - goal);
  const accuracy = err <= tol * goal ? 1 : Math.max(0, 1 - (err - tol * goal) / goal);
  const base = SCORING.refuelMaxPoints * accuracy;
  return Math.max(0, base - faults * SCORING.refuelFaultPenalty);
}

export function departureScore(safe, corrections) {
  if (!safe) return 0;
  return corrections === 0 ? SCORING.departureFirstPlanPoints : SCORING.departureCorrectedPoints;
}

export function grade(score) {
  const g = SCORING.grades;
  if (score >= g.A) return 'A';
  if (score >= g.B) return 'B';
  if (score >= g.C) return 'C';
  if (score >= g.D) return 'D';
  return 'F';
}

// Penalties are applied to the running score by the mission state machine.
export function penaltyFor(kind) {
  if (kind === 'envelope') return SCORING.envelopePenalty;
  if (kind === 'cam') return SCORING.camPenalty;
  return 0;
}

export const RULES_CONSTANTS = {
  kosRadiusM: RULES.kosRadiusM,
  corridorHalfAngleDeg: RULES.corridorHalfAngleDeg,
  holdPointsDm: RULES.holdPointsDm,
  captureDm: CAPTURE.captureDm
};
