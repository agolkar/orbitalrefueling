// src/render/cameras.js
// Docking, tool, chase and free cameras.

import * as THREE from 'three';

export class CameraRig {
  constructor({ foregroundCamera, backgroundCamera, chaserRoot, targetRoot, approachAxisRoot, domElement }) {
    this.foregroundCamera = foregroundCamera;
    this.backgroundCamera = backgroundCamera;
    this.chaserRoot = chaserRoot;
    this.targetRoot = targetRoot;
    this.approachAxisRoot = approachAxisRoot;
    this.domElement = domElement;

    // C cycles the views of the current level: chase -> docking -> free for the approach and the
    // departure (the outside view of both spacecraft comes first), tool -> chase -> free on the
    // arm. The outside views keep the docking or tool view in a corner (src/render/pip.js).
    this.modeIndex = 0;
    this.modes = ['chase', 'docking', 'free'];
    this.labels = { docking: 'docking camera', tool: 'tool camera', chase: 'chase camera', free: 'free camera' };

    this.chaseOrbit = { theta: 0.6, phi: 1.1, radius: 18 };
    this.freeOrbit = { theta: 0.0, phi: 1.4, radius: 60 };
    this.chaseTarget = null; // function returning a world point, or null for the servicer CM
    this.chaseMinRadius = null; // function returning the smallest chase distance (keeps both spacecraft in view)
    this.toolPose = null; // function returning { position, forward, up } for the tool camera

    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;

    // Reused vectors and quaternions in the frame loop (no allocation per frame).
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this._bind();
  }

  currentName() {
    return this.modes[this.modeIndex];
  }

  cycle() {
    this.modeIndex = (this.modeIndex + 1) % this.modes.length;
  }

  // Label of the view that C switches to.
  nextLabel() {
    return this.labels[this.modes[(this.modeIndex + 1) % this.modes.length]];
  }

  // Views of a level: modes (the first is the level's default view), the chase distance and point,
  // and the tool camera pose. A level with the same views as the previous one (a retry, or the
  // next capture level) keeps the view the player chose with C; a level with other views opens on
  // its default.
  setContext({ modes, chaseRadius, chaseTarget = null, chaseMinRadius = null, toolPose = null, chaseAngles = { theta: 0.6, phi: 1.1 } }) {
    const current = this.currentName();
    const changed = modes.join() !== this.modes.join();
    this.modes = modes;
    this.modeIndex = changed ? 0 : Math.max(0, modes.indexOf(current));
    if (changed) {
      if (chaseRadius) this.chaseOrbit.radius = chaseRadius;
      this.chaseOrbit.theta = chaseAngles.theta;
      this.chaseOrbit.phi = chaseAngles.phi;
    }
    this.chaseTarget = chaseTarget;
    this.chaseMinRadius = chaseMinRadius;
    this.toolPose = toolPose;
  }

  // Tool camera pose on any camera: on the tool axis above the tip, looking along the valve axis.
  applyToolPose(cam) {
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    if (!this.toolPose) return;
    const p = this.toolPose();
    cam.position.copy(p.position);
    cam.up.copy(p.up);
    this._v1.copy(p.position).add(p.forward);
    cam.lookAt(this._v1);
  }

  currentLabel() {
    return this.labels[this.currentName()];
  }

  // Docking camera pose on any camera: mounted on the docking face 0.15 m above the probe axis
  // and canted 9 deg towards it, so the nozzle stays near the centre of the image from 7 m down
  // to the capture point. Body axes: position (1.32, 0, 0.15), look along (cos 9, 0, -sin 9),
  // up = body +Z tilted. Field of view 40 deg.
  applyDockingPose(cam) {
    if (cam.fov !== 40) {
      cam.fov = 40;
      cam.updateProjectionMatrix();
    }
    const q = this.chaserRoot.quaternion;
    const cant = (9 * Math.PI) / 180;
    this._v1.set(1.32, 0, 0.15).applyQuaternion(q);
    this._v2.set(Math.cos(cant), 0, -Math.sin(cant)).applyQuaternion(q);
    this._v3.set(Math.sin(cant), 0, Math.cos(cant)).applyQuaternion(q);
    cam.position.copy(this.chaserRoot.position).add(this._v1);
    cam.up.copy(this._v3);
    this._v1.copy(cam.position).add(this._v2);
    cam.lookAt(this._v1);
  }

  onResize(w, h) {
    this.foregroundCamera.aspect = w / h;
    this.foregroundCamera.updateProjectionMatrix();
  }

  _bind() {
    const el = this.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const orbit = this.currentName() === 'free' ? this.freeOrbit : this.chaseOrbit;
      orbit.theta -= dx * 0.005;
      orbit.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi - dy * 0.005));
    });
    el.addEventListener('wheel', (e) => {
      const orbit = this.currentName() === 'free' ? this.freeOrbit : this.chaseOrbit;
      orbit.radius = Math.max(1.5, Math.min(400, orbit.radius * (1 + Math.sign(e.deltaY) * 0.08)));
      e.preventDefault();
    }, { passive: false });
    // The C key reaches cycle() through src/input.js and main.js.
  }

  update() {
    const mode = this.currentName();
    const cam = this.foregroundCamera;

    if (mode === 'chase') {
      cam.fov = 50;
      cam.updateProjectionMatrix();
      const o = this.chaseOrbit;
      const target = this.chaseTarget ? this.chaseTarget() : this.chaserRoot.position;
      // The wheel sets the distance; it grows on its own when the two spacecraft move apart.
      const r = Math.max(o.radius, this.chaseMinRadius ? this.chaseMinRadius() : 0);
      cam.position.set(
        target.x + r * Math.sin(o.phi) * Math.cos(o.theta),
        target.y + r * Math.cos(o.phi),
        target.z + r * Math.sin(o.phi) * Math.sin(o.theta)
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
    } else if (mode === 'docking') {
      this.applyDockingPose(cam);
    } else if (mode === 'tool') {
      this.applyToolPose(cam);
    } else {
      cam.fov = 50;
      cam.updateProjectionMatrix();
      const o = this.freeOrbit;
      cam.position.set(
        o.radius * Math.sin(o.phi) * Math.cos(o.theta),
        o.radius * Math.cos(o.phi),
        o.radius * Math.sin(o.phi) * Math.sin(o.theta)
      );
      cam.up.set(0, 1, 0);
      this._v2.set(0, 0, 0);
      cam.lookAt(this._v2);
    }
  }
}
