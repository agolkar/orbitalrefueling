// src/dockedPlay.js
// The docked levels in the browser (5 Connect, 6 Transfer, 7 Depart): maps the keys to the level
// modules, poses the arm, the valve cap, the probe and the servicer, sets the views of the level
// and draws its instruments. main.js owns the screens and the render loop.

import * as THREE from 'three';
import { ARM, CAPTURE, CHASER, TANK } from './config.js';
import { createConnect, stepConnect, connectSummary, connectFeedback } from './game/connect.js';
import { createTransfer, stepTransferLevel, transferSummary, transferFeedback } from './game/refuel.js';
import { createDeparture, stepDeparture, departureSummary, departureFeedback, predictDeparture } from './game/departure.js';
import { attachedAttitude, clientQuat } from './game/challenge.js';
import { stowedPose, toolIk, armWorkspace } from './physics/arm.js';
import { quatRotateVec } from './physics/vehicle.js';
import { updateConnectUi, updateTransferUi, updateDepartureUi } from './ui/dockedUi.js';

const DEG = Math.PI / 180;
const DOCKED_CW = { x: CAPTURE.dockedCmXM, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const NICE_EXTENTS_M = [250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
// Servicer mass after delivering the cargo of level 6.
const DEPART_MASS_KG = CHASER.dryMassKg + CHASER.ownPropellantKg + CHASER.cargoPropellantKg - TANK.goalKg;

// Reused vectors and quaternions in the frame loop (no allocation per frame).
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);

export class DockedPlay {
  constructor({ arm, valveCap, cameraRig, ui, targetRoot, pairFocus = null, pairFitRadius = null }) {
    this.arm = arm;
    this.valveCap = valveCap;
    this.cameraRig = cameraRig;
    this.ui = ui;
    this.targetRoot = targetRoot;
    this.pairFocus = pairFocus; // point halfway between the two spacecraft (outside view of the departure)
    this.pairFitRadius = pairFitRadius;
    this.capQuaternion = valveCap.quaternion.clone();
    this.level = null;
    this.kind = null;
    this.model = null;
    this.rollOffsetRad = 0;
    this.matedPose = null;
  }

  active() {
    return this.model !== null;
  }

  // Back to the capture levels: arm folded on the docking plate, cap on the valve.
  reset() {
    this.level = null;
    this.kind = null;
    this.model = null;
    this.arm.setPose(stowedPose());
    this.arm.setMated(false);
    this.arm.setCapStowed(false);
    this.valveCap.visible = true;
    this.valveCap.quaternion.copy(this.capQuaternion);
  }

  start(level, orbit) {
    this.reset();
    this.level = level;
    this.kind = level.kind;
    const arm = this.arm;
    const toolPose = () => arm.toolCameraPose();
    const armFocus = () => arm.worldPoint(0.26, 0.55, 0);
    if (this.kind === 'connect') {
      this.rollOffsetRad = (2 * Math.random() - 1) * ARM.dockedRollOffsetMaxDeg * DEG;
      this.model = createConnect(level, { rollOffsetRad: this.rollOffsetRad });
      this.cameraRig.setContext({ modes: ['tool', 'chase', 'free'], chaseRadius: 2.4, chaseTarget: armFocus, toolPose, chaseAngles: { theta: 0.18, phi: 1.5 } });
    } else if (this.kind === 'transfer') {
      this.rollOffsetRad = 0;
      this.model = createTransfer(level);
      const ws = armWorkspace(0);
      const ik = toolIk(ws.valve.u, ws.valve.v);
      this.matedPose = { ...ik, strokeM: ws.valveFaceA - ARM.toolTipRetractedAheadOfFaceM };
      this.valveCap.visible = false;
      arm.setCapStowed(true);
      arm.setMated(true);
      this.cameraRig.setContext({ modes: ['chase', 'tool', 'free'], chaseRadius: 2.4, chaseTarget: armFocus, toolPose, chaseAngles: { theta: 0.18, phi: 1.5 } });
    } else {
      this.rollOffsetRad = 0;
      this.model = createDeparture(level, orbit.nRadPerS, orbit.periodS);
      // The departure opens on the outside view of both spacecraft, the docking camera in the corner.
      this.cameraRig.setContext({ modes: ['chase', 'docking', 'free'], chaseRadius: 16, chaseTarget: this.pairFocus, chaseMinRadius: this.pairFitRadius });
    }
    this.render();
  }

  // One frame of play. actions: the action names of this frame (confirm, level1..3, warpUp...).
  step(dt, input, actions) {
    if (!this.model) return;
    const intent = input.translationIntent();
    const confirm = actions.includes('confirm');
    if (this.kind === 'connect') {
      // Tool camera axes: up arrow away from the docking axis (+u), right arrow +v, W lowers.
      stepConnect(this.model, dt, { move: { u: intent.z, v: -intent.y, a: intent.x }, fine: input.shiftHeld(), space: confirm });
    } else if (this.kind === 'transfer') {
      let valve = 0;
      for (const k of [1, 2, 3]) if (actions.includes(`level${k}`)) valve = k;
      stepTransferLevel(this.model, dt, { valve, leak: input.wasPressed('KeyL'), flow: confirm, openingRate: intent.z });
    } else {
      const a = (CHASER.rcsTranslationForceN / DEPART_MASS_KG) * dt;
      const dv = quatRotateVec(this.servicerAttitude(), { x: intent.x * a, y: intent.y * a, z: intent.z * a });
      stepDeparture(this.model, dt, {
        dv,
        clear: input.wasPressed('Backspace'),
        execute: confirm,
        faster: actions.includes('warpUp'),
        slower: actions.includes('warpDown')
      });
    }
  }

  done() {
    return !!this.model && (this.model.phase === 'success' || this.model.phase === 'failed');
  }

  result() {
    return this.model ? this.model.result : null;
  }

  sceneTime() {
    if (!this.model) return 0;
    return this.kind === 'departure' ? this.model.tSim : this.model.t;
  }

  servicerAttitude() {
    return attachedAttitude(this.level, this.sceneTime(), this.rollOffsetRad);
  }

  // Poses for the scene: servicer position (LVLH) and attitude, client attitude, probe extension.
  sceneState() {
    const t = this.sceneTime();
    const m = this.model;
    let probeExtM = CAPTURE.finalExtensionM;
    let cw = DOCKED_CW;
    if (this.kind === 'departure') {
      cw = m.cw;
      probeExtM = m.phase === 'undocking' ? CAPTURE.finalExtensionM * Math.max(0, 1 - m.t / ARM.undockS) : 0;
    }
    return { tScene: t, cw, q: this.servicerAttitude(), qc: clientQuat(this.level, t), probeExtM };
  }

  // Arm, cap and coupling for this frame.
  render() {
    if (!this.model) return;
    if (this.kind === 'connect') {
      const c = this.model;
      this.arm.setPose(c.pose);
      this.arm.setMated(c.mated);
      this.arm.setCapStowed(c.capRemoved);
      this.valveCap.visible = !c.capRemoved;
      const turn = c.capRemovingS > 0 ? (1 - c.capRemovingS / ARM.capRemovalS) * 4 * Math.PI : 0;
      this.valveCap.quaternion.copy(this.capQuaternion).multiply(_q.setFromAxisAngle(_axisY, -turn));
    } else if (this.kind === 'transfer') {
      this.arm.setPose(this.matedPose);
    } else {
      this.arm.setPose(stowedPose());
    }
  }

  // Which corner view the outside cameras keep: the tool camera on the arm, the docking camera
  // for the departure.
  pipPose(current) {
    if (this.kind === 'connect' && current !== 'tool') return 'tool';
    if (this.kind === 'departure' && current !== 'docking') return 'docking';
    return null;
  }

  pipView() {
    if (this.kind === 'connect') {
      const s = connectSummary(this.model);
      return { aimPoint: this.arm.toolCameraPose().tip, text: reticleText(s, ' · ') };
    }
    const nozzle = _v.set(CAPTURE.ringPlaneAboveClientCmM + CAPTURE.nozzleExitProtrusionM, 0, 0);
    this.targetRoot.updateWorldMatrix(true, false);
    const s = departureSummary(this.model);
    return { aimPoint: nozzle.applyMatrix4(this.targetRoot.matrixWorld), text: `range ${s.rangeM.toFixed(1)} m  ${(100 * s.rangeRateMps).toFixed(1)} cm/s` };
  }

  // Reticle of the main view: the tool camera of level 5 (the tool axis is the image centre), or
  // the docking camera of level 7 on the client's nozzle with range and range rate.
  reticle(camera, current) {
    const onScreen = (w) => {
      const p = w.clone().project(camera);
      return { visible: p.z > -1 && p.z < 1, px: (p.x * 0.5 + 0.5) * window.innerWidth, py: (-p.y * 0.5 + 0.5) * window.innerHeight };
    };
    if (this.kind === 'connect' && current === 'tool') {
      return { ...onScreen(this.arm.toolCameraPose().tip), text: reticleText(connectSummary(this.model), '<br>') };
    }
    if (this.kind === 'departure' && current === 'docking') {
      const s = departureSummary(this.model);
      return { ...onScreen(this.pipView().aimPoint), rangeM: s.rangeM, rangeRateMps: s.rangeRateMps };
    }
    return { visible: false };
  }

  updateUi(countdown) {
    if (!this.model) return;
    const ready = { text: `Get ready · C switches to the ${this.cameraRig.nextLabel()}`, tone: 'info' };
    const level = this.level;
    if (this.kind === 'connect') {
      updateConnectUi(this.ui, { level, s: connectSummary(this.model), feedback: countdown ? ready : connectFeedback(this.model) });
    } else if (this.kind === 'transfer') {
      updateTransferUi(this.ui, { level, s: transferSummary(this.model), feedback: countdown ? ready : transferFeedback(this.model) });
    } else {
      updateDepartureUi(this.ui, { level, s: departureSummary(this.model), feedback: countdown ? ready : departureFeedback(this.model) });
    }
  }

  // What the sound director needs from the level, copied so that the next frame cannot change it.
  audioState() {
    if (!this.model) return null;
    const m = this.model;
    if (this.kind === 'connect') {
      const s = connectSummary(m);
      return {
        timeLeftS: s.timeLeftS,
        connect: {
          phase: m.phase,
          pose: { joint1Rad: m.pose.joint1Rad, joint2Rad: m.pose.joint2Rad, strokeM: m.pose.strokeM },
          overValve: s.overValve,
          contact: s.contact,
          capRemovingS: s.capRemovingS,
          capRemoved: m.capRemoved,
          message: m.message,
          messageS: m.messageS
        }
      };
    }
    if (this.kind === 'transfer') {
      const s = transferSummary(m);
      return {
        timeLeftS: s.timeLeftS,
        transfer: {
          phase: m.phase,
          leakState: s.leakState,
          openCount: s.openCount,
          running: s.running,
          opening: s.opening,
          deliveredKg: s.deliveredKg,
          goalLowKg: s.goalLowKg,
          goalHighKg: s.goalHighKg,
          clientPressureBar: s.clientPressureBar,
          maxPressureBar: s.maxPressureBar,
          message: m.message,
          messageS: m.messageS
        }
      };
    }
    const s = departureSummary(m);
    return {
      timeLeftS: s.timeLeftS,
      departure: { phase: m.phase, safe: s.safe, planMps: s.planMps, fastForward: s.fastForward, message: m.message, messageS: m.messageS }
    };
  }

  // LVLH plot of the departure: trail, two-orbit prediction and a scale that shows it whole.
  plotData() {
    if (this.kind !== 'departure') return null;
    const dep = this.model;
    const prediction = dep.phase === 'success' || dep.phase === 'failed' ? [] : predictDeparture(dep, 160);
    let need = 0;
    for (const p of prediction) need = Math.max(need, Math.abs(p.x), Math.abs(p.y));
    need = Math.max(need, Math.abs(dep.cw.x), Math.abs(dep.cw.y)) / 0.9;
    let extentM = NICE_EXTENTS_M[NICE_EXTENTS_M.length - 1];
    for (const e of NICE_EXTENTS_M) {
      if (e >= need) {
        extentM = e;
        break;
      }
    }
    return { state: { x: dep.cw.x, y: dep.cw.y }, trail: dep.trail, prediction, extentM };
  }
}

function reticleText(s, sep) {
  if (s.capRemovingS > 0) return `unscrewing the cap${sep}${s.capRemovingS.toFixed(1)} s`;
  const off = 1000 * s.offAxisM;
  const offText = off < 1000 ? `${off.toFixed(1)} mm off axis` : `${(off / 1000).toFixed(2)} m to the valve`;
  const h = s.overValve ? `${(1000 * s.heightAboveTargetM).toFixed(0)} mm above the ${s.targetName}` : 'not over the valve';
  return `${offText}${sep}${s.contact ? `on the ${s.contact}` : h}`;
}
