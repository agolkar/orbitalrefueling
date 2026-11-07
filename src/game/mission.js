// src/game/mission.js
// Phase state machine, checklists, mission-control messages, scoring.
// No three.js and no DOM access.

import { CAPTURE, RULES, SCORING, SCENARIOS, ARM, TANK, DEG_TO_RAD } from '../config.js';
import {
  rangeM,
  relativeSpeedMps,
  rangeRateMps,
  insideKos,
  insideCorridor,
  envelopeCheck,
  captureWindow,
  captureScore,
  collisionCheck,
  selectCamDirection,
  departureCheck,
  deltaVScore,
  refuelScore,
  departureScore,
  grade,
  penaltyFor
} from './rules.js';

export const PHASES = [
  'menu',
  'briefing',
  'approach',
  'hold1',
  'hold2',
  'hold3',
  'finalApproach',
  'captureReady',
  'captureExtension',
  'hardCapture',
  'docked',
  'refuelling',
  'undocking',
  'departure',
  'debrief',
  'failed'
];

const HOLD_PHASES = ['hold1', 'hold2', 'hold3'];
const HOLD_D = { hold1: 250, hold2: 80, hold3: 20 };
const HOLD_NEXT = { hold1: 'hold2', hold2: 'hold3', hold3: 'finalApproach' };

// Mission control messages per phase.
const MESSAGES = {
  approach: 'Approach from above along the approach axis. Hold at HP1 (250 m).',
  hold1: 'Hold at HP1 (250 m). Stay within 2 m at under 0.01 m/s for 10 s.',
  hold2: 'Hold at HP2 (80 m). Stay within 2 m at under 0.01 m/s for 10 s.',
  hold3: 'Hold at HP3 (20 m). Stay within 0.5 m at under 0.01 m/s for 10 s.',
  finalApproach: 'GO for final approach. Close to the capture point at d = 1.0 m.',
  captureReady: 'READY. GO for capture. Press X to extend the probe.',
  captureExtension: 'Probe extending. Hold the window.',
  hardCapture: 'HARD CAPTURE. Latches engaged.',
  docked: 'Docked. Begin refuelling.',
  refuelling: 'Refuelling sequence.',
  undocking: 'Undocking.',
  departure: 'Plan the departure. SAFE when the prediction leaves the KOS.',
  debrief: 'Mission complete.',
  failed: 'Mission failed.'
};

// A mission state holds the phase, the running score, penalties, the CAM state and the
// capture/probe sequence state. It is a plain object so tests can drive it headless.
export function createMission({ scenarioName = 'fullMission', arcade = false } = {}) {
  const scenario = SCENARIOS[scenarioName] || SCENARIOS.fullMission;
  const phase = scenario.phase === 'approach' ? 'approach'
    : scenario.phase === 'hold1' ? 'hold1'
    : scenario.phase === 'hold3' ? 'hold3'
    : scenario.phase === 'docked' ? 'docked'
    : 'approach';
  return {
    scenarioName,
    arcade,
    phase,
    phaseBeforeCam: null,
    phaseBeforeFail: null,
    message: MESSAGES[phase] || '',
    holdTimerS: 0,
    envelopeViolationS: 0,
    kosEntered: false,
    kosGo: phase !== 'approach' && phase !== 'hold1',
    camActive: false,
    camDirection: null,
    camApplied: false,
    camCount: 0,
    envelopePenalties: 0,
    corridorPenalties: 0,
    probe: {
      state: 'stowed', // stowed | extending | fingers | retracting | hardCapture | aborting
      timerS: 0,
      peaks: null,
      readyTimerS: 0
    },
    captureQuality: 0,
    refuel: {
      deliveredKg: 0,
      faults: 0,
      complete: false
    },
    departure: {
      safe: false,
      corrections: 0,
      firstPlanSafe: null
    },
    deltaVReferenceMps: 0.30, // m/s, reference for the full mission, assumption
    score: 0,
    breakdown: null,
    failReason: null
  };
}

// Advance the mission by dtS of simulated time. cw is the chaser CW state, al the alignment
// from the flight module, nRadPerS the orbit rate, T the period.
// Returns a list of events: { type, text, penalty }.
export function stepMission(mission, cw, al, dtS, nRadPerS, T) {
  const events = [];
  if (mission.phase === 'failed' || mission.phase === 'debrief') return events;

  // Collision check first: any contact above 0.3 m/s or a bus-to-bus contact fails the mission.
  const col = collisionCheck(cw);
  if (col.collision && mission.phase !== 'docked' && mission.phase !== 'refuelling') {
    mission.phaseBeforeFail = mission.phase;
    mission.phase = 'failed';
    mission.failReason = col.reason === 'speed' ? 'Contact above 0.3 m/s' : 'Contact between the vehicles';
    events.push({ type: 'fail', text: mission.failReason });
    return events;
  }

  // CAM check: entering the KOS before the GO at HP1, leaving the corridor inside the KOS,
  // or exceeding the envelope for more than 5 s.
  if (!mission.camActive) {
    const inKos = insideKos(cw);
    if (inKos && !mission.kosGo) {
      events.push(...startCam(mission, cw, nRadPerS, T, 'Entered the KOS before the GO at HP1'));
    } else if (inKos && !insideCorridor(cw)) {
      events.push(...startCam(mission, cw, nRadPerS, T, 'Left the approach corridor inside the KOS'));
    } else {
      const env = envelopeCheck(cw);
      if (env.violation) {
        mission.envelopeViolationS += dtS;
        if (mission.envelopeViolationS > RULES.envelopeViolationTimeS) {
          events.push(...startCam(mission, cw, nRadPerS, T, 'Exceeded the speed envelope for more than 5 s'));
        }
      } else {
        mission.envelopeViolationS = 0;
      }
    }
  }

  // Phase-specific logic.
  const phase = mission.phase;
  if (phase === 'approach' || HOLD_PHASES.includes(phase)) {
    stepApproach(mission, cw, al, dtS, events);
  } else if (phase === 'finalApproach') {
    stepFinalApproach(mission, al, dtS, events);
  } else if (phase === 'captureReady') {
    stepCaptureReady(mission, al, dtS, events);
  } else if (phase === 'captureExtension') {
    stepCaptureExtension(mission, al, dtS, events);
  } else if (phase === 'hardCapture') {
    // The latches close while the stanchions sit on the ring; then the stack is docked.
    mission.probe.timerS += dtS;
    if (mission.probe.timerS >= CAPTURE.latchTimeS) {
      mission.phase = 'docked';
      mission.message = MESSAGES.docked;
      events.push({ type: 'phase', text: 'Docked' });
    }
  } else if (phase === 'departure') {
    const dep = departureCheck(cw, nRadPerS, T);
    mission.departure.safe = dep.safe;
    if (dep.safe && mission.departure.firstPlanSafe === null) {
      mission.departure.firstPlanSafe = mission.departure.corrections === 0;
    }
  }
  return events;
}

function stepApproach(mission, cw, al, dtS, events) {
  const phase = mission.phase;
  if (phase === 'approach') {
    // The GO at HP1 is granted when the chaser arrives at HP1 inside the KOS boundary.
    if (rangeM(cw) < RULES.kosRadiusM) {
      // Entering the KOS without the GO triggers a CAM; the GO is granted by the hold at HP1.
      // The approach phase ends when the player reaches HP1.
      if (Math.abs(al.dM - HOLD_D.hold1) < RULES.holdToleranceM) {
        mission.phase = 'hold1';
        mission.message = MESSAGES.hold1;
        mission.holdTimerS = 0;
        events.push({ type: 'phase', text: 'HP1' });
      }
    }
    return;
  }
  const targetD = HOLD_D[phase];
  const tol = phase === 'hold3' ? RULES.holdToleranceHp3M : RULES.holdToleranceM;
  const dErr = Math.abs(al.dM - targetD);
  const speed = al.relativeSpeedMps;
  if (dErr <= tol && speed <= RULES.holdSpeedMps) {
    mission.holdTimerS += dtS;
    if (mission.holdTimerS >= RULES.holdDurationS) {
      mission.holdTimerS = 0;
      if (phase === 'hold1') {
        mission.kosGo = true;
        mission.phase = 'hold2';
        mission.message = MESSAGES.hold2;
        events.push({ type: 'go', text: 'GO for approach to HP2' });
      } else if (phase === 'hold2') {
        mission.phase = 'hold3';
        mission.message = MESSAGES.hold3;
        events.push({ type: 'go', text: 'GO for approach to HP3' });
      } else {
        mission.phase = 'finalApproach';
        mission.message = MESSAGES.finalApproach;
        events.push({ type: 'go', text: 'GO for final approach' });
      }
    }
  } else {
    mission.holdTimerS = 0;
  }
}

function stepFinalApproach(mission, al, dtS, events) {
  const win = captureWindow(al, mission.arcade);
  if (win.ready) {
    mission.probe.readyTimerS += dtS;
    if (mission.probe.readyTimerS >= CAPTURE.readyHoldS) {
      mission.phase = 'captureReady';
      mission.message = MESSAGES.captureReady;
      events.push({ type: 'go', text: 'GO for capture' });
    }
  } else {
    mission.probe.readyTimerS = 0;
  }
}

function stepCaptureReady(mission, al, dtS, events) {
  const win = captureWindow(al, mission.arcade);
  if (!win.ready) {
    mission.phase = 'finalApproach';
    mission.message = MESSAGES.finalApproach;
    mission.probe.readyTimerS = 0;
    events.push({ type: 'phase', text: 'Window lost, back to final approach' });
  }
}

// The player pressed X: start the probe extension. Only valid in captureReady.
export function startCapture(mission, al) {
  if (mission.phase !== 'captureReady') return { started: false, reason: 'not ready' };
  const win = captureWindow(al, mission.arcade);
  if (!win.ready) return { started: false, reason: 'window' };
  mission.phase = 'captureExtension';
  mission.message = MESSAGES.captureExtension;
  mission.probe.state = 'extending';
  mission.probe.timerS = 0;
  mission.probe.peaks = {
    d: Math.abs(al.dM - CAPTURE.captureDm),
    lateral: al.lateralM,
    pitchYaw: al.pitchYawDeg,
    roll: al.rollDeg,
    pitchYawRate: al.pitchYawRateDegS,
    rollRate: al.rollRateDegS,
    speed: al.relativeSpeedMps
  };
  return { started: true, reason: null };
}

function stepCaptureExtension(mission, al, dtS, events) {
  const win = captureWindow(al, mission.arcade);
  const p = mission.probe;
  p.timerS += dtS;
  if (p.peaks && p.state === 'extending') {
    p.peaks.d = Math.max(p.peaks.d, Math.abs(al.dM - CAPTURE.captureDm));
    p.peaks.lateral = Math.max(p.peaks.lateral, al.lateralM);
    p.peaks.pitchYaw = Math.max(p.peaks.pitchYaw, al.pitchYawDeg);
    p.peaks.roll = Math.max(p.peaks.roll, al.rollDeg);
    p.peaks.pitchYawRate = Math.max(p.peaks.pitchYawRate, al.pitchYawRateDegS);
    p.peaks.rollRate = Math.max(p.peaks.rollRate, al.rollRateDegS);
    p.peaks.speed = Math.max(p.peaks.speed, al.relativeSpeedMps);
  }
  // The window matters while the probe extends. Once the fingers hold the client the probe
  // pulls the vehicles together, so d leaves the window by design.
  if (!win.ready && p.state === 'extending' && p.timerS < CAPTURE.extensionTimeS) {
    // PROBE_ABORT: the probe retracts, the player returns to the window and retries.
    mission.phase = 'finalApproach';
    mission.message = 'PROBE_ABORT. Window lost during extension. Retry with a penalty.';
    mission.probe.state = 'aborting';
    mission.probe.timerS = 0;
    mission.probe.readyTimerS = 0;
    mission.captureQuality = 0;
    events.push({ type: 'abort', text: 'PROBE_ABORT', penalty: 50 });
    return;
  }
  if (p.timerS >= CAPTURE.extensionTimeS) {
    p.state = 'fingers';
    if (p.timerS >= CAPTURE.extensionTimeS + CAPTURE.fingerExpandTimeS) {
      p.state = 'retracting';
      if (p.timerS >= CAPTURE.extensionTimeS + CAPTURE.fingerExpandTimeS + CAPTURE.hardCaptureRetractionS) {
        mission.phase = 'hardCapture';
        mission.message = MESSAGES.hardCapture;
        mission.captureQuality = captureScore(p.peaks, mission.arcade);
        p.state = 'hardCapture';
        p.timerS = 0; // the latch phase has its own timer
        events.push({ type: 'hardCapture', text: 'HARD CAPTURE' });
      }
    }
  }
}

function startCam(mission, cw, nRadPerS, T, reason) {
  const sel = selectCamDirection(cw, nRadPerS, T);
  mission.camActive = true;
  mission.camDirection = sel.direction;
  mission.camApplied = false;
  mission.camCount += 1;
  mission.phaseBeforeCam = mission.phase;
  mission.envelopeViolationS = 0;
  return [{ type: 'cam', text: `CAM: ${reason}`, direction: sel.direction, fallback: sel.fallback }];
}

// Apply the CAM impulse to the CW state (the flight module calls this once).
export function applyCamImpulse(mission, cw) {
  if (!mission.camActive || mission.camApplied || !mission.camDirection) return false;
  const dv = RULES.camImpulseMps;
  cw.vx += mission.camDirection.x * dv;
  cw.vy += mission.camDirection.y * dv;
  cw.vz += mission.camDirection.z * dv;
  mission.camApplied = true;
  return true;
}

// After a CAM the scenario resumes from HP1 with a score penalty.
export function resumeAfterCam(mission, cw) {
  if (!mission.camActive) return;
  mission.camActive = false;
  mission.phase = 'hold1';
  mission.message = MESSAGES.hold1;
  mission.holdTimerS = 0;
  mission.kosGo = true;
  cw.x = HOLD_D.hold1 + CAPTURE.axisOffsetM;
  cw.y = 0;
  cw.z = 0;
  cw.vx = 0;
  cw.vy = 0;
  cw.vz = 0;
}

// Undocking: the player presses U in the docked phase. The mission moves to departure.
export function startUndocking(mission) {
  if (mission.phase !== 'docked' && mission.phase !== 'refuelling') return false;
  mission.phase = 'undocking';
  mission.message = MESSAGES.undocking;
  return true;
}

export function finishUndocking(mission) {
  if (mission.phase !== 'undocking') return false;
  mission.phase = 'departure';
  mission.message = MESSAGES.departure;
  return true;
}

// Refuelling completion is reported by the tank module.
export function setRefuelResult(mission, deliveredKg, faults) {
  mission.refuel.deliveredKg = deliveredKg;
  mission.refuel.faults = faults;
  mission.refuel.complete = true;
}

// Departure planning: the player presses P to record the current plan.
export function planDeparture(mission, cw, nRadPerS, T) {
  const dep = departureCheck(cw, nRadPerS, T);
  mission.departure.safe = dep.safe;
  if (dep.safe) {
    if (mission.departure.firstPlanSafe === null) {
      mission.departure.firstPlanSafe = mission.departure.corrections === 0;
    }
  } else {
    mission.departure.corrections += 1;
  }
  return dep;
}

// Final scoring.
export function computeScore(mission, vehicle) {
  const capture = mission.captureQuality;
  const deltaV = deltaVScore(vehicle.deltaVUsedMps, mission.deltaVReferenceMps);
  const refuel = refuelScore(mission.refuel.deliveredKg, mission.refuel.faults);
  const departure = departureScore(mission.departure.safe, mission.departure.corrections);
  const penalties = mission.camCount * penaltyFor('cam') + mission.envelopePenalties * penaltyFor('envelope');
  const total = Math.max(0, capture + deltaV + refuel + departure - penalties);
  mission.score = total;
  mission.breakdown = { capture, deltaV, refuel, departure, penalties, total, grade: grade(total) };
  return mission.breakdown;
}

export function setPhase(mission, phase) {
  mission.phase = phase;
  mission.message = MESSAGES[phase] || '';
}

export const MISSION_MESSAGES = MESSAGES;
export const HOLD_PHASES_LIST = HOLD_PHASES;
export const HOLD_DISTANCES = HOLD_D;
