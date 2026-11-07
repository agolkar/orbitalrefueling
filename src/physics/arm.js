// src/physics/arm.js
// Refuelling arm (level 5): kinematics and the docked workspace it moves in. No three.js and no
// DOM access.
//
// The arm is a SCARA arm on the servicer docking plate: shoulder and elbow turn about axes
// parallel to the docking axis, so the two links sweep planes parallel to the docking face, and a
// vertical stroke at the end of the second link lowers the tool along the valve axis. The tool
// therefore stays parallel to the valve axis by construction.
//
// Arm frame (metres, orthonormal): a ahead of the servicer docking face along body +X (towards
// the client); u along e1, the radial direction of the arm base azimuth; v along e2 = X x e1.
// Body point = (dockingFace + a, u e1 + v e2). Azimuths are measured from body +Z towards body +Y,
// as for the stanchions in src/render/models.js. Docked with no roll offset, body azimuth 60 deg
// is also client azimuth 60 deg (from client +y towards +z), the azimuth of the service valve.

import { ARM, CAPTURE } from '../config.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Unit vectors of the arm frame in the servicer body frame.
export function armFrameAxes(azimuthDeg = ARM.armBaseAzimuthDeg) {
  const az = azimuthDeg * DEG;
  return {
    e1: { x: 0, y: Math.sin(az), z: Math.cos(az) },
    e2: { x: 0, y: -Math.cos(az), z: Math.sin(az) }
  };
}

// Body coordinates (m, relative to the servicer CM) of an arm-frame point.
export function armToBody(a, u, v, faceX = CAPTURE.dockingFaceAheadChaserCmM) {
  const { e1, e2 } = armFrameAxes();
  return { x: faceX + a, y: u * e1.y + v * e2.y, z: u * e1.z + v * e2.z };
}

// (u, v) of a direction at a body azimuth (deg) and a distance from the docking axis.
export function uvAtAzimuth(azimuthDeg, radiusM) {
  const d = (azimuthDeg - ARM.armBaseAzimuthDeg) * DEG;
  return { u: radiusM * Math.cos(d), v: -radiusM * Math.sin(d) };
}

// Two-link planar kinematics in the link planes, relative to the shoulder axis: joint 1 from +u
// towards +v, joint 2 relative to the first link. The vertical tool adds no reach.
export function armTip(joint1Rad, joint2Rad) {
  const l1 = ARM.segment1M;
  const l2 = ARM.segment2M;
  return {
    x: l1 * Math.cos(joint1Rad) + l2 * Math.cos(joint1Rad + joint2Rad),
    y: l1 * Math.sin(joint1Rad) + l2 * Math.sin(joint1Rad + joint2Rad)
  };
}

// Inverse kinematics of the two links; elbowSign +1 gives a positive joint 2. Null out of reach.
export function armIk(x, y, elbowSign = 1) {
  const l1 = ARM.segment1M;
  const l2 = ARM.segment2M;
  const d2 = x * x + y * y;
  const d = Math.sqrt(d2);
  if (d > l1 + l2 || d < Math.abs(l1 - l2)) return null;
  const c2 = clamp((d2 - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1);
  const j2 = elbowSign * Math.acos(c2);
  const j1 = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(j2), l1 + l2 * Math.cos(j2));
  return { joint1Rad: j1, joint2Rad: j2 };
}

// Largest joint change in one step of dtS seconds.
export function jointStepLimitRad(dtS) {
  return ARM.jointRateMaxDegS * DEG * dtS;
}

// Arm base on the docking plate, in the servicer body frame (test geometry).
export function armBasePositionBody() {
  const az = ARM.armBaseAzimuthDeg * DEG;
  return { x: 0, y: ARM.armBaseOffsetM * Math.sin(az), z: ARM.armBaseOffsetM * Math.cos(az) };
}

// Service valve in the client frame (LVLH when the client holds still): on the aft face, 0.85 m
// from the engine axis at 60 deg azimuth (from +y towards +z), on a 0.10 m bracket.
export function valvePositionClient() {
  const az = ARM.valveAzimuthDeg * DEG;
  return {
    x: ARM.valveBracketHeightM,
    y: ARM.valveOffsetFromLaeAxisM * Math.cos(az),
    z: ARM.valveOffsetFromLaeAxisM * Math.sin(az)
  };
}

// Points of the arm in the (u, v) planes.
export function armPoints(joint1Rad, joint2Rad) {
  const base = { u: ARM.armBaseOffsetM, v: 0 };
  const elbow = { u: base.u + ARM.segment1M * Math.cos(joint1Rad), v: base.v + ARM.segment1M * Math.sin(joint1Rad) };
  const tool = {
    u: elbow.u + ARM.segment2M * Math.cos(joint1Rad + joint2Rad),
    v: elbow.v + ARM.segment2M * Math.sin(joint1Rad + joint2Rad)
  };
  return { base, elbow, tool };
}

// Joints that put the tool axis at (u, v) on the arm's elbow branch, within the elbow limits.
export function toolIk(u, v) {
  const ik = armIk(u - ARM.armBaseOffsetM, v, 1);
  if (!ik) return null;
  if (ik.joint2Rad < ARM.elbowMinDeg * DEG || ik.joint2Rad > ARM.elbowMaxDeg * DEG) return null;
  return ik;
}

export function stowedPose() {
  return { joint1Rad: ARM.stowShoulderDeg * DEG, joint2Rad: ARM.stowElbowDeg * DEG, strokeM: 0 };
}

export function toolTipA(strokeM) {
  return ARM.toolTipRetractedAheadOfFaceM + strokeM;
}

// The docked workspace for a roll offset of the stack (rad, servicer about its body +X relative to
// the nominal docked roll). Only the valve moves with the roll: ring, deck and nozzle are round,
// and the stanchions and the probe belong to the servicer.
export function armWorkspace(rollOffsetRad = 0) {
  const ringA = CAPTURE.dockedCmXM - CAPTURE.axisOffsetM; // 0.50 m
  const deckA = ringA + CAPTURE.ringPlaneAboveClientCmM - CAPTURE.zenithDeckAboveClientCmM; // 0.55 m
  const valveFaceA = deckA - ARM.valveBracketHeightM; // 0.45 m
  const valve = uvAtAzimuth(ARM.valveAzimuthDeg + rollOffsetRad / DEG, ARM.valveOffsetFromLaeAxisM);
  const stanchions = [];
  for (let i = 0; i < CAPTURE.stanchionCount; i += 1) {
    const az = i * CAPTURE.stanchionSpacingDeg;
    const root = uvAtAzimuth(az, 0.68);
    const tip = uvAtAzimuth(az, CAPTURE.stanchionTipRadiusM);
    stanchions.push({
      leg: [{ a: 0.03, ...root }, { a: CAPTURE.stanchionLengthM - 0.025, ...tip }],
      boot: [{ a: 0.03, ...root }, { a: 0.12, ...root }]
    });
  }
  return {
    rollOffsetRad,
    ringA,
    deckA,
    valveFaceA,
    capTopA: valveFaceA - ARM.capHeightM, // 0.42 m
    nozzleExitA: ringA - CAPTURE.nozzleExitProtrusionM, // 0.16 m
    ringRadiusM: CAPTURE.ringRadiusM,
    nozzleRadiusM: CAPTURE.laeExitDiameterM / 2,
    valve,
    stanchions
  };
}

// Arm parts as capsules in the arm frame for a pose { joint1Rad, joint2Rad, strokeM }.
export function armParts(pose) {
  const p = armPoints(pose.joint1Rad, pose.joint2Rad);
  const a1 = ARM.link1AheadOfFaceM;
  const a2 = ARM.link2AheadOfFaceM;
  const tipA = toolTipA(pose.strokeM);
  return {
    ...p,
    tipA,
    capsules: [
      { name: 'link', r: ARM.linkRadiusM, seg: [{ a: a1, ...p.base }, { a: a1, ...p.elbow }] },
      { name: 'link', r: ARM.linkRadiusM, seg: [{ a: a2, ...p.elbow }, { a: a2, ...p.tool }] },
      { name: 'tool', r: ARM.toolRadiusM, seg: [{ a: a2, ...p.tool }, { a: tipA, ...p.tool }] }
    ]
  };
}

function sub(p, q) {
  return { a: p.a - q.a, u: p.u - q.u, v: p.v - q.v };
}
function dot(p, q) {
  return p.a * q.a + p.u * q.u + p.v * q.v;
}

// Shortest distance between the segments p1-q1 and p2-q2.
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-15 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = { a: p1.a + d1.a * s, u: p1.u + d1.u * s, v: p1.v + d1.v * s };
  const c2 = { a: p2.a + d2.a * t, u: p2.u + d2.u * t, v: p2.v + d2.v * t };
  const d = sub(c1, c2);
  return Math.sqrt(dot(d, d));
}

// Floor under the tool: the cap top or the valve face when the tool overlaps them, else none.
export function toolFloor(ws, tool, capOn) {
  const eh = Math.hypot(tool.u - ws.valve.u, tool.v - ws.valve.v);
  if (capOn && eh < ARM.capRadiusM + ARM.toolRadiusM) return { a: ws.capTopA, on: 'cap', eh };
  if (eh < ARM.valveRadiusM + ARM.toolRadiusM) return { a: ws.valveFaceA, on: 'valve', eh };
  return { a: Infinity, on: null, eh };
}

// Clearance of the arm in a pose: the smallest gap to any obstacle (negative = contact) and the
// obstacle's name. The tool may rest on the cap or the valve face (contact from above is allowed;
// the stroke stops there), but not touch their sides.
export function armClearance(ws, pose, capOn) {
  const parts = armParts(pose);
  let best = { clearanceM: Infinity, name: null };
  const consider = (gap, name) => {
    if (gap < best.clearanceM) best = { clearanceM: gap, name };
  };
  const axisTop = { a: 0, u: 0, v: 0 };
  const obstacles = [
    { name: 'probe', r: 0.06, seg: [axisTop, { a: 0.10, u: 0, v: 0 }] },
    { name: 'probe', r: CAPTURE.probeTipFoldedDiameterM, seg: [axisTop, { a: ws.deckA, u: 0, v: 0 }] },
    { name: 'nozzle', r: ws.nozzleRadiusM, seg: [{ a: ws.nozzleExitA, u: 0, v: 0 }, { a: ws.deckA, u: 0, v: 0 }] }
  ];
  for (const s of ws.stanchions) {
    obstacles.push({ name: 'stanchion', r: 0.03, seg: s.leg });
    obstacles.push({ name: 'stanchion', r: 0.055, seg: s.boot });
  }
  for (const c of parts.capsules) {
    for (const o of obstacles) {
      consider(segmentDistance(c.seg[0], c.seg[1], o.seg[0], o.seg[1]) - c.r - o.r, o.name);
    }
  }
  // Tool against the ring wall, the deck and the valve.
  const tool = parts.tool;
  const tipA = parts.tipA;
  const rt = ARM.toolRadiusM;
  const rho = Math.hypot(tool.u, tool.v);
  const radialGap = Math.abs(rho - ws.ringRadiusM) - rt - 0.006;
  const ringDepth = ws.ringA - tipA;
  consider(radialGap > 0 && ringDepth < 0 ? radialGap : radialGap > 0 ? Math.hypot(radialGap, ringDepth) : ringDepth, 'ring');
  consider(ws.deckA - tipA, 'deck');
  const eh = Math.hypot(tool.u - ws.valve.u, tool.v - ws.valve.v);
  const side = (radius, topA, name) => {
    const lateral = eh - radius - rt;
    const depth = topA - tipA; // > 0: the tip is above the top
    if (lateral >= 0) consider(depth >= 0 ? Math.hypot(lateral, depth) : lateral, name);
    else if (depth < -1e-4) consider(depth, name); // overlapping and below the top: hit from the side
  };
  side(ARM.valveBootRadiusM, ws.deckA - ARM.valveBootHeightM, 'valve');
  side(ARM.valveRadiusM, ws.valveFaceA, 'valve');
  if (capOn) side(ARM.capRadiusM, ws.capTopA, 'cap');
  return { ...best, parts };
}
