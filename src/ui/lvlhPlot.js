// src/ui/lvlhPlot.js
// 2D LVLH plot in the orbit plane: V-bar horizontal (+y, direction of flight, to the right),
// R-bar vertical pointing down toward the Earth, so the radial +x (away from the Earth) is up
// and the servicer, which approaches from above, appears above the client.
// KOS, approach corridor, hold points, trail and predicted path. Canvas only.

const NICE_EXTENTS_M = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

export class LvlhPlot {
  constructor({ overlayEl, width = 260, height = 260 }) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.className = 'lvlh-plot';
    overlayEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.visible = true;
    this.extentM = 1000; // half-width of the plot, m
  }

  setVisible(v) {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  // Smallest nice half-width that keeps the servicer inside the inner 75 % of the plot.
  _autoExtent(state) {
    const need = Math.max(Math.abs(state.x), Math.abs(state.y)) / 0.75;
    for (const e of NICE_EXTENTS_M) if (e >= need) return e;
    return NICE_EXTENTS_M[NICE_EXTENTS_M.length - 1];
  }

  // LVLH (y along-track, x radial up) to canvas pixels.
  _map(y, x) {
    const s = (this.width * 0.5) / this.extentM;
    return { px: this.width * 0.5 + y * s, py: this.height * 0.5 - x * s };
  }

  // data: { state, trail, prediction, kosRadiusM, corridorHalfAngleDeg, holdPointsDm, axisOffsetM, ringPlaneM,
  // extentM (optional half-width; otherwise it follows the servicer) }
  draw(data) {
    if (!this.visible) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (data.extentM) this.extentM = data.extentM;
    else if (data.state) this.extentM = this._autoExtent(data.state);
    const s = (w * 0.5) / this.extentM;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);

    // Axes through the client.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.moveTo(w * 0.5, 0);
    ctx.lineTo(w * 0.5, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('V-bar →', w - 50, h * 0.5 - 5);
    ctx.fillText('R-bar ↓ Earth', w * 0.5 + 5, h - 6);
    ctx.fillText('+x up', w * 0.5 + 5, 12);
    ctx.fillText(`±${this.extentM >= 1000 ? `${this.extentM / 1000} km` : `${this.extentM} m`}`, 6, 12);

    // KOS circle centred on the client.
    const c0 = this._map(0, 0);
    ctx.strokeStyle = 'rgba(255,120,120,0.7)';
    ctx.beginPath();
    ctx.arc(c0.px, c0.py, data.kosRadiusM * s, 0, Math.PI * 2);
    ctx.stroke();

    // Approach corridor: cone about the radial line above the client, apex at the ring plane.
    const half = data.corridorHalfAngleDeg * Math.PI / 180;
    const apexX = data.ringPlaneM;
    const len = Math.max(data.kosRadiusM * 1.3, this.extentM * 1.5);
    const apex = this._map(0, apexX);
    const p1 = this._map(Math.sin(half) * len, apexX + Math.cos(half) * len);
    const p2 = this._map(-Math.sin(half) * len, apexX + Math.cos(half) * len);
    ctx.strokeStyle = 'rgba(79,216,208,0.35)';
    ctx.beginPath();
    ctx.moveTo(apex.px, apex.py);
    ctx.lineTo(p1.px, p1.py);
    ctx.moveTo(apex.px, apex.py);
    ctx.lineTo(p2.px, p2.py);
    ctx.stroke();

    // Hold points and capture point on the axis (CM x = d + axis offset).
    ctx.fillStyle = 'rgba(79,216,208,0.9)';
    for (const d of data.holdPointsDm) {
      const p = this._map(0, data.axisOffsetM + d);
      if (p.py < 0 || p.py > h) continue;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Next point of the coached mission, and the ghost.
    if (data.nextPointX !== undefined && data.nextPointX !== null) {
      const p = this._map(0, data.nextPointX);
      ctx.strokeStyle = 'rgba(80,220,255,0.9)';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (data.ghost) {
      const p = this._map(data.ghost.y, data.ghost.x);
      ctx.fillStyle = 'rgba(80,220,255,0.9)';
      ctx.fillRect(p.px - 3, p.py - 3, 6, 6);
    }

    // Client.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(c0.px - 2, c0.py - 2, 4, 4);

    const line = (pts, style, width, dash) => {
      if (!pts || pts.length < 2) return;
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const m = this._map(p.y, p.x);
        if (i === 0) ctx.moveTo(m.px, m.py);
        else ctx.lineTo(m.px, m.py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(data.trail, 'rgba(120,200,255,0.85)', 1.5);
    line(data.prediction, 'rgba(255,255,255,0.55)', 1, [3, 3]);

    // Servicer.
    if (data.state) {
      const p = this._map(data.state.y, data.state.x);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
