// tests/input.test.mjs
// Gamepad: the pad's sticks, triggers and buttons become the keys they stand for (padKeyCodes),
// with a hysteresis on the sticks and triggers. Pure function, no browser.

import { padKeyCodes } from '../src/input.js';

function assertTrue(c, m) {
  if (!c) throw new Error(m);
}

const pad = (axes = [0, 0, 0, 0], buttons = {}) => {
  const b = [];
  for (let i = 0; i < 16; i += 1) {
    const v = buttons[i] || 0;
    b.push({ pressed: v > 0.5, value: v });
  }
  return { axes, buttons: b };
};
const keys = (set) => [...set].sort().join(' ');

export const tests = [
  {
    name: '61 Gamepad: sticks, triggers and buttons become the keys they stand for, with hysteresis',
    fn() {
      assertTrue(padKeyCodes(null).size === 0, 'no pad, no keys');
      assertTrue(padKeyCodes(pad()).size === 0, 'pad at rest, no keys');
      assertTrue(keys(padKeyCodes(pad([-0.9, 0, 0, 0]))) === 'ArrowLeft', 'left stick left = left arrow');
      assertTrue(keys(padKeyCodes(pad([0.9, -0.8, 0, 0]))) === 'ArrowRight ArrowUp', 'left stick up right = up and right arrows');
      assertTrue(keys(padKeyCodes(pad([0, 0, 0, -0.7]))) === 'KeyW', 'right stick up = W');
      assertTrue(keys(padKeyCodes(pad([0, 0, 0, 0.7]))) === 'KeyS', 'right stick down = S');
      assertTrue(keys(padKeyCodes(pad([0, 0, 0.9, 0]))) === '', 'right stick sideways does nothing');
      assertTrue(keys(padKeyCodes(pad(undefined, { 6: 0.5, 7: 0.1 }))) === 'KeyU', 'left trigger = U');
      assertTrue(keys(padKeyCodes(pad(undefined, { 0: 1, 1: 1, 2: 1, 3: 1 }))) === 'Escape KeyC KeyM Space', 'A B X Y');
      assertTrue(keys(padKeyCodes(pad(undefined, { 4: 1 }))) === 'ShiftLeft' && keys(padKeyCodes(pad(undefined, { 5: 1 }))) === 'ShiftLeft', 'shoulders = SHIFT');
      assertTrue(keys(padKeyCodes(pad(undefined, { 8: 1, 9: 1 }))) === 'Escape F1', 'Back = F1, Start = Esc');
      assertTrue(keys(padKeyCodes(pad(undefined, { 12: 1, 15: 1 }))) === 'ArrowRight ArrowUp', 'd-pad = arrows');
      // Hysteresis: 0.45 does not press, but keeps a key that is already held; 0.3 lets go.
      assertTrue(!padKeyCodes(pad([-0.45, 0, 0, 0])).has('ArrowLeft'), 'below half deflection: no press');
      assertTrue(padKeyCodes(pad([-0.45, 0, 0, 0]), new Set(['ArrowLeft'])).has('ArrowLeft'), 'held key stays held at 0.45');
      assertTrue(!padKeyCodes(pad([-0.3, 0, 0, 0]), new Set(['ArrowLeft'])).has('ArrowLeft'), 'and lets go below 0.35');
      // A pad that reports buttons as numbers (some older browsers).
      assertTrue(keys(padKeyCodes({ axes: [0, 0], buttons: [1, 0, 0, 0] })) === 'Space', 'numeric buttons');
    }
  }
];

export default tests;
