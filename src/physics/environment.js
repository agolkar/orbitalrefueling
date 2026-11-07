// src/physics/environment.js
// Sun direction in LVLH, Earth orientation, shadow visibility and earthshine.
// No three.js and no DOM access.

import {
  R_E,
  EARTH_SPIN_RATE,
  SUN_ANGULAR_RADIUS_RAD,
  EARTH_ALBEDO
} from '../config.js';

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m <= 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function wrapRad(x) {
  const twoPi = 2 * Math.PI;
  let y = x % twoPi;
  if (y < -Math.PI) y += twoPi;
  if (y > Math.PI) y -= twoPi;
  return y;
}

export function sunDirectionLVLH(betaRad, phaseRad) {
  const cb = Math.cos(betaRad);
  const sb = Math.sin(betaRad);
  return {
    x: cb * Math.cos(phaseRad),
    y: cb * Math.sin(phaseRad),
    z: sb
  };
}

// Local solar time h in hours: phase = 2*pi*(12 - h)/24.
// At h = 06:00 the Sun is along +y; at 12:00 along +x; at 18:00 along -y; at 00:00 along -x.
export function sunPhaseFromLocalSolarTimeHours(hours) {
  const wrapped = ((hours % 24) + 24) % 24;
  return 2 * Math.PI * (12 - wrapped) / 24;
}

export function sunDirectionAtTime(betaRad, localSolarTimeHours0, nRadPerS, tS) {
  const phase0 = sunPhaseFromLocalSolarTimeHours(localSolarTimeHours0);
  return sunDirectionLVLH(betaRad, phase0 - nRadPerS * tS);
}

export function earthPolarAxisLVLH(inclinationRad, argLatRad = Math.PI / 2) {
  const si = Math.sin(inclinationRad);
  const ci = Math.cos(inclinationRad);
  return {
    x: si * Math.sin(argLatRad),
    y: si * Math.cos(argLatRad),
    z: ci
  };
}

export function earthRelativeAngularVelocity(nRadPerS, inclinationRad = 0, argLatRad = Math.PI / 2) {
  const axis = earthPolarAxisLVLH(inclinationRad, argLatRad);
  return {
    x: axis.x * EARTH_SPIN_RATE,
    y: axis.y * EARTH_SPIN_RATE,
    z: axis.z * EARTH_SPIN_RATE - nRadPerS
  };
}

export function earthRelativeSpinRate(nRadPerS, inclinationRad = 0, argLatRad = Math.PI / 2) {
  return earthRelativeAngularVelocity(nRadPerS, inclinationRad, argLatRad).z;
}

export function earthAngularRadius(radiusM) {
  if (radiusM <= R_E) return Math.PI / 2;
  return Math.asin(R_E / radiusM);
}

export function circleOverlapArea(r1, r2, d) {
  if (r1 <= 0 || r2 <= 0) return 0;
  if (d >= r1 + r2) return 0;
  const minR = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return Math.PI * minR * minR;

  const r1s = r1 * r1;
  const r2s = r2 * r2;
  const ds = d * d;
  const cosA = clamp((ds + r1s - r2s) / (2 * d * r1), -1, 1);
  const cosB = clamp((ds + r2s - r1s) / (2 * d * r2), -1, 1);
  const a = Math.acos(cosA);
  const b = Math.acos(cosB);
  return r1s * (a - Math.sin(2 * a) * 0.5) + r2s * (b - Math.sin(2 * b) * 0.5);
}

export function solarVisibility(positionFromEarth, sunDirection, earthRadiusM = R_E) {
  const r = Math.hypot(positionFromEarth.x, positionFromEarth.y, positionFromEarth.z);
  if (r <= earthRadiusM) return 0;
  const sun = normalize(sunDirection);
  const earthDir = {
    x: -positionFromEarth.x / r,
    y: -positionFromEarth.y / r,
    z: -positionFromEarth.z / r
  };
  const cosSep = clamp(dot(earthDir, sun), -1, 1);
  const sep = Math.acos(cosSep);
  const rhoEarth = Math.asin(earthRadiusM / r);
  const rhoSun = SUN_ANGULAR_RADIUS_RAD;
  const overlap = circleOverlapArea(rhoEarth, rhoSun, sep);
  const sunArea = Math.PI * rhoSun * rhoSun;
  return clamp(1 - overlap / sunArea, 0, 1);
}

export function earthshineFactor(positionFromEarth, sunDirection, earthRadiusM = R_E) {
  const r = Math.hypot(positionFromEarth.x, positionFromEarth.y, positionFromEarth.z);
  if (r <= earthRadiusM) return 0;
  const sun = normalize(sunDirection);
  const rHat = {
    x: positionFromEarth.x / r,
    y: positionFromEarth.y / r,
    z: positionFromEarth.z / r
  };
  const fLit = clamp((1 + dot(sun, rHat)) * 0.5, 0, 1);
  const sinRho = earthRadiusM / r;
  return EARTH_ALBEDO * fLit * sinRho * sinRho;
}

// Argument of latitude at time t: u = u0 + n*t.
export function argLatAtTime(orbit, tS) {
  return orbit.u0Rad + orbit.nRadPerS * tS;
}

// Earth rotation angle theta(t) = (u0 - lon0) + omega_E * t.
export function earthRotationAngle(orbit, tS) {
  return (orbit.u0Rad - orbit.subSatelliteLongitudeRad) + EARTH_SPIN_RATE * tS;
}

// Sub-satellite longitude at time t.
export function subSatelliteLongitude(orbit, tS) {
  const u = argLatAtTime(orbit, tS);
  const ci = Math.cos(orbit.inclinationRad);
  const theta = earthRotationAngle(orbit, tS);
  return wrapRad(Math.atan2(ci * Math.sin(u), Math.cos(u)) - theta);
}

// Rotation from Earth-fixed axes to LVLH, row-major 3x3.
// Rows of R_LVLH<-ECI for RAAN = 0:
//   r = (cos u, sin u cos i, sin u sin i)
//   y = (-sin u, cos u cos i, cos u sin i)
//   h = (0, -sin i, cos i)
// Multiply by R_z(theta(t)) on the right.
export function earthOrientationLVLH(orbit, tS) {
  const u = argLatAtTime(orbit, tS);
  const ci = Math.cos(orbit.inclinationRad);
  const si = Math.sin(orbit.inclinationRad);
  const cu = Math.cos(u);
  const su = Math.sin(u);

  const theta = earthRotationAngle(orbit, tS);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  const r0 = [cu, su * ci, su * si];
  const r1 = [-su, cu * ci, cu * si];
  const r2 = [0, -si, ci];

  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    const row = i === 0 ? r0 : i === 1 ? r1 : r2;
    out[i][0] = row[0] * ct + row[1] * st;
    out[i][1] = -row[0] * st + row[1] * ct;
    out[i][2] = row[2];
  }
  return out;
}

// Local solar time (h) at which the vehicle enters the Earth's shadow on the evening side: the
// first time after noon at which the Sun is half hidden. Null when the orbit has no eclipse at
// this beta angle (the graveyard orbit at its default beta).
export function shadowEntryLocalTimeHours(orbit, betaRad = orbit.defaultBetaRad) {
  const pos = { x: orbit.aM, y: 0, z: 0 };
  for (let h = 12; h < 24; h += 1 / 3600) {
    if (solarVisibility(pos, sunDirectionAtTime(betaRad, h, 0, 0)) < 0.5) return h;
  }
  return null;
}

// Local solar time at the start so that the Sun sets secondsBeforeSunset later. The local
// solar time of a circular orbit advances by 24 h per orbital period.
export function startLocalTimeBeforeSunset(orbit, secondsBeforeSunset, betaRad = orbit.defaultBetaRad) {
  const he = shadowEntryLocalTimeHours(orbit, betaRad);
  if (he === null) return null;
  return he - (secondsBeforeSunset * 24) / orbit.periodS;
}
