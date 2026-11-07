// src/game/connect.js
// Level 5 (Connect) in the challenge format. Pure logic: no three.js and no DOM.
//
// Docked. The arrow keys move the tool across the docking axis as seen in the tool camera (up is
// away from the docking axis, towards the valve), W lowers the tool along the valve axis and S
// raises it; SHIFT slows every motion to a fifth. The shoulder and elbow turn at most 5 deg/s, so
// the tool slows down where the arm needs large joint motions. Sequence: lower the tool onto the
// cap below 1 cm/s, centre it within 1 cm, SPACE unscrews the cap (3 s); lower the tool onto the
// valve face below 1 cm/s, centre it within 5 mm, SPACE mates. Touching the ring, the nozzle, a
// stanchion, the probe or the client deck, or the side of the valve, fails the attempt.

import { ARM, SCORING } from '../config.js';
import {
  armWorkspace,
  armPoints,
  toolIk,
  stowedPose,
  toolTipA,
  toolFloor,
  armClearance,
  jointStepLimitRad
} from '../physics/arm.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapPi(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const FAIL_TEXT = {
  stanchion: 'The arm hit a stanchion of the docking mechanism.',
  probe: 'The arm hit the probe.',
  nozzle: 'The tool hit the client\'s engine nozzle.',
  ring: 'The tool hit the launch adapter ring.',
  deck: 'The tool touched the client deck.',
  valve: 'The tool hit the side of the service valve.',
  cap: 'The tool hit the side of the valve cap.'
};

// A Connect session. rollOffsetRad: roll of the docked stack left by the capture (moves the valve
// across the arm); the browser draws it at random within ARM.dockedRollOffsetMaxDeg.
export function createConnect(level, { rollOffsetRad = 0 } = {}) {
  const pose = stowedPose();
  const c = {
    level,
    phase: 'fly', // fly, success, failed
    t: 0,
    ws: armWorkspace(rollOffsetRad),
    pose,
    tool: null,
    elbow: null,
    tipA: toolTipA(pose.strokeM),
    capOn: true,
    capRemovingS: 0,
    capRemoved: false,
    contact: null, // null, 'cap', 'valve'
    mated: false,
    corrections: 0,
    lastSign: { u: 0, v: 0, a: 0 },
    fine: false,
    atReachLimit: false,
    clearance: { clearanceM: Infinity, name: null },
    message: '',
    messageS: 0,
    result: null
  };
  updateGeometry(c);
  return c;
}

function updateGeometry(c) {
  const p = armPoints(c.pose.joint1Rad, c.pose.joint2Rad);
  c.tool = p.tool;
  c.elbow = p.elbow;
  c.tipA = toolTipA(c.pose.strokeM);
  const floor = toolFloor(c.ws, c.tool, c.capOn);
  c.contact = floor.on && Math.abs(c.tipA - floor.a) < 1e-6 ? floor.on : null;
}

// Horizontal distance (m) from the tool axis to the valve axis, and the offset in the tool camera
// (du up, dv right).
export function toolToValve(c) {
  const du = c.ws.valve.u - c.tool.u;
  const dv = c.ws.valve.v - c.tool.v;
  return { du, dv, distM: Math.hypot(du, dv) };
}

function say(c, text, s = 3) {
  c.message = text;
  c.messageS = s;
}

// Move the tool across the docking axis by (du, dv) metres through inverse kinematics; the joint
// increments are scaled together so that neither joint passes its rate limit.
function moveAcross(c, du, dv, dtS) {
  const target = toolIk(c.tool.u + du, c.tool.v + dv);
  if (!target) {
    c.atReachLimit = true;
    return;
  }
  c.atReachLimit = false;
  const d1 = wrapPi(target.joint1Rad - c.pose.joint1Rad);
  const d2 = wrapPi(target.joint2Rad - c.pose.joint2Rad);
  const lim = jointStepLimitRad(dtS);
  const k = Math.min(1, lim / Math.max(1e-12, Math.abs(d1), Math.abs(d2)));
  c.pose.joint1Rad += k * d1;
  c.pose.joint2Rad += k * d2;
}

// Lower (+) or raise (-) the tool by ds metres; the stroke stops on the cap or the valve face.
// Returns the contact that started in this step, if any.
function moveStroke(c, ds) {
  const before = toolTipA(c.pose.strokeM);
  let stroke = clamp(c.pose.strokeM + ds, 0, ARM.toolStrokeMaxM);
  const floor = toolFloor(c.ws, c.tool, c.capOn);
  let touched = null;
  if (ds > 0 && toolTipA(stroke) >= floor.a) {
    if (before < floor.a - 1e-6) touched = floor.on;
    stroke = Math.min(stroke, floor.a - ARM.toolTipRetractedAheadOfFaceM);
  }
  c.pose.strokeM = stroke;
  return touched;
}

function noteCorrections(c, move) {
  for (const axis of ['u', 'v', 'a']) {
    const s = Math.sign(move[axis] || 0);
    if (s === 0) continue;
    if (c.lastSign[axis] !== 0 && s !== c.lastSign[axis]) c.corrections += 1;
    c.lastSign[axis] = s;
  }
}

// One frame of level 5. controls: { move: { u, v, a } each -1..1 (a > 0 lowers), fine, space }.
export function stepConnect(c, dtS, controls = {}) {
  if (c.phase !== 'fly') return c;
  c.t += dtS;
  c.messageS = Math.max(0, c.messageS - dtS);
  updateGeometry(c);
  const move = controls.move || { u: 0, v: 0, a: 0 };
  c.fine = !!controls.fine;

  if (c.capRemovingS > 0) {
    c.capRemovingS = Math.max(0, c.capRemovingS - dtS);
    if (c.capRemovingS === 0) {
      c.capOn = false;
      c.capRemoved = true;
      updateGeometry(c);
      say(c, 'Cap removed and stowed: lower the tool onto the valve (SHIFT + W), then SPACE mates', 4);
    }
  } else {
    noteCorrections(c, move);
    const factor = c.fine ? ARM.fineSpeedFactor : 1;
    const mu = move.u || 0;
    const mv = move.v || 0;
    if (mu !== 0 || mv !== 0) {
      const n = Math.max(1, Math.hypot(mu, mv));
      const step = ARM.toolSpeedMps * factor * dtS;
      moveAcross(c, (mu / n) * step, (mv / n) * step, dtS);
      updateGeometry(c);
    }
    const ma = clamp(move.a || 0, -1, 1);
    if (ma !== 0) {
      const speed = ARM.strokeSpeedMps * factor * ma;
      const touched = moveStroke(c, speed * dtS);
      updateGeometry(c);
      if (touched && speed > ARM.contactSpeedMaxMps + 1e-9) {
        finishConnect(c, false, `The tool struck the ${touched} at ${(100 * speed).toFixed(1)} cm/s: ` +
          'touch below 1 cm/s (hold SHIFT with W).');
        return c;
      }
      if (touched) say(c, touched === 'cap' ? 'Touching the cap' : 'Touching the valve face', 2);
    }
  }

  c.clearance = armClearance(c.ws, c.pose, c.capOn);
  if (c.clearance.clearanceM < 0) {
    finishConnect(c, false, FAIL_TEXT[c.clearance.name] || 'The arm touched the client.');
    return c;
  }

  if (controls.space && c.capRemovingS === 0) {
    const tv = toolToValve(c);
    if (c.capOn) {
      if (c.contact !== 'cap') say(c, tv.distM > ARM.capRadiusM ? 'NO GO: the tool is not over the valve' : 'NO GO: lower the tool onto the cap first');
      else if (tv.distM > ARM.capCentringM) say(c, `NO GO: ${(1000 * tv.distM).toFixed(0)} mm off the valve axis, centre within 10 mm`);
      else {
        c.capRemovingS = ARM.capRemovalS;
        say(c, 'Unscrewing the cap', ARM.capRemovalS);
      }
    } else if (c.contact !== 'valve') {
      say(c, 'NO GO: lower the tool onto the valve face first');
    } else if (tv.distM > ARM.toolMatingToleranceM) {
      say(c, `NO GO: ${(1000 * tv.distM).toFixed(1)} mm off the valve axis, centre within 5 mm`);
    } else {
      c.mated = true;
      finishConnect(c, true, 'Connected: the tool is mated to the service valve.');
      return c;
    }
  }

  if (c.t > c.level.timeS) finishConnect(c, false, c.level.timeoutReason || 'Time is up before the tool mated.');
  return c;
}

// Time left (s) that earns the full time points.
function fullTimeLeftS(level) {
  return level.fullTimeLeftS || SCORING.fullTimeFraction * level.timeS;
}

function finishConnect(c, success, reason) {
  c.phase = success ? 'success' : 'failed';
  const level = c.level;
  const timeLeft = Math.max(0, level.timeS - c.t);
  const w = SCORING.connectWeights;
  const tv = toolToValve(c);
  let score = 0;
  let stars = 0;
  let precision = 0;
  if (success) {
    precision = clamp(1 - tv.distM / ARM.toolMatingToleranceM, 0, 1);
    const timePart = clamp(timeLeft / fullTimeLeftS(level), 0, 1);
    const corrPart = clamp(1 - (c.corrections * SCORING.connectCorrectionPenalty) / w.corrections, 0, 1);
    score = Math.round(w.precision * precision + w.time * timePart + w.corrections * corrPart);
    stars = score >= 750 ? 3 : score >= 550 ? 2 : 1;
  }
  c.result = {
    success,
    reason,
    score,
    stars,
    timeS: c.t,
    timeLeftS: timeLeft,
    corrections: c.corrections,
    precision,
    offAxisMm: 1000 * tv.distM,
    deltaVMps: 0,
    budgetMps: level.budgetMps
  };
}

// Everything the instruments draw, as plain numbers.
export function connectSummary(c) {
  const tv = toolToValve(c);
  const floor = toolFloor(c.ws, c.tool, c.capOn);
  const targetA = c.capOn ? c.ws.capTopA : c.ws.valveFaceA;
  return {
    timeLeftS: Math.max(0, c.level.timeS - c.t),
    base: { u: ARM.armBaseOffsetM, v: 0 },
    elbow: { ...c.elbow },
    tool: { ...c.tool },
    valve: { ...c.ws.valve },
    stanchions: c.ws.stanchions.map((s) => ({ u: s.leg[0].u, v: s.leg[0].v })),
    ringRadiusM: c.ws.ringRadiusM,
    nozzleRadiusM: c.ws.nozzleRadiusM,
    tipA: c.tipA,
    retractedA: ARM.toolTipRetractedAheadOfFaceM,
    deckA: c.ws.deckA,
    ringA: c.ws.ringA,
    capTopA: c.ws.capTopA,
    valveFaceA: c.ws.valveFaceA,
    targetName: c.capOn ? 'cap' : 'valve',
    heightAboveTargetM: targetA - c.tipA,
    overValve: floor.on !== null,
    offAxisM: tv.distM,
    du: tv.du,
    dv: tv.dv,
    contact: c.contact,
    capOn: c.capOn,
    capRemovingS: c.capRemovingS,
    mated: c.mated,
    corrections: c.corrections,
    fine: c.fine,
    clearanceM: c.clearance.clearanceM,
    nearest: c.clearance.name,
    atReachLimit: c.atReachLimit
  };
}

function arrowsText(du, dv) {
  const parts = [];
  if (Math.abs(du) > 0.005) parts.push(`${du > 0 ? '↑' : '↓'} ${(100 * Math.abs(du)).toFixed(0)} cm`);
  if (Math.abs(dv) > 0.005) parts.push(`${dv > 0 ? '→' : '←'} ${(100 * Math.abs(dv)).toFixed(0)} cm`);
  return parts.join(', ');
}

const NEAR_TEXT = {
  stanchion: 'a stanchion',
  probe: 'the probe',
  nozzle: 'the nozzle',
  ring: 'the ring',
  deck: 'the client deck',
  valve: 'the valve side',
  cap: 'the cap side'
};

// Feedback for level 5: one line that names the keys.
export function connectFeedback(c) {
  if (c.messageS > 0 && c.message) {
    return { text: c.message, tone: c.message.startsWith('NO GO') ? 'bad' : 'go' };
  }
  const s = connectSummary(c);
  if (s.capRemovingS > 0) return { text: `Unscrewing the cap: ${s.capRemovingS.toFixed(1)} s`, tone: 'ok' };
  if (s.clearanceM < 0.03 && s.nearest !== 'deck' && s.nearest) {
    return { text: `Careful: ${(100 * s.clearanceM).toFixed(1)} cm from ${NEAR_TEXT[s.nearest] || 'the client'}`, tone: 'warn' };
  }
  if (s.atReachLimit) return { text: 'The arm is at the edge of its reach: move back', tone: 'warn' };
  const target = s.targetName;
  if (!s.overValve || s.offAxisM > 0.03) {
    if (s.tipA > s.ringA - 0.12 && !s.overValve) {
      return { text: `Raise the tool with S before moving: you are low and not over the valve (${arrowsText(s.du, s.dv)} to go)`, tone: 'warn' };
    }
    return { text: `Move the tool over the valve with the arrow keys: ${arrowsText(s.du, s.dv)}`, tone: 'act' };
  }
  if (!s.contact) {
    const h = s.heightAboveTargetM;
    if (h > 0.02) return { text: `Lower the tool with W: the ${target} is ${(100 * h).toFixed(0)} cm below`, tone: 'act' };
    if (!s.fine) return { text: `Hold SHIFT with W for the last ${(100 * h).toFixed(1)} cm: touch the ${target} below 1 cm/s`, tone: 'warn' };
    return { text: `SHIFT + W: ${(1000 * h).toFixed(0)} mm to the ${target}`, tone: 'ok' };
  }
  if (target === 'cap') {
    if (s.offAxisM > ARM.capCentringM) return { text: `On the cap, ${(1000 * s.offAxisM).toFixed(0)} mm off axis: centre within 10 mm (${arrowsText(s.du, s.dv)})`, tone: 'act' };
    return { text: 'On the cap and centred: press SPACE to unscrew it', tone: 'go' };
  }
  if (s.offAxisM > ARM.toolMatingToleranceM) {
    return { text: `On the valve, ${(1000 * s.offAxisM).toFixed(1)} mm off axis: tap the arrow keys with SHIFT to centre within 5 mm`, tone: 'act' };
  }
  return { text: 'Within 5 mm of the valve axis: press SPACE to mate', tone: 'go' };
}

