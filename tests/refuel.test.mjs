// tests/refuel.test.mjs
// Stage 5 tests: tank pressure, maximum transferable mass, flow rate, valve procedure, leak check,
// departure from the docked state, arm geometry and collisions, the de-spin of the docked stack,
// and the three docked levels won by a scripted player in every scenario. No test framework.

import { ORBITS, TANK, ARM, CHALLENGE, CHASER, CLIENT } from '../src/config.js';
import {
  clientPressurePa,
  maxClientMassKg,
  flowRateKgS,
  createTank,
  setValve,
  allValvesOpen,
  startLeakCheck,
  stepLeakCheck,
  goalReached
} from '../src/physics/tank.js';
import {
  armIk,
  armTip,
  armPoints,
  jointStepLimitRad,
  valvePositionClient,
  armBasePositionBody,
  armWorkspace,
  armClearance,
  stowedPose,
  toolIk,
  uvAtAzimuth
} from '../src/physics/arm.js';
import { createConnect, stepConnect, connectSummary } from '../src/game/connect.js';
import { createTransfer, stepTransferLevel, transferSummary } from '../src/game/refuel.js';
import {
  createDeparture,
  stepUndock,
  setPlan,
  clearPlan,
  updateSafe,
  executeBurn,
  stepCoast,
  stepDeparture
} from '../src/game/departure.js';
import { levelFor, createDespin, stepDespin, despinAngleRad, spinAngleRad, clientQuat } from '../src/game/challenge.js';

const DEG = Math.PI / 180;

function assertTrue(c, m) {
  if (!c) throw new Error(m);
}
function assertClose(a, e, tol, m) {
  if (!Number.isFinite(a) || Math.abs(a - e) > tol) throw new Error(`${m}: actual=${a}, expected=${e}, tol=${tol}`);
}

// A scripted Connect player: moves the tool over the valve, lowers it (SHIFT for the last 2 cm),
// removes the cap, lowers onto the valve, centres within 1.5 mm and mates.
function playConnect(level, rollDeg = 0) {
  const c = createConnect(level, { rollOffsetRad: rollDeg * DEG });
  const h = 1 / 60;
  while (c.phase === 'fly' && c.t < 200) {
    const s = connectSummary(c);
    const move = { u: 0, v: 0, a: 0 };
    let fine = false;
    let space = false;
    if (s.capRemovingS > 0) {
      // wait
    } else if (s.offAxisM > (s.contact ? 0.0015 : 0.003)) {
      move.u = s.du / s.offAxisM;
      move.v = s.dv / s.offAxisM;
      fine = s.offAxisM < 0.02;
    } else if (!s.contact) {
      move.a = 1;
      fine = s.heightAboveTargetM < 0.02;
    } else {
      space = true;
    }
    stepConnect(c, h, { move, fine, space });
  }
  return c;
}

// A scripted Transfer player: leak check, valves in order, flow at full opening, throttle down
// near the goal, stop, close the valves in reverse order.
function playTransfer(level) {
  const tr = createTransfer(level);
  const h = 1 / 60;
  let k = 0;
  while (tr.phase === 'fly' && tr.t < 300) {
    const s = transferSummary(tr);
    const ctl = {};
    if (k % 12 === 0) {
      if (s.leakState === 'idle') ctl.leak = true;
      else if (s.leakState === 'passed' && !s.flowed && s.openCount < 3) ctl.valve = s.openCount + 1;
      else if (s.openCount === 3 && !s.running && !s.flowed) ctl.flow = true;
      else if (s.running && s.deliveredKg >= 149.7) ctl.flow = true;
      else if (!s.running && s.flowed && s.openCount > 0) ctl.valve = s.openCount;
    }
    if (s.running && s.deliveredKg > 146 && s.opening > 0.3) ctl.openingRate = -1;
    k += 1;
    stepTransferLevel(tr, h, ctl);
  }
  return tr;
}

// A scripted Depart player: waits for the undock, holds an along-track key until SAFE, executes.
function playDeparture(level, orbit, sign = 1) {
  const dep = createDeparture(level, orbit.nRadPerS, orbit.periodS);
  const h = 1 / 60;
  const acc = CHASER.rcsTranslationForceN / 2050;
  while (dep.phase !== 'success' && dep.phase !== 'failed' && dep.t < 400) {
    const ctl = {};
    if (dep.phase === 'plan') {
      if (!dep.safe) ctl.dv = { x: 0, y: sign * acc * h, z: 0 };
      else ctl.execute = true;
    }
    stepDeparture(dep, h, ctl);
  }
  return dep;
}

export const tests = [
  {
    name: '41 Tank: client pressure after adding 150 kg',
    fn() {
      const p = clientPressurePa(TANK.clientInitialPropellantKg + 150);
      assertClose(p / 1e5, 11.25, 1e-6, 'client pressure after 150 kg');
    }
  },
  {
    name: '42 Tank: maximum transferable mass before 22 bar',
    fn() {
      assertClose(maxClientMassKg() - TANK.clientInitialPropellantKg, 209, 1, 'maximum transferable mass');
    }
  },
  {
    name: '43 Tank: flow at full opening at the start',
    fn() {
      const tank = createTank();
      assertClose(flowRateKgS(1, tank.cargoPressurePa, tank.clientPressurePa), 0.068, 0.001, 'flow at full opening');
    }
  },
  {
    name: '44 Tank: leak check first, valves open in order and close in reverse order',
    fn() {
      const tank = createTank();
      let r = setValve(tank, 'chaserCargoIsolation', true);
      assertTrue(r.fault && !tank.valves.chaserCargoIsolation, 'opening before the leak check is a fault');
      assertTrue(startLeakCheck(tank).ok, 'leak check with the valves closed');
      stepLeakCheck(tank, TANK.leakHoldS);
      assertTrue(tank.leak.passed, 'tight line passes');
      r = setValve(tank, 'clientFill', true);
      assertTrue(r.fault && !tank.valves.clientFill, 'client fill before the line valve is a fault and stays closed');
      for (const v of TANK.valveOrder) assertTrue(setValve(tank, v, true).ok, `open ${v} in order`);
      assertTrue(allValvesOpen(tank), 'all three valves open');
      r = setValve(tank, 'line', false);
      assertTrue(r.fault && tank.valves.line, 'closing the line valve before the client fill valve is a fault');
      for (const v of TANK.closeValveOrder) assertTrue(setValve(tank, v, false).ok, `close ${v} in reverse order`);
      assertTrue(tank.faults === 3, `three faults, got ${tank.faults}`);
    }
  },
  {
    name: '45 Tank: leak check passes on a tight line and fails on a leaky one',
    fn() {
      const tank = createTank();
      assertTrue(startLeakCheck(tank).ok, 'started');
      for (let t = 0; t < TANK.leakHoldS + 1; t += 0.1) stepLeakCheck(tank, 0.1);
      assertTrue(tank.leak.state === 'passed' && tank.faults === 0, `tight: ${tank.leak.state}`);
      const tr = createTransfer(levelFor(6), { leaky: true });
      stepTransferLevel(tr, 0.1, { leak: true });
      for (let i = 0; i < 30; i += 1) stepTransferLevel(tr, 0.1, {});
      assertTrue(tr.phase === 'failed' && /leak check/.test(tr.result.reason), `leaky: ${tr.phase} ${tr.result && tr.result.reason}`);
    }
  },
  {
    name: '46 Departure: the push-off moves away; radial burn UNSAFE, along-track SAFE, contact UNSAFE',
    fn() {
      const n = ORBITS.GEO.nRadPerS;
      const T = ORBITS.GEO.periodS;
      const dep = createDeparture(levelFor(7, CHALLENGE.scenarios[0]), n, T);
      while (dep.phase === 'undocking') stepUndock(dep, 0.1);
      assertTrue(dep.phase === 'plan', `phase ${dep.phase}`);
      assertTrue(dep.cw.x > 3.55 + 0.05 && dep.cw.vx > 0.019, `moving away: x ${dep.cw.x}, vx ${dep.cw.vx}`);
      assertTrue(!dep.safe && dep.reason === 'reenter', `push alone: ${dep.reason}`);
      setPlan(dep, { x: 0.1, y: 0, z: 0 });
      assertTrue(!dep.safe, 'radial burn of 0.1 m/s is UNSAFE');
      clearPlan(dep);
      setPlan(dep, { x: -0.05, y: 0.05, z: 0 });
      assertTrue(!dep.safe && dep.reason === 'contact', `a burn towards the client: ${dep.reason}`);
      clearPlan(dep);
      setPlan(dep, { x: 0, y: -0.1, z: 0 });
      assertTrue(dep.safe, 'along-track burn of -0.1 m/s is SAFE');
      assertTrue(executeBurn(dep).ok, 'burn executed');
      for (let k = 0; k < 200 && dep.phase === 'coast'; k += 1) stepCoast(dep, 0.2);
      assertTrue(dep.phase === 'success', `phase ${dep.phase}`);
    }
  },
  {
    name: '47 Level 5 Connect is winnable in every scenario and roll offset',
    fn() {
      for (const scen of CHALLENGE.scenarios) {
        const level = levelFor(5, scen);
        for (const roll of [-ARM.dockedRollOffsetMaxDeg, 0, ARM.dockedRollOffsetMaxDeg]) {
          const c = playConnect(level, roll);
          const tag = `${scen.id} roll ${roll}`;
          assertTrue(c.phase === 'success', `${tag}: ${c.phase}, ${c.result && c.result.reason}`);
          assertTrue(c.t <= level.timeS, `${tag}: mated at ${c.t} s`);
          assertTrue(c.result.score > 0 && c.result.offAxisMm <= 5, `${tag}: score ${c.result.score}, ${c.result.offAxisMm} mm`);
        }
      }
    }
  },
  {
    name: '48 Level 6 Transfer is winnable in every scenario',
    fn() {
      for (const scen of CHALLENGE.scenarios) {
        const level = levelFor(6, scen);
        const tr = playTransfer(level);
        assertTrue(tr.phase === 'success', `${scen.id}: ${tr.phase}, ${tr.result && tr.result.reason}`);
        assertTrue(tr.t <= level.timeS, `${scen.id}: complete at ${tr.t} s`);
        assertTrue(goalReached(tr.tank), `${scen.id}: goal reached`);
        assertTrue(tr.tank.clientPressurePa <= TANK.maxExpectedOperatingPressurePa, `${scen.id}: below 22 bar`);
        assertTrue(tr.result.score > 700, `${scen.id}: scored ${tr.result.score}`);
      }
    }
  },
  {
    name: '49 Level 7 Depart is winnable in every scenario',
    fn() {
      for (const scen of CHALLENGE.scenarios) {
        const level = levelFor(7, scen);
        for (const sign of [1, -1]) {
          const dep = playDeparture(level, ORBITS[scen.orbit], sign);
          const tag = `${scen.id} sign ${sign}`;
          assertTrue(dep.phase === 'success', `${tag}: ${dep.phase}, ${dep.result && dep.result.reason}`);
          assertTrue(dep.burnT <= level.timeS, `${tag}: burn at ${dep.burnT} s`);
          assertTrue(dep.t < dep.burnT + 30, `${tag}: 30 m reached ${dep.t - dep.burnT} s after the burn`);
          assertTrue(dep.result.score > 700 && dep.result.deltaVMps < level.budgetMps, `${tag}: ${dep.result.score}, ${dep.result.deltaVMps}`);
        }
      }
    }
  },
  {
    name: '50 Arm kinematics and geometry',
    fn() {
      const tip = armTip(0, 0);
      assertClose(tip.x, ARM.segment1M + ARM.segment2M, 1e-12, 'stretched reach');
      const ik = armIk(0.5, 0.3);
      const tip2 = armTip(ik.joint1Rad, ik.joint2Rad);
      assertClose(tip2.x, 0.5, 1e-9, 'ik x');
      assertClose(tip2.y, 0.3, 1e-9, 'ik y');
      const v = valvePositionClient();
      assertClose(v.y, 0.425, 1e-9, 'valve y');
      assertClose(v.z, 0.85 * Math.sin(Math.PI / 3), 1e-9, 'valve z');
      const base = armBasePositionBody();
      assertClose(base.y, 0.3 * Math.sin(Math.PI / 3), 1e-9, 'arm base y');
      assertClose(base.z, 0.3 * Math.cos(Math.PI / 3), 1e-9, 'arm base z');
      assertClose(jointStepLimitRad(1), ARM.jointRateMaxDegS * DEG, 1e-12, 'joint rate limit');
      const ws = armWorkspace(0);
      assertClose(ws.valveFaceA, 0.45, 1e-9, 'valve face 0.45 m ahead of the docking face');
      assertClose(ws.capTopA, 0.42, 1e-9, 'cap top');
      assertClose(ws.valve.u, 0.85, 1e-9, 'valve straight out from the arm base');
      const s0 = uvAtAzimuth(0, 1);
      assertClose(s0.u, 0.5, 1e-9, 'stanchion at 0 deg, u');
      assertClose(s0.v, Math.sqrt(3) / 2, 1e-9, 'stanchion at 0 deg, v');
      const stow = stowedPose();
      assertTrue(armClearance(ws, stow, true).clearanceM > 0.05, 'the stowed arm is clear');
      const reach = toolIk(ws.valve.u, ws.valve.v);
      assertTrue(reach !== null, 'the valve is in reach');
      const pts = armPoints(reach.joint1Rad, reach.joint2Rad);
      assertClose(Math.hypot(pts.tool.u - ws.valve.u, pts.tool.v - ws.valve.v), 0, 1e-9, 'tool over the valve');
    }
  },
  {
    name: '51 Connect: hard contact, the deck, the ring and the stanchions fail the attempt',
    fn() {
      const level = levelFor(5);
      const h = 1 / 60;
      const place = (c, u, v) => {
        const ik = toolIk(u, v);
        c.pose.joint1Rad = ik.joint1Rad;
        c.pose.joint2Rad = ik.joint2Rad;
      };
      // Over the valve at full speed onto the cap: struck.
      let c = createConnect(level);
      place(c, c.ws.valve.u, c.ws.valve.v);
      for (let i = 0; i < 1200 && c.phase === 'fly'; i += 1) stepConnect(c, h, { move: { u: 0, v: 0, a: 1 } });
      assertTrue(c.phase === 'failed' && /struck the cap/.test(c.result.reason), `fast contact: ${c.result && c.result.reason}`);
      // Lowered beside the valve: the deck.
      c = createConnect(level);
      place(c, c.ws.valve.u - 0.15, c.ws.valve.v);
      for (let i = 0; i < 1200 && c.phase === 'fly'; i += 1) stepConnect(c, h, { move: { u: 0, v: 0, a: 1 } });
      assertTrue(c.phase === 'failed' && /deck/.test(c.result.reason), `deck: ${c.result && c.result.reason}`);
      // Lowered over the ring wall.
      c = createConnect(level);
      place(c, c.ws.ringRadiusM, 0);
      for (let i = 0; i < 1200 && c.phase === 'fly'; i += 1) stepConnect(c, h, { move: { u: 0, v: 0, a: 1 } });
      assertTrue(c.phase === 'failed' && /ring/.test(c.result.reason), `ring: ${c.result && c.result.reason}`);
      // Driving the tool into the stanchion at 0 deg.
      c = createConnect(level);
      const leg = uvAtAzimuth(0, 0.66);
      for (let i = 0; i < 6000 && c.phase === 'fly'; i += 1) {
        const du = leg.u - c.tool.u;
        const dv = leg.v - c.tool.v;
        const d = Math.hypot(du, dv);
        stepConnect(c, h, { move: { u: du / d, v: dv / d, a: 0 } });
      }
      assertTrue(c.phase === 'failed' && /stanchion/.test(c.result.reason), `stanchion: ${c.result && c.result.reason}`);
    }
  },
  {
    name: '52 Connect: SPACE needs contact and centring; reversals count as corrections',
    fn() {
      const level = levelFor(5);
      const c = createConnect(level);
      stepConnect(c, 1 / 60, { space: true });
      assertTrue(!c.capRemoved && c.capRemovingS === 0 && /NO GO/.test(c.message), 'SPACE far from the valve is NO GO');
      stepConnect(c, 0.1, { move: { u: 1, v: 0, a: 0 } });
      stepConnect(c, 0.1, { move: { u: -1, v: 0, a: 0 } });
      stepConnect(c, 0.1, { move: { u: 1, v: 0, a: 0 } });
      assertTrue(c.corrections === 2, `two corrections, got ${c.corrections}`);
      // On the cap 2 cm off axis: NO GO; centred: the cap comes off in 3 s.
      const off = toolIk(c.ws.valve.u + 0.02, c.ws.valve.v);
      c.pose.joint1Rad = off.joint1Rad;
      c.pose.joint2Rad = off.joint2Rad;
      c.pose.strokeM = c.ws.capTopA - ARM.toolTipRetractedAheadOfFaceM;
      stepConnect(c, 1 / 60, { space: true });
      assertTrue(c.contact === 'cap' && c.capRemovingS === 0 && /10 mm/.test(c.message), `off-centre: ${c.message}`);
      const on = toolIk(c.ws.valve.u + 0.004, c.ws.valve.v);
      c.pose.joint1Rad = on.joint1Rad;
      c.pose.joint2Rad = on.joint2Rad;
      stepConnect(c, 1 / 60, { space: true });
      assertTrue(c.capRemovingS > 0, 'unscrewing');
      for (let i = 0; i < 200; i += 1) stepConnect(c, 1 / 60, { move: { u: 1, v: 0, a: 0 } });
      assertTrue(c.capRemoved && !c.capOn, 'cap removed after 3 s');
    }
  },
  {
    name: '53 Transfer: overfilling fails, closing the line early fails, faults cost points',
    fn() {
      const level = levelFor(6);
      const h = 1 / 60;
      const ready = () => {
        const t = createTransfer(level);
        stepTransferLevel(t, h, { leak: true });
        for (let i = 0; i < 90; i += 1) stepTransferLevel(t, h, {});
        for (const k of [1, 2, 3]) stepTransferLevel(t, h, { valve: k });
        stepTransferLevel(t, h, { flow: true });
        return t;
      };
      let tr = ready();
      for (let i = 0; i < 120 * 60 && tr.phase === 'fly'; i += 1) stepTransferLevel(tr, h, {});
      assertTrue(tr.phase === 'failed' && /Overfilled/.test(tr.result.reason), `overfill: ${tr.result && tr.result.reason}`);
      tr = ready();
      for (let i = 0; i < 600; i += 1) stepTransferLevel(tr, h, {});
      for (const k of [3, 2, 1]) stepTransferLevel(tr, h, { valve: k });
      assertTrue(tr.phase === 'failed' && /Line closed with/.test(tr.result.reason), `early close: ${tr.result && tr.result.reason}`);
      tr = createTransfer(level);
      stepTransferLevel(tr, h, { valve: 3 });
      assertTrue(tr.tank.faults === 1 && /Fault/.test(tr.message), 'opening a valve before the leak check is a fault');
      const clean = playTransfer(level);
      assertTrue(clean.result.success && clean.result.score > 0, 'clean run scores');
    }
  },
  {
    name: '54 De-spin of the docked stack and still docked levels',
    fn() {
      const scen = CHALLENGE.scenarios.find((s) => s.rollControl);
      const level = levelFor(4, scen);
      const d = createDespin(level, 50);
      const alpha = CHASER.rcsRotationTorqueNm / (CHASER.inertiaKgM2[0] + CLIENT.inertiaKgM2[0]);
      assertClose(d.durationS, scen.spinDegS * DEG / alpha, 1e-9, 'de-spin time');
      assertTrue(d.durationS > 10 && d.durationS < 16, `about 13 s, got ${d.durationS}`);
      assertClose(despinAngleRad(d), spinAngleRad(level, 50), 1e-12, 'continuous at hard capture');
      stepDespin(d, 0.01);
      assertClose((despinAngleRad(d) - spinAngleRad(level, 50)) / 0.01, scen.spinDegS * DEG, 1e-4, 'initial rate');
      for (let i = 0; i < 2000 && !d.done; i += 1) stepDespin(d, 0.01);
      assertTrue(d.done, 'stack still');
      const a1 = despinAngleRad(d);
      stepDespin(d, 1);
      assertClose(despinAngleRad(d), a1, 1e-12, 'no motion after the de-spin');
      for (const id of [5, 6, 7]) {
        const l = levelFor(id, scen);
        assertTrue(l.spinDegS === 0 && !l.rollControl && l.tumbleConeDeg === 0, `level ${id} starts still`);
        const q = clientQuat(l, 30);
        assertClose(q.w, 1, 1e-12, `level ${id}: client attitude fixed`);
      }
    }
  },
  {
    name: '55 Departure: time limit on the planning and refused unsafe or over-budget burns',
    fn() {
      const scen = CHALLENGE.scenarios.find((s) => s.orbit === 'LEO');
      const o = ORBITS.LEO;
      const level = levelFor(7, scen);
      let dep = createDeparture(level, o.nRadPerS, o.periodS);
      for (let i = 0; i < (level.timeS + 2) * 10 && dep.phase !== 'failed'; i += 1) stepDeparture(dep, 0.1, {});
      assertTrue(dep.phase === 'failed' && /Time is up/.test(dep.result.reason), `time-out: ${dep.result && dep.result.reason}`);
      dep = createDeparture(level, o.nRadPerS, o.periodS);
      while (dep.phase === 'undocking') stepUndock(dep, 0.1);
      updateSafe(dep);
      assertTrue(!executeBurn(dep).ok && dep.unsafeAttempts === 1, 'UNSAFE burn refused and counted');
      setPlan(dep, { x: 0, y: 0.3, z: 0 });
      assertTrue(dep.overBudget && !executeBurn(dep).ok && dep.phase === 'plan', 'over-budget burn refused');
      clearPlan(dep);
      setPlan(dep, { x: 0, y: 0.03, z: 0 });
      assertTrue(dep.safe && executeBurn(dep).ok, 'a SAFE burn within the budget runs');
    }
  }
];

export default tests;
