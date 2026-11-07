// src/input.js
// Keyboard and gamepad input. Produces per-frame presses, held intents and actions;
// no physics, no DOM writes.
//
// Body axes: +X forward along the docking axis, +Y left, +Z up (right-handed).
// Positive rotation follows the right-hand rule: +Y pitches the nose down, +Z yaws the nose
// left, +X rolls to the right.
//
// Gamepad: the pad works as a keyboard. Every frame its sticks, triggers and buttons become the
// keys they stand for (padKeyCodes), held and pressed exactly like them, so the pad drives every
// screen and level the keys drive: left stick and d-pad = arrow keys, right stick up and down =
// W and S, left and right trigger = U and O, shoulders = SHIFT, A = SPACE, B and Start = Esc,
// X = C, Y = M, Back = F1. Level 6 still needs the keyboard for L and the valve keys 1, 2, 3.

const TRANSLATION_KEYS = {
  KeyW: { axis: 'x', sign: 1 }, // forward
  KeyS: { axis: 'x', sign: -1 }, // back
  KeyA: { axis: 'y', sign: 1 }, // left
  KeyD: { axis: 'y', sign: -1 }, // right
  KeyR: { axis: 'z', sign: 1 }, // up
  KeyF: { axis: 'z', sign: -1 }, // down
  ArrowLeft: { axis: 'y', sign: 1 }, // the arrows move the chaser as seen in the docking camera
  ArrowRight: { axis: 'y', sign: -1 },
  ArrowUp: { axis: 'z', sign: 1 },
  ArrowDown: { axis: 'z', sign: -1 }
};

const ROTATION_KEYS = {
  KeyI: { axis: 'y', sign: 1 }, // pitch nose down
  KeyK: { axis: 'y', sign: -1 }, // pitch nose up
  KeyJ: { axis: 'z', sign: 1 }, // yaw left
  KeyL: { axis: 'z', sign: -1 }, // yaw right
  KeyU: { axis: 'x', sign: -1 }, // roll left
  KeyO: { axis: 'x', sign: 1 } // roll right
};

const ACTION_KEYS = {
  KeyP: 'toggleTranslationMode',
  KeyH: 'attitudeHold',
  KeyX: 'capture',
  KeyT: 'warpUp',
  KeyG: 'warpDown',
  KeyC: 'camera',
  KeyM: 'plot',
  KeyB: 'music', // background music on or off
  KeyV: 'voice', // voice callouts on or off
  KeyK: 'mute', // all sound on or off
  KeyS: 'settings', // on the menu only; in flight S stays a translation key
  Escape: 'pause',
  F1: 'help',
  Slash: 'help',
  KeyN: 'next',
  Space: 'confirm',
  Enter: 'restart',
  NumpadEnter: 'restart',
  Digit1: 'level1',
  Digit2: 'level2',
  Digit3: 'level3',
  Digit4: 'level4',
  Digit5: 'level5',
  Digit6: 'level6',
  Digit7: 'level7',
  Numpad1: 'level1',
  Numpad2: 'level2',
  Numpad3: 'level3',
  Numpad4: 'level4',
  Numpad5: 'level5',
  Numpad6: 'level6',
  Numpad7: 'level7',
  KeyA: 'about' // on the menu only; in flight A stays a translation key
};

// Gamepad buttons (standard mapping) and the keys they stand for. 12 to 15: the d-pad.
const PAD_BUTTON_KEYS = {
  0: 'Space', // A
  1: 'Escape', // B
  2: 'KeyC', // X
  3: 'KeyM', // Y
  4: 'ShiftLeft', // left shoulder
  5: 'ShiftLeft', // right shoulder
  8: 'F1', // Back
  9: 'Escape', // Start
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight'
};

// Keys held on a gamepad (standard mapping). A stick counts as a key past half deflection and is
// let go below 0.35, so that it does not chatter at the threshold; a trigger past 0.3 (let go
// below 0.2). prevHeld: the keys of the previous frame.
export function padKeyCodes(pad, prevHeld = new Set()) {
  const held = new Set();
  if (!pad) return held;
  const press = (code, v, on, off) => {
    if (v > (prevHeld.has(code) ? off : on)) held.add(code);
  };
  const axis = (i) => (pad.axes && Number(pad.axes[i])) || 0;
  const button = (i) => {
    const b = pad.buttons ? pad.buttons[i] : null;
    if (!b) return 0;
    if (typeof b === 'object') return b.value > 0 ? b.value : b.pressed ? 1 : 0;
    return Number(b) || 0;
  };
  press('ArrowLeft', -axis(0), 0.5, 0.35);
  press('ArrowRight', axis(0), 0.5, 0.35);
  press('ArrowUp', -axis(1), 0.5, 0.35);
  press('ArrowDown', axis(1), 0.5, 0.35);
  press('KeyW', -axis(3), 0.5, 0.35);
  press('KeyS', axis(3), 0.5, 0.35);
  press('KeyU', button(6), 0.3, 0.2);
  press('KeyO', button(7), 0.3, 0.2);
  for (const [i, code] of Object.entries(PAD_BUTTON_KEYS)) {
    if (button(Number(i)) > 0.5) held.add(code);
  }
  return held;
}

export class Input {
  constructor({ domElement }) {
    this.domElement = domElement;
    // Keys held now: those of the keyboard (kbKeys) and those of the gamepad (padKeys).
    this.keys = new Set();
    this.kbKeys = new Set();
    this.padKeys = new Set();
    // Key presses since the last frame. Filled by the key events between frames and by the
    // gamepad at the start of the frame, read during the frame, cleared by endFrame().
    this.pressedThisFrame = [];
    this.actions = [];
    this.gamepadIndex = null;

    this._onKeyDown = (e) => {
      if (e.code === 'F1' || e.code === 'Space' || e.code === 'Backspace' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.kbKeys.add(e.code);
      this.keys.add(e.code);
      this.pressedThisFrame.push(e.code);
    };
    this._onKeyUp = (e) => {
      this.kbKeys.delete(e.code);
      if (!this.padKeys.has(e.code)) this.keys.delete(e.code);
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => {
      this.kbKeys.clear();
      this.keys = new Set(this.padKeys);
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  // Called once per frame before reading presses and intents.
  beginFrame() {
    this.actions.length = 0;
    this._pollGamepad();
  }

  // Called once per frame after the simulation has consumed the presses.
  endFrame() {
    this.pressedThisFrame.length = 0;
  }

  _pad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] || null;
  }

  // The gamepad's keys of this frame: a key that goes down is a press, as on the keyboard.
  _pollGamepad() {
    const held = padKeyCodes(this._pad(), this.padKeys);
    for (const code of held) {
      if (!this.padKeys.has(code)) {
        if (!this.keys.has(code)) this.pressedThisFrame.push(code);
        this.keys.add(code);
      }
    }
    for (const code of this.padKeys) {
      if (!held.has(code) && !this.kbKeys.has(code)) this.keys.delete(code);
    }
    this.padKeys = held;
  }

  // True when the key (KeyboardEvent.code) went down since the last frame.
  wasPressed(code) {
    return this.pressedThisFrame.includes(code);
  }

  shiftHeld() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  // Translation key presses this frame: [{ axis, sign }] (PULSE mode).
  translationPresses() {
    const out = [];
    for (const code of this.pressedThisFrame) {
      const k = TRANSLATION_KEYS[code];
      if (k) out.push({ axis: k.axis, sign: k.sign });
    }
    return out;
  }

  // Rotation key presses this frame: [{ axis, sign }] (Realistic mode).
  rotationPresses() {
    const out = [];
    for (const code of this.pressedThisFrame) {
      const k = ROTATION_KEYS[code];
      if (k) out.push({ axis: k.axis, sign: k.sign });
    }
    return out;
  }

  // Held translation per body axis, -1..1 (CONTINUOUS mode).
  translationIntent() {
    const out = { x: 0, y: 0, z: 0 };
    for (const code of this.keys) {
      const k = TRANSLATION_KEYS[code];
      if (k) out[k.axis] += k.sign;
    }
    for (const a of ['x', 'y', 'z']) out[a] = Math.max(-1, Math.min(1, out[a]));
    return out;
  }

  // Held rotation per body axis, -1..1 (Arcade mode).
  rotationIntent() {
    const out = { x: 0, y: 0, z: 0 };
    for (const code of this.keys) {
      const k = ROTATION_KEYS[code];
      if (k) out[k.axis] += k.sign;
    }
    for (const a of ['x', 'y', 'z']) out[a] = Math.max(-1, Math.min(1, out[a]));
    return out;
  }

  // Discrete actions this frame (key presses, from the keyboard or the gamepad).
  takeActions() {
    const out = [];
    for (const code of this.pressedThisFrame) {
      const a = ACTION_KEYS[code];
      if (a) out.push(a);
    }
    out.push(...this.actions);
    return out;
  }

  // True if any translation or rotation control is held or was pressed this frame.
  hasControlInput() {
    for (const code of this.keys) {
      if (TRANSLATION_KEYS[code] || ROTATION_KEYS[code]) return true;
    }
    for (const code of this.pressedThisFrame) {
      if (TRANSLATION_KEYS[code] || ROTATION_KEYS[code]) return true;
    }
    const t = this.translationIntent();
    const r = this.rotationIntent();
    return t.x !== 0 || t.y !== 0 || t.z !== 0 || r.x !== 0 || r.y !== 0 || r.z !== 0;
  }
}
