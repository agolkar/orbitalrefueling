// src/main.js
// Bootstrap and game loop of the challenges. In the capture levels (1 to 4) the servicer flies with
// the physics core (src/physics/flight.js); the client sits at the LVLH origin and, in some levels
// and scenarios, its nozzle axis drifts or spins (src/game/challenge.js). The docked levels (5 to 7:
// arm, transfer, departure) run in src/dockedPlay.js. Time runs at 1x, except the line processes
// of level 6 (30x) and the coast after the separation burn of level 7 (fast-forward).
//
// URL options: ?scenario=geo|leo|tumble, ?level=1..7 opens a level brief directly,
// ?plumes=bright for the training plumes.
//
// Polish (Stage 6): sound (src/audio, B music, V voice, K all sound), gamepad (src/input.js), a
// settings panel and a mission diagram on the menu, reused vectors and quaternions in the frame loop.

import * as THREE from 'three';
import { CONFIG, ORBITS, CAPTURE, CHASER, CHALLENGE } from './config.js';
import { buildScene, LVLH_TO_SCENE } from './render/scene.js';
import { buildChaser, buildTarget, buildApproachAxis } from './render/models.js';
import { buildArm } from './render/arm.js';
import { CameraRig } from './render/cameras.js';
import { ThrusterPlumes } from './render/effects.js';
import { Hud } from './ui/hud.js';
import { LvlhPlot } from './ui/lvlhPlot.js';
import { ChallengeUi } from './ui/challengeUi.js';
import { Input } from './input.js';
import { stepFlight } from './physics/flight.js';
import { startLocalTimeBeforeSunset } from './physics/environment.js';
import { DockingPip } from './render/pip.js';
import { DockedPlay } from './dockedPlay.js';
import { AudioSystem } from './audio/engine.js';
import { AudioDirector } from './audio/director.js';
import {
  levelFor,
  scenarioById,
  rollStep,
  clientQuat,
  trackingAttitude,
  attachedAttitude,
  createDespin,
  stepDespin,
  despinAngleRad,
  despinText,
  startState,
  createChallenge,
  updateChallenge,
  retractStep,
  relativeState,
  windowChecks,
  recommendedMps,
  feedback
} from './game/challenge.js';

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const AXES = ['x', 'y', 'z'];

const app = document.getElementById('app');
const overlayEl = document.getElementById('overlay');
const params = new URLSearchParams(window.location.search);

// Scenario: from the URL, else the last one played in this browser, else the first.
function knownScenario(id) {
  return CHALLENGE.scenarios.some((sc) => sc.id === id) ? id : null;
}
let storedScenario = null;
try {
  storedScenario = window.localStorage.getItem('refuelScenario');
} catch (e) {
  storedScenario = null;
}
let scenario = scenarioById(knownScenario(params.get('scenario')) || knownScenario(storedScenario) || CHALLENGE.scenarios[0].id);
let orbit = ORBITS[scenario.orbit];
let n = orbit.nRadPerS;

// Local solar time at the start of an attempt: fixed, or chosen so that the Sun sets a given
// time after the start.
function scenarioStartHours(sc) {
  if (sc.sunsetAfterS) {
    const h = startLocalTimeBeforeSunset(ORBITS[sc.orbit], sc.sunsetAfterS);
    if (h !== null) return h;
  }
  return sc.startLocalSolarTimeHours !== undefined ? sc.startLocalSolarTimeHours : CONFIG.ENVIRONMENT.geoStartLocalSolarTimeHours;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.ENVIRONMENT.hdrExposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const sceneRoot = buildScene({ orbit, renderer, startLocalSolarTimeHours: scenarioStartHours(scenario) });
const { backgroundScene, backgroundCamera, foregroundScene, foregroundCamera, sunLight, updateEnvironment } = sceneRoot;

const chaser = buildChaser();
const target = buildTarget(scenario.client);
foregroundScene.add(chaser.root);
foregroundScene.add(target.root);
// Refuelling arm on the servicer docking plate (levels 5 to 7; folded during the capture levels).
const arm = buildArm({ chaserRoot: chaser.root });

const approachAxis = buildApproachAxis({
  fromX: 2.14,
  toX: 40,
  callouts: [
    { d: 1.0, label: 'capture 1 m' },
    { d: CHALLENGE.impingementDm, label: '2 m' }
  ]
});
foregroundScene.add(approachAxis.root);
const calloutDivs = approachAxis.markers.map((m) => {
  const div = document.createElement('div');
  div.className = 'callout';
  div.textContent = m.label;
  overlayEl.appendChild(div);
  return { div, marker: m };
});

const cameraRig = new CameraRig({
  foregroundCamera,
  backgroundCamera,
  chaserRoot: chaser.root,
  targetRoot: target.root,
  approachAxisRoot: approachAxis.root,
  domElement: renderer.domElement
});
// The outside view frames both spacecraft: it looks at the point halfway between them and backs
// off as they move apart.
const pairPoint = new THREE.Vector3();
const pairFocus = () => pairPoint.addVectors(chaser.root.position, target.root.position).multiplyScalar(0.5);
const pairFitRadius = () => 6 + 1.1 * chaser.root.position.distanceTo(target.root.position);

const hud = new Hud({ overlayEl });
for (const b of [hud.topLeft, hud.topRight, hud.bottomCenter, hud.bottomRight]) b.style.display = 'none';
hud.help.innerHTML =
  '<b>Controls</b><br>' +
  'Hold W to close in, S to brake · hold the arrow keys to move sideways, as seen in the docking camera<br>' +
  'A tap fires a short pulse, holding keeps the thrusters firing (44 N on 2 tonnes: about 2 cm/s per second)<br>' +
  'Non-cooperative client: hold U or O to roll with its spin until it stops turning in the docking camera<br>' +
  'SPACE extends the probe when every light is green<br>' +
  'Level 5 Connect: the arrow keys move the tool as seen in the tool camera, W lowers it, S raises it, ' +
  'SHIFT for fine motion; SPACE removes the cap, then mates<br>' +
  'Level 6 Transfer: L leak check, 1 2 3 valves in order (and in reverse order to close), SPACE starts and stops ' +
  'the flow, up and down arrows set the opening<br>' +
  'Level 7 Depart: arrow keys and W S add to the separation plan, Backspace clears it, SPACE executes; ' +
  'T and G change the fast-forward after the burn<br>' +
  'C cycles the cameras: the approach and the departure open on the outside view of both spacecraft, ' +
  'with the docking camera (or the tool camera on the arm) in the lower right corner; drag to orbit and use ' +
  'the wheel to zoom<br>' +
  'M LVLH plot · B music on or off · V voice on or off · K all sound on or off · Esc pause · F1 this help<br>' +
  'Gamepad: left stick and d-pad the arrow keys, right stick W and S, triggers U and O, shoulders SHIFT, ' +
  'A SPACE, B Esc, X C, Y M; level 6 needs the keyboard for L and the valves 1 2 3';
const plot = new LvlhPlot({ overlayEl });
plot.setVisible(false);
const pendingActions = [];
const ui = new ChallengeUi({ overlayEl, onAction: (a) => pendingActions.push(a) });
const input = new Input({ domElement: renderer.domElement });
const plumes = new ThrusterPlumes({ chaserRoot: chaser.root, bright: params.get('plumes') === 'bright' });
const pip = new DockingPip({ renderer, overlayEl, backgroundCamera, cameraRig });
const docked = new DockedPlay({ arm, valveCap: target.valveCap, cameraRig, ui, targetRoot: target.root, pairFocus, pairFitRadius });
// Sound: music, effects and the voice callouts (src/audio). They start at the first key or click.
const audio = new AudioSystem();
const director = new AudioDirector(audio.output());

// Settings kept in this browser: training plumes and the corner camera window (the sound keeps its
// own, src/audio/engine.js). The scenario chooses the orbit, so there is no orbit setting.
function readSettings() {
  const out = { trainingPlumes: params.get('plumes') === 'bright', pip: true };
  try {
    const s = JSON.parse(window.localStorage.getItem('refuelSettings') || '{}') || {};
    if (typeof s.trainingPlumes === 'boolean') out.trainingPlumes = s.trainingPlumes;
    if (typeof s.pip === 'boolean') out.pip = s.pip;
  } catch (e) {
    // storage unavailable: defaults
  }
  return out;
}
const settings = readSettings();
plumes.setBright(settings.trainingPlumes);
function saveSettings() {
  try {
    window.localStorage.setItem('refuelSettings', JSON.stringify({ trainingPlumes: settings.trainingPlumes, pip: settings.pip }));
  } catch (e) {
    // storage unavailable: the settings last for this page only
  }
}
// What the menu's settings panel shows.
const menuSettings = () => ({
  trainingPlumes: settings.trainingPlumes,
  pip: settings.pip,
  music: audio.settings.music,
  voice: audio.settings.voice,
  muted: audio.settings.muted,
  volume: audio.settings.volume
});

// Best scores per scenario, kept in this browser. An older store without scenarios belongs to
// the first scenario.
let bestAll = {};
try {
  bestAll = JSON.parse(window.localStorage.getItem('refuelBest') || '{}') || {};
} catch (e) {
  bestAll = {};
}
if (Object.keys(bestAll).some((k) => /^\d+$/.test(k))) bestAll = { [CHALLENGE.scenarios[0].id]: bestAll };
function bestFor(sc) {
  if (!bestAll[sc.id]) bestAll[sc.id] = {};
  return bestAll[sc.id];
}
function saveBest() {
  try {
    window.localStorage.setItem('refuelBest', JSON.stringify(bestAll));
  } catch (e) {
    // storage unavailable: best scores last for this page only
  }
}

// Game state.
let screen = 'menu'; // menu, about, brief, countdown, fly, result, paused
let level = levelFor(1, scenario);
let minRollOn = 0;
let minRollSign = 0;
let flight = null;
let vehicle = null;
let ch = null;
let despin = null; // de-spin of the docked stack after a capture with a spinning client
let plotPref = false; // LVLH plot shown by the player (level 7 always opens it)
let countdownS = 0;
const minOn = { x: 0, y: 0, z: 0 };
const minSign = { x: 0, y: 0, z: 0 };
let lastForce = ZERO;
let resultAtS = 0;
let wallS = 0;
let camHintUntilS = 0; // the camera badge is highlighted until then (or until C is pressed)
let menuSel = 1; // level selected on the menu (up and down arrows, SPACE opens its brief)

// Reused vectors and quaternions in the frame loop (no allocation per frame).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _lvlhToSceneInv = LVLH_TO_SCENE.clone().invert();
let toastUntilS = 0; // a short message (music or voice on or off) is cleared then

function resetLevel(l) {
  level = l;
  despin = null;
  plot.setVisible(plotPref);
  if (level.docked) {
    flight = null;
    vehicle = null;
    ch = null;
    docked.start(level, orbit);
    return;
  }
  docked.reset();
  cameraRig.setContext({ modes: ['chase', 'docking', 'free'], chaseRadius: 18, chaseTarget: pairFocus, chaseMinRadius: pairFitRadius });
  const s = startState(level);
  flight = s.flight;
  vehicle = s.vehicle;
  ch = createChallenge(level, vehicle.deltaVUsedMps);
  ch.rs = relativeState(level, flight, vehicle, 0);
  for (const a of AXES) {
    minOn[a] = 0;
    minSign[a] = 0;
  }
  minRollOn = 0;
  minRollSign = 0;
  chaser.probeGroup.position.x = 0;
}

function openBrief(l) {
  resetLevel(l);
  screen = 'brief';
  ui.showBrief(level, scenario);
}

function openMenu() {
  screen = 'menu';
  resetLevel(levelFor(level.id, scenario));
  menuSel = level.id;
  refreshMenu();
}

function refreshMenu() {
  ui.showMenu(CHALLENGE.levels, bestFor(scenario), CHALLENGE.scenarios, scenario, menuSettings(), menuSel);
}

// Settings panel of the menu.
function handleSetting(a) {
  if (a === 'setting:plumes') {
    settings.trainingPlumes = !settings.trainingPlumes;
    plumes.setBright(settings.trainingPlumes);
    saveSettings();
  } else if (a === 'setting:pip') {
    settings.pip = !settings.pip;
    saveSettings();
  } else if (a === 'setting:music') {
    audio.unlock();
    audio.toggleMusic();
  } else if (a === 'setting:voice') {
    audio.unlock();
    audio.toggleVoice();
  } else if (a === 'setting:mute') {
    audio.unlock();
    audio.toggleMute();
  } else if (a === 'setting:volumeDown' || a === 'setting:volumeUp') {
    audio.unlock();
    const v = Math.round(10 * audio.settings.volume + (a === 'setting:volumeUp' ? 1 : -1)) / 10;
    audio.setVolume('master', Math.max(0, Math.min(1, v)));
  }
  refreshMenu();
}

// Switch scenario from the menu: orbit, lighting and client behaviour change at once.
function setScenario(id) {
  const next = scenarioById(id);
  if (next.id === scenario.id) return;
  scenario = next;
  try {
    window.localStorage.setItem('refuelScenario', scenario.id);
  } catch (e) {
    // storage unavailable: the choice lasts for this page only
  }
  orbit = ORBITS[scenario.orbit];
  n = orbit.nRadPerS;
  sceneRoot.setOrbit(orbit, scenarioStartHours(scenario));
  target.setDesign(scenario.client);
  openMenu();
}

function cycleScenario(step) {
  const list = CHALLENGE.scenarios;
  const i = list.findIndex((sc) => sc.id === scenario.id);
  setScenario(list[(i + step + list.length) % list.length].id);
}

function startCountdown() {
  resetLevel(level);
  // The departure is planned on the LVLH plot: it opens with the level.
  if (level.kind === 'departure') plot.setVisible(true);
  ui.hideScreen();
  screen = 'countdown';
  countdownS = 3;
  camHintUntilS = wallS + 10;
}

function showResult() {
  const r = docked.active() ? docked.result() : ch.result;
  const best = bestFor(scenario);
  const prev = best[level.id];
  const isBest = r.success && (!prev || r.score > prev.score);
  if (isBest) {
    best[level.id] = { score: r.score, stars: r.stars };
    saveBest();
  }
  screen = 'result';
  resultAtS = wallS;
  ui.showResult(level, r, best[level.id], isBest, level.id < CHALLENGE.levels.length, scenario);
}

const PAUSE_TEXT = 'Paused. Esc resumes, Enter restarts the level.';

function toast(text) {
  hud.setMessage(text);
  toastUntilS = wallS + 1.6;
}

function handleAction(a) {
  if (a === 'music' || a === 'voice' || a === 'mute') {
    audio.unlock();
    if (a === 'music') toast(audio.toggleMusic() ? 'Music on (B)' : 'Music off (B)');
    if (a === 'voice') toast(audio.toggleVoice() ? 'Voice on (V)' : 'Voice off (V)');
    if (a === 'mute') toast(audio.toggleMute() ? 'Sound on (K)' : 'Sound off (K)');
    if (screen === 'menu') refreshMenu();
    return;
  }
  if (a.startsWith('setting:')) {
    if (screen === 'menu') handleSetting(a);
    return;
  }
  if (a === 'settings') {
    // On the menu S brings the settings panel into view; in flight S is a translation key.
    if (screen === 'menu') ui.focusSettings();
    return;
  }
  if (a === 'help') {
    hud.setHelpVisible(hud.help.classList.contains('hidden'));
    return;
  }
  if (a === 'camera') {
    cameraRig.cycle();
    camHintUntilS = 0;
    return;
  }
  if (a === 'plot') {
    plot.toggle();
    if (level.kind !== 'departure') plotPref = plot.visible;
    return;
  }
  const m = /^level(\d)$/.exec(a);
  const sc = /^scenario:(\w+)$/.exec(a);
  if (screen === 'menu') {
    if (m) openBrief(levelFor(Number(m[1]), scenario));
    else if (sc) setScenario(sc[1]);
    else if (a === 'confirm' || a === 'restart') openBrief(levelFor(menuSel, scenario));
    else if (a === 'about') {
      screen = 'about';
      ui.showAbout();
    }
  } else if (screen === 'about') {
    if (a === 'menu' || a === 'pause' || a === 'confirm' || a === 'about') openMenu();
  } else if (screen === 'brief') {
    if (a === 'start' || a === 'confirm' || a === 'restart') startCountdown();
    else if (a === 'menu' || a === 'pause') openMenu();
    else if (m) openBrief(levelFor(Number(m[1]), scenario));
  } else if (screen === 'result') {
    // A short guard so that a SPACE pressed for the capture does not skip the result.
    if (wallS - resultAtS < 1.0 && (a === 'confirm' || a === 'restart')) return;
    if (a === 'retry' || a === 'restart' || a === 'confirm') startCountdown();
    else if (a === 'next' && level.id < CHALLENGE.levels.length) openBrief(levelFor(level.id + 1, scenario));
    else if (a === 'menu' || a === 'pause') openMenu();
    else if (m) openBrief(levelFor(Number(m[1]), scenario));
  } else if (screen === 'fly' || screen === 'paused') {
    if (a === 'pause') {
      screen = screen === 'paused' ? 'fly' : 'paused';
      hud.setMessage(screen === 'paused' ? PAUSE_TEXT : '');
    } else if (a === 'restart' && screen === 'paused') {
      hud.setMessage('');
      startCountdown();
    }
  }
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  cameraRig.onResize(w, h);
  backgroundCamera.aspect = w / h;
  backgroundCamera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

const clock = new THREE.Clock();
let captureKey = false;
// Actions that belong to the play of the docked levels (SPACE, the digit keys, T and G).
const DOCKED_ACTIONS = new Set(['confirm', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7', 'warpUp', 'warpDown']);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  wallS += dt;
  input.beginFrame();
  captureKey = false;
  const flyActions = [];
  for (const a of [...input.takeActions(), ...pendingActions.splice(0)]) {
    if (screen === 'fly' && docked.active() && DOCKED_ACTIONS.has(a)) flyActions.push(a);
    else if (a === 'confirm' && screen === 'fly') captureKey = true;
    else handleAction(a);
  }
  // On the menu the left and right arrows switch scenario, up and down select a level.
  if (screen === 'menu') {
    for (const code of input.pressedThisFrame) {
      if (code === 'ArrowRight') cycleScenario(1);
      else if (code === 'ArrowLeft') cycleScenario(-1);
      else if (code === 'ArrowDown' || code === 'ArrowUp') {
        const n = CHALLENGE.levels.length;
        menuSel = ((menuSel - 1 + (code === 'ArrowDown' ? 1 : n - 1)) % n) + 1;
        ui.selectLevel(menuSel);
      }
    }
  }

  if (screen === 'countdown') {
    countdownS -= dt;
    ui.showCountdown(Math.ceil(Math.max(0, countdownS)));
    if (countdownS <= 0) {
      ui.showCountdown(0);
      screen = 'fly';
    }
  }

  lastForce = ZERO;
  if (screen === 'fly' && docked.active()) {
    docked.step(dt, input, flyActions);
    if (docked.done()) showResult();
  } else if (screen === 'fly' && despin) {
    // Hard capture with a spinning client: the stack slows down before the result (SPACE skips).
    stepDespin(despin, dt);
    if (captureKey) despin.done = true;
    if (despin.done) showResult();
  } else if (screen === 'fly') {
    // Held keys fire continuously; a tap fires at least the minimum pulse.
    for (const p of input.translationPresses()) {
      minOn[p.axis] = CHALLENGE.minPulseS;
      minSign[p.axis] = p.sign;
    }
    const held = input.translationIntent();
    const firing = { x: 0, y: 0, z: 0 };
    for (const a of AXES) {
      firing[a] = held[a] !== 0 ? held[a] : minOn[a] > 0 ? minSign[a] : 0;
      minOn[a] = Math.max(0, minOn[a] - dt);
    }
    // Scenarios with a spinning client: U and O command the roll; a tap fires at least 0.1 s.
    if (level.rollControl && (ch.phase === 'fly' || ch.phase === 'extending')) {
      for (const p of input.rotationPresses()) {
        if (p.axis === 'x') {
          minRollOn = CHALLENGE.minPulseS;
          minRollSign = p.sign;
        }
      }
      const heldRoll = input.rotationIntent().x;
      const rollIntent = heldRoll !== 0 ? heldRoll : minRollOn > 0 ? minRollSign : 0;
      minRollOn = Math.max(0, minRollOn - dt);
      rollStep(ch, rollIntent, dt);
    }
    vehicle.heldAttitude = trackingAttitude(level, ch.t, ch.rollRad);
    vehicle.attitudeHold = true;
    if (ch.phase === 'retracting') {
      retractStep(ch, flight, vehicle, dt);
    } else {
      const res = stepFlight(flight, vehicle, { translationHeld: firing }, dt, n);
      lastForce = res.forceBodyN;
    }
    updateChallenge(ch, flight, vehicle, dt, { capture: captureKey, forceBodyN: lastForce });
    if (ch.phase === 'success' && level.spinDegS > 0) {
      despin = createDespin(level, ch.t);
      ch.result.despinS = despin.durationS;
    } else if (ch.phase === 'success' || ch.phase === 'failed') {
      showResult();
    }
  }

  // Sound: the director hears the state of this frame, the engine schedules music and voice.
  director.update(dt, audioSnapshot());
  audio.tick();
  if (toastUntilS && wallS > toastUntilS) {
    toastUntilS = 0;
    hud.setMessage(screen === 'paused' ? PAUSE_TEXT : '');
  }

  plumes.setFiring(lastForce, ZERO);
  plumes.update(dt);

  // Scene: client attitude (and its nozzle axis), servicer pose, probe, arm.
  let tScene;
  let qc;
  let q;
  let c;
  if (docked.active()) {
    const st = docked.sceneState();
    tScene = st.tScene;
    qc = st.qc;
    q = st.q;
    c = st.cw;
    chaser.probeGroup.position.x = st.probeExtM;
    docked.render();
  } else {
    tScene = ch.t + (despin ? despin.t : 0);
    const spin = despin ? despinAngleRad(despin) : null;
    qc = clientQuat(level, tScene, spin);
    q = despin ? attachedAttitude(level, tScene, ch.rollOffsetRad, spin) : vehicle.attitude;
    c = flight.cw;
    chaser.probeGroup.position.x = ch.extensionM;
  }
  _q1.set(qc.x, qc.y, qc.z, qc.w);
  target.root.quaternion.copy(LVLH_TO_SCENE).multiply(_q1);
  approachAxis.root.quaternion.copy(LVLH_TO_SCENE).multiply(_q1).multiply(_lvlhToSceneInv);
  chaser.root.position.set(c.y, c.x, -c.z);
  _q2.set(q.x, q.y, q.z, q.w);
  chaser.root.quaternion.copy(LVLH_TO_SCENE).multiply(_q2);

  updateEnvironment(tScene, wallS);
  cameraRig.update();
  _q3.copy(chaser.root.quaternion).invert();
  chaser.trackSun(_v1.copy(sunLight.position).normalize().applyQuaternion(_q3));
  _q3.copy(target.root.quaternion).invert();
  target.trackSun(_v1.copy(sunLight.position).normalize().applyQuaternion(_q3));

  backgroundCamera.quaternion.copy(foregroundCamera.quaternion);
  backgroundCamera.fov = foregroundCamera.fov;
  backgroundCamera.updateProjectionMatrix();
  // The tool camera looks along the tool axis: the arm itself is not drawn in it.
  const toolView = cameraRig.currentName() === 'tool';
  arm.root.visible = !toolView;
  renderer.autoClear = false;
  renderer.clear();
  renderer.render(backgroundScene, backgroundCamera);
  renderer.clearDepth();
  renderer.render(foregroundScene, foregroundCamera);
  arm.root.visible = true;

  const flying = screen === 'fly' || screen === 'paused' || screen === 'countdown';

  // Outside views keep the docking camera (or the tool camera on the arm) in the lower right corner.
  const pipPose = !flying || !settings.pip ? null : docked.active() ? docked.pipPose(cameraRig.currentName()) : cameraRig.currentName() !== 'docking' && ch.rs ? 'docking' : null;
  pip.setVisible(!!pipPose);
  if (pipPose) {
    const view = docked.active()
      ? docked.pipView()
      : { aimPoint: aimPointWorld(), text: `d ${ch.rs.dM.toFixed(2)} m  ${(100 * ch.rs.closingMps).toFixed(1)} cm/s` };
    pip.render({
      backgroundScene,
      foregroundScene,
      hide: pipPose === 'tool' ? [approachAxis.root, arm.root] : [approachAxis.root],
      aimPoint: view.aimPoint,
      text: view.text,
      pose: pipPose
    });
  }
  const pipOn = !!pipPose;
  plot.canvas.style.bottom = pipOn ? `${pip.rect.h + 2 * pip.margin}px` : '12px';

  ui.setFlying(flying);
  ui.setCameraBadge(cameraRig.currentLabel(), cameraRig.nextLabel(), flying && wallS < camHintUntilS);
  updateCallouts(flying);
  updateReticle(flying);
  if (flying && docked.active()) {
    docked.updateUi(screen === 'countdown');
  } else if (flying && ch.rs) {
    const checks = windowChecks(ch.rs);
    let fb = screen === 'countdown' ? { text: `Get ready · C switches to the ${cameraRig.nextLabel()}`, tone: 'info' } : feedback(ch);
    if (despin) fb = { text: despinText(despin), tone: 'ok' };
    ui.update({
      level,
      ch,
      feedback: fb,
      checks,
      timeLeftS: level.timeS - ch.t,
      dvUsedMps: vehicle.deltaVUsedMps - ch.dvStart
    });
    ui.drawScope({ rs: ch.rs, recommendedMps: recommendedMps(ch.rs.dM) });
  }
  const pd = docked.plotData();
  plot.draw({
    state: { x: c.x, y: c.y },
    trail: pd ? pd.trail : [],
    prediction: pd ? pd.prediction : [],
    extentM: pd ? pd.extentM : null,
    kosRadiusM: 200,
    corridorHalfAngleDeg: 10,
    holdPointsDm: [1.0],
    axisOffsetM: CAPTURE.axisOffsetM,
    ringPlaneM: CAPTURE.ringPlaneAboveClientCmM
  });

  input.endFrame();
  requestAnimationFrame(frame);
}

function updateCallouts(flying) {
  // The axis, its rings and labels sit on the line of sight of the docking camera, whose
  // position is inside the ring radius near capture: they are drawn in the other cameras only.
  const docking = cameraRig.currentName() === 'docking';
  const dockedLevel = docked.active();
  approachAxis.root.visible = !docking && !dockedLevel;
  for (const co of calloutDivs) {
    if (!flying || docking || dockedLevel || (co.marker.d !== 1.0 && !level.impingement)) {
      co.div.style.display = 'none';
      co.marker.mesh.visible = co.marker.d === 1.0 || level.impingement;
      continue;
    }
    co.marker.mesh.visible = true;
    co.marker.mesh.getWorldPosition(_v2);
    const s = _v2.project(foregroundCamera);
    const x = (s.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-s.y * 0.5 + 0.5) * window.innerHeight;
    const visible = s.z > -1 && s.z < 1 && x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight;
    co.div.style.display = visible ? 'block' : 'none';
    co.div.style.left = `${x}px`;
    co.div.style.top = `${y}px`;
  }
}

// State of this frame for the sound director (src/audio/director.js): fresh objects every frame.
function audioSnapshot() {
  const s = {
    screen,
    kind: level.kind || 'capture',
    countdown: screen === 'countdown' ? Math.ceil(Math.max(0, countdownS)) : 0
  };
  if (screen === 'result') {
    const r = docked.active() ? docked.result() : ch && ch.result;
    s.result = r ? { success: r.success, reason: r.reason } : null;
  }
  if (docked.active()) {
    Object.assign(s, docked.audioState());
  } else if (ch && ch.rs) {
    const rs = ch.rs;
    const checks = windowChecks(rs);
    s.timeLeftS = level.timeS - ch.t;
    s.capture = {
      phase: ch.phase,
      dM: rs.dM,
      startDm: level.startDm,
      closingMps: rs.closingMps,
      recMps: recommendedMps(rs.dM),
      allGreen: checks.distance && checks.centred && checks.speed && checks.aligned,
      entered: ch.entered,
      message: ch.message,
      messageS: ch.messageS,
      thrust: screen === 'fly' ? Math.min(1, Math.hypot(lastForce.x, lastForce.y, lastForce.z) / CHASER.rcsTranslationForceN) : 0,
      pulses: screen === 'fly' && ch.phase === 'fly' ? input.translationPresses().length : 0,
      braking: lastForce.x < 0,
      impingement: !!level.impingement,
      rollControl: !!level.rollControl,
      rollRelDegS: rs.rollRateSignedDegS,
      dvFrac: (vehicle.deltaVUsedMps - ch.dvStart) / level.budgetMps
    };
    s.despin = despin ? { active: !despin.done } : null;
  }
  return s;
}

// Point where the probe axis pierces the nozzle exit plane (0.34 m in front of the ring plane):
// the reticle sits on the nozzle when the two are aligned.
function aimPointWorld() {
  const ahead = CHASER.dockingFaceAheadOfCmM + Math.max(0.15, ch.rs.dM - CAPTURE.nozzleExitProtrusionM);
  return new THREE.Vector3(ahead, 0, 0).applyQuaternion(chaser.root.quaternion).add(chaser.root.position);
}

// Docking camera reticle with range and range rate (the tool camera of level 5 has its own text).
function updateReticle(flying) {
  if (flying && docked.active()) {
    hud.updateReticle(docked.reticle(foregroundCamera, cameraRig.currentName()));
    return;
  }
  if (!flying || cameraRig.currentName() !== 'docking' || !ch || !ch.rs) {
    hud.updateReticle({ visible: false });
    return;
  }
  const s = aimPointWorld().project(foregroundCamera);
  hud.updateReticle({
    visible: s.z > -1 && s.z < 1,
    px: (s.x * 0.5 + 0.5) * window.innerWidth,
    py: (-s.y * 0.5 + 0.5) * window.innerHeight,
    rangeM: ch.rs.dM,
    rangeRateMps: -ch.rs.closingMps
  });
}

const startLevel = Number(params.get('level'));
if (startLevel >= 1 && startLevel <= CHALLENGE.levels.length) openBrief(levelFor(startLevel, scenario));
else openMenu();
frame();

window.__sim = {
  renderer, sceneRoot, chaser, target, arm, docked, cameraRig, ui, pip, plot, audio, director,
  settings,
  get scenario() { return scenario; },
  get screen() { return screen; },
  get level() { return level; },
  get ch() { return ch; },
  get despin() { return despin; },
  get flight() { return flight; },
  get vehicle() { return vehicle; }
};
