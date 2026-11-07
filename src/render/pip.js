// src/render/pip.js
// Docking or tool camera in a corner window: while the main view is the chase or free camera,
// the image of the camera the level is flown with stays in the lower right corner, with its own
// reticle, so the game remains playable from the outside views.

import * as THREE from 'three';

export class DockingPip {
  constructor({ renderer, overlayEl, backgroundCamera, cameraRig }) {
    this.renderer = renderer;
    this.cameraRig = cameraRig;
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 5000);
    this.bgCamera = backgroundCamera.clone();
    this.margin = 12; // px

    this.frame = document.createElement('div');
    this.frame.className = 'pip-frame hidden';
    this.label = document.createElement('div');
    this.label.className = 'pip-label';
    this.label.textContent = 'docking camera';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pip-reticle';
    this.frame.appendChild(this.canvas);
    this.frame.appendChild(this.label);
    overlayEl.appendChild(this.frame);
    this.ctx = this.canvas.getContext('2d');
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
  }

  // Size in CSS pixels: 30 % of the window width, 16:9, between 240 and 480 px wide.
  layout() {
    const W = window.innerWidth;
    const w = Math.round(Math.max(240, Math.min(480, 0.3 * W)));
    const h = Math.round((w * 9) / 16);
    this.rect = { x: W - w - this.margin, y: this.margin, w, h }; // y from the bottom (WebGL)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.frame.style.width = `${w}px`;
      this.frame.style.height = `${h}px`;
    }
    return this.rect;
  }

  setVisible(v) {
    this.frame.classList.toggle('hidden', !v);
  }

  // Renders the docking view into the corner. hide: objects to hide in this view (the approach
  // axis). aimPoint: world point of the probe axis at the nozzle exit plane, for the reticle.
  render({ backgroundScene, foregroundScene, hide = [], aimPoint = null, text = '', pose = 'docking' }) {
    const r = this.layout();
    const renderer = this.renderer;
    if (pose === 'tool') this.cameraRig.applyToolPose(this.camera);
    else this.cameraRig.applyDockingPose(this.camera);
    const label = pose === 'tool' ? 'tool camera' : 'docking camera';
    if (this.label.textContent !== label) this.label.textContent = label;
    if (this.camera.aspect !== r.w / r.h) {
      this.camera.aspect = r.w / r.h;
      this.camera.updateProjectionMatrix();
    }
    this.bgCamera.quaternion.copy(this.camera.quaternion);
    this.bgCamera.fov = this.camera.fov;
    this.bgCamera.aspect = this.camera.aspect;
    this.bgCamera.updateProjectionMatrix();

    const wasVisible = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // reuse the shadow map of the main view

    renderer.setScissorTest(true);
    renderer.setViewport(r.x, r.y, r.w, r.h);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    renderer.clear();
    renderer.render(backgroundScene, this.bgCamera);
    renderer.clearDepth();
    renderer.render(foregroundScene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);

    renderer.shadowMap.autoUpdate = shadowAuto;
    hide.forEach((o, i) => { o.visible = wasVisible[i]; });

    this.drawReticle(aimPoint, text);
  }

  drawReticle(aimPoint, text) {
    const ctx = this.ctx;
    const { w, h } = this.rect;
    ctx.clearRect(0, 0, w, h);
    if (aimPoint) {
      const s = aimPoint.clone().project(this.camera);
      if (s.z > -1 && s.z < 1) {
        const x = (s.x * 0.5 + 0.5) * w;
        const y = (-s.y * 0.5 + 0.5) * h;
        ctx.strokeStyle = 'rgba(79,216,208,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.moveTo(x - 22, y);
        ctx.lineTo(x + 22, y);
        ctx.moveTo(x, y - 22);
        ctx.lineTo(x, y + 22);
        ctx.stroke();
      }
    }
    if (text) {
      ctx.fillStyle = 'rgba(79,216,208,0.95)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(text, 8, h - 8);
    }
  }
}
