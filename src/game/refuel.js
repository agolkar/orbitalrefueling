// src/game/refuel.js
// Level 6 (Transfer) in the challenge format. Pure logic: no three.js and no DOM. Level 5
// (Connect) is in src/game/connect.js.
//
// Connected. L runs the leak check of the mated tool with the valves closed; 1, 2 and 3 open the
// valves in order (servicer cargo isolation, line, client fill); SPACE starts and stops the flow;
// the up and down arrows set the flow-control opening. Deliver 150 kg within 2 %, stop the flow,
// then close the valves in reverse order (3, 2, 1): closing the last one ends the attempt. The
// line processes (leak check and transfer) run at a fixed 30x; the level clock runs at 1x.

import { ARM, TANK, SCORING } from '../config.js';
import {
  createTank,
  setValve,
  allValvesOpen,
  allValvesClosed,
  startLeakCheck,
  stepLeakCheck,
  startTransfer,
  stepTransfer,
  stopTransfer,
  goalReached,
  overfilled,
  flowRateKgS
} from '../physics/tank.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export const VALVE_LABELS = {
  chaserCargoIsolation: 'servicer cargo isolation valve',
  line: 'line valve',
  clientFill: 'client fill valve'
};

// A Transfer session. The connection made in level 5 is nominal unless leaky is set.
export function createTransfer(level, { leaky = false } = {}) {
  const tank = createTank();
  if (leaky) {
    tank.leak.leaky = true;
    tank.leak.leakRatePaPerS = TANK.heliumPressurePa * 0.02 / TANK.leakHoldS;
  }
  return {
    level,
    phase: 'fly', // fly, success, failed
    t: 0, // level clock, s at 1x
    tank,
    opening: 1.0, // flow-control opening, 0.05..1
    flowed: false, // the flow has run at least once
    message: '',
    messageS: 0,
    result: null
  };
}

function say(tr, text, s = 3) {
  tr.message = text;
  tr.messageS = s;
}

// One frame of level 6. dtS: real seconds at 1x. controls: { valve: 1|2|3 (toggle), leak,
// flow (SPACE: start or stop), openingRate: -1..1 (arrow keys held) }.
export function stepTransferLevel(tr, dtS, controls = {}) {
  if (tr.phase !== 'fly') return tr;
  tr.t += dtS;
  tr.messageS = Math.max(0, tr.messageS - dtS);
  const tank = tr.tank;

  if (controls.leak) {
    const res = startLeakCheck(tank);
    if (res.ok) say(tr, 'Leak check: helium at 15 bar against the closed valves, hold 30 s (1 s at 30x)', 2);
    else say(tr, `NO GO: ${res.reason}`);
  }
  if (controls.valve) {
    const name = TANK.valveOrder[controls.valve - 1];
    const open = !tank.valves[name];
    const res = setValve(tank, name, open);
    if (res.fault) say(tr, `Fault: ${res.reason}`);
    else if (res.ok) say(tr, `${controls.valve} ${VALVE_LABELS[name]} ${open ? 'open' : 'closed'}`, 2);
    else say(tr, `NO GO: ${res.reason}`, 2);
  }
  if (controls.openingRate) {
    tr.opening = clamp(tr.opening + controls.openingRate * ARM.transferOpeningRatePerS * dtS, 0.05, 1);
  }
  if (controls.flow) {
    if (tank.transfer.state === 'running') {
      stopTransfer(tank);
      say(tr, `Flow stopped at ${tank.deliveredKg.toFixed(1)} kg`, 2);
    } else {
      const res = startTransfer(tank, tr.opening);
      if (res.ok) {
        tr.flowed = true;
        say(tr, 'Flow running at 30x', 2);
      } else {
        say(tr, `NO GO: ${res.reason}`);
      }
    }
  }
  tank.transfer.opening = tr.opening;

  const comp = ARM.transferTimeCompression;
  stepLeakCheck(tank, dtS * comp);
  stepTransfer(tank, dtS * comp);

  if (tank.leak.state === 'failed') {
    finishTransfer(tr, false, 'The leak check failed: the mated tool loses helium. The tool must be re-seated.');
    return tr;
  }
  if (tank.transfer.overpressure) {
    finishTransfer(tr, false, 'Overpressure: the client tank passed 22 bar.');
    return tr;
  }
  if (overfilled(tank)) {
    stopTransfer(tank);
    finishTransfer(tr, false, `Overfilled: ${tank.deliveredKg.toFixed(1)} kg delivered, more than 150 kg + 2 %.`);
    return tr;
  }
  if (tr.flowed && allValvesClosed(tank)) {
    if (goalReached(tank)) finishTransfer(tr, true, 'Refuelled: 150 kg delivered within 2 % and the line closed.');
    else finishTransfer(tr, false, `Line closed with ${tank.deliveredKg.toFixed(1)} kg delivered: the goal was 150 kg within 2 %.`);
    return tr;
  }
  if (tr.t > tr.level.timeS) {
    stopTransfer(tank);
    finishTransfer(tr, false, tr.level.timeoutReason || 'Time is up before the line was closed.');
  }
  return tr;
}

function finishTransfer(tr, success, reason) {
  tr.phase = success ? 'success' : 'failed';
  const level = tr.level;
  const tank = tr.tank;
  const timeLeft = Math.max(0, level.timeS - tr.t);
  const w = SCORING.transferWeights;
  let score = 0;
  let stars = 0;
  let accuracy = 0;
  if (success) {
    accuracy = clamp(1 - Math.abs(tank.deliveredKg - TANK.goalKg) / (TANK.goalToleranceFrac * TANK.goalKg), 0, 1);
    const timePart = clamp(timeLeft / (level.fullTimeLeftS || SCORING.fullTimeFraction * level.timeS), 0, 1);
    const faultPart = clamp(1 - (tank.faults * SCORING.transferFaultPenalty) / w.faults, 0, 1);
    score = Math.round(w.accuracy * accuracy + w.faults * faultPart + w.time * timePart);
    stars = score >= 750 ? 3 : score >= 550 ? 2 : 1;
  }
  tr.result = {
    success,
    reason,
    score,
    stars,
    timeS: tr.t,
    timeLeftS: timeLeft,
    deliveredKg: tank.deliveredKg,
    clientPressurePa: tank.clientPressurePa,
    faults: tank.faults,
    accuracy,
    deltaVMps: 0,
    budgetMps: level.budgetMps
  };
}

// Everything the instruments draw, as plain numbers.
export function transferSummary(tr) {
  const tank = tr.tank;
  const running = tank.transfer.state === 'running';
  const mdot = running ? flowRateKgS(tr.opening, tank.cargoPressurePa, tank.clientPressurePa) : 0;
  return {
    timeLeftS: Math.max(0, tr.level.timeS - tr.t),
    valves: TANK.valveOrder.map((v) => tank.valves[v]),
    openCount: tank.valveOrderIndex,
    leakState: tank.leak.state,
    leakHoldS: tank.leak.holdS,
    leakHoldTotalS: TANK.leakHoldS,
    leakPressureBar: tank.leak.pressurePa / 1e5,
    opening: tr.opening,
    running,
    flowed: tr.flowed,
    deliveredKg: tank.deliveredKg,
    goalKg: TANK.goalKg,
    goalLowKg: TANK.goalKg * (1 - TANK.goalToleranceFrac),
    goalHighKg: TANK.goalKg * (1 + TANK.goalToleranceFrac),
    clientPressureBar: tank.clientPressurePa / 1e5,
    maxPressureBar: TANK.maxExpectedOperatingPressurePa / 1e5,
    clientMassKg: tank.clientMassKg,
    cargoMassKg: tank.cargoMassKg,
    flowKgPerS: mdot, // simulated
    flowKgPerRealS: mdot * ARM.transferTimeCompression,
    compression: ARM.transferTimeCompression,
    faults: tank.faults
  };
}

// Feedback for level 6: the next step in the sequence, naming the key.
export function transferFeedback(tr) {
  if (tr.messageS > 0 && tr.message) {
    const bad = tr.message.startsWith('NO GO') || tr.message.startsWith('Fault');
    return { text: tr.message, tone: bad ? 'bad' : 'go' };
  }
  const s = transferSummary(tr);
  const tank = tr.tank;
  if (!tank.leak.passed) {
    if (s.leakState === 'holding') return { text: `Leak check: ${s.leakHoldS.toFixed(0)} of ${s.leakHoldTotalS} s at ${s.leakPressureBar.toFixed(2)} bar`, tone: 'ok' };
    return { text: 'Press L: leak check of the mated tool with the valves closed', tone: 'act' };
  }
  if (s.running) {
    const togo = TANK.goalKg - s.deliveredKg;
    if (togo > 15) return { text: `${s.deliveredKg.toFixed(1)} kg delivered, ${togo.toFixed(0)} kg to go: throttle down with ↓ before the goal`, tone: 'ok' };
    if (togo > 0) return { text: `${togo.toFixed(1)} kg to go: press SPACE to stop between 147 and 153 kg`, tone: 'warn' };
    return { text: `${s.deliveredKg.toFixed(1)} kg: press SPACE now to stop the flow`, tone: 'warn' };
  }
  if (!goalReached(tank)) {
    if (!allValvesOpen(tank)) {
      const k = s.openCount + 1;
      const lead = tr.flowed ? `Only ${s.deliveredKg.toFixed(1)} kg delivered: open` : 'Leak check passed. Open';
      return { text: `${lead} the valves in order: press ${k} (${VALVE_LABELS[TANK.valveOrder[k - 1]]})`, tone: 'act' };
    }
    if (tr.flowed) return { text: `${s.deliveredKg.toFixed(1)} kg delivered: SPACE resumes the flow (↑ ↓ set the opening)`, tone: 'act' };
    return { text: `Valves open: press SPACE to start the flow at ${(100 * s.opening).toFixed(0)} % (↑ ↓ set the opening)`, tone: 'act' };
  }
  if (s.openCount === 0) return { text: 'Line closed', tone: 'go' };
  const k = s.openCount;
  return { text: `${s.deliveredKg.toFixed(1)} kg delivered. Close the valves in reverse order: press ${k} (${VALVE_LABELS[TANK.valveOrder[k - 1]]})`, tone: 'go' };
}
