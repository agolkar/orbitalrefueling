// src/render/arm.js
// Refuelling arm on the servicer docking plate: procedural geometry in the design-bible language
// (white links, graphite joints, amber accents, aluminium tool). A SCARA arm: the shoulder and
// the elbow turn about axes parallel to the docking axis and the tool slides along it, as in
// src/physics/arm.js, whose arm frame this module reproduces: a group on the docking face turned
// so that its local axes are (body X, e1, e2), so local coordinates are (a, u, v).

import * as THREE from 'three';
import { ARM, CHASER } from '../config.js';

function materials() {
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xe9e7e0, metalness: 0.1, roughness: 0.62 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.3, roughness: 0.5 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc06e1e, metalness: 0.5, roughness: 0.38 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xd6dadf, metalness: 0.85, roughness: 0.28 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.45 }),
    mated: new THREE.MeshStandardMaterial({ color: 0x4fd8d0, metalness: 0.3, roughness: 0.4, emissive: 0x0b3b38 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.9, roughness: 0.1 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xa3362a, metalness: 0.35, roughness: 0.45 })
  };
}

// Cylinder along local X (the arm frame's a axis) centred at (a, u, v).
function cylA(r, len, a, u, v, mat, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(a, u, v);
  return mesh;
}

// A link of the SCARA arm in the plane a = const, from u = 0 to u = len (local Y), with rounded
// ends.
function link(len, a, width, thick, mat, endMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(thick, len, width), mat);
  body.position.set(a, len / 2, 0);
  g.add(body);
  g.add(cylA(width / 2, thick, a, 0, 0, mat, 24));
  g.add(cylA(width / 2, thick, a, len, 0, mat, 24));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(thick + 0.002, len * 0.6, 0.012), endMat);
  stripe.position.set(a, len / 2, 0);
  g.add(stripe);
  return g;
}

// Builds the arm on the servicer root. Returns the root and the setters used by main.js.
export function buildArm({ chaserRoot }) {
  const m = materials();
  const root = new THREE.Group();
  root.name = 'refuelArm';
  root.position.set(CHASER.dockingFaceAheadOfCmM, 0, 0);
  // Local Y must be e1 = (0, sin az, cos az): a rotation about X by 90 deg - az.
  root.rotation.x = Math.PI / 2 - (ARM.armBaseAzimuthDeg * Math.PI) / 180;
  chaserRoot.add(root);

  const a1 = ARM.link1AheadOfFaceM;
  const a2 = ARM.link2AheadOfFaceM;
  const baseU = ARM.armBaseOffsetM;

  // Pedestal on the docking plate (the plate ends 0.03 m ahead of the docking face).
  root.add(cylA(0.065, 0.05, 0.055, baseU, 0, m.aluminium));
  root.add(cylA(0.07, 0.012, 0.036, baseU, 0, m.amber));

  // Shoulder: turns about local X by joint 1.
  const shoulder = new THREE.Group();
  shoulder.position.set(0, baseU, 0);
  root.add(shoulder);
  shoulder.add(cylA(0.05, 0.05, a1 - 0.015, 0, 0, m.graphite));
  shoulder.add(link(ARM.segment1M, a1, 0.075, 0.05, m.white, m.amber));

  // Elbow at the end of the first link: turns by joint 2; the second link sits further from the
  // docking face than the first, so the links cross without touching.
  const elbow = new THREE.Group();
  elbow.position.set(0, ARM.segment1M, 0);
  shoulder.add(elbow);
  elbow.add(cylA(0.045, a2 - a1 + 0.05, (a1 + a2) / 2, 0, 0, m.graphite));
  elbow.add(link(ARM.segment2M, a2, 0.065, 0.045, m.white, m.amber));

  // Tool carriage at the end of the second link. It turns back by -(joint 1 + joint 2), so the
  // tool keeps its orientation in the arm frame; the tool slides along local X (the stroke).
  const wrist = new THREE.Group();
  wrist.position.set(0, ARM.segment2M, 0);
  elbow.add(wrist);
  wrist.add(cylA(0.05, 0.07, a2, 0, 0, m.graphite));
  wrist.add(cylA(0.053, 0.01, a2 + 0.03, 0, 0, m.amber));

  const slide = new THREE.Group();
  wrist.add(slide);
  // Shaft from the carriage to the tool head; scaled along its length with the stroke.
  const shaft = cylA(0.016, 1, 0, 0, 0, m.aluminium, 16);
  slide.add(shaft);
  const head = new THREE.Group();
  slide.add(head);
  const headLen = 0.08;
  head.add(cylA(ARM.toolRadiusM, headLen, -headLen / 2, 0, 0, m.aluminium, 28));
  const coupling = cylA(ARM.toolRadiusM + 0.002, 0.014, -0.007, 0, 0, m.dark, 28);
  head.add(coupling);
  // Tool camera pod on the side of the head, looking along the valve axis.
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.03), m.graphite);
  pod.position.set(-0.05, 0, ARM.toolRadiusM + 0.015);
  head.add(pod);
  head.add(cylA(0.008, 0.004, -0.031, 0, ARM.toolRadiusM + 0.015, m.lens, 12));
  // Holder for the removed cap, on the other side of the head.
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(ARM.capRadiusM, ARM.capRadiusM, 0.03, 24), m.cap);
  holder.rotation.x = Math.PI / 2;
  holder.position.set(-0.05, 0, -(ARM.toolRadiusM + ARM.capRadiusM + 0.005));
  holder.visible = false;
  head.add(holder);

  // Hose: amber line along both links and down the shaft.
  const hoseMat = m.amber;
  const hose1 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, ARM.segment1M, 8), hoseMat);
  hose1.position.set(a1 - 0.03, ARM.segment1M / 2, 0.045);
  shoulder.add(hose1);
  const hose2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, ARM.segment2M, 8), hoseMat);
  hose2.position.set(a2 + 0.026, ARM.segment2M / 2, 0.04);
  elbow.add(hose2);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Lights: a floodlight on the docking plate aimed at the valve area, and the tool camera's LED
  // ring along the tool axis. The slot between the vehicles is otherwise mostly in shadow.
  const flood = new THREE.SpotLight(0xfff2e0, 6, 4, 0.75, 0.6, 2);
  flood.position.set(0.04, 0.12, 0);
  const floodTarget = new THREE.Object3D();
  floodTarget.position.set(0.5, 0.85, 0);
  root.add(flood);
  root.add(floodTarget);
  flood.target = floodTarget;
  const toolLight = new THREE.SpotLight(0xf4f7ff, 2.5, 2.5, 0.6, 0.5, 2);
  toolLight.position.set(-0.05, 0, 0);
  const toolLightTarget = new THREE.Object3D();
  toolLightTarget.position.set(1, 0, 0);
  head.add(toolLight);
  head.add(toolLightTarget);
  toolLight.target = toolLightTarget;
  // Fill light in the slot on the side the chase camera looks from, so the white links read.
  const fill = new THREE.PointLight(0xe8eeff, 1.2, 2.5, 2);
  fill.position.set(0.24, 0.6, 0.5);
  root.add(fill);

  const state = { tipA: ARM.toolTipRetractedAheadOfFaceM, u: 0, v: 0 };

  // Pose from the physics: joints (rad) and stroke (m). Also returns nothing; see toolTipLocal.
  function setPose({ joint1Rad, joint2Rad, strokeM }) {
    shoulder.rotation.x = joint1Rad;
    elbow.rotation.x = joint2Rad;
    wrist.rotation.x = -(joint1Rad + joint2Rad);
    const tipA = ARM.toolTipRetractedAheadOfFaceM + strokeM;
    head.position.x = tipA;
    const top = a2 + 0.035;
    const bottom = tipA - headLen;
    shaft.scale.y = Math.max(0.01, bottom - top);
    shaft.position.x = (top + bottom) / 2;
    const c1 = Math.cos(joint1Rad);
    const s1 = Math.sin(joint1Rad);
    const c12 = Math.cos(joint1Rad + joint2Rad);
    const s12 = Math.sin(joint1Rad + joint2Rad);
    state.tipA = tipA;
    state.u = baseU + ARM.segment1M * c1 + ARM.segment2M * c12;
    state.v = ARM.segment1M * s1 + ARM.segment2M * s12;
  }

  function setMated(v) {
    coupling.material = v ? m.mated : m.dark;
  }

  function setCapStowed(v) {
    holder.visible = v;
  }

  // World pose of a camera on the tool axis, height metres above the tool tip, looking along
  // the valve axis, with up = e1 (away from the docking axis).
  function toolCameraPose(height = 0.25) {
    root.updateWorldMatrix(true, false);
    const a = Math.max(0.04, state.tipA - height);
    const position = new THREE.Vector3(a, state.u, state.v).applyMatrix4(root.matrixWorld);
    const q = new THREE.Quaternion();
    root.getWorldQuaternion(q);
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const tip = new THREE.Vector3(state.tipA, state.u, state.v).applyMatrix4(root.matrixWorld);
    return { position, forward, up, tip };
  }

  // World point in the arm frame (a, u, v).
  function worldPoint(a, u, v) {
    root.updateWorldMatrix(true, false);
    return new THREE.Vector3(a, u, v).applyMatrix4(root.matrixWorld);
  }

  setPose({ joint1Rad: (ARM.stowShoulderDeg * Math.PI) / 180, joint2Rad: (ARM.stowElbowDeg * Math.PI) / 180, strokeM: 0 });
  return { root, setPose, setMated, setCapStowed, toolCameraPose, worldPoint };
}
