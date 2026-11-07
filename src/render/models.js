// src/render/models.js
// Procedural models of the two fictional spacecraft and the approach axis.
//
// Servicer: octagonal bus in white beta cloth with black multi-layer insulation (MLI) on the
// chamfers, silver optical solar reflector (OSR) radiators on top and bottom, amber Kapton RCS
// pods on the corners, two roll-out solar blankets, a docking mechanism with a central probe
// and three capture legs with foot pads.
// Clients, one per scenario, all with the same docking interface on the aft face (a bare
// aluminium launch adapter ring around a foil heat shield, the engine nozzle and the capped
// service valve):
// - relay: retired communications satellite, charcoal MLI bus, silver OSR radiators on the north
//   and south faces, an amber band, two unequal white reflectors, four-panel wings on V yokes.
// - observer: Earth observation satellite, silver MLI bus, a telescope with an oblique sunshade
//   looking at the Earth, one three-panel wing, star trackers, a downlink dish, a magnetometer boom.
// - derelict: older communications satellite that lost its attitude control, gold MLI bus, white
//   radiators, an antenna tower on the Earth deck, a large reflector on a long boom, a flat antenna
//   panel, three-panel wings stopped at different angles.
//
// The capture geometry (ring, nozzle, probe, stanchions) comes from config CAPTURE and is
// unchanged by the styling. Servicer in body axes (+X docking axis, +Y left, +Z up); client
// in LVLH axes (+x towards the servicer, wings along z).

import * as THREE from 'three';
import { CAPTURE, CHASER } from '../config.js';
import { THRUSTER_LAYOUT } from './effects.js';
import { materials, cellMaterial, osrMaterial, box, rod, cylX, dish, octagonCap, enableShadows } from './modelKit.js';

export { buildTarget } from './clients.js';

// ---------------------------------------------------------------------------
// Servicer

export function buildChaser() {
  const root = new THREE.Group();
  root.name = 'chaser';
  const m = materials();

  const L = CHASER.busDimensionsM[0]; // 2.5 m along X
  const H = CHASER.busDimensionsM[1] / 2; // 1.0 m half-size
  const C = 0.38; // m, chamfer leg
  const FACE = CHASER.dockingFaceAheadOfCmM; // 1.25 m

  // Octagonal hull: four flats and four chamfers, 2.5 m long.
  const flatW = 2 * (H - C);
  const chamW = C * Math.SQRT2;
  const chamDist = (2 * H - C) / Math.SQRT2;
  const osrTopBottom = osrMaterial(m, 2.5, 1.2);
  for (let k = 0; k < 8; k += 1) {
    const theta = (k * Math.PI) / 4; // 0 = +Y, 90 deg = +Z
    const flat = k % 2 === 0;
    const width = flat ? flatW : chamW;
    const dist = flat ? H : chamDist;
    let mat = m.blackMli;
    if (flat) mat = k === 2 || k === 6 ? osrTopBottom : m.beta;
    const face = box(L, width, 0.02, mat);
    face.rotation.x = theta - Math.PI / 2;
    face.position.set(0, Math.cos(theta) * (dist - 0.01), Math.sin(theta) * (dist - 0.01));
    root.add(face);
  }
  const front = octagonCap(H, C, true, m.blackMli);
  front.position.x = L / 2;
  root.add(front);
  const rear = octagonCap(H, C, false, m.beta);
  rear.position.x = -L / 2;
  root.add(rear);

  // Docking plate and the three capture legs (stanchions) with foot pads. The pads touch the
  // ring when d = stanchion length.
  root.add(cylX(0.74, 0.03, FACE + 0.015, 0, 0, m.aluminium, 48));
  const legLen = CAPTURE.stanchionLengthM;
  for (let i = 0; i < CAPTURE.stanchionCount; i += 1) {
    const ang = (i * CAPTURE.stanchionSpacingDeg * Math.PI) / 180;
    const rootR = 0.68;
    const tipR = CAPTURE.stanchionTipRadiusM;
    const a = [FACE + 0.03, Math.sin(ang) * rootR, Math.cos(ang) * rootR];
    const b = [FACE + legLen - 0.025, Math.sin(ang) * tipR, Math.cos(ang) * tipR];
    root.add(rod(a, b, 0.022, 0.03, m.aluminium));
    root.add(rod(a, [a[0] + 0.09, a[1] * 0.99, a[2] * 0.99], 0.05, 0.055, m.amber));
    root.add(cylX(0.065, 0.025, FACE + legLen - 0.0125, b[1], b[2], m.graphite, 24));
  }

  // Probe: a static amber housing on the plate and a telescoping rod. The rod's back end
  // stays inside the hull up to the full 1.30 m stroke. The stowed tip is 0.15 m ahead of the
  // docking face, as in the capture model.
  root.add(cylX(0.06, 0.10, FACE + 0.05, 0, 0, m.amber, 24));
  const probeGroup = new THREE.Group();
  probeGroup.name = 'probeGroup';
  const tipX = FACE + 0.15;
  probeGroup.add(cylX(0.012, 1.46, tipX - 0.04 - 0.73, 0, 0, m.aluminium, 12));
  probeGroup.add(cylX(CAPTURE.probeTipFoldedDiameterM / 2, 0.04, tipX - 0.02, 0, 0, m.dark, 12));
  root.add(probeGroup);

  // Docking camera pod above the probe (the docking camera sits at body (1.32, 0, 0.15)) and
  // the LED illuminator below it.
  // Both stay behind the camera position so they never cover the image.
  const camPod = box(0.05, 0.09, 0.07, m.graphite);
  camPod.position.set(FACE + 0.025, 0, 0.15);
  root.add(camPod);
  root.add(cylX(0.022, 0.01, FACE + 0.055, 0, 0.15, m.lens, 16));
  const ledPanel = box(0.02, 0.14, 0.06, m.led);
  ledPanel.position.set(FACE + 0.04, 0, -0.3);
  root.add(ledPanel);
  const illuminator = new THREE.SpotLight(0xfff2e0, 8, 60, 0.45, 0.5, 2);
  illuminator.position.set(FACE + 0.07, 0, -0.3);
  const illuminatorTarget = new THREE.Object3D();
  illuminatorTarget.position.set(10, 0, -0.3);
  root.add(illuminatorTarget);
  illuminator.target = illuminatorTarget;
  root.add(illuminator);

  // RCS: amber pods on the chamfers at both ends, and a nozzle at every thruster of the
  // plume layout (src/render/effects.js), pointing along its exhaust.
  for (let k = 1; k < 8; k += 2) {
    const theta = (k * Math.PI) / 4;
    for (const xs of [1, -1]) {
      const pod = box(0.5, 0.22, 0.12, m.amber);
      pod.rotation.x = theta - Math.PI / 2;
      pod.position.set(xs * (L / 2 - 0.25), Math.cos(theta) * (chamDist + 0.06), Math.sin(theta) * (chamDist + 0.06));
      root.add(pod);
    }
  }
  const nozzleGeo = new THREE.CylinderGeometry(0.012, 0.03, 0.07, 12, 1, true);
  for (const t of THRUSTER_LAYOUT) {
    const e = new THREE.Vector3(...t.exhaust).normalize();
    const nz = new THREE.Mesh(nozzleGeo, m.niobium);
    nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), e);
    nz.position.set(...t.pos).addScaledVector(e, -0.035);
    root.add(nz);
  }

  // Roll-out solar blankets on the +/-Y flats: drive, yoke, blanket between two edge booms,
  // root bar and tip mandrel. The blanket faces -X before sun tracking rotates it about Y.
  const blanketLen = CHASER.wingTipM - 1.14 - 0.75;
  const blanketW = 1.4;
  const cellsFront = cellMaterial(m, 1, blanketLen / (blanketW * 1.1));
  function buildWing(s) {
    const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 24), m.aluminium);
    drive.position.set(0, s * 1.07, 0);
    root.add(drive);
    const pivot = new THREE.Group();
    pivot.position.set(0, s * 1.14, 0);
    const y0 = s * 0.75;
    const y1 = s * (0.75 + blanketLen);
    pivot.add(rod([0, 0, 0], [0, y0, 0.62], 0.025, 0.025, m.graphite));
    pivot.add(rod([0, 0, 0], [0, y0, -0.62], 0.025, 0.025, m.graphite));
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.008, blanketLen, blanketW), [
      m.cellBack, cellsFront, m.cellBack, m.cellBack, m.cellBack, m.cellBack
    ]);
    blanket.position.set(0, (y0 + y1) / 2, 0);
    pivot.add(blanket);
    for (const zs of [1, -1]) pivot.add(rod([0, y0, zs * 0.72], [0, y1, zs * 0.72], 0.018, 0.018, m.aluminium));
    pivot.add(rod([0, y0, -0.76], [0, y0, 0.76], 0.03, 0.03, m.aluminium));
    pivot.add(rod([0, y1, -0.78], [0, y1, 0.78], 0.05, 0.05, m.graphite));
    root.add(pivot);
    return pivot;
  }
  const wingPivotL = buildWing(1);
  const wingPivotR = buildWing(-1);

  // Sensor head on a short mast at the front top: a lidar window facing forward.
  root.add(rod([FACE - 0.2, -0.45, H], [FACE - 0.2, -0.45, H + 0.22], 0.03, 0.03, m.aluminium));
  root.add(cylX(0.075, 0.12, FACE - 0.17, -0.45, H + 0.28, m.graphite, 24));
  root.add(cylX(0.05, 0.01, FACE - 0.105, -0.45, H + 0.28, m.lens, 24));

  // The refuelling arm stands on the docking plate (src/render/arm.js).

  // Rear: two electric thruster heads and a small high-gain dish on a boom.
  for (const ys of [1, -1]) {
    root.add(cylX(0.13, 0.16, -L / 2 - 0.08, ys * 0.45, -0.35, m.graphite, 32));
    const ringFace = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.025, 10, 32), m.niobium);
    ringFace.rotation.y = Math.PI / 2;
    ringFace.position.set(-L / 2 - 0.17, ys * 0.45, -0.35);
    root.add(ringFace);
  }
  root.add(rod([-0.9, 0.35, H], [-0.9, 0.35, H + 0.45], 0.025, 0.025, m.aluminium));
  root.add(dish(0.32, [-0.9, 0.35, H + 0.48], [-1, 0, 1], m.paint));

  enableShadows(root);

  function trackSun(sunLocal) {
    const ang = Math.atan2(sunLocal.z, -sunLocal.x);
    wingPivotL.rotation.y = ang;
    wingPivotR.rotation.y = ang;
  }

  return { root, probeGroup, trackSun };
}

// ---------------------------------------------------------------------------
// Approach axis: a dashed teal line along the client's engine axis with ring markers at the
// given distances d from the ring plane. Guidance graphics, not hardware.

export function buildApproachAxis({ fromX, toX, callouts }) {
  const root = new THREE.Group();
  root.name = 'approachAxis';

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, fromX, 0, 0, toX, 0], 3));
  const lineMat = new THREE.LineDashedMaterial({
    color: 0x4fd8d0,
    dashSize: 0.4,
    gapSize: 0.25,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const line = new THREE.Line(lineGeo, lineMat);
  line.computeLineDistances();
  root.add(line);

  const markerGeo = new THREE.TorusGeometry(0.15, 0.015, 8, 40);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x4fd8d0, transparent: true, opacity: 0.85 });
  const markers = [];
  for (const c of callouts) {
    const x = CAPTURE.ringPlaneAboveClientCmM + c.d;
    const r = new THREE.Mesh(markerGeo, markerMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(0, x, 0);
    root.add(r);
    markers.push({ mesh: r, label: c.label, d: c.d });
  }

  return { root, markers };
}
