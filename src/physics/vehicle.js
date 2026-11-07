// src/physics/vehicle.js
// Chaser 6-DoF state helpers: mass, propellant, RCS, attitude.
// No three.js and no DOM access.

import { CHASER, G0, DEG_TO_RAD, START_ATTITUDE } from '../config.js';

export function mdotKgPerS(forceN, ispS, g0 = G0) {
  if (forceN <= 0 || ispS <= 0) return 0;
  return forceN / (ispS * g0);
}

export function propellantForBurnKg(forceN, durationS, ispS = CHASER.ispS, g0 = G0) {
  if (durationS <= 0) return 0;
  return mdotKgPerS(forceN, ispS, g0) * durationS;
}

export function deltaVForBurnMps(forceN, initialMassKg, durationS, ispS = CHASER.ispS, g0 = G0) {
  if (forceN <= 0 || initialMassKg <= 0 || durationS <= 0 || ispS <= 0) return 0;
  const mdot = mdotKgPerS(forceN, ispS, g0);
  const consumed = mdot * durationS;
  const finalMass = Math.max(1e-9, initialMassKg - consumed);
  return ispS * g0 * Math.log(initialMassKg / finalMass);
}

export function quatIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quatMultiply(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}

export function quatNormalize(q) {
  const mag = Math.hypot(q.w, q.x, q.y, q.z);
  if (mag <= 0) return quatIdentity();
  return { w: q.w / mag, x: q.x / mag, y: q.y / mag, z: q.z / mag };
}

export function quatRotateVec(q, v) {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const t = quatMultiply(q, quatMultiply(qv, qi));
  return { x: t.x, y: t.y, z: t.z };
}

export function quatFromAxisAngle(axis, angleRad) {
  const mag = Math.hypot(axis.x, axis.y, axis.z);
  if (mag <= 0 || angleRad === 0) return quatIdentity();
  const half = angleRad * 0.5;
  const s = Math.sin(half) / mag;
  return quatNormalize({ w: Math.cos(half), x: axis.x * s, y: axis.y * s, z: axis.z * s });
}

// Attitude kinematics q' = 0.5 q * omega, body rates relative to LVLH.
export function integrateAttitude(q, omega, dtS) {
  if (dtS <= 0) return quatNormalize(q);
  const wq = { x: omega.x, y: omega.y, z: omega.z, w: 0 };
  const dq = quatMultiply(q, wq);
  const half = 0.5 * dtS;
  return quatNormalize({
    w: q.w + dq.w * half,
    x: q.x + dq.x * half,
    y: q.y + dq.y * half,
    z: q.z + dq.z * half
  });
}

// Rotation vector of q relative to qRef, expressed in qRef frame (small-angle).
export function quatErrorVec(qRef, q) {
  const qi = { x: -qRef.x, y: -qRef.y, z: -qRef.z, w: qRef.w };
  const d = quatMultiply(qi, q);
  const sign = d.w >= 0 ? 1 : -1;
  return {
    x: 2 * sign * d.x,
    y: 2 * sign * d.y,
    z: 2 * sign * d.z
  };
}

// Propellant for a combined-axis burn. Each firing thruster consumes F / (Isp g0);
// the flow is the sum over the axes, the delta-v comes from the resultant.
export function combinedBurn(forceBodyN, initialMassKg, durationS, ispS = CHASER.ispS, g0 = G0) {
  const fx = Math.abs(forceBodyN.x);
  const fy = Math.abs(forceBodyN.y);
  const fz = Math.abs(forceBodyN.z);
  const mdotSum = (fx + fy + fz) / (ispS * g0);
  const forceMag = Math.hypot(forceBodyN.x, forceBodyN.y, forceBodyN.z);
  const propellantKg = mdotSum * durationS;
  const finalMass = Math.max(1e-9, initialMassKg - propellantKg);
  const deltaVMps = forceMag > 0 && mdotSum > 0
    ? (forceMag / mdotSum) * Math.log(initialMassKg / finalMass)
    : 0;
  return { propellantKg, deltaVMps, finalMassKg: finalMass };
}

export class ChaserVehicle {
  constructor() {
    this.dryMassKg = CHASER.dryMassKg;
    this.ownPropellantKg = CHASER.ownPropellantKg;
    this.cargoPropellantKg = CHASER.cargoPropellantKg;
    this.inertiaKgM2 = [...CHASER.inertiaKgM2];
    this.attitude = quatNormalize({ ...START_ATTITUDE });
    this.heldAttitude = quatNormalize({ ...START_ATTITUDE });
    this.bodyRatesRadPerS = { x: 0, y: 0, z: 0 };
    this.deltaVUsedMps = 0;
    this.translationMode = 'PULSE';
    this.attitudeHold = true;
  }

  get massKg() {
    return this.dryMassKg + this.ownPropellantKg + this.cargoPropellantKg;
  }

  get ownPropellantMassKg() {
    return this.ownPropellantKg;
  }

  get cargoPropellantMassKg() {
    return this.cargoPropellantKg;
  }

  // Translation burn: forceBodyN in body axes, durationS in s.
  burnTranslation(forceBodyN, durationS) {
    if (durationS <= 0) {
      return { propellantKg: 0, deltaVMps: 0, massAfterKg: this.massKg };
    }
    const m0 = this.massKg;
    const requested = combinedBurn(forceBodyN, m0, durationS, CHASER.ispS);
    const propellantKg = Math.min(this.ownPropellantKg, requested.propellantKg);
    const scale = requested.propellantKg > 0 ? propellantKg / requested.propellantKg : 0;
    const effectiveDurationS = durationS * scale;
    const effective = combinedBurn(forceBodyN, m0, effectiveDurationS, CHASER.ispS);
    this.ownPropellantKg = Math.max(0, this.ownPropellantKg - propellantKg);
    this.deltaVUsedMps += effective.deltaVMps;
    return { propellantKg, deltaVMps: effective.deltaVMps, massAfterKg: this.massKg };
  }

  // Rotation pulse: fire the couple for I * deltaRate / 44 N m.
  rotationPulse(axis, deltaRateRadPerS) {
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const inertia = this.inertiaKgM2[idx];
    const torque = CHASER.rcsRotationTorqueNm;
    const durationS = Math.abs(inertia * deltaRateRadPerS) / torque;
    const mdot = 2 * CHASER.rcsThrusterForceN / (CHASER.ispS * G0);
    const requestedKg = mdot * durationS;
    const propellantKg = Math.min(this.ownPropellantKg, requestedKg);
    const scale = requestedKg > 0 ? propellantKg / requestedKg : 0;
    this.ownPropellantKg = Math.max(0, this.ownPropellantKg - propellantKg);
    if (axis === 'x') this.bodyRatesRadPerS.x += deltaRateRadPerS * scale;
    if (axis === 'y') this.bodyRatesRadPerS.y += deltaRateRadPerS * scale;
    if (axis === 'z') this.bodyRatesRadPerS.z += deltaRateRadPerS * scale;
    this.attitudeHold = false;
    return { propellantKg, durationS: durationS * scale };
  }

  addRotationInput(axis, degPerPress = CHASER.rotationStepDegPerPress) {
    return this.rotationPulse(axis, degPerPress * DEG_TO_RAD);
  }

  enableAttitudeHold() {
    this.heldAttitude = quatNormalize({ ...this.attitude });
    this.attitudeHold = true;
  }

  disableAttitudeHold() {
    this.attitudeHold = false;
  }

  // PD attitude hold per axis, clamped to 44 N m, applied as thruster on-time.
  attitudeHoldStep(dtS) {
    if (!this.attitudeHold || dtS <= 0) return { propellantKg: 0, appliedTorqueNm: { x: 0, y: 0, z: 0 } };

    const wn = CHASER.attitudeHoldKpWnRadPerS;
    const zeta = CHASER.attitudeHoldZeta;
    const torqueMax = CHASER.rcsRotationTorqueNm;
    const minPulse = CHASER.attitudeHoldMinPulseS;
    const minPulseFrac = CHASER.attitudeHoldMinPulseFrac;

    const err = quatErrorVec(this.heldAttitude, this.attitude);
    const axes = ['x', 'y', 'z'];
    let totalPropKg = 0;
    const mdot = 2 * CHASER.rcsThrusterForceN / (CHASER.ispS * G0);
    const applied = { x: 0, y: 0, z: 0 };

    for (let i = 0; i < 3; i += 1) {
      const axis = axes[i];
      const inertia = this.inertiaKgM2[i];
      const kp = inertia * wn * wn;
      const kd = 2 * zeta * inertia * wn;
      const errAxis = i === 0 ? err.x : i === 1 ? err.y : err.z;
      const rateAxis = this.bodyRatesRadPerS[axis];
      let tau = -kp * errAxis - kd * rateAxis;
      tau = Math.max(-torqueMax, Math.min(torqueMax, tau));

      // The couple fires at full torque for the on-time, so the angular impulse is tau * dt.
      let onTime = Math.abs(tau) / torqueMax * dtS;
      if (onTime < minPulse) {
        onTime = Math.abs(tau) / torqueMax > minPulseFrac ? minPulse : 0;
      }
      // A step shorter than the minimum pulse (high frame rates) gets at most the full couple.
      onTime = Math.min(onTime, dtS);
      if (onTime <= 0) continue;
      const impulse = Math.sign(tau) * torqueMax * onTime;
      this.bodyRatesRadPerS[axis] += impulse / inertia;
      applied[axis] = impulse / dtS;
      totalPropKg += mdot * onTime;
    }

    const propellantKg = Math.min(this.ownPropellantKg, totalPropKg);
    this.ownPropellantKg = Math.max(0, this.ownPropellantKg - propellantKg);

    // Integrate attitude kinematics.
    this.attitude = integrateAttitude(this.attitude, this.bodyRatesRadPerS, dtS);

    return { propellantKg, appliedTorqueNm: applied };
  }
}
