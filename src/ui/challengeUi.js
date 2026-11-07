// src/ui/challengeUi.js
// Screens and instruments of the capture challenges: menu (with the mission diagram and the
// settings), level brief, countdown, result, the feedback panel with timer, RCS budget and
// capture-window lights, the docking scope with the closing-speed tape, and the numbers. The
// instruments of the docked levels (5 to 7) are drawn into the same panels by src/ui/dockedUi.js.
// DOM and canvas only.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const key = (k) => `<span class="key">${k}</span>`;
const btn = (action, k, label) => `<button class="btn" data-action="${action}">${key(k)} ${label}</button>`;
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const chip = (action, label) => `<button class="btn chip" data-action="${action}">${label}</button>`;

// Mission diagram of the menu (top right): Earth's limb and the orbit of the scenario, with the
// servicer approaching the client. Schematic, not to scale; generic icons, no real spacecraft.
function drawMissionDiagram(canvas, scenario) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const k = W / 280; // drawn at twice the CSS size for sharp lines
  ctx.clearRect(0, 0, W, H);
  const R = 2.2 * W; // Earth, seen as a limb along the bottom edge
  const cx = 0.5 * W;
  const cy = 0.9 * H + R;
  const g = ctx.createLinearGradient(0, 0.85 * H, 0, H);
  g.addColorStop(0, '#2c6fae');
  g.addColorStop(1, '#0c2a4a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,190,255,0.6)';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 1.5 * k, 0, 2 * Math.PI);
  ctx.stroke();
  const arc = (y, color, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * k;
    ctx.setLineDash(dash.map((d) => d * k));
    ctx.beginPath();
    ctx.arc(cx, cy, cy - y, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const label = (text, x, y, color = 'rgba(255,255,255,0.7)') => {
    ctx.fillStyle = color;
    ctx.font = `${10 * k}px ui-monospace, Menlo, monospace`;
    ctx.fillText(text, x, y);
  };
  const leo = scenario.orbit === 'LEO';
  let yOrbit;
  if (leo) {
    yOrbit = 0.5 * H;
    arc(yOrbit, 'rgba(79,216,208,0.75)', [4, 3]);
    label('low Earth orbit, 500 km', 6 * k, 22 * k, 'rgba(79,216,208,0.9)');
  } else {
    arc(0.56 * H, 'rgba(79,216,208,0.6)', [4, 3]);
    label('geostationary belt', 6 * k, 44 * k, 'rgba(79,216,208,0.9)');
    yOrbit = 0.3 * H;
    arc(yOrbit, 'rgba(255,162,76,0.85)', []);
    label('graveyard orbit', 6 * k, 12 * k, 'rgba(255,162,76,0.95)');
  }
  // The client on the orbit, the servicer behind it with an arrow towards it.
  const xc = 0.8 * W;
  const yc = cy - Math.sqrt((cy - yOrbit) ** 2 - (xc - cx) ** 2);
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(xc - 4 * k, yc - 3 * k, 8 * k, 6 * k);
  ctx.strokeStyle = 'rgba(230,230,230,0.8)';
  ctx.lineWidth = 1 * k;
  ctx.beginPath();
  ctx.moveTo(xc - 11 * k, yc);
  ctx.lineTo(xc + 11 * k, yc);
  ctx.stroke();
  if (scenario.spinDegS > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(xc, yc, 9 * k, -2.4, 0.6);
    ctx.stroke();
  }
  const xs = 0.66 * W;
  const ys = cy - Math.sqrt((cy - yOrbit) ** 2 - (xs - cx) ** 2);
  ctx.fillStyle = '#ffa24c';
  ctx.beginPath();
  ctx.arc(xs, ys, 3.5 * k, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(xs + 6 * k, ys);
  ctx.lineTo(xc - 14 * k, yc);
  ctx.stroke();
  label('servicer', xs - 24 * k, ys - 7 * k);
  label('client', xc + 13 * k, yc + 3 * k);
  if (scenario.spinDegS > 0) label('spins', xc + 13 * k, yc + 14 * k);
}

export class ChallengeUi {
  constructor({ overlayEl, onAction }) {
    this.onAction = onAction;
    this.panel = el('div', 'coach');
    this.titleEl = el('div', 'coach-step');
    this.textEl = el('div', 'coach-main');
    this.barsEl = el('div', 'bars');
    this.lightsEl = el('div', 'lights');
    for (const c of [this.titleEl, this.textEl, this.barsEl, this.lightsEl]) this.panel.appendChild(c);
    overlayEl.appendChild(this.panel);

    this.numbers = el('div', 'hud-block hud-top-right');
    overlayEl.appendChild(this.numbers);

    this.scope = document.createElement('canvas');
    this.scope.className = 'scope';
    this.scope.width = 230;
    this.scope.height = 200;
    overlayEl.appendChild(this.scope);
    this.ctx = this.scope.getContext('2d');

    this.badge = el('div', 'cam-badge');
    overlayEl.appendChild(this.badge);

    this.screen = el('div', 'brief');
    overlayEl.appendChild(this.screen);
    this.countEl = el('div', 'countdown hidden');
    overlayEl.appendChild(this.countEl);

    this.screen.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      b.blur();
      if (this.onAction) this.onAction(b.dataset.action);
    });
  }

  setFlying(v) {
    for (const e of [this.panel, this.numbers, this.scope, this.badge]) e.style.display = v ? 'block' : 'none';
  }

  // Camera badge (top left): the current view and the one C switches to. hint: highlighted at the
  // start of a level, so that the player notices the C key.
  setCameraBadge(name, next = null, hint = false) {
    const inside = name === 'docking camera' || name === 'tool camera';
    const sw = next ? `press C for the ${next}` : 'press C to switch the view';
    const extra = inside ? sw : `${sw} · drag to orbit, wheel to zoom`;
    const html = `${key('C')} ${name} <span class="cam-extra">${extra}</span>`;
    if (this.badge.innerHTML !== html) this.badge.innerHTML = html;
    this.badge.classList.toggle('hint', hint);
  }

  hideScreen() {
    this.screen.classList.add('hidden');
  }

  // Menu: scenario tabs, mission diagram, the levels with their best scores (sel: the level
  // selected with the up and down arrows), the settings line.
  // settings: { trainingPlumes, pip, music, voice, muted, volume }.
  showMenu(levels, best, scenarios, scenario, settings = null, sel = 1) {
    this.screen.classList.remove('hidden');
    const tabs = scenarios.map((sc) =>
      `<button class="btn tab${sc.id === scenario.id ? ' active' : ''}" data-action="scenario:${sc.id}">${sc.name}<span class="tab-where">${sc.where}</span></button>`
    ).join('');
    const row = (l) => {
      const b = best[l.id];
      const score = b ? `${starText(b.stars)} ${b.score}` : 'not flown yet';
      return `<div class="level-row"><button class="btn${l.id === sel ? ' sel' : ''}" data-action="level${l.id}">` +
        `${key(String(l.id))} ${l.name}</button><span class="level-best">${score}</span></div>`;
    };
    const col = (head, list) => `<div><div class="level-col-head">${head}</div>${list.map(row).join('')}</div>`;
    const rows = '<div class="level-cols">' +
      col('Capture: the last metres', levels.filter((l) => !l.docked)) +
      col('Docked: arm, transfer, departure', levels.filter((l) => l.docked)) +
      '</div>';
    const roll = scenario.rollControl
      ? ` Hold ${key('U')} or ${key('O')} to roll the servicer about its docking axis and match the client's spin.`
      : '';
    this.screen.innerHTML =
      '<h1>Orbital refuelling challenges</h1>' +
      `<div class="tabs">${tabs}</div>` +
      `<p>${scenario.story}</p>` +
      `<p><b>Capture.</b> Hold ${key('W')} to close in and ${key('S')} to brake, the arrow keys ` +
      `${key('←')}${key('→')}${key('↑')}${key('↓')} to move sideways as seen in the docking camera; a tap is a short pulse.` + roll +
      ` When every light is green, ${key('SPACE')} extends the probe into the nozzle. ` +
      `<b>Docked levels:</b> each brief lists its keys. ${key('C')} changes the camera. ` +
      `On this screen ${key('←')}${key('→')} switch scenario.</p>` +
      rows +
      this.settingsLine(settings) +
      `<p class="small">${key('↑')}${key('↓')} ${key('SPACE')} pick a level &nbsp; ${key('M')} LVLH plot &nbsp; ` +
      `${key('F1')} help &nbsp; ${btn('about', 'A', 'About and disclaimer')}</p>`;
    const diagram = document.createElement('canvas');
    diagram.className = 'mission-diagram';
    diagram.width = 560;
    diagram.height = 120;
    drawMissionDiagram(diagram, scenario);
    this.screen.appendChild(diagram);
  }

  // One line of small buttons: training plumes, music, voice, all sound, volume, corner window.
  settingsLine(set) {
    if (!set) return '';
    const on = (v) => (v ? 'on' : 'off');
    return '<div class="settings small">' +
      `${key('S')} ` +
      chip('setting:music', `music ${on(set.music)} ${key('B')}`) +
      chip('setting:voice', `voice ${on(set.voice)} ${key('V')}`) +
      chip('setting:mute', `sound ${set.muted ? 'off' : 'on'} ${key('K')}`) +
      chip('setting:volumeDown', '−') +
      `<span class="vol">${Math.round(100 * set.volume)} %</span>` +
      chip('setting:volumeUp', '+') +
      chip('setting:plumes', `plumes ${set.trainingPlumes ? 'bright' : 'dim'}`) +
      chip('setting:pip', `corner camera ${on(set.pip)}`) +
      '</div>';
  }

  // The level selected on the menu (up and down arrows).
  selectLevel(id) {
    for (const b of this.screen.querySelectorAll('.level-row .btn')) {
      b.classList.toggle('sel', b.dataset.action === `level${id}`);
    }
  }

  // S on the menu: the settings line flashes and comes into view.
  focusSettings() {
    const line = this.screen.querySelector('.settings');
    if (!line) return;
    if (line.scrollIntoView) line.scrollIntoView({ block: 'nearest' });
    line.classList.remove('flash');
    void line.offsetWidth;
    line.classList.add('flash');
  }

  // About screen with the disclaimer (the same text as in README.md).
  showAbout() {
    this.screen.classList.remove('hidden');
    this.screen.innerHTML =
      '<h1>About this game</h1>' +
      '<p><b>AI disclosure.</b> This game and its documentation were generated with AI: DeepSeek ' +
      'V4.1 Flash, running locally, wrote the code stage by stage, and Claude Opus 5.5 ' +
      '(Anthropic) reviewed and corrected every stage, wrote parts of the game, its music, sound ' +
      'effects and voice callouts, and tested it. The voice lines are rendered with the open ' +
      'Kokoro-82M text-to-speech model. ' +
      'Human author wrote the specification, set the game design and reviewed the gameplay.</p>' +
      '<p>This game is inspired by a publicly released YouTube video of an on-orbit satellite ' +
      'servicing mission. The video served only as a general reference for the type of mission. ' +
      'No footage, image, logo, livery or graphic from it is used. The mission shown in the ' +
      'video involved no propellant transfer: the refuelling in this game is fictional.</p>' +
      '<p>The spacecraft in this game are fictional. Their shape, dimensions, masses, propulsion, ' +
      'sensors, procedures and performance were invented for the game and do not represent in ' +
      'any way the vehicles shown in the video or their flight capabilities. They are realistic ' +
      'but entirely fictional examples, built for fun and potentially for education.</p>' +
      '<p class="small">This project is not affiliated with, sponsored or endorsed by the authors of the video ' +
      'or by any organisation involved in the mission it shows. Source code: <a ' +
      'href="https://github.com/agolkar/orbitalrefueling" target="_blank" rel="noopener" ' +
      'style="color:#4fd8d0">github.com/agolkar/orbitalrefueling</a>, MIT License.</p>' +
      `<p class="choices">${btn('menu', 'Esc', 'Back')}</p>`;
  }

  showBrief(level, scenario) {
    this.screen.classList.remove('hidden');
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const rows = [row('Scenario', `${scenario.name}, ${scenario.where}`)];
    if (level.rollControl) {
      rows.push(row('Client', `spins ${level.spinDegS.toFixed(1)} deg/s about its engine axis, which wobbles ${level.tumbleConeDeg.toFixed(1)} deg: match the spin with U and O`));
    }
    if (level.dockedNote) rows.push(row('Stack', level.dockedNote));
    const time = row('Time', `${level.timeS} s ${level.timeLimitText || 'before the Sun glares into the docking camera'}`);
    const outside = 'outside, with both spacecraft in view and the docking camera in the lower right corner; ' +
      `${key('C')} switches to the full docking camera, then to the free camera`;
    if (level.kind === 'connect') {
      rows.push(row('View', `the tool camera, looking down the tool axis; ${key('C')} switches to the outside views`));
      rows.push(row('Start', 'docked, the arm folded on the docking plate. The capture left the stack up to 3 deg off in roll, so the valve sits a few centimetres away from its nominal place'));
      rows.push(time);
      rows.push(row('Keys', `${key('←')}${key('→')}${key('↑')}${key('↓')} move the tool across, as seen in the tool camera; ${key('W')} lowers it, ${key('S')} raises it; hold ${key('SHIFT')} for fine motion; ${key('SPACE')} removes the cap, then mates`));
      rows.push(row('Limits', 'touch the cap and the valve below 1 cm/s; remove the cap within 10 mm of the valve axis; mate within 5 mm. The arm joints turn at most 5 deg/s'));
      rows.push(row('RCS budget', 'none: the arm is electric'));
    } else if (level.kind === 'transfer') {
      rows.push(row('View', `outside, on the arm and the valve; ${key('C')} switches to the tool camera`));
      rows.push(row('Start', 'connected: the tool is mated to the service valve, the three valves are closed'));
      rows.push(time);
      rows.push(row('Keys', `${key('L')} leak check; ${key('1')}${key('2')}${key('3')} open the valves in order and close them in reverse order; ${key('SPACE')} starts and stops the flow; ${key('↑')}${key('↓')} set the opening`));
      rows.push(row('Goal', '150 kg within 2 % (147 to 153 kg), client tank below 22 bar. The leak check and the flow run at 30x'));
      rows.push(row('RCS budget', 'none'));
    } else if (level.kind === 'departure') {
      rows.push(row('View', outside));
      rows.push(row('Start', 'refuelled and docked; the probe pushes the servicer away at 2 cm/s'));
      rows.push(time);
      rows.push(row('Keys', `${key('↑')}${key('↓')} along-track, ${key('S')} up and ${key('W')} down (radial), ${key('←')}${key('→')} out of the orbit plane: each second held adds 2.3 cm/s to the plan; ${key('Backspace')} clears it; ${key('SPACE')} executes; after the burn ${key('T')}${key('G')} change the fast-forward`));
      rows.push(row('SAFE', 'the two-orbit prediction leaves the 200 m keep-out sphere within one orbit, stays out, never passes within 5 m of the client, and does not touch it in the first minute'));
      rows.push(row('RCS budget', `${level.budgetMps.toFixed(2)} m/s of delta-v`));
    } else {
      rows.push(row('View', outside));
      rows.push(row('Start', `${level.startDm} m from the ring${level.velocity.x < 0 ? `, closing at ${(-100 * level.velocity.x).toFixed(0)} cm/s` : ', at rest'}`));
      rows.push(time);
      rows.push(row('RCS budget', `${level.budgetMps.toFixed(2)} m/s of delta-v`));
      rows.push(row('Capture window', 'd 1.00 m ± 15 cm, within 10 cm of the nozzle axis, below 2 cm/s'));
    }
    this.screen.innerHTML =
      `<h1>Level ${level.id}: ${level.name}</h1>` +
      `<p>${level.brief}</p>` +
      `<table class="stats">${rows.join('')}</table>` +
      `<p class="choices">${btn('start', 'SPACE', 'Start')}${btn('menu', 'Esc', 'Levels')}</p>`;
  }

  showCountdown(n) {
    this.countEl.classList.toggle('hidden', !n);
    this.countEl.textContent = n ? String(n) : '';
  }

  showResult(level, r, best, isBest, hasNext, scenario) {
    this.screen.classList.remove('hidden');
    const c = r.capture;
    const kind = level.kind;
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const rows = [];
    if (r.success && c) {
      rows.push(row('At capture', `d ${c.dM.toFixed(2)} m, ${(100 * c.lateralM).toFixed(1)} cm off axis, ${(100 * c.relSpeedMps).toFixed(1)} cm/s`));
      rows.push(row('Precision', `${Math.round(100 * r.quality)} %`));
    }
    if (r.despinS) rows.push(row('De-spin', `${r.despinS.toFixed(0)} s with the roll thrusters, then the stack held still`));
    if (kind === 'connect' && r.success) {
      rows.push(row('Off the valve axis', `${r.offAxisMm.toFixed(1)} mm at mating (precision ${Math.round(100 * r.precision)} %)`));
      rows.push(row('Corrections', `${r.corrections}`));
    }
    if (kind === 'transfer') {
      rows.push(row('Delivered', `${r.deliveredKg.toFixed(1)} kg of 150 kg`));
      rows.push(row('Client tank', `${(r.clientPressurePa / 1e5).toFixed(2)} bar of 22 bar`));
      rows.push(row('Faults', `${r.faults}`));
    }
    if (kind === 'departure' && r.success) {
      const b = r.burn;
      rows.push(row('Burn', `along-track ${(100 * b.vy).toFixed(1)}, radial ${(100 * b.vx).toFixed(1)}, normal ${(100 * b.vz).toFixed(1)} cm/s`));
      rows.push(row('Delta-v', `${(100 * r.deltaVMps).toFixed(1)} of ${(100 * r.budgetMps).toFixed(0)} cm/s`));
      rows.push(row('Refused UNSAFE burns', `${r.unsafeAttempts}`));
      rows.push(row('To 30 m', `${(r.simulatedS / 60).toFixed(0)} min of orbit time`));
    }
    if (r.success) rows.push(row(kind === 'departure' ? 'Time left at the burn' : 'Time left', `${r.timeLeftS.toFixed(0)} s of ${level.timeS} s`));
    if (!kind) rows.push(row('RCS used', `${r.deltaVMps.toFixed(3)} of ${r.budgetMps.toFixed(2)} m/s`));
    if (level.impingement) rows.push(row('Plume on the client', `${r.impingementS.toFixed(1)} s`));
    if (r.envelopeS > 0) rows.push(row('Above 10 cm/s', `${r.envelopeS.toFixed(1)} s`));
    const title = { connect: 'Connected', transfer: 'Refuelled', departure: 'Safe departure' }[kind] || 'Docked';
    this.screen.innerHTML =
      `<h1>${r.success ? title : 'Attempt failed'}</h1>` +
      `<p class="small">Level ${level.id}, ${level.name} · ${scenario ? scenario.name : ''}</p>` +
      (r.success
        ? `<p class="grade">${starText(r.stars)} &nbsp; <span>${r.score} points${isBest ? ' · new best' : best ? ` · best ${best.score}` : ''}</span></p>`
        : `<p class="bad">${r.reason}</p>`) +
      `<table class="stats">${rows.join('')}</table>` +
      `<p class="choices">${btn('retry', 'SPACE', 'Try again')}${hasNext ? btn('next', 'N', 'Next level') : ''}${btn('menu', 'Esc', 'Levels')}</p>`;
  }

  // One frame of the capture instruments (levels 1 to 4).
  update({ level, ch, feedback, checks, timeLeftS, dvUsedMps }) {
    const rs = ch.rs;
    this.scope.style.display = 'block';
    this.titleEl.textContent = `Level ${level.id} · ${level.name}`;
    this.panel.className = `coach tone-${feedback.tone}`;
    this.textEl.textContent = feedback.text;
    const tf = Math.max(0, timeLeftS) / level.timeS;
    const ff = Math.max(0, level.budgetMps - dvUsedMps) / level.budgetMps;
    this.barsEl.innerHTML =
      `<span class="bar-label">time ${Math.max(0, timeLeftS).toFixed(0)} s</span><span class="bar"><span style="width:${(100 * tf).toFixed(0)}%" class="${tf < 0.2 ? 'low' : ''}"></span></span>` +
      `<span class="bar-label">RCS</span><span class="bar"><span style="width:${(100 * ff).toFixed(0)}%" class="${ff < 0.2 ? 'low' : ''}"></span></span>`;
    if (rs && rs.dM < 3 && ch.phase === 'fly') {
      const light = (ok, label) => `<span class="light ${ok ? 'on' : 'off'}">${label}</span>`;
      this.lightsEl.innerHTML =
        light(checks.distance, `d ${rs.dM.toFixed(2)} m`) +
        light(checks.centred, `axis ${(100 * rs.lateralM).toFixed(0)} cm`) +
        light(checks.speed, `speed ${(100 * rs.relSpeedMps).toFixed(1)} cm/s`) +
        light(checks.aligned, level.rollControl ? `spin ${rs.rollRateDegS.toFixed(2)} deg/s` : 'aligned');
    } else {
      this.lightsEl.innerHTML = '';
    }
    if (rs) {
      this.numbers.innerHTML =
        `<b>d</b> ${rs.dM.toFixed(2)} m<br>` +
        `<b>Closing speed</b> ${(100 * rs.closingMps).toFixed(1)} cm/s<br>` +
        `<b>Off axis</b> ${(100 * rs.lateralM).toFixed(1)} cm<br>` +
        `<b>Sideways</b> ${(100 * rs.lateralSpeedMps).toFixed(1)} cm/s<br>` +
        `<b>RCS</b> ${dvUsedMps.toFixed(3)} / ${level.budgetMps.toFixed(2)} m/s` +
        (level.rollControl
          ? `<br><b>Client spin</b> ${level.spinDegS.toFixed(2)} deg/s<br><b>Your roll</b> ${(-ch.rollRateRadS * 180 / Math.PI).toFixed(2)} deg/s`
          : '');
    }
  }

  // Docking scope: the nozzle as seen in the docking camera relative to the reticle, its drift
  // over the next 10 s, the capture circle (10 cm), and the closing-speed tape with the
  // recommended band and the 2 cm/s capture line.
  drawScope({ rs, recommendedMps }) {
    const ctx = this.ctx;
    const W = this.scope.width;
    const H = this.scope.height;
    const R = 80;
    const cx = 92;
    const cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    if (!rs) return;
    const scaleM = Math.max(0.25, Math.min(1.5, 0.12 * rs.dM + 0.1));
    const s = R / scaleM;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(106,255,138,0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.10 * s, 0, Math.PI * 2);
    ctx.stroke();
    const clip = (v) => Math.max(-R, Math.min(R, v));
    const px = cx + clip(rs.offsetBody.y * s);
    const py = cy - clip(-rs.offsetBody.z * s);
    const qx = cx + clip((rs.offsetBody.y + 10 * rs.velocityBody.y) * s);
    const qy = cy - clip(-(rs.offsetBody.z + 10 * rs.velocityBody.z) * s);
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(qx, qy);
    ctx.stroke();
    ctx.fillStyle = rs.lateralM <= 0.10 ? '#6aff8a' : '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('nozzle in the docking camera', 6, 12);
    ctx.fillText(`edge ±${(100 * scaleM).toFixed(0)} cm, green 10 cm`, 6, H - 6);

    const tx = 200;
    const top = 18;
    const bottom = H - 18;
    const vmax = 0.12;
    const yOf = (v) => bottom - (Math.max(-0.01, Math.min(vmax, v)) / vmax) * (bottom - top);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(tx - 7, top, 14, bottom - top);
    ctx.fillStyle = 'rgba(106,255,138,0.35)';
    ctx.fillRect(tx - 7, yOf(recommendedMps), 14, yOf(0.4 * recommendedMps) - yOf(recommendedMps));
    ctx.strokeStyle = 'rgba(255,162,76,0.95)';
    ctx.beginPath();
    ctx.moveTo(tx - 11, yOf(0.02));
    ctx.lineTo(tx + 11, yOf(0.02));
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 10, yOf(rs.closingMps) - 1, 20, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('cm/s', tx - 12, 12);
    ctx.fillText((100 * rs.closingMps).toFixed(1), tx - 12, H - 4);
  }
}
