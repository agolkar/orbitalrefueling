// src/physics/cw.js
// Clohessy-Wiltshire translational dynamics.
// No three.js and no DOM access.

const ZERO_ACCEL = Object.freeze({ x: 0, y: 0, z: 0 });

export function copyState(s) {
  return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
}

export function zeroState() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}

function derivative(s, nRadPerS, accel) {
  const n = nRadPerS;
  const n2 = n * n;
  return {
    x: s.vx,
    y: s.vy,
    z: s.vz,
    vx: 3 * n2 * s.x + 2 * n * s.vy + accel.x,
    vy: -2 * n * s.vx + accel.y,
    vz: -n2 * s.z + accel.z
  };
}

function addScaledState(s, d, scale) {
  return {
    x: s.x + d.x * scale,
    y: s.y + d.y * scale,
    z: s.z + d.z * scale,
    vx: s.vx + d.vx * scale,
    vy: s.vy + d.vy * scale,
    vz: s.vz + d.vz * scale
  };
}

export function rk4Step(state, accel, dtS, nRadPerS) {
  const a = accel || ZERO_ACCEL;
  const k1 = derivative(state, nRadPerS, a);
  const k2 = derivative(addScaledState(state, k1, dtS * 0.5), nRadPerS, a);
  const k3 = derivative(addScaledState(state, k2, dtS * 0.5), nRadPerS, a);
  const k4 = derivative(addScaledState(state, k3, dtS), nRadPerS, a);
  const sixth = dtS / 6;
  return {
    x: state.x + sixth * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: state.y + sixth * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: state.z + sixth * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
    vx: state.vx + sixth * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx),
    vy: state.vy + sixth * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy),
    vz: state.vz + sixth * (k1.vz + 2 * k2.vz + 2 * k3.vz + k4.vz)
  };
}

export function propagateRK4(state, durationS, nRadPerS, accel, maxStepS) {
  const a = accel || ZERO_ACCEL;
  const maxStep = maxStepS && maxStepS > 0 ? maxStepS : 0.5;
  let s = copyState(state);
  if (durationS === 0) return s;

  const sign = durationS >= 0 ? 1 : -1;
  const absT = Math.abs(durationS);
  const steps = Math.max(1, Math.ceil(absT / maxStep));
  const dt = sign * absT / steps;
  for (let i = 0; i < steps; i += 1) {
    s = rk4Step(s, a, dt, nRadPerS);
  }
  return s;
}

export function propagateClosedForm(state, durationS, nRadPerS) {
  const t = durationS;
  const n = nRadPerS;
  const x0 = state.x;
  const y0 = state.y;
  const z0 = state.z;
  const vx0 = state.vx;
  const vy0 = state.vy;
  const vz0 = state.vz;

  if (n === 0) {
    return {
      x: x0 + vx0 * t,
      y: y0 + vy0 * t,
      z: z0 + vz0 * t,
      vx: vx0,
      vy: vy0,
      vz: vz0
    };
  }

  const nt = n * t;
  const c = Math.cos(nt);
  const s = Math.sin(nt);

  const x = x0 * (4 - 3 * c) + (vx0 / n) * s + (2 * vy0 / n) * (1 - c);
  const y = y0 - 6 * n * x0 * t - 3 * vy0 * t + 6 * x0 * s + (4 * vy0 / n) * s - (2 * vx0 / n) * (1 - c);
  const z = z0 * c + (vz0 / n) * s;

  const vx = vx0 * c + (3 * n * x0 + 2 * vy0) * s;
  const vy = (4 * c - 3) * vy0 - 6 * n * x0 * (1 - c) - 2 * vx0 * s;
  const vz = vz0 * c - z0 * n * s;

  return { x, y, z, vx, vy, vz };
}

export function predictPath(state, nRadPerS, durationS, samples) {
  const count = samples && samples > 1 ? samples : 128;
  const out = [];
  for (let i = 0; i <= count; i += 1) {
    const t = durationS * i / count;
    out.push(propagateClosedForm(state, t, nRadPerS));
  }
  return out;
}

export function periodS(nRadPerS) {
  return nRadPerS > 0 ? 2 * Math.PI / nRadPerS : Infinity;
}
