// src/ui/hud.js
// HUD, alignment indicator, messages, menus, debrief. DOM only; no physics imports.

import { CAPTURE, CHASER, RULES, RAD_TO_DEG } from '../config.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(v, digits) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function formatMet(s) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Distance along an LVLH axis with a direction word, so no sign convention is needed.
function dist(v, plus, minus) {
  const a = Math.abs(v);
  return a < 0.05 ? '0.0 m' : `${fmt(a, 1)} m ${v > 0 ? plus : minus}`;
}

// Colour class for a value against its limit: green inside, amber up to 2x, red beyond.
function limitClass(value, limit) {
  const a = Math.abs(value);
  if (a <= limit) return 'ok';
  if (a <= 2 * limit) return 'warn';
  return 'bad';
}

export class Hud {
  constructor({ overlayEl }) {
    this.overlayEl = overlayEl;

    this.topLeft = el('div', 'hud-block hud-top-left');
    this.topRight = el('div', 'hud-block hud-top-right');
    this.bottomCenter = el('div', 'hud-block hud-bottom-center');
    this.bottomRight = el('div', 'hud-block hud-bottom-right');
    this.message = el('div', 'hud-message');
    this.warn = el('div', 'hud-warn hidden');
    this.help = el('div', 'hud-help hidden');
    this.menu = el('div', 'hud-menu hidden');
    this.reticle = el('div', 'reticle hidden');
    this.reticleText = el('div', 'reticle-text hidden');

    overlayEl.appendChild(this.topLeft);
    overlayEl.appendChild(this.topRight);
    overlayEl.appendChild(this.bottomCenter);
    overlayEl.appendChild(this.bottomRight);
    overlayEl.appendChild(this.message);
    overlayEl.appendChild(this.warn);
    overlayEl.appendChild(this.help);
    overlayEl.appendChild(this.menu);
    overlayEl.appendChild(this.reticle);
    overlayEl.appendChild(this.reticleText);

    this._buildHelp();
  }

  _buildHelp() {
    this.help.innerHTML =
      '<b>Controls</b><br>' +
      'W/S forward/back along the docking axis · A/D left/right · R/F up/down<br>' +
      'PULSE (default): 0.01 m/s per press · CONTINUOUS: thrust while held · P switches<br>' +
      'I/K pitch nose down/up · J/L yaw left/right · U/O roll left/right, 0.05° per press<br>' +
      'H attitude hold on/off · T/G time warp up/down · C camera · M LVLH plot · B music · V voice · K all sound<br>' +
      'Esc pause · F1 or ? this help · mouse drag orbits the chase and free cameras, wheel zooms<br>' +
      'Gamepad: left stick and d-pad the arrow keys, right stick W/S, triggers U/O, shoulders SHIFT, A SPACE, B Esc, X C, Y M';
  }

  setHelpVisible(v) {
    this.help.classList.toggle('hidden', !v);
  }

  setMenuVisible(v) {
    this.menu.classList.toggle('hidden', !v);
  }

  setMenuContent(html) {
    this.menu.innerHTML = html;
  }

  setMessage(text, kind) {
    this.message.textContent = text || '';
    this.message.className = 'hud-message' + (kind ? ` ${kind}` : '');
  }

  setWarning(text) {
    if (!text) {
      this.warn.classList.add('hidden');
      this.warn.textContent = '';
    } else {
      this.warn.classList.remove('hidden');
      this.warn.textContent = text;
    }
  }

  // Main per-frame update. All values are already in display units where noted.
  update({
    phaseLabel,
    instruction,
    rangeM,
    rangeRateMps,
    lvlh,
    relVelMps,
    deltaVUsedMps,
    ownPropellantKg,
    cargoPropellantKg,
    translationMode,
    warp,
    metS,
    cameraName,
    alignment,
    orbitName,
    mode,
    compact = false,
    showAlignment = true
  }) {
    if (compact) {
      this.topLeft.innerHTML = `<b>Orbit</b> ${orbitName} · ${mode}<br><b>Camera</b> ${cameraName}`;
      this.topRight.innerHTML =
        `<b>Range</b> ${fmt(rangeM, 1)} m<br>` +
        `<b>Closing speed</b> ${fmt(-rangeRateMps, 3)} m/s<br>` +
        `<b>Δv used</b> ${fmt(deltaVUsedMps, 3)} m/s<br>` +
        `<b>Propellant</b> ${fmt(ownPropellantKg, 2)} kg<br>` +
        `<b>Time</b> ×${warp} · <b>MET</b> ${formatMet(metS)}`;
    }
    if (!compact) this.topLeft.innerHTML =
      `<b>Phase</b> ${phaseLabel}<br>` +
      (instruction ? `<b>Instruction</b> ${instruction}<br>` : '') +
      `<b>Orbit</b> ${orbitName} · ${mode}`;

    if (!compact) this.topRight.innerHTML =
      `<b>Range</b> ${fmt(rangeM, 1)} m<br>` +
      `<b>Range rate</b> ${fmt(rangeRateMps, 3)} m/s<br>` +
      `<b>R-bar</b> ${dist(lvlh.x, 'above', 'below')}<br>` +
      `<b>V-bar</b> ${dist(lvlh.y, 'ahead', 'behind')} · <b>H-bar</b> ${dist(lvlh.z, 'north', 'south')}<br>` +
      `<b>Rel. vel.</b> ${fmt(relVelMps, 3)} m/s<br>` +
      `<b>Δv used</b> ${fmt(deltaVUsedMps, 3)} m/s<br>` +
      `<b>Own prop.</b> ${fmt(ownPropellantKg, 1)} kg · <b>Cargo</b> ${fmt(cargoPropellantKg, 1)} kg<br>` +
      `<b>Mode</b> ${translationMode} · <b>Warp</b> ${warp}× · <b>MET</b> ${fmt(metS, 0)} s<br>` +
      `<b>Camera</b> ${cameraName}`;

    if (alignment && showAlignment) {
      const a = alignment;
      const row = (label, value, unit, cls) =>
        `<span class="align-row"><span class="align-label">${label}</span>` +
        `<span class="align-value ${cls}">${value}${unit}</span></span>`;
      this.bottomCenter.innerHTML =
        `<b>Alignment</b><br>` +
        row('d', fmt(a.dM, 2), ' m', limitClass(a.dM - CAPTURE.captureDm, CAPTURE.captureDToleranceM)) +
        row('lateral', fmt(a.lateralM, 2), ' m', limitClass(a.lateralM, CAPTURE.lateralToleranceM)) +
        row('pitch/yaw', fmt(a.pitchYawDeg, 1), '°', limitClass(a.pitchYawDeg, CAPTURE.pitchYawToleranceDeg)) +
        row('roll', fmt(a.rollDeg, 1), '°', limitClass(a.rollDeg, CAPTURE.rollToleranceDeg)) +
        row('p/y rate', fmt(a.pitchYawRateDegS, 2), '°/s', limitClass(a.pitchYawRateDegS, CAPTURE.pitchYawRateToleranceDegS)) +
        row('roll rate', fmt(a.rollRateDegS, 2), '°/s', limitClass(a.rollRateDegS, CAPTURE.rollRateToleranceDegS)) +
        row('speed', fmt(a.relativeSpeedMps, 3), ' m/s', limitClass(a.relativeSpeedMps, CAPTURE.relativeSpeedToleranceMps));
    } else {
      this.bottomCenter.innerHTML = '';
    }
  }

  // Docking camera reticle: centred where the probe axis meets the ring plane at the current d,
  // with range and range rate next to it. Hidden in the other cameras. The tool camera of level 5
  // uses it with its own text.
  // text replaces the range lines (the tool camera of level 5).
  updateReticle({ visible, px, py, rangeM, rangeRateMps, text = null }) {
    this.reticle.classList.toggle('hidden', !visible);
    this.reticleText.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.reticle.style.left = `${px}px`;
    this.reticle.style.top = `${py}px`;
    this.reticleText.style.left = `${px + 70}px`;
    this.reticleText.style.top = `${py - 18}px`;
    const html = text !== null ? text : `range ${fmt(rangeM, 2)} m<br>rate ${fmt(rangeRateMps, 3)} m/s`;
    if (this.reticleText.innerHTML !== html) this.reticleText.innerHTML = html;
  }

  showDebrief(html) {
    this.menu.innerHTML = html;
    this.menu.classList.remove('hidden');
  }
}

export const HUD_LIMITS = {
  lateral: CAPTURE.lateralToleranceM,
  pitchYaw: CAPTURE.pitchYawToleranceDeg,
  roll: CAPTURE.rollToleranceDeg,
  pitchYawRate: CAPTURE.pitchYawRateToleranceDegS,
  rollRate: CAPTURE.rollRateToleranceDegS,
  speed: CAPTURE.relativeSpeedToleranceMps,
  d: CAPTURE.captureDToleranceM
};

export const HUD_RULES = {
  kosRadiusM: RULES.kosRadiusM,
  holdPointsDm: RULES.holdPointsDm
};

export const HUD_DEG = RAD_TO_DEG;
export const HUD_CHASER = CHASER;
