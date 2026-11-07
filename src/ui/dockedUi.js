// src/ui/dockedUi.js
// Instruments of the docked levels, drawn into the panels of ChallengeUi (src/ui/challengeUi.js):
// level 5 Connect (arm map from above and tool height gauge), level 6 Transfer (client tank and
// line gauges) and level 7 Depart (separation plan). Each function takes the plain summary of its
// level module (connectSummary, transferSummary, departureSummary). DOM and canvas only.

const light = (ok, label) => `<span class="light ${ok ? 'on' : 'off'}">${label}</span>`;

function bar(label, frac, low) {
  const f = Math.max(0, Math.min(1, frac));
  return `<span class="bar-label">${label}</span><span class="bar"><span style="width:${(100 * f).toFixed(0)}%" class="${low ? 'low' : ''}"></span></span>`;
}

function setHtml(elm, html) {
  if (elm.innerHTML !== html) elm.innerHTML = html;
}

function frame(ui, level, feedback) {
  ui.scope.style.display = 'block';
  ui.titleEl.textContent = `Level ${level.id} · ${level.name}`;
  ui.panel.className = `coach tone-${feedback.tone}`;
  ui.textEl.textContent = feedback.text;
  const ctx = ui.ctx;
  const W = ui.scope.width;
  const H = ui.scope.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '10px ui-monospace, monospace';
  return { ctx, W, H };
}

// ---------------------------------------------------------------------------
// Level 5: Connect

export function updateConnectUi(ui, { level, s, feedback }) {
  const { ctx, W, H } = frame(ui, level, feedback);
  const tf = s.timeLeftS / level.timeS;
  setHtml(ui.barsEl, bar(`time ${s.timeLeftS.toFixed(0)} s`, tf, tf < 0.2));
  const offMm = 1000 * s.offAxisM;
  setHtml(ui.lightsEl,
    light(s.overValve, 'over the valve') +
    light(!s.capOn, s.capOn ? 'cap on' : 'cap off') +
    light(!!s.contact, s.contact ? `on the ${s.contact}` : 'no contact') +
    light(s.contact === 'valve' && offMm <= 5, `axis ${offMm < 100 ? offMm.toFixed(1) : '> 100'} mm`));
  const height = s.heightAboveTargetM;
  setHtml(ui.numbers,
    `<b>Tool to valve axis</b> ${offMm < 1000 ? offMm.toFixed(1) : (offMm / 1000).toFixed(2) + ' m'}${offMm < 1000 ? ' mm' : ''}<br>` +
    `<b>Above the ${s.targetName}</b> ${s.overValve ? `${(1000 * height).toFixed(0)} mm` : 'not over it'}<br>` +
    `<b>Motion</b> ${s.fine ? 'fine (SHIFT)' : 'normal'}<br>` +
    `<b>Corrections</b> ${s.corrections}`);

  // Map from above, as in the tool camera: up = away from the docking axis, right = e2.
  const mapW = 160;
  const scale = 112; // px per metre
  const cx = mapW / 2;
  const cy = H - 34; // the docking axis
  const P = (u, v) => ({ x: cx + v * scale, y: cy - u * scale });
  const circle = (u, v, r, stroke, fill) => {
    const p = P(u, v);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, r * scale), 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, mapW, H);
  ctx.clip();
  ctx.lineWidth = 1;
  circle(0, 0, s.ringRadiusM, 'rgba(255,255,255,0.55)');
  circle(0, 0, s.nozzleRadiusM, 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.12)');
  for (const st of s.stanchions) circle(st.u, st.v, 0.03, null, 'rgba(255,162,76,0.9)');
  circle(s.valve.u, s.valve.v, s.capOn ? 0.065 : 0.055, 'rgba(79,216,208,0.95)', 'rgba(79,216,208,0.18)');
  const b = P(s.base.u, s.base.v);
  const e = P(s.elbow.u, s.elbow.v);
  const t = P(s.tool.u, s.tool.v);
  ctx.strokeStyle = 'rgba(235,235,230,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  ctx.lineWidth = 1;
  circle(s.base.u, s.base.v, 0.04, null, 'rgba(160,166,178,1)');
  circle(s.tool.u, s.tool.v, 0.035, s.contact ? '#6aff8a' : '#ffffff', 'rgba(0,0,0,0.6)');
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('arm from above', 6, 12);
  ctx.fillText('↑ away from the axis', 6, 24);

  // Tool height gauge: the stroke from retracted (top) to the client deck (bottom).
  const gx = 196;
  const top = 18;
  const bottom = H - 16;
  const aMin = s.retractedA - 0.02;
  const aMax = s.deckA + 0.01;
  const yOf = (a) => top + ((a - aMin) / (aMax - aMin)) * (bottom - top);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(gx - 7, top, 14, bottom - top);
  const mark = (a, color, label) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(gx - 11, yOf(a));
    ctx.lineTo(gx + 11, yOf(a));
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.fillText(label, gx - 40, yOf(a) + 3);
    }
  };
  mark(s.deckA, 'rgba(255,106,106,0.9)', 'deck');
  mark(s.ringA, 'rgba(255,255,255,0.5)', 'ring');
  if (s.capOn) mark(s.capTopA, 'rgba(79,216,208,0.95)', 'cap');
  mark(s.valveFaceA, 'rgba(79,216,208,0.6)', s.capOn ? '' : 'valve');
  ctx.fillStyle = s.contact ? '#6aff8a' : '#ffffff';
  ctx.fillRect(gx - 10, yOf(s.tipA) - 1, 20, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('tool', gx - 10, 12);
}

// ---------------------------------------------------------------------------
// Level 6: Transfer

export function updateTransferUi(ui, { level, s, feedback }) {
  const { ctx, W, H } = frame(ui, level, feedback);
  const tf = s.timeLeftS / level.timeS;
  setHtml(ui.barsEl,
    bar(`time ${s.timeLeftS.toFixed(0)} s`, tf, tf < 0.2) +
    bar(`${s.deliveredKg.toFixed(1)} kg`, s.deliveredKg / s.goalKg, false));
  setHtml(ui.lightsEl,
    light(s.leakState === 'passed', `L leak ${s.leakState === 'holding' ? `${s.leakHoldS.toFixed(0)} s` : s.leakState}`) +
    light(s.valves[0], '1 cargo') +
    light(s.valves[1], '2 line') +
    light(s.valves[2], '3 fill') +
    light(s.running, s.running ? 'flow on' : 'flow off'));
  setHtml(ui.numbers,
    `<b>Delivered</b> ${s.deliveredKg.toFixed(1)} kg<br>` +
    `<b>Goal</b> ${s.goalLowKg.toFixed(0)} to ${s.goalHighKg.toFixed(0)} kg<br>` +
    `<b>Client tank</b> ${s.clientPressureBar.toFixed(2)} of ${s.maxPressureBar.toFixed(0)} bar<br>` +
    `<b>Flow</b> ${s.flowKgPerS.toFixed(3)} kg/s at ${s.compression}x<br>` +
    `<b>Opening</b> ${(100 * s.opening).toFixed(0)} %<br>` +
    `<b>Faults</b> ${s.faults}`);

  // Gauges: delivered mass with the goal band, client pressure with the 22 bar limit, opening.
  const top = 20;
  const bottom = H - 18;
  const y = (f) => bottom - Math.max(0, Math.min(1, f)) * (bottom - top);
  const gauge = (x, label, frac, band, limit, color) => {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x - 12, top, 24, bottom - top);
    if (band) {
      ctx.fillStyle = 'rgba(106,255,138,0.45)';
      ctx.fillRect(x - 14, y(band[1]), 28, Math.max(2, y(band[0]) - y(band[1])));
    }
    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y(frac), 16, bottom - y(frac));
    if (limit !== null) {
      ctx.strokeStyle = 'rgba(255,106,106,0.95)';
      ctx.beginPath();
      ctx.moveTo(x - 15, y(limit));
      ctx.lineTo(x + 15, y(limit));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(label, x - 20, 12);
  };
  const full = 170;
  gauge(40, 'mass kg', s.deliveredKg / full, [s.goalLowKg / full, s.goalHighKg / full], null, s.deliveredKg > s.goalHighKg ? '#ff6a6a' : '#4fd8d0');
  gauge(110, 'bar', s.clientPressureBar / 24, null, s.maxPressureBar / 24, '#c8c8c8');
  gauge(180, 'open %', s.opening, null, null, '#ffa24c');
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${s.deliveredKg.toFixed(1)}`, 22, H - 4);
  ctx.fillText(`${s.clientPressureBar.toFixed(1)}`, 96, H - 4);
  ctx.fillText(`${(100 * s.opening).toFixed(0)}`, 172, H - 4);
}

// ---------------------------------------------------------------------------
// Level 7: Depart

export function updateDepartureUi(ui, { level, s, feedback }) {
  const { ctx, W, H } = frame(ui, level, feedback);
  const tf = s.timeLeftS / level.timeS;
  const bf = 1 - s.planMps / s.budgetMps;
  setHtml(ui.barsEl,
    bar(`time ${s.timeLeftS.toFixed(0)} s`, tf, tf < 0.2) +
    bar('RCS', bf, bf < 0.2));
  setHtml(ui.lightsEl,
    light(s.safe, s.safe ? 'SAFE' : 'UNSAFE') +
    light(!s.overBudget, 'within budget') +
    light(!!s.executed, s.executed ? 'burn done' : 'burn planned'));
  const p = s.executed || s.plan;
  const what = s.executed ? 'Burn' : 'Plan';
  setHtml(ui.numbers,
    `<b>Range</b> ${s.rangeM.toFixed(1)} of ${s.targetRangeM} m<br>` +
    `<b>Range rate</b> ${(100 * s.rangeRateMps).toFixed(1)} cm/s<br>` +
    `<b>${what} along-track</b> ${(100 * p.vy).toFixed(1)} cm/s<br>` +
    `<b>${what} radial</b> ${(100 * p.vx).toFixed(1)} cm/s<br>` +
    `<b>${what} out of plane</b> ${(100 * p.vz).toFixed(1)} cm/s<br>` +
    `<b>Delta-v</b> ${(100 * (s.executed ? Math.hypot(p.vx, p.vy, p.vz) : s.planMps)).toFixed(1)} of ${(100 * s.budgetMps).toFixed(0)} cm/s<br>` +
    (s.phase === 'coast' ? `<b>Fast-forward</b> ${s.fastForward}x` : `<b>Refused burns</b> ${s.unsafeAttempts}`));

  // Plan direction in the orbit plane, as in the LVLH plot: along-track to the right, radial up.
  // The length follows a log scale from 0.1 mm/s to the RCS budget.
  const cx = 104;
  const cy = H / 2 + 8;
  const R = 66;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.moveTo(cx - R - 6, cy);
  ctx.lineTo(cx + R + 6, cy);
  ctx.moveTo(cx, cy - R - 6);
  ctx.lineTo(cx, cy + R + 6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('↑ key', cx + R - 26, cy - 4);
  ctx.fillText('↓ key', cx - R, cy - 4);
  ctx.fillText('S', cx + 4, cy - R + 8);
  ctx.fillText('W', cx + 4, cy + R - 2);
  const mag = Math.hypot(p.vx, p.vy);
  if (mag > 1e-5) {
    const f = Math.max(0.08, Math.min(1, Math.log10(mag / 1e-4) / Math.log10(s.budgetMps / 1e-4)));
    const px = cx + (p.vy / mag) * R * f;
    const py = cy - (p.vx / mag) * R * f;
    ctx.strokeStyle = s.safe || s.executed ? 'rgba(106,255,138,0.95)' : 'rgba(255,106,106,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(s.executed ? 'burn in the orbit plane' : 'plan in the orbit plane', 6, 12);
  ctx.fillText('log scale, edge = budget', 6, H - 6);
  ctx.fillStyle = s.safe || s.executed ? '#6aff8a' : '#ff8a8a';
  ctx.fillText(s.safe || s.executed ? 'SAFE' : 'UNSAFE', W - 48, 12);
}
