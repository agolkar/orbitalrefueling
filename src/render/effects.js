// src/render/effects.js
// Thruster plumes and the transfer indicator.

import * as THREE from 'three';

// Chaser RCS layout in body axes (+X forward along the docking axis, +Y left, +Z up).
// Bus faces at |x| = 1.25 m, |y| = |z| = 1.0 m. Each thruster has a nozzle position and an
// exhaust direction; the force on the vehicle is opposite to the exhaust.
const CANT = 15 * Math.PI / 180; // forward-facing thrusters cant outward, away from the client
const THRUSTERS = [];
for (const sy of [1, -1]) {
  for (const sz of [1, -1]) {
    // +X force: rear face corners, exhaust backward.
    THRUSTERS.push({ pos: [-1.30, 0.8 * sy, 0.8 * sz], exhaust: [-1, 0, 0] });
    // -X force: docking face corners, exhaust forward, canted outward.
    const s = Math.sin(CANT) / Math.SQRT2;
    THRUSTERS.push({ pos: [1.30, 0.85 * sy, 0.85 * sz], exhaust: [Math.cos(CANT), s * sy, s * sz] });
  }
}
// Lateral thrusters in diagonal pairs: a pair firing together gives no net torque,
// and two opposite thrusters of different pairs form the rotation couples.
THRUSTERS.push(
  { pos: [0.9, -1.02, 0.8], exhaust: [0, -1, 0] }, // +Y force
  { pos: [-0.9, -1.02, -0.8], exhaust: [0, -1, 0] }, // +Y force
  { pos: [0.9, 1.02, -0.8], exhaust: [0, 1, 0] }, // -Y force
  { pos: [-0.9, 1.02, 0.8], exhaust: [0, 1, 0] }, // -Y force
  { pos: [0.9, 0.8, -1.02], exhaust: [0, 0, -1] }, // +Z force
  { pos: [-0.9, -0.8, -1.02], exhaust: [0, 0, -1] }, // +Z force
  { pos: [0.9, -0.8, 1.02], exhaust: [0, 0, 1] }, // -Z force
  { pos: [-0.9, 0.8, 1.02], exhaust: [0, 0, 1] } // -Z force
);

// Shared with the servicer model, which draws a nozzle at each thruster.
export const THRUSTER_LAYOUT = THRUSTERS;

const AXES = ['x', 'y', 'z'];

function dominantAxis(v) {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  const axis = AXES[i];
  return { axis, sign: Math.sign(v[axis]), purity: a[i] / (a[0] + a[1] + a[2]) };
}

// Thruster groups: translation per (axis, sign) and rotation couples per (axis, sign).
function buildGroups() {
  const items = THRUSTERS.map((t, i) => {
    const f = new THREE.Vector3(-t.exhaust[0], -t.exhaust[1], -t.exhaust[2]);
    const r = new THREE.Vector3(t.pos[0], t.pos[1], t.pos[2]);
    return { i, f, r, tau: new THREE.Vector3().crossVectors(r, f) };
  });
  const translation = {};
  for (const it of items) {
    const d = dominantAxis(it.f);
    const key = `${d.axis}${d.sign > 0 ? '+' : '-'}`;
    (translation[key] = translation[key] || []).push(it.i);
  }
  const rotation = {};
  const lateral = items.filter((it) => Math.abs(it.f.x) < 0.5);
  for (let a = 0; a < lateral.length; a += 1) {
    for (let b = a + 1; b < lateral.length; b += 1) {
      const p = lateral[a];
      const q = lateral[b];
      if (p.f.clone().add(q.f).length() > 1e-6) continue;
      const tau = p.tau.clone().add(q.tau);
      if (tau.length() < 0.5) continue;
      const d = dominantAxis(tau);
      if (d.purity < 0.999) continue;
      const key = `${d.axis}${d.sign > 0 ? '+' : '-'}`;
      if (!rotation[key]) rotation[key] = [p.i, q.i];
    }
  }
  return { translation, rotation };
}

function makePlumeGeometry(lengthM, exitRadiusM) {
  // Narrow at the nozzle (origin), widening along +X; brighter near the nozzle.
  const geo = new THREE.ConeGeometry(exitRadiusM, lengthM, 12, 4, true);
  geo.translate(0, -lengthM / 2, 0);
  geo.rotateZ(Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k += 1) {
    const c = Math.pow(Math.max(0, 1 - pos.getX(k) / lengthM), 1.5);
    colors[k * 3] = c;
    colors[k * 3 + 1] = c;
    colors[k * 3 + 2] = c;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Hydrazine monopropellant plumes are nearly invisible in vacuum. They are drawn faint by
// default; the training setting (bright) makes every firing easy to see.
export class ThrusterPlumes {
  constructor({ chaserRoot, bright = false }) {
    this.group = new THREE.Group();
    this.group.name = 'plumes';
    chaserRoot.add(this.group);
    this.bright = bright;
    this.groups = buildGroups();
    this.levels = new Float32Array(THRUSTERS.length);
    this.flashes = [];
    const geo = makePlumeGeometry(0.6, 0.12);
    const xAxis = new THREE.Vector3(1, 0, 0);
    this.meshes = THRUSTERS.map((t) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd8ecff,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      mesh.quaternion.setFromUnitVectors(xAxis, new THREE.Vector3(...t.exhaust).normalize());
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    });
  }

  setBright(v) {
    this.bright = !!v;
  }

  // Frame-averaged body force (N) and torque (N m) from the flight step.
  setFiring(forceBodyN, torqueBodyNm) {
    this.levels.fill(0);
    for (const a of AXES) {
      const f = forceBodyN[a];
      if (Math.abs(f) > 1e-6) {
        const ids = this.groups.translation[`${a}${f > 0 ? '+' : '-'}`] || [];
        const level = Math.min(1, Math.abs(f) / 44);
        for (const i of ids) this.levels[i] = Math.max(this.levels[i], level);
      }
      const t = torqueBodyNm[a];
      if (Math.abs(t) > 1e-6) {
        const ids = this.groups.rotation[`${a}${t > 0 ? '+' : '-'}`] || [];
        const level = Math.min(1, 0.35 + Math.abs(t) / 44);
        for (const i of ids) this.levels[i] = Math.max(this.levels[i], level);
      }
    }
  }

  // Short flash of a rotation couple, for a rotation key press.
  flashRotation(axis, sign, durationS) {
    const ids = this.groups.rotation[`${axis}${sign > 0 ? '+' : '-'}`] || [];
    this.flashes.push({ ids, left: Math.max(0.12, durationS) });
  }

  update(dtS) {
    for (const f of this.flashes) {
      f.left -= dtS;
      if (f.left > 0) for (const i of f.ids) this.levels[i] = Math.max(this.levels[i], 1);
    }
    this.flashes = this.flashes.filter((f) => f.left > 0);
    const base = this.bright ? 0.75 : 0.22;
    this.meshes.forEach((m, i) => {
      const l = this.levels[i];
      m.visible = l > 0.01;
      m.material.opacity = base * l * (0.85 + 0.15 * Math.random());
    });
  }
}

// Transfer indicator: a small emissive sphere on the client valve, pulsing during flow.
export class TransferIndicator {
  constructor({ targetRoot }) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.0 })
    );
    // Client valve at LVLH +x face, 0.85 m from LAE axis, 60 deg azimuth.
    this.mesh.position.set(1.85, 0.85 * Math.cos(Math.PI / 3), 0.85 * Math.sin(Math.PI / 3));
    targetRoot.add(this.mesh);
    this.phase = 0;
    this.flowing = false;
  }

  setFlow(on) {
    this.flowing = !!on;
    if (!on) this.mesh.material.opacity = 0;
  }

  update(dtS) {
    this.phase += dtS;
    if (this.flowing) this.mesh.material.opacity = 0.55 + 0.25 * Math.sin(this.phase * 6);
  }
}
