// src/game/departure.js
// Level 7 (Depart) in the challenge format. Pure logic: no three.js and no DOM.
//
// Undock: the probe releases the client and pushes the servicer away at 0.02 m/s along the
// docking axis (LVLH +x, straight up from the client). The player then plans a separation burn
// (the translation keys add delta-v to the plan) while the closed-form prediction over two orbits
// and the SAFE/UNSAFE indicator update live; SPACE executes a SAFE plan. The coast then runs fast
// forward (100x by default) until the range passes 30 m. The level time limit applies to the
// planning; the servicer keeps drifting while the player plans.
//
// A purely radial velocity leaves the orbital period unchanged, so the relative orbit closes on
// itself and the servicer comes back after one orbit; an along-track component changes the period
// and the servicer drifts away.

import { ARM, CAPTURE, SCORING } from '../config.js';
import { departureCheck } from './rules.js';
import { propagateClosedForm } from '../physics/cw.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function planState(dep) {
  return {
    x: dep.cw.x, y: dep.cw.y, z: dep.cw.z,
    vx: dep.cw.vx + dep.plan.vx,
    vy: dep.cw.vy + dep.plan.vy,
    vz: dep.cw.vz + dep.plan.vz
  };
}

function say(dep, text, s = 3) {
  dep.message = text;
  dep.messageS = s;
}

// A Depart session from the docked state (CM to CM 3.55 m on the radial axis).
export function createDeparture(level, nRadPerS, periodS) {
  const dep = {
    level,
    phase: 'undocking', // undocking, plan, coast, success, failed
    t: 0, // level clock, real seconds
    tSim: 0, // simulated seconds (fast-forward included)
    nRadPerS,
    periodS,
    cw: { x: CAPTURE.dockedCmXM, y: 0, z: 0, vx: ARM.undockPushSpeedMps, vy: 0, vz: 0 },
    plan: { vx: 0, vy: 0, vz: 0 },
    executed: null,
    safe: false,
    reason: null,
    exitTimeS: null,
    overBudget: false,
    unsafeAttempts: 0,
    fastForward: ARM.departureFastForward,
    burnT: null,
    trail: [],
    message: '',
    messageS: 0,
    result: null
  };
  updateSafe(dep);
  return dep;
}

function drift(dep, dtSim) {
  dep.cw = propagateClosedForm(dep.cw, dtSim, dep.nRadPerS);
  dep.tSim += dtSim;
}

// Undocking phase: the probe has pushed; the servicer drifts while the probe releases.
export function stepUndock(dep, dtS) {
  if (dep.phase !== 'undocking') return dep;
  dep.t += dtS;
  dep.messageS = Math.max(0, dep.messageS - dtS);
  drift(dep, dtS);
  if (dep.t >= ARM.undockS) {
    dep.phase = 'plan';
    updateSafe(dep);
  }
  return dep;
}

// Add a delta-v (LVLH, m/s) to the planned burn.
export function setPlan(dep, dv) {
  dep.plan.vx += dv.x;
  dep.plan.vy += dv.y;
  dep.plan.vz += dv.z;
  updateSafe(dep);
  return dep.plan;
}

export function clearPlan(dep) {
  dep.plan = { vx: 0, vy: 0, vz: 0 };
  updateSafe(dep);
}

export function planMps(dep) {
  return Math.hypot(dep.plan.vx, dep.plan.vy, dep.plan.vz);
}

// SAFE/UNSAFE for the current state plus the plan: the departure check of the rules (leave the
// keep-out sphere within one orbit, stay out for two, no pass within 5 m after 60 s) and, for the
// first 60 s, no return to contact with the client.
export function updateSafe(dep) {
  const s = planState(dep);
  const res = departureCheck(s, dep.nRadPerS, dep.periodS);
  let contact = false;
  for (let k = 1; k <= 120 && !contact; k += 1) {
    const p = propagateClosedForm(s, (ARM.departureContactCheckS * k) / 120, dep.nRadPerS);
    if (Math.hypot(p.x, p.y, p.z) < ARM.departureContactRangeM) contact = true;
  }
  dep.safe = res.safe && !contact;
  dep.reason = contact ? 'contact' : res.reason;
  dep.exitTimeS = res.exitTimeS;
  dep.overBudget = planMps(dep) > dep.level.budgetMps + 1e-9;
  return { safe: dep.safe, reason: dep.reason };
}

// Execute the planned burn (SPACE). An UNSAFE plan is refused and counted; a plan above the RCS
// budget is refused.
export function executeBurn(dep) {
  if (dep.phase !== 'plan') return { ok: false, reason: 'not planning' };
  updateSafe(dep);
  if (!dep.safe) {
    dep.unsafeAttempts += 1;
    say(dep, 'NO GO: the plan is UNSAFE, the burn was not executed');
    return { ok: false, reason: 'unsafe' };
  }
  if (dep.overBudget) {
    say(dep, 'NO GO: the plan is above the RCS budget (Backspace clears it)');
    return { ok: false, reason: 'budget' };
  }
  dep.cw.vx += dep.plan.vx;
  dep.cw.vy += dep.plan.vy;
  dep.cw.vz += dep.plan.vz;
  dep.executed = { ...dep.plan };
  dep.plan = { vx: 0, vy: 0, vz: 0 };
  dep.burnT = dep.t;
  dep.phase = 'coast';
  say(dep, 'SAFE burn executed: fast-forward to 30 m', 3);
  return { ok: true, reason: null };
}

// Planning phase: the servicer drifts at 1x while the player plans; the time limit applies.
export function stepPlan(dep, dtS) {
  if (dep.phase !== 'plan') return dep;
  dep.t += dtS;
  dep.messageS = Math.max(0, dep.messageS - dtS);
  drift(dep, dtS);
  updateSafe(dep);
  if (dep.t > dep.level.timeS) finishDeparture(dep, false, dep.level.timeoutReason || 'Time is up before the separation burn.');
  return dep;
}

// Coast after the burn, fast forward: dtS real seconds become dtS * fastForward simulated.
export function stepCoast(dep, dtS) {
  if (dep.phase !== 'coast') return dep;
  dep.t += dtS;
  dep.messageS = Math.max(0, dep.messageS - dtS);
  const total = dtS * dep.fastForward;
  const n = Math.max(1, Math.ceil(total / 5));
  for (let i = 0; i < n; i += 1) {
    drift(dep, total / n);
    if (dep.trail.length === 0 || dep.tSim - dep.trail[dep.trail.length - 1].t > 5) {
      dep.trail.push({ t: dep.tSim, x: dep.cw.x, y: dep.cw.y });
    }
    if (Math.hypot(dep.cw.x, dep.cw.y, dep.cw.z) >= ARM.departureRangeM) {
      finishDeparture(dep, true, 'Safe departure: the range passed 30 m on a SAFE trajectory.');
      break;
    }
  }
  return dep;
}

// One frame of level 7. controls: { dv: {x, y, z} LVLH m/s to add, clear, execute, faster, slower }.
export function stepDeparture(dep, dtS, controls = {}) {
  if (dep.phase === 'undocking') return stepUndock(dep, dtS);
  if (dep.phase === 'plan') {
    const dv = controls.dv;
    if (dv && (dv.x || dv.y || dv.z)) setPlan(dep, dv);
    if (controls.clear) clearPlan(dep);
    stepPlan(dep, dtS);
    if (dep.phase === 'plan' && controls.execute) executeBurn(dep);
    return dep;
  }
  if (dep.phase === 'coast') {
    if (controls.faster) dep.fastForward = Math.min(4 * ARM.departureFastForward, dep.fastForward * 2);
    if (controls.slower) dep.fastForward = Math.max(1, dep.fastForward / 2);
    stepCoast(dep, dtS);
  }
  return dep;
}

function finishDeparture(dep, success, reason) {
  dep.phase = success ? 'success' : 'failed';
  const level = dep.level;
  const burnT = dep.burnT === null ? dep.t : dep.burnT;
  const timeLeft = Math.max(0, level.timeS - burnT);
  const w = SCORING.departureWeights;
  const e = dep.executed || { vx: 0, vy: 0, vz: 0 };
  const dv = Math.hypot(e.vx, e.vy, e.vz);
  let score = 0;
  let stars = 0;
  if (success) {
    const safePart = clamp(1 - (dep.unsafeAttempts * SCORING.departureUnsafePenalty) / w.safe, 0, 1);
    const dvPart = clamp(1 - dv / level.budgetMps, 0, 1);
    const timePart = clamp(timeLeft / (level.fullTimeLeftS || SCORING.fullTimeFraction * level.timeS), 0, 1);
    score = Math.round(w.safe * safePart + w.deltaV * dvPart + w.time * timePart);
    stars = score >= 750 ? 3 : score >= 550 ? 2 : 1;
  }
  dep.result = {
    success,
    reason,
    score,
    stars,
    timeS: burnT,
    timeLeftS: timeLeft,
    deltaVMps: dv,
    budgetMps: level.budgetMps,
    unsafeAttempts: dep.unsafeAttempts,
    burn: { ...e },
    simulatedS: dep.tSim
  };
}

// Two-orbit prediction (LVLH points) from the current state plus the plan, for the plot.
export function predictDeparture(dep, samples = 160) {
  const s = dep.phase === 'plan' || dep.phase === 'undocking' ? planState(dep) : dep.cw;
  const out = [];
  for (let i = 0; i <= samples; i += 1) {
    out.push(propagateClosedForm(s, (2 * dep.periodS * i) / samples, dep.nRadPerS));
  }
  return out;
}

// Everything the instruments draw, as plain numbers.
export function departureSummary(dep) {
  const c = dep.cw;
  const range = Math.hypot(c.x, c.y, c.z);
  return {
    phase: dep.phase,
    timeLeftS: Math.max(0, dep.level.timeS - (dep.burnT === null ? dep.t : dep.burnT)),
    undockLeftS: Math.max(0, ARM.undockS - dep.t),
    rangeM: range,
    rangeRateMps: range > 0 ? (c.x * c.vx + c.y * c.vy + c.z * c.vz) / range : 0,
    plan: { ...dep.plan },
    planMps: planMps(dep),
    budgetMps: dep.level.budgetMps,
    executed: dep.executed ? { ...dep.executed } : null,
    safe: dep.safe,
    reason: dep.reason,
    overBudget: dep.overBudget,
    fastForward: dep.fastForward,
    unsafeAttempts: dep.unsafeAttempts,
    targetRangeM: ARM.departureRangeM,
    tSim: dep.tSim
  };
}

const UNSAFE_TEXT = {
  contact: 'this plan drives the servicer back into the client: remove the W component',
  kos: 'the prediction stays inside the 200 m keep-out sphere',
  reenter: 'the prediction comes back inside the keep-out sphere',
  close: 'the prediction passes within 5 m of the client'
};

// Feedback for level 7: one line that names the keys.
export function departureFeedback(dep) {
  if (dep.messageS > 0 && dep.message) return { text: dep.message, tone: dep.message.startsWith('NO GO') ? 'bad' : 'go' };
  const s = departureSummary(dep);
  if (s.phase === 'undocking') return { text: 'Undocking: the probe releases the client and pushes the servicer away at 2 cm/s', tone: 'ok' };
  if (s.phase === 'plan') {
    if (s.overBudget) return { text: 'The plan is above the RCS budget: Backspace clears it', tone: 'bad' };
    if (s.safe) return { text: `SAFE: press SPACE to execute the burn (${(100 * s.planMps).toFixed(1)} cm/s)`, tone: 'go' };
    if (s.planMps < 1e-4) return { text: 'UNSAFE: the push alone comes back after one orbit. Hold ↑ or ↓ to add along-track velocity', tone: 'act' };
    const hint = s.reason === 'contact' ? '' : '. Add along-track velocity with ↑ or ↓';
    return { text: `UNSAFE: ${UNSAFE_TEXT[s.reason] || 'the prediction is unsafe'}${hint}`, tone: 'bad' };
  }
  if (s.phase === 'coast') {
    return { text: `SAFE separation: range ${s.rangeM.toFixed(1)} of 30 m, fast-forward ${s.fastForward}x (T faster, G slower)`, tone: 'ok' };
  }
  return { text: '', tone: 'info' };
}
