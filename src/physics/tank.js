// src/physics/tank.js
// Client blowdown tank, servicer cargo tank, transfer line, valves, leak check and propellant
// transfer. No three.js and no DOM access.
//
// Client tank: blowdown, isothermal ullage p = p0 * V_ull0 / V_ull with V_ull = V_tank - m / rho.
// Servicer cargo tank: regulated at 24 bar.
// Flow: mdot = k * opening * sqrt(max(0, p_servicer - p_client - dp_line)), k = 5e-5 kg/(s Pa^0.5).
// Procedure: the leak check of the mated tool comes first, with the three valves closed: helium
// at 15 bar fills the line up to the closed client fill valve and must hold 30 s with less than
// 1 % drop. Then the valves open in order (servicer cargo isolation, line, client fill) and close
// in reverse order. A wrong step is a fault and changes nothing.

import { TANK } from '../config.js';

// Client tank pressure (Pa) for a propellant mass m (kg).
export function clientPressurePa(massKg, volumeM3 = TANK.clientVolumeM3, densityKgM3 = TANK.propellantDensityKgM3) {
  const ullage0 = volumeM3 - TANK.clientInitialPropellantKg / densityKgM3;
  const ullage = volumeM3 - massKg / densityKgM3;
  if (ullage <= 0) return Infinity;
  return TANK.clientInitialUllagePressurePa * ullage0 / ullage;
}

// Propellant mass (kg) in the client tank at pressure p (Pa).
export function clientMassAtPressureKg(pressurePa, volumeM3 = TANK.clientVolumeM3, densityKgM3 = TANK.propellantDensityKgM3) {
  const ullage0 = volumeM3 - TANK.clientInitialPropellantKg / densityKgM3;
  const ullage = TANK.clientInitialUllagePressurePa * ullage0 / pressurePa;
  return (volumeM3 - ullage) * densityKgM3;
}

// Maximum propellant the client tank can hold before the 22 bar limit.
export function maxClientMassKg() {
  return clientMassAtPressureKg(TANK.maxExpectedOperatingPressurePa);
}

// Flow rate (kg/s) at a valve opening (0..1) and the current pressures.
export function flowRateKgS(opening, pServicerPa, pClientPa) {
  const dp = pServicerPa - pClientPa - TANK.linePressureDropPa;
  if (dp <= 0 || opening <= 0) return 0;
  return TANK.flowCoefficientKgPerSPa0_5 * opening * Math.sqrt(dp);
}

// Leak probability from the misalignment at capture (rad) and the lateral offset (m).
export function leakProbability(misalignmentRad, lateralM) {
  const p = TANK.leakProbabilityBase
    + TANK.leakProbabilityPerRadMisalignment * Math.abs(misalignmentRad)
    + TANK.leakProbabilityPerMeterLateral * Math.abs(lateralM);
  return Math.min(TANK.leakProbabilityMax, Math.max(0, p));
}

// Deterministic pseudo-random from a seed, so tests and replays agree.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A refuelling session: valves, leak check, transfer state and the masses.
export function createTank({ captureMisalignmentRad = 0, captureLateralM = 0, seed = 20200201 } = {}) {
  const rand = seeded(seed);
  const leaky = rand() < leakProbability(captureMisalignmentRad, captureLateralM);
  return {
    clientMassKg: TANK.clientInitialPropellantKg,
    clientPressurePa: clientPressurePa(TANK.clientInitialPropellantKg),
    cargoMassKg: 300, // kg, servicer cargo tank
    cargoPressurePa: TANK.chaserCargoPressurePa,
    valves: { chaserCargoIsolation: false, line: false, clientFill: false },
    valveOrderIndex: 0, // number of open valves; they always open as a prefix of TANK.valveOrder
    faults: 0,
    faultLog: [],
    leak: {
      state: 'idle', // idle, holding, passed, failed
      pressurePa: 0,
      holdS: 0,
      leaky,
      // A leaky interface loses 2 % of the helium pressure over the hold; a tight one nothing.
      leakRatePaPerS: leaky ? TANK.heliumPressurePa * 0.02 / TANK.leakHoldS : 0,
      passed: false
    },
    transfer: { state: 'idle', opening: 0, deliveredKg: 0, elapsedS: 0, overpressure: false },
    deliveredKg: 0
  };
}

function fault(tank, kind, reason) {
  tank.faults += 1;
  tank.faultLog.push({ kind, atS: tank.transfer.elapsedS });
  return { ok: false, fault: true, reason };
}

export function allValvesOpen(tank) {
  return TANK.valveOrder.every((v) => tank.valves[v]);
}

export function allValvesClosed(tank) {
  return TANK.valveOrder.every((v) => !tank.valves[v]);
}

// Open (open = true) or close a valve. Opening needs a passed leak check and the next valve in
// TANK.valveOrder; closing needs the last open valve (reverse order). Closing the client fill valve
// stops a running transfer. Returns { ok, fault, reason }.
export function setValve(tank, name, open) {
  if (!(name in tank.valves)) return { ok: false, fault: false, reason: 'unknown valve' };
  if (open) {
    if (tank.valves[name]) return { ok: true, fault: false, reason: null };
    if (tank.leak.state === 'holding') return { ok: false, fault: false, reason: 'wait for the end of the leak check' };
    if (!tank.leak.passed) return fault(tank, 'leakFirst', 'run the leak check before opening a valve');
    const expected = TANK.valveOrder[tank.valveOrderIndex];
    if (name !== expected) return fault(tank, 'order', `wrong order: open ${expected} first`);
    tank.valves[name] = true;
    tank.valveOrderIndex += 1;
    return { ok: true, fault: false, reason: null };
  }
  if (!tank.valves[name]) return { ok: true, fault: false, reason: null };
  const expectedClose = TANK.valveOrder[tank.valveOrderIndex - 1];
  if (name !== expectedClose) return fault(tank, 'closeOrder', `wrong order: close ${expectedClose} first`);
  if (name === 'clientFill') stopTransfer(tank);
  tank.valves[name] = false;
  tank.valveOrderIndex -= 1;
  return { ok: true, fault: false, reason: null };
}

// Pressurise the line with helium against the closed valves and start the 30 s hold.
export function startLeakCheck(tank) {
  if (tank.leak.passed) return { ok: false, reason: 'the leak check has passed already' };
  if (!allValvesClosed(tank)) return { ok: false, reason: 'close all three valves first' };
  if (tank.leak.state === 'holding') return { ok: false, reason: 'the leak check is running' };
  tank.leak.state = 'holding';
  tank.leak.pressurePa = TANK.heliumPressurePa;
  tank.leak.holdS = 0;
  return { ok: true, reason: null };
}

// Advance the leak check by dtS seconds. Passes when the pressure drop stays below 1 %.
export function stepLeakCheck(tank, dtS) {
  if (tank.leak.state !== 'holding') return tank.leak;
  tank.leak.holdS = Math.min(TANK.leakHoldS, tank.leak.holdS + dtS);
  tank.leak.pressurePa = Math.max(0, tank.leak.pressurePa - tank.leak.leakRatePaPerS * dtS);
  if (tank.leak.holdS >= TANK.leakHoldS) {
    const drop = (TANK.heliumPressurePa - tank.leak.pressurePa) / TANK.heliumPressurePa;
    tank.leak.passed = drop <= TANK.leakMaxDropFrac;
    tank.leak.state = tank.leak.passed ? 'passed' : 'failed';
    if (!tank.leak.passed) fault(tank, 'leak', 'the line lost helium during the hold');
  }
  return tank.leak;
}

// Start the transfer at an opening (0..1). Needs all three valves open (and so a passed leak check).
export function startTransfer(tank, opening) {
  if (!tank.leak.passed) return { ok: false, reason: 'run the leak check first' };
  if (!allValvesOpen(tank)) return { ok: false, reason: 'open all three valves first' };
  tank.transfer.opening = Math.max(0, Math.min(1, opening));
  tank.transfer.state = 'running';
  return { ok: true, reason: null };
}

// Advance the transfer by dtS seconds of simulated time. The masses update live; exceeding
// 22 bar is a fault and stops the transfer.
export function stepTransfer(tank, dtS) {
  if (tank.transfer.state !== 'running') return tank.transfer;
  const mdot = flowRateKgS(tank.transfer.opening, tank.cargoPressurePa, tank.clientPressurePa);
  const dm = Math.min(tank.cargoMassKg, mdot * dtS);
  tank.cargoMassKg -= dm;
  tank.clientMassKg += dm;
  tank.deliveredKg += dm;
  tank.transfer.deliveredKg = tank.deliveredKg;
  tank.transfer.elapsedS += dtS;
  tank.clientPressurePa = clientPressurePa(tank.clientMassKg);
  if (tank.clientPressurePa > TANK.maxExpectedOperatingPressurePa) {
    tank.transfer.overpressure = true;
    tank.transfer.state = 'stopped';
    fault(tank, 'overpressure', 'the client tank passed 22 bar');
  }
  if (tank.cargoMassKg <= 0) tank.transfer.state = 'stopped';
  return tank.transfer;
}

export function stopTransfer(tank) {
  if (tank.transfer.state === 'running') tank.transfer.state = 'stopped';
  return tank.transfer;
}

// Goal: 150 kg within 2 %.
export function goalReached(tank) {
  return Math.abs(tank.deliveredKg - TANK.goalKg) <= TANK.goalToleranceFrac * TANK.goalKg;
}

// More than the goal plus the tolerance: the goal can no longer be met.
export function overfilled(tank) {
  return tank.deliveredKg > TANK.goalKg * (1 + TANK.goalToleranceFrac);
}
